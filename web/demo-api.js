/**
 * Browser-only demo API for GitHub Pages / static hosting.
 * Uses a shipped snapshot as the initial seed and localStorage for per-browser edits.
 * NO real IoT devices, backend storage, or actual industrial predictions are implied.
 */
(() => {
  'use strict';
  const STORAGE_KEY = 'pulsecore-demo-v1';
  const isStaticHost = location.hostname.endsWith('.github.io') ||
    location.search.includes('demo=1') || location.protocol === 'file:';
  window.PULSECORE_STATIC = isStaticHost;
  let dbPromise;
  const copy = x => JSON.parse(JSON.stringify(x));
  function save(db) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(db)); }
    catch (err) { console.warn('Demo changes could not be saved', err); }
  }
  async function database() {
    if (!dbPromise) dbPromise = (async () => {
      const response = await fetch('demo-data.json');
      if (!response.ok) throw new Error('Demo data could not be loaded. Check demo-data.json.');
      const seed = await response.json();
      try {
        const existing = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
        if (existing && existing.version === seed.version && existing.assets?.length === seed.assets.length) return existing;
      } catch (_) { /* Corrupted or unavailable browser storage: use seed. */ }
      save(seed);
      return seed;
    })();
    return dbPromise;
  }
  // Mirror the Python model so simulated updates yield consistent scores.
  const cfg = { intercept: -3.15, weights: {
    temperature: .78, vibration: 1.12, pressure_deviation: .42, current: .52, rpm_deviation: .40
  }};
  const round = (x, decimals = 2) => Number(x.toFixed(decimals));
  function prediction(r) {
    const f = {
      temperature: (r.temperature - 62) / 18,
      vibration: (r.vibration - 2.4) / 1.7,
      pressure_deviation: Math.abs(r.pressure - 6.2) / 1.7,
      current: (r.current - 18) / 6,
      rpm_deviation: Math.abs(r.rpm - 1480) / 240
    };
    const labels = { temperature: 'Elevated temperature', vibration: 'Unusual vibration',
      pressure_deviation: 'Pressure deviation', current: 'High power draw', rpm_deviation: 'Speed deviation' };
    const contributions = Object.entries(f).map(([key, value]) => ({ key, impact: round(cfg.weights[key] * value, 3) }));
    const logit = cfg.intercept + contributions.reduce((sum, x) => sum + x.impact, 0);
    const risk = Math.round(100 / (1 + Math.exp(-Math.max(-40, Math.min(40, logit)))));
    return { risk, status: risk >= 65 ? 'critical' : risk >= 35 ? 'warning' : 'healthy',
      drivers: contributions.filter(x => x.impact > 0).sort((a,b) => b.impact - a.impact)
        .slice(0,3).map(x => ({factor:labels[x.key], impact:round(x.impact)})),
      model:'synthetic-logistic-v1', horizon:'24h (simulated)' };
  }
  function overview(db) {
    const assets = db.assets.map(a => ({...a, ...prediction(a)}));
    const stats = {
      total: assets.length, healthy: assets.filter(a => a.status === 'healthy').length,
      warning: assets.filter(a => a.status === 'warning').length,
      critical: assets.filter(a => a.status === 'critical').length,
      fleet_health: Math.round(100 - assets.reduce((sum,a)=>sum+a.risk,0)/Math.max(1,assets.length)),
      active_alerts: db.alerts.filter(a => !a.acknowledged).length,
      open_orders: db.orders.filter(o => o.status !== 'completed').length
    };
    const trend = Array.from({ length:24 }, (_,i) => {
      const values = db.assets.flatMap(a => {
        const h = db.history[a.id]; return h?.[h.length - 24 + i] ? [prediction(h[h.length - 24 + i]).risk] : [];
      });
      return {hour:i,health:values.length ? round(100-values.reduce((a,b)=>a+b,0)/values.length,1) : 0};
    });
    return { assets, stats, alerts:db.alerts.slice().sort((a,b)=>Date.parse(b.created_at)-Date.parse(a.created_at) || b.id-a.id).slice(0,6),
      trend, generated_at:new Date().toISOString() };
  }
  function bad(message) {throw new Error(message);}
  window.pulsecoreDemoRequest = async (path, options = {}) => {
    const db = await database();
    const method = (options.method || 'GET').toUpperCase();
    const route = path.split('?')[0];
    if (route === '/api/health' && method === 'GET') return {status:'ok',storage:'localStorage',demo_mode:true};
    if (route === '/api/overview' && method === 'GET') return copy(overview(db));
    if (route === '/api/assets' && method === 'GET') return {items:copy(overview(db).assets)};
    if (route === '/api/alerts' && method === 'GET') {
      const filter = new URLSearchParams(path.split('?')[1] || '').get('status') || 'all';
      return {items:copy(db.alerts.filter(a => filter === 'all' || (filter === 'active' ? !a.acknowledged : !!a.acknowledged)))};
    }
    if (route === '/api/work-orders' && method === 'GET') return {items:copy(db.orders.slice().sort((a,b)=>b.id-a.id))};
    const detail = route.match(/^\/api\/assets\/([A-Z0-9-]+)$/);
    if (detail && method === 'GET') {
      const asset = overview(db).assets.find(a=>a.id===detail[1]);
      if (!asset) return bad('Asset not found');
      return {asset:copy(asset), history:copy(db.history[asset.id].slice(-96)),
        alerts:copy(db.alerts.filter(x=>x.asset_id===asset.id)),
        work_orders:copy(db.orders.filter(x=>x.asset_id===asset.id))};
    }
    if (route === '/api/simulate' && method === 'POST') {
      const now = new Date().toISOString();let alertsCreated=0;
      db.assets.forEach(a => {
        const p = db.history[a.id]; const last = p[p.length-1];
        const noise = (Math.random() - .5);
        const condition = a.condition;
        const next = {ts:now,
          temperature:round(.67*last.temperature+.33*(59.6+30*condition+noise*4)),
          vibration:round(Math.max(.5,.67*last.vibration+.33*(1.8+6*condition+noise))),
          pressure:round(.67*last.pressure+.33*(6.2-1.1*condition+noise*.3)),
          current:round(.67*last.current+.33*(16.8+12.5*condition+noise*1.5)),
          rpm:round(.67*last.rpm+.33*(1490-180*condition+noise*25))};
        p.push(next); if (p.length > 169) p.shift();
        Object.assign(a, next); const status = prediction(next);
        const recent = db.alerts.filter(x=>x.asset_id===a.id).sort((x,y)=>y.id-x.id)[0];
        if (status.status !== 'healthy' && (!recent || Date.now()-Date.parse(recent.created_at)>=4*3600000)) {
          db.alerts.push({id:Math.max(0,...db.alerts.map(x=>x.id))+1, asset_id:a.id,
            asset_name:a.name, severity:status.status,title:`${a.name}: ${status.status} risk`,
            detail:`Simulated risk score ${status.risk}/100. Review telemetry and inspect equipment.`,
            created_at:now,acknowledged:0}); alertsCreated++;
        }
      });save(db);
      return {readings_added:db.assets.length,alerts_created:alertsCreated,timestamp:now};
    }
    const ack = route.match(/^\/api\/alerts\/(\d+)\/acknowledge$/);
    if (ack && method === 'POST') {
      const a = db.alerts.find(x=>x.id===Number(ack[1])); if(!a) return bad('Alert not found');
      a.acknowledged=1;save(db);return {ok:true};
    }
    if (route === '/api/work-orders' && method === 'POST') {
      const data = JSON.parse(options.body || '{}');
      const asset = db.assets.find(a=>a.id===data.asset_id);
      if (!asset || !data.title || String(data.title).length < 3 || String(data.title).length > 120 ||
        !['low','medium','high'].includes(data.priority) || String(data.notes||'').length > 1000) return bad('Invalid work order');
      const order = {id:Math.max(0,...db.orders.map(x=>x.id))+1,asset_id:asset.id,asset_name:asset.name,
        title:String(data.title), priority:data.priority, notes:String(data.notes || ''),
        status:'open',created_at:new Date().toISOString()};
      db.orders.push(order);save(db);return {id:order.id,status:'open'};
    }
    const patch = route.match(/^\/api\/work-orders\/(\d+)$/);
    if (patch && method === 'PATCH') {
      const data = JSON.parse(options.body || '{}');
      const order = db.orders.find(o=>o.id===Number(patch[1])); if (!order) return bad('Work order not found');
      if (!['open','in_progress','completed'].includes(data.status)) return bad('Invalid status');
      order.status=data.status;save(db);return {ok:true,status:order.status};
    }
    return bad(`Unsupported demo route: ${method} ${route}`);
  };
})();
