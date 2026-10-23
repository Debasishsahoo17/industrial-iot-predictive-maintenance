"""Zero-third-party-dependency HTTP REST API and static application server."""
import json
import mimetypes
import os
import re
import sqlite3
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

from .database import DB_LOCK, DB_PATH, advance_simulation, connection, init_db
from .model import predict

ROOT = Path(__file__).resolve().parent.parent
WEB = ROOT / 'web'
MIME = {'.js':'text/javascript', '.css':'text/css', '.svg':'image/svg+xml', '.webp':'image/webp'}


def rows(cursor):
    return [dict(r) for r in cursor.fetchall()]


def summarize_asset(asset, telemetry):
    info = dict(asset)
    if telemetry:
        record = dict(telemetry)
        info.update({k:record[k] for k in ('temperature','vibration','pressure','current','rpm','ts')})
        info.update(predict(record))
    return info


def assets(db):
    # Join newest row using MAX(id), avoiding correlated timestamp ambiguity.
    records = db.execute('''SELECT a.*, t.temperature,t.vibration,t.pressure,t.current,t.rpm,t.ts
        FROM assets a LEFT JOIN telemetry t ON t.id=(
           SELECT MAX(id) FROM telemetry WHERE asset_id=a.id)
        ORDER BY a.id''').fetchall()
    return [summarize_asset(r, r) for r in records]


def overview(db):
    fleet = assets(db)
    counts = {status: sum(a.get('status') == status for a in fleet)
              for status in ('healthy','warning','critical')}
    active_alerts = db.execute('SELECT COUNT(*) FROM alerts WHERE acknowledged=0').fetchone()[0]
    open_orders = db.execute("SELECT COUNT(*) FROM work_orders WHERE status!='completed'").fetchone()[0]
    all_alerts = rows(db.execute('''SELECT al.*, a.name AS asset_name FROM alerts al
        JOIN assets a ON a.id=al.asset_id ORDER BY al.created_at DESC, al.id DESC LIMIT 6'''))
    trend = []
    # Average snapshot fleet score for each of last 24 hourly sample positions.
    # Based on data (not fabricated smooth graph points).
    history = rows(db.execute('''SELECT asset_id,temperature,vibration,pressure,current,rpm,
        ROW_NUMBER() OVER(PARTITION BY asset_id ORDER BY id DESC) AS rn
        FROM telemetry'''))
    grouped = {}
    for h in history:
        if h['rn'] <= 24:
            grouped.setdefault(h['rn'], []).append(predict(h)['risk'])
    for i in range(24,0,-1):
        scores = grouped.get(i, [])
        trend.append({'hour':24-i,'health':round(100 - sum(scores)/len(scores), 1) if scores else 0})
    return {
        'assets': fleet,
        'stats':{'total':len(fleet),'healthy':counts['healthy'], 'warning':counts['warning'],
                 'critical':counts['critical'], 'fleet_health':round(100-sum(x['risk'] for x in fleet)/max(len(fleet),1)),
                 'active_alerts':active_alerts,'open_orders':open_orders},
        'alerts':all_alerts,'trend':trend,
        'generated_at':datetime.now(timezone.utc).isoformat().replace('+00:00','Z'),
    }


