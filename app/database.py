"""SQLite persistence, deterministic seed fixtures, and synthetic sensor simulator."""
from contextlib import contextmanager
import datetime as dt
import math
import random
import sqlite3
import threading
from pathlib import Path

from .model import predict

DB_LOCK = threading.RLock()
DB_PATH = Path(__file__).resolve().parent.parent / 'data' / 'pulsecore.db'
UTC = dt.timezone.utc

ASSET_SPECS = [
    ('MTR-001', 'Main drive motor', 'Motor', 'Assembly Line A', 'Siemens', '1LE1503', 0.05, 'motor'),
    ('PMP-002', 'Coolant circulation pump', 'Pump', 'Assembly Line A', 'Grundfos', 'CR 32', 0.20, 'pump'),
    ('CMP-003', 'Air compressor unit', 'Compressor', 'Utility Block', 'Atlas Copco', 'GA 37', 0.78, 'facility'),
    ('MTR-004', 'Conveyor belt motor', 'Motor', 'Assembly Line B', 'ABB', 'M3BP 160', 0.08, 'motor'),
    ('FAN-005', 'Industrial exhaust fan', 'Fan', 'Utility Block', 'ebm-papst', 'W3G', 0.43, 'facility'),
    ('PMP-006', 'Hydraulic feed pump', 'Pump', 'Assembly Line B', 'Bosch Rexroth', 'A10VSO', 0.95, 'pump'),
    ('MTR-007', 'Precision spindle motor', 'Motor', 'CNC Bay', 'Siemens', '1PH8', 0.24, 'motor'),
    ('CMP-008', 'Backup air compressor', 'Compressor', 'Utility Block', 'Ingersoll Rand', 'R-Series', 0.14, 'facility'),
    ('FAN-009', 'Cooling tower fan', 'Fan', 'Cooling Station', 'Howden', 'AXC', 0.50, 'facility'),
    ('PMP-010', 'Water treatment pump', 'Pump', 'Cooling Station', 'Grundfos', 'NB 50', 0.10, 'pump'),
    ('MTR-011', 'Packaging line motor', 'Motor', 'Packaging Hall', 'ABB', 'M2BAX', 0.06, 'motor'),
    ('PMP-012', 'Transfer feed pump', 'Pump', 'CNC Bay', 'KSB', 'Etanorm', 0.63, 'pump'),
]


@contextmanager
def connection(path=None):
    path = str(path or DB_PATH)
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path, timeout=20, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute('PRAGMA foreign_keys=ON')
    conn.execute('PRAGMA journal_mode=WAL')
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db(path=None):
    with DB_LOCK, connection(path) as db:
        db.executescript('''
        CREATE TABLE IF NOT EXISTS assets (
            id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL,
            location TEXT NOT NULL, manufacturer TEXT NOT NULL, model TEXT NOT NULL,
            condition REAL NOT NULL DEFAULT 0, image TEXT NOT NULL,
            installed_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS telemetry (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            asset_id TEXT NOT NULL REFERENCES assets(id),
            ts TEXT NOT NULL, temperature REAL NOT NULL,
            vibration REAL NOT NULL, pressure REAL NOT NULL,
            current REAL NOT NULL, rpm REAL NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_telemetry_asset_time ON telemetry(asset_id, ts DESC);
        CREATE TABLE IF NOT EXISTS alerts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            asset_id TEXT NOT NULL REFERENCES assets(id),
            severity TEXT NOT NULL CHECK(severity IN ('warning','critical')),
            title TEXT NOT NULL, detail TEXT NOT NULL, created_at TEXT NOT NULL,
            acknowledged INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS work_orders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            asset_id TEXT NOT NULL REFERENCES assets(id),
            title TEXT NOT NULL, priority TEXT NOT NULL CHECK(priority IN ('low','medium','high')),
            notes TEXT NOT NULL DEFAULT '',
            status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','in_progress','completed')),
            created_at TEXT NOT NULL
        );
        ''')
        count = db.execute('SELECT COUNT(*) FROM assets').fetchone()[0]
        if count == 0:
            seed(db)
        db.commit()


def timestamp(t):
    return t.isoformat(timespec='seconds').replace('+00:00', 'Z')


def readings(condition, progress, rng):
    """Synthetic signals: gradual wear, wave motion and small sensor noise."""
    wear = condition * (0.35 + 0.65 * progress)
    cyc = math.sin(progress * 19 * math.pi)
    def r(x, places=2):
        return round(x, places)
    return {
        'temperature': r(59.6 + 30 * wear + 1.7 * cyc + rng.gauss(0, 1.0)),
        'vibration': r(max(0.5, 1.8 + 6.0 * wear + 0.3 * cyc + rng.gauss(0, 0.23))),
        'pressure': r(6.2 - 1.1 * wear + rng.gauss(0, 0.13)),
        'current': r(16.8 + 12.5 * wear + 0.55 * cyc + rng.gauss(0, 0.6)),
        'rpm': r(1490 - 180 * wear + rng.gauss(0, 18), 0),
    }


