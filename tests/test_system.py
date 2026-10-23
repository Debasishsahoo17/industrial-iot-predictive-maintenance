"""Integration regression tests; runs entirely with Python stdlib."""
import http.client
import json
import tempfile
import threading
import unittest
from pathlib import Path
from http.server import ThreadingHTTPServer

from app.database import init_db, connection
from app.model import predict
from app.server import Handler, overview


class ApiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.path = str(Path(cls.temp.name) / 'test.db')
        init_db(cls.path)
        cls.server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        cls.server.db_path = cls.path
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.temp.cleanup()

    def call(self, method, path, obj=None):
        conn = http.client.HTTPConnection('127.0.0.1', self.server.server_port, timeout=5)
        body = json.dumps(obj).encode() if obj is not None else None
        headers = {'Content-Type': 'application/json'} if body is not None else {}
        conn.request(method, path, body=body, headers=headers)
        response = conn.getresponse()
        data = response.read()
        result = json.loads(data) if response.getheader('Content-Type','').startswith('application/json') else data
        status = response.status
        conn.close()
        return status, result

    def test_01_health(self):
        status, obj = self.call('GET', '/api/health')
        self.assertEqual(status, 200)
        self.assertTrue(obj['demo_mode'])

    def test_02_fleet_overview(self):
        status, obj = self.call('GET','/api/overview')
        self.assertEqual(status,200)
        self.assertEqual(obj['stats']['total'],12)
        self.assertEqual(len(obj['trend']),24)
        self.assertEqual(len(obj['assets']),12)
        self.assertTrue(all(0 <= a['risk'] <= 100 for a in obj['assets']))

    def test_03_asset_detail(self):
        status, data = self.call('GET','/api/assets/PMP-006')
        self.assertEqual(status, 200)
        self.assertEqual(len(data['history']),96)
        self.assertEqual(data['asset']['id'],'PMP-006')

    def test_04_missing_asset(self):
        status, obj = self.call('GET', '/api/assets/NO-999')
        self.assertEqual(status,404)
        self.assertIn('error',obj)

    def test_05_alert_acknowledgement(self):
        status, initial = self.call('GET', '/api/alerts?status=active')
        self.assertEqual(status,200)
        aid=initial['items'][0]['id']
        status, result = self.call('POST',f'/api/alerts/{aid}/acknowledge',{})
        self.assertEqual(status,200)
        status, active = self.call('GET','/api/alerts?status=active')
        self.assertTrue(all(x['id'] != aid for x in active['items']))
        status, closed=self.call('GET','/api/alerts?status=acknowledged')
        self.assertTrue(any(x['id']==aid for x in closed['items']))

    def test_06_create_work_order_and_update(self):
        status, created = self.call('POST','/api/work-orders',{
            'asset_id':'MTR-001','title':'Inspect shaft bearings','priority':'high','notes':'Test work order'})
        self.assertEqual(status,201)
        order_id=created['id']
        status, updated=self.call('PATCH',f'/api/work-orders/{order_id}',{'status':'in_progress'})
        self.assertEqual(status,200)
        self.assertEqual(updated['status'],'in_progress')
        status, orders=self.call('GET','/api/work-orders')
        self.assertTrue(any(o['id']==order_id and o['status']=='in_progress' for o in orders['items']))

    def test_07_bad_work_order(self):
        status, obj=self.call('POST','/api/work-orders',{'asset_id':'FAKE-999','title':'OK','priority':'high'})
        self.assertEqual(status,400)
        status, obj=self.call('PATCH','/api/work-orders/1',{'status':'invalid'})
        self.assertEqual(status,400)

    def test_08_simulation(self):
        with connection(self.path) as db:
            before=db.execute('SELECT count(*) FROM telemetry').fetchone()[0]
        status, result=self.call('POST','/api/simulate',{})
        self.assertEqual(status,201)
        self.assertEqual(result['readings_added'],12)
        with connection(self.path) as db:
            after=db.execute('SELECT count(*) FROM telemetry').fetchone()[0]
        self.assertEqual(after-before,12)

    def test_09_static_assets(self):
        for path in ('/','/app.js','/styles.css','/demo-api.js','/demo-data.json','/assets/motor.webp'):
            status, data=self.call('GET',path)
            self.assertEqual(status,200,path)
            self.assertTrue(data)

    def test_10_model_output(self):
        low=predict({'temperature':55,'vibration':1.1,'pressure':6.2,'current':15,'rpm':1500})
        high=predict({'temperature':97,'vibration':9.0,'pressure':4.1,'current':31,'rpm':1290})
        self.assertLess(low['risk'],high['risk'])
        self.assertEqual(high['status'],'critical')


if __name__ == '__main__': unittest.main()