class Handler(BaseHTTPRequestHandler):
    server_version = 'PulseCore/1.0'

    def log_message(self, fmt, *args):
        if not os.environ.get('PULSECORE_QUIET'):
            super().log_message(fmt, *args)

    def respond(self, obj, status=200):
        raw = json.dumps(obj, allow_nan=False, separators=(',', ':')).encode()
        self.send_response(status)
        self.send_header('Content-Type','application/json; charset=utf-8')
        self.send_header('Content-Length',str(len(raw)))
        self.send_header('Cache-Control','no-store')
        self.end_headers()
        self.wfile.write(raw)

    def error(self, status, message):
        self.respond({'error':message}, status)

    def body(self):
        length = int(self.headers.get('Content-Length', 0))
        if length < 1 or length > 65536:
            raise ValueError('Request body must be 1 to 65536 bytes')
        try:
            obj = json.loads(self.rfile.read(length))
        except (json.JSONDecodeError, UnicodeDecodeError) as e:
            raise ValueError('Invalid JSON body') from e
        if not isinstance(obj, dict):
            raise ValueError('JSON body must be an object')
        return obj

    def serve_static(self, path):
        path = '/index.html' if path in ('/', '/dashboard') else path
        candidate = (WEB / path.lstrip('/')).resolve()
        if not candidate.is_relative_to(WEB.resolve()) or not candidate.is_file():
            return self.error(404, 'Not found')
        data = candidate.read_bytes()
        mime = MIME.get(candidate.suffix) or mimetypes.guess_type(candidate.name)[0] or 'application/octet-stream'
        self.send_response(200)
        self.send_header('Content-Type', mime)
        self.send_header('Content-Length',str(len(data)))
        self.send_header('Cache-Control', 'public, max-age=3600' if candidate.suffix!='.html' else 'no-cache')
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        target = urlsplit(self.path)
        path = target.path
        try:
            if not path.startswith('/api/'):
                return self.serve_static(path)
            with connection(self.server.db_path) as db:
                if path == '/api/health':
                    return self.respond({'status':'ok','storage':'sqlite','demo_mode':True})
                if path == '/api/overview':
                    return self.respond(overview(db))
                if path == '/api/assets':
                    return self.respond({'items':assets(db)})
                if match := re.fullmatch(r'/api/assets/([A-Z0-9-]+)',path):
                    aid = match.group(1)
                    asset = db.execute('SELECT * FROM assets WHERE id=?',(aid,)).fetchone()
                    if not asset: return self.error(404,'Asset not found')
                    readings = rows(db.execute('''SELECT ts,temperature,vibration,pressure,current,rpm
                        FROM telemetry WHERE asset_id=? ORDER BY id DESC LIMIT 96''',(aid,)))
                    return self.respond({'asset':next(x for x in assets(db) if x['id']==aid),
                        'history':readings[::-1],
                        'alerts':rows(db.execute('SELECT * FROM alerts WHERE asset_id=? ORDER BY id DESC',(aid,))),
                        'work_orders':rows(db.execute('SELECT * FROM work_orders WHERE asset_id=? ORDER BY id DESC',(aid,)))})
                if path == '/api/alerts':
                    status = parse_qs(target.query).get('status',['all'])[0]
                    if status not in ('all','active','acknowledged'):
                        return self.error(400,'Invalid status filter')
                    clause = '' if status == 'all' else 'WHERE al.acknowledged=?'
                    args = () if status == 'all' else (0 if status=='active' else 1,)
                    return self.respond({'items':rows(db.execute(f'''SELECT al.*,a.name AS asset_name
                        FROM alerts al JOIN assets a ON a.id=al.asset_id {clause}
                        ORDER BY al.created_at DESC, al.id DESC''',args))})
                if path == '/api/work-orders':
                    return self.respond({'items':rows(db.execute('''SELECT w.*,a.name AS asset_name
                        FROM work_orders w JOIN assets a ON a.id=w.asset_id ORDER BY w.id DESC'''))})
                return self.error(404,'API endpoint not found')
        except sqlite3.Error:
            return self.error(500,'Database error')

    def do_POST(self):
        path = urlsplit(self.path).path
        try:
            with DB_LOCK, connection(self.server.db_path) as db:
                if path == '/api/simulate':
                    result = advance_simulation(db)
                    return self.respond(result,201)
                if match := re.fullmatch(r'/api/alerts/(\d+)/acknowledge',path):
                    result = db.execute('UPDATE alerts SET acknowledged=1 WHERE id=?',(int(match.group(1)),))
                    if not result.rowcount: return self.error(404,'Alert not found')
                    db.commit()
                    return self.respond({'ok':True})
                if path == '/api/work-orders':
                    obj = self.body()
                    aid = str(obj.get('asset_id','')).strip()
                    title = str(obj.get('title','')).strip()
                    priority = str(obj.get('priority','medium')).strip()
                    notes = str(obj.get('notes','')).strip()
                    if not aid or not db.execute('SELECT 1 FROM assets WHERE id=?',(aid,)).fetchone():
                        return self.error(400,'Valid asset_id is required')
                    if not (3 <= len(title) <= 120) or priority not in ('low','medium','high') or len(notes)>1000:
                        return self.error(400,'Invalid title, priority or notes')
                    created = datetime.now(timezone.utc).isoformat(timespec='seconds').replace('+00:00','Z')
                    cur = db.execute('''INSERT INTO work_orders(asset_id,title,priority,notes,created_at)
                        VALUES(?,?,?,?,?)''',(aid,title,priority,notes,created))
                    db.commit()
                    return self.respond({'id':cur.lastrowid,'status':'open'},201)
                return self.error(404,'API endpoint not found')
        except ValueError as e:
            return self.error(400,str(e))
        except sqlite3.Error:
            return self.error(500,'Database error')

    def do_PATCH(self):
        path = urlsplit(self.path).path
        try:
            with DB_LOCK, connection(self.server.db_path) as db:
                if match := re.fullmatch(r'/api/work-orders/(\d+)',path):
                    body = self.body()
                    status = body.get('status')
                    if status not in ('open','in_progress','completed'):
                        return self.error(400,'Invalid work order status')
                    result = db.execute('UPDATE work_orders SET status=? WHERE id=?',
                                        (status,int(match.group(1))))
                    if not result.rowcount: return self.error(404,'Work order not found')
                    db.commit()
                    return self.respond({'ok':True,'status':status})
                return self.error(404,'API endpoint not found')
        except ValueError as e:
            return self.error(400,str(e))
        except sqlite3.Error:
            return self.error(500,'Database error')


def serve(host='127.0.0.1', port=8000, db_path=None):
    db_path = str(db_path or os.getenv('PULSECORE_DB', DB_PATH))
    init_db(db_path)
    server = ThreadingHTTPServer((host,int(port)),Handler)
    server.db_path = db_path
    print(f'PulseCore running at http://{host}:{port}')
    print('Demo-only synthetic data · press Ctrl+C to stop')
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