def seed(db, now=None):
    rng = random.Random(20261023)
    now = now or dt.datetime.now(UTC)
    started = now - dt.timedelta(days=7)
    for spec in ASSET_SPECS:
        aid, name, kind, location, manufacturer, model, wear, image = spec
        db.execute('INSERT INTO assets VALUES (?,?,?,?,?,?,?,?,?)',
                   (aid, name, kind, location, manufacturer, model, wear, image, '2022-06-12'))
        for step in range(169):
            t = started + dt.timedelta(hours=step)
            vals = readings(wear, step / 168, rng)
            db.execute('''INSERT INTO telemetry
                (asset_id,ts,temperature,vibration,pressure,current,rpm)
                VALUES (?,?,?,?,?,?,?)''',
                (aid, timestamp(t), *vals.values()))
    # Demo alert/work order history illustrating workflows.
    for aid, title, detail, hours in [
        ('PMP-006','Critical vibration anomaly','Vibration increased beyond normal operating baseline.', 2),
        ('CMP-003','Compressor overheating trend','Sustained temperature elevation detected.', 5),
        ('PMP-012','Bearing degradation pattern','Combination of vibration and power draw anomalies.', 8),
        ('FAN-009','Exhaust fan deviation','Moderate vibration increase requires inspection.', 17),
        ('FAN-005','Fan temperature trending upward','Review lubrication and operating load.', 26),
    ]:
        sev = 'critical' if aid in ('PMP-006','CMP-003','PMP-012') else 'warning'
        db.execute('INSERT INTO alerts(asset_id,severity,title,detail,created_at) VALUES(?,?,?,?,?)',
                   (aid, sev, title, detail, timestamp(now-dt.timedelta(hours=hours))))
    for aid,title,priority,status,notes in [
        ('PMP-006','Inspect hydraulic pump bearings','high','in_progress','Check alignment and bearing housing temperature.'),
        ('CMP-003','Compressor cooling system inspection','high','open','Inspect filters, cooling fins and airflow.'),
        ('FAN-005','Fan lubrication service','medium','completed','Routine scheduled maintenance complete.'),
    ]:
        db.execute('''INSERT INTO work_orders
            (asset_id,title,priority,notes,status,created_at) VALUES(?,?,?,?,?,?)''',
            (aid,title,priority,notes,status,timestamp(now-dt.timedelta(days=1))))


def advance_simulation(db, now=None):
    """Append one synthetic reading to every asset; create alert on new high risk."""
    rng = random.Random()
    now = now or dt.datetime.now(UTC)
    inserted = 0
    new_alerts = 0
    for asset in db.execute('SELECT * FROM assets').fetchall():
        prev = db.execute('SELECT * FROM telemetry WHERE asset_id=? ORDER BY id DESC LIMIT 1',
                          (asset['id'],)).fetchone()
        last = {k: prev[k] for k in ('temperature','vibration','pressure','current','rpm')}
        drift = min(1.4, asset['condition'] + rng.uniform(-0.03, 0.035))
        target = readings(drift, 1.0, rng)
        vals = {k: round(last[k]*0.68 + target[k]*0.32, 2) for k in target}
        db.execute('''INSERT INTO telemetry (asset_id,ts,temperature,vibration,pressure,current,rpm)
            VALUES (?,?,?,?,?,?,?)''', (asset['id'],timestamp(now),*vals.values()))
        inserted += 1
        p = predict(vals)
        # Cooldown: avoid alert spam while users repeatedly click simulator.
        recent = db.execute('''SELECT created_at FROM alerts WHERE asset_id=?
            ORDER BY id DESC LIMIT 1''', (asset['id'],)).fetchone()
        last_alert_at = dt.datetime.fromisoformat(recent['created_at'].replace('Z','+00:00')) if recent else None
        if p['status'] != 'healthy' and (not last_alert_at or now-last_alert_at >= dt.timedelta(hours=4)):
            db.execute('''INSERT INTO alerts(asset_id,severity,title,detail,created_at)
                VALUES(?,?,?,?,?)''', (asset['id'],p['status'],f'{asset["name"]}: {p["status"]} risk',
                    f'Simulated risk score {p["risk"]}/100. Review telemetry and inspect equipment.',timestamp(now)))
            new_alerts += 1
    db.commit()
    return {'readings_added':inserted,'alerts_created':new_alerts,'timestamp':timestamp(now)}
