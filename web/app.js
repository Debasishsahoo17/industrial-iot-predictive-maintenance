/* PulseCore dashboard: dependency-free, accessible interactive single-page UI. */
'use strict';
const state = { page: 'overview', overview: null, assets: [], alerts: [], orders: [],
  assetFilter: 'all', search: '', alertFilter: 'active', busy: false };
const app = document.getElementById('app');
const icons = {
  layout:'<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  cpu:'<rect x="5" y="5" width="14" height="14" rx="2"/><path d="M9 1v4M15 1v4M9 19v4M15 19v4M1 9h4M1 15h4M19 9h4M19 15h4"/><rect x="9" y="9" width="6" height="6" rx="1"/>',
  bell:'<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/>',
  clipboard:'<rect x="6" y="4" width="13" height="18" rx="2"/><rect x="9" y="2" width="7" height="5" rx="1"/><path d="M10 12h5M10 16h5"/>',
  chart:'<path d="M3 3v18h18M7 16l4-5 4 3 5-8"/>',
  github:'<path d="M9 19c-4 1-4-2-6-2m12 4v-3.9a3.4 3.4 0 0 0-.9-2.7c3.1-.3 6.4-1.5 6.4-7A5.4 5.4 0 0 0 19 3.7 5 5 0 0 0 18.9 0S17.7-.3 15 2a14 14 0 0 0-8 0C4.3-.3 3.1 0 3.1 0A5 5 0 0 0 3 3.7 5.4 5.4 0 0 0 1.5 7c0 5.5 3.3 6.7 6.4 7A3.4 3.4 0 0 0 7 16.7V21" transform="translate(2 1) scale(.86)"/>',
  refresh:'<path d="M20 7v5h-5M4 17v-5h5"/><path d="M5.5 9a7 7 0 0 1 12-3L20 12M4 12l2.5 6a7 7 0 0 0 12-3"/>',
  arrow:'<path d="M5 12h14m-6-6 6 6-6 6"/>',
  plus:'<path d="M12 5v14m-7-7h14"/>',
  activity:'<path d="M3 12h4l3-7 4 14 3-7h4"/>',
  shield:'<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/><path d="m9 12 2 2 4-4"/>',
  alert:'<path d="m12 3 10 18H2L12 3Z"/><path d="M12 9v5m0 3h.01"/>',
  wrench:'<path d="M14.7 6a5 5 0 0 0-6.7 6.7L3 17.7 6.3 21l5-5a5 5 0 0 0 6.7-6.7l-3.7 3.7-3.3-3.3L14.7 6Z"/>',
  search:'<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
  filter:'<path d="M4 7h16M7 12h10m-7 5h4"/>',
  clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  download:'<path d="M12 3v12m-4-4 4 4 4-4M4 17v4h16v-4"/>',
  check:'<path d="m4 12 5 5L20 6"/>',
  bolt:'<path d="m13 2-9 11h7l-1 9 10-12h-7l0-8Z"/>',
  info:'<circle cx="12" cy="12" r="10"/><path d="M12 11v6m0-10h.01"/>',
  calendar:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4M17 3v4M3 10h18"/>'
};
function icon(name) { return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.activity}</svg>`; }
function escapeHTML(v) { return String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
const cap = s => s.replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase());
const label = status => `<span class="status-pill ${escapeHTML(status)}">${cap(status)}</span>`;
const photo = a => `assets/${['motor','pump','facility'].includes(a.image) ? a.image : 'facility'}.webp`;
const formatDate = s => s ? new Date(s).toLocaleString(undefined,{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}) : '—';
function ago(s) { const m = Math.max(0,Math.floor((Date.now()-new Date(s).getTime())/60000)); return m<1?'just now':m<60?`${m}m ago`:m<1440?`${Math.floor(m/60)}h ago`:`${Math.floor(m/1440)}d ago`; }
async function request(path, options={}) {
  if (window.PULSECORE_STATIC) return window.pulsecoreDemoRequest(path, options);
  let r;
  try { r = await fetch(path,{...options,headers:{'Content-Type':'application/json',...(options.headers||{})}}); }
  catch (error) {
    // A static host without API should still deliver an interactive portfolio demo.
    window.PULSECORE_STATIC = true;
    return window.pulsecoreDemoRequest(path, options);
  }
  let data;
  try { data=await r.json(); } catch {
    if (path === '/api/overview') {
      window.PULSECORE_STATIC = true;
      return window.pulsecoreDemoRequest(path,options);
    }
    throw new Error('Unexpected server response');
  }
  if(!r.ok){
    if(path === '/api/overview' && r.status === 404){
      window.PULSECORE_STATIC=true;
      return window.pulsecoreDemoRequest(path,options);
    }
    throw new Error(data.error || `HTTP ${r.status}`);
  }
  return data;
}
function toast(text,error=false){const el=document.createElement('div');el.className=`toast ${error?'error':''}`;el.textContent=text;document.getElementById('toast-area').append(el);setTimeout(()=>el.remove(),3700);}
function heading(title, subtitle, eyebrow='OPERATIONS / OVERVIEW', actions='') {return `<div class="page-intro"><div><div class="eyebrow">${eyebrow}</div><h1 class="page-title">${title}</h1><p class="page-subtitle">${subtitle}</p></div><div class="page-actions">${actions}</div></div>`;}
function btn(label,action,primary=false,which=''){return `<button class="btn ${primary?'btn-primary':'btn-outline'}" data-action="${action}" ${which}>${label}</button>`;}
function riskBar(a){return `<div class="risk-value">${a.risk}<span class="subtle">/100</span></div><div class="risk-track ${a.status}"><span style="width:${a.risk}%"></span></div>`;}
function chartPoints(values, w, h, min, max, padding=4){return values.map((v,i)=>{const x=padding+i*((w-2*padding)/Math.max(1,values.length-1));const y=h-padding-(Math.max(min,Math.min(max,v))-min)/(max-min)*(h-2*padding);return [x,y];});}
function lineSvg(values,{width=710,height=195,min=0,max=100,labels=true,fill=true}={}){
 if(!values.length)return '<div class="empty-state">No measurements</div>';
 const padL=labels?34:4,padR=8,padT=12,padB=labels?27:8;
 const pts=values.map((v,i)=>{const x=padL+i*(width-padL-padR)/Math.max(1,values.length-1);const y=padT+(max-v)/(max-min)*(height-padT-padB);return [x,Math.max(padT,Math.min(height-padB,y))]});
 const coords=pts.map(([x,y])=>`${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
 const path=`M ${pts.map(p=>p.map(v=>v.toFixed(1)).join(' ')).join(' L ')}`;
 const area=`${path} L ${pts.at(-1)[0].toFixed(1)} ${height-padB} L ${pts[0][0].toFixed(1)} ${height-padB} Z`;
 const ticks=labels?[40,55,70,85,100].map(v=>{const y=padT+(max-v)/(max-min)*(height-padT-padB);return `<line x1="${padL}" x2="${width-padR}" y1="${y}" y2="${y}" stroke="#273948" stroke-dasharray="4 5"/><text x="0" y="${y+4}" fill="#6d8294" font-size="10">${v}%</text>`}).join(''):'';
 const xlabels=labels?[0,6,12,18,23].map(i=>{const x=padL+i*(width-padL-padR)/23;return `<text x="${x}" y="${height-4}" text-anchor="middle" fill="#6d8294" font-size="10">${i===0?'24h ago':i===23?'Now':`${24-i}h ago`}</text>`}).join(''):'';
 const id=`line-${Math.floor(values.reduce((a,b)=>a+b,0)*13)}`;
 return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Equipment health line chart"><defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4fe6c5" stop-opacity=".28"/><stop offset="1" stop-color="#4fe6c5" stop-opacity="0"/></linearGradient></defs>${ticks}${xlabels}${fill?`<path d="${area}" fill="url(#${id})"/>`:''}<path d="${path}" fill="none" stroke="#5ce4c8" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/><circle cx="${pts.at(-1)[0]}" cy="${pts.at(-1)[1]}" r="4" fill="#7cf3dc" stroke="#113b37" stroke-width="3"/></svg>`;
}
function donut(stats){const total=Math.max(1,stats.total), healthy=stats.healthy/total*100,warning=stats.warning/total*100;return `<div class="donut-content"><div class="donut" style="background:conic-gradient(#59dfc3 0% ${healthy}%,#f7bd78 ${healthy}% ${healthy+warning}%,#ff818a ${healthy+warning}% 100%)"><div class="donut-center"><strong>${stats.total}</strong><small>Assets</small></div></div><div class="donut-labels">${['healthy','warning','critical'].map(x=>`<div class="donut-label"><span class="color-dot ${x}"></span>${cap(x)}<strong>${stats[x]}</strong></div>`).join('')}</div></div>`;}
function kpi(name,value,sub,iconName,color=''){return `<section class="kpi"><div class="kpi-top"><span>${name}</span><span class="kpi-icon ${color}">${icon(iconName)}</span></div><div class="kpi-value">${value}</div><div class="kpi-footer">${sub}</div></section>`;}
function tableAssets(items,limit=null){const shown=limit?items.slice(0,limit):items;return `<div class="table-wrap"><table class="asset-table"><thead><tr><th>EQUIPMENT</th><th>LOCATION</th><th>CONDITION</th><th>RISK SCORE</th><th></th></tr></thead><tbody>${shown.map(a=>`<tr data-asset="${a.id}"><td><div class="machine-cell"><img class="machine-thumbnail" src="${photo(a)}" alt="${escapeHTML(a.kind)} photograph"><div><strong>${escapeHTML(a.name)}</strong><small>${a.id} · ${escapeHTML(a.kind)}</small></div></div></td><td>${escapeHTML(a.location)}</td><td>${label(a.status)}</td><td>${riskBar(a)}</td><td><span class="row-more">→</span></td></tr>`).join('')}</tbody></table>${!shown.length?`<div class="empty-state"><strong>No matching equipment</strong>Try a different search or filter.</div>`:''}</div>`;}
function alertsPreview(items){return items.slice(0,4).map(a=>`<div class="alert-item"><div class="alert-symbol ${a.severity}">${icon('alert')}</div><div class="alert-body"><strong>${escapeHTML(a.title)}</strong><p>${escapeHTML(a.detail)}</p><div class="alert-foot">${escapeHTML(a.asset_id)} <span>•</span> ${cap(a.severity)}</div></div><time class="alert-time">${ago(a.created_at)}</time></div>`).join('')||'<div class="empty-state">No alerts reported</div>'}
function renderOverview(){const d=state.overview,s=d.stats,sorted=[...d.assets].sort((a,b)=>b.risk-a.risk);
 app.innerHTML=heading('The factory, in focus.','Your complete operational picture. Updated with every simulated sensor reading.','CONTROL CENTER / FLEET OVERVIEW',btn(`${icon('refresh')} Simulate live data`,'simulate',true))+
 `<section class="hero"><div class="hero-stamp"><span></span> CONNECTED MANUFACTURING</div><div class="hero-copy"><div class="hero-kicker">PULSECORE / INTELLIGENT OPERATIONS</div><h2>See failures coming.<br><em>Before they happen.</em></h2><p>Turn complex machine signals into clear, actionable insights and keep your production moving.</p><button class="btn btn-subtle" data-action="goto-assets">Explore equipment ${icon('arrow')}</button></div></section>`+
 `<div class="kpi-grid">${kpi('Connected equipment',s.total,`<span class="mini-arrow">●</span> Monitoring ${s.total} assets`, 'cpu','blue')}${kpi('Fleet health score',`${s.fleet_health}<small>%</small>`,`<span class="mini-arrow">↗</span> Based on current model scores`,'activity')}${kpi('Attention required',s.warning+s.critical,`<span class="text-danger">${s.critical} critical</span> · ${s.warning} warning`,'alert','orange')}${kpi('Open work orders',s.open_orders,`<span class="mini-arrow">●</span> Maintenance tasks tracked`,'wrench','red')}</div>`+
 `<div class="overview-middle"><section class="panel"><div class="panel-header"><div><h3>Fleet health trend</h3><p>Average modeled health score across all connected assets</p></div><span class="tag-neutral">Last 24 readings ▾</span></div><div class="chart-area main-chart">${lineSvg(d.trend.map(x=>x.health))}</div><div class="chart-legend"><span><i class="legend-line"></i> Fleet health index</span><span><i class="legend-circle"></i> Latest ${s.fleet_health}%</span></div></section><section class="panel"><div class="panel-header"><div><h3>Equipment condition</h3><p>Real-time risk classification</p></div><span class="tag-neutral">Fleet overview</span></div>${donut(s)}</section></div>`+
 `<div class="bottom-grid"><section><div class="section-head"><h3 class="section-title">Equipment requiring attention</h3><button class="text-link" data-action="goto-assets">View all equipment →</button></div><div class="panel">${tableAssets(sorted,5)}</div></section><section><div class="section-head"><h3 class="section-title">Latest alerts</h3><button class="text-link" data-action="goto-alerts">View all alerts →</button></div><div class="panel"><div class="alerts-list">${alertsPreview(d.alerts)}</div></div></section></div>`;
}
function renderAssets(){const q=state.search.toLowerCase();let items=state.assets.filter(a=>(state.assetFilter==='all'||a.status===state.assetFilter)&&[a.id,a.name,a.kind,a.location].some(t=>t.toLowerCase().includes(q))).sort((a,b)=>b.risk-a.risk);
 const selected=state.assetFilter;
 app.innerHTML=heading('Equipment inventory','Live condition monitoring across your connected industrial assets.','OPERATIONS / EQUIPMENT',btn(`${icon('download')} Export CSV`,'export')+btn(`${icon('plus')} New work order`,'new-order',true))+
 `<div class="toolbar"><label class="search-wrap">${icon('search')}<input class="search-input" id="asset-search" type="search" placeholder="Search equipment, ID, or location…" value="${escapeHTML(state.search)}" aria-label="Search equipment"></label><div class="filter-row">${['all','healthy','warning','critical'].map(f=>`<button data-filter="${f}" class="filter ${f===selected?'active':''}">${cap(f)}${f==='all'?` (${state.assets.length})`:''}</button>`).join('')}</div></div><div class="asset-cards" id="asset-cards">${items.map(a=>`<article class="asset-card" data-asset="${a.id}" tabindex="0" role="button" aria-label="Open ${escapeHTML(a.name)} details"><div class="asset-photo"><img src="${photo(a)}" alt="Industrial ${escapeHTML(a.kind)} equipment">${label(a.status)}</div><div class="asset-card-body"><h3 class="asset-card-title">${escapeHTML(a.name)}</h3><div class="asset-card-id">${a.id} <span class="muted-dot">·</span> ${escapeHTML(a.location)}</div><div class="asset-metrics"><div><small>TEMP.</small><strong>${a.temperature.toFixed(1)}°C</strong></div><div><small>VIBRATION</small><strong>${a.vibration.toFixed(1)} mm/s</strong></div><div><small>RISK</small><strong>${a.risk}/100</strong></div></div><div class="asset-card-foot"><small>${escapeHTML(a.manufacturer)} · ${escapeHTML(a.model)}</small><span>Inspect →</span></div></div></article>`).join('')||`<div class="empty-state"><strong>No matching equipment</strong>Change your search or condition filter.</div>`}</div>`;
}
function renderAlerts(){let items=state.alerts.filter(a=>state.alertFilter==='all'||(state.alertFilter==='active'?!a.acknowledged:!!a.acknowledged));
 app.innerHTML=heading('Alert center','Act on anomalies before they become unplanned downtime.','MONITORING / ALERTS',btn(`${icon('refresh')} Generate readings`,'simulate',true))+
 `<div class="toolbar"><div class="filter-row">${['active','acknowledged','all'].map(f=>`<button class="filter ${state.alertFilter===f?'active':''}" data-alert-filter="${f}">${cap(f)}${f==='active'?` (${state.alerts.filter(a=>!a.acknowledged).length})`:''}</button>`).join('')}</div><span class="subtle">${items.length} alerts</span></div><div class="record-stack">${items.map(a=>`<section class="record-row"><div class="record-content"><div class="alert-symbol ${a.severity}">${icon('alert')}</div><div><div class="summary-split"><strong>${escapeHTML(a.title)}</strong>${label(a.severity)}</div><p>${escapeHTML(a.detail)}</p><small>${a.asset_id} · ${escapeHTML(a.asset_name)} · ${formatDate(a.created_at)}</small></div></div><div class="record-actions">${a.acknowledged?`<span class="status-pill healthy">Acknowledged</span>`:`<button class="btn btn-outline" data-action="ack" data-id="${a.id}">${icon('check')} Acknowledge</button>`}<button class="text-link" data-asset="${a.asset_id}">Inspect →</button></div></section>`).join('')||'<div class="empty-state"><div class="empty-icon">✓</div><strong>All clear for this filter</strong>No alerts to display.</div>'}</div>`;
}
function renderOrders(){const active=state.orders.filter(x=>x.status!=='completed').length, completed=state.orders.length-active;
 app.innerHTML=heading('Maintenance work orders','Plan, track, and resolve servicing tasks for plant equipment.','OPERATIONS / MAINTENANCE',btn(`${icon('plus')} Create work order`,'new-order',true))+
 `<div class="order-stats"><div class="order-stat"><strong>${state.orders.length}</strong><span>Total work orders</span></div><div class="order-stat"><strong>${active}</strong><span>Active maintenance</span></div><div class="order-stat"><strong>${completed}</strong><span>Completed</span></div></div>`+
 `<section class="panel"><div class="table-wrap"><table class="orders-table"><thead><tr><th>WORK ORDER</th><th>EQUIPMENT</th><th>PRIORITY</th><th>CREATED</th><th>STATUS</th></tr></thead><tbody>${state.orders.map(o=>`<tr><td><strong style="color:#edf4f9">${escapeHTML(o.title)}</strong><div style="margin-top:5px;color:#7e94a7">WO-${String(o.id).padStart(4,'0')}</div></td><td>${escapeHTML(o.asset_name)}<div style="color:#809aae;margin-top:5px">${o.asset_id}</div></td><td>${label(o.priority==='high'?'critical':o.priority==='medium'?'warning':'healthy')}</td><td>${formatDate(o.created_at)}</td><td><select class="filter-select" aria-label="Update status for ${escapeHTML(o.title)}" data-order-status="${o.id}"><option value="open" ${o.status==='open'?'selected':''}>Open</option><option value="in_progress" ${o.status==='in_progress'?'selected':''}>In progress</option><option value="completed" ${o.status==='completed'?'selected':''}>Completed</option></select></td></tr>`).join('')}</tbody></table>${!state.orders.length?'<div class="empty-state">No work orders yet. Create one to get started.</div>':''}</div></section>`;
}
function renderAnalytics(){const sorted=[...state.assets].sort((a,b)=>b.risk-a.risk);const avg=k=>state.assets.reduce((s,a)=>s+a[k],0)/Math.max(1,state.assets.length);
 app.innerHTML=heading('Predictive analytics','Understand asset degradation signals and prioritize inspections.','INSIGHTS / MODEL ANALYTICS',btn(`${icon('refresh')} Refresh model inputs`,'simulate',true))+
 `<div class="page-banner"><div class="page-banner-icon">${icon('info')}</div><div><strong>Explainable synthetic risk scoring</strong><p>This demonstration uses a frozen logistic model with simulated operating signals. Scores are illustrative and must not be treated as field-calibrated failure probabilities.</p></div></div>`+
 `<div class="analytics-grid"><section class="panel"><div class="panel-header"><div><h3>Highest-risk equipment</h3><p>Calculated from latest temperature, vibration, pressure, current and speed</p></div></div><div class="metric-bars">${sorted.slice(0,8).map(a=>`<div class="metric-line"><span title="${escapeHTML(a.name)}">${a.id}</span><div class="metric-bar ${a.status==='critical'?'red':a.status==='warning'?'orange':''}"><span style="width:${a.risk}%"></span></div><strong>${a.risk}%</strong></div>`).join('')}</div></section><section class="panel"><div class="panel-header"><div><h3>Fleet sensor averages</h3><p>Latest measurements · all equipment</p></div></div><div class="metric-bars">${[['Temperature',avg('temperature'),'°C'],['Vibration',avg('vibration'),' mm/s'],['Pressure',avg('pressure'),' bar'],['Current',avg('current'),' A'],['Shaft speed',avg('rpm'),' rpm']].map(([key,n,unit])=>`<div class="driver-row"><span>${key}</span><strong style="color:#e1f0f2">${n.toFixed(1)}${unit}</strong></div>`).join('')}</div><div class="model-note">Model: synthetic-logistic-v1<br>Prediction horizon: next 24 hours (simulated)<br>Data source: built-in deterministic demo simulator</div></section></div>`;
}
function render(){const titles={overview:'Overview',assets:'Equipment',alerts:'Alerts','work-orders':'Work orders',analytics:'Analytics'};
 document.getElementById('breadcrumb').textContent=titles[state.page];document.querySelectorAll('.nav-link[data-page]').forEach(x=>x.classList.toggle('active',x.dataset.page===state.page));
 document.getElementById('asset-count').textContent=state.assets.length;document.getElementById('alert-count').textContent=state.alerts.filter(a=>!a.acknowledged).length;
 if(state.page==='overview')renderOverview();else if(state.page==='assets')renderAssets();else if(state.page==='alerts')renderAlerts();else if(state.page==='work-orders')renderOrders();else renderAnalytics();
}
async function loadData(){const [overview,alerts,orders]=await Promise.all([request('/api/overview'),request('/api/alerts'),request('/api/work-orders')]);state.overview=overview;state.assets=overview.assets;state.alerts=alerts.items;state.orders=orders.items;render();}
function go(page){state.page=page;state.search='';window.location.hash=page;window.scrollTo({top:0,behavior:'smooth'});render();}
function showModal(html){document.getElementById('modal-root').innerHTML=`<div class="modal-backdrop"><div class="modal" role="dialog" aria-modal="true" aria-label="Equipment details">${html}</div></div>`;const close=document.querySelector('.close-button');if(close)close.focus();}
function closeModal(){document.getElementById('modal-root').innerHTML='';}
async function showAsset(id){try{const result=await request(`/api/assets/${encodeURIComponent(id)}`),a=result.asset;const steps=result.history.map(h=>h.temperature);const avgTemp=steps.length?steps.reduce((x,y)=>x+y,0)/steps.length:0;
 showModal(`<div class="modal-head"><div><div class="eyebrow">ASSET INSPECTION · ${a.id}</div><h3>${escapeHTML(a.name)}</h3><p>${escapeHTML(a.location)} · ${escapeHTML(a.manufacturer)} ${escapeHTML(a.model)}</p></div><button class="close-button" data-action="close" aria-label="Close details">×</button></div><div class="modal-body"><img src="${photo(a)}" class="modal-hero-img" alt="Industrial ${escapeHTML(a.kind)} machinery"><div style="display:flex;align-items:center;justify-content:space-between;margin:0 0 17px"><div>${label(a.status)} <span class="subtle" style="margin-left:7px;font-size:11px">24h simulated failure risk</span></div><strong style="font-size:17px">${a.risk}/100</strong></div><div class="modal-grid">${[['Temperature',`${a.temperature} °C`],['Vibration',`${a.vibration} mm/s`],['Pressure',`${a.pressure} bar`],['Current',`${a.current} A`],['Speed',`${a.rpm} rpm`],['Avg. temp (96h)',`${avgTemp.toFixed(1)} °C`]].map(([k,v])=>`<div class="modal-metric"><span>${k}</span><strong>${v}</strong></div>`).join('')}</div><div class="modal-section-title">Recent temperature readings</div><div class="small-chart">${lineSvg(steps,{width:550,height:120,min:40,max:105,labels:false})}</div><div class="muted-caption">96 most recent observations · simulated data · °C</div><div class="modal-section-title">Top risk contributors</div>${a.drivers.length?a.drivers.map(d=>`<div class="driver-row"><span>${escapeHTML(d.factor)}</span><strong>+${d.impact.toFixed(2)} log-odds</strong></div>`).join(''):'<div class="muted-caption">No elevated contributing features.</div>'}<div class="model-note" style="padding-left:0">Predictions are demonstration estimates only, not industrial diagnostics or safety alarms.</div></div><div class="modal-footer"><button class="btn btn-outline" data-action="close">Close</button><button class="btn btn-primary" data-action="new-order" data-selected-asset="${a.id}">${icon('plus')} Create work order</button></div>`);
 }catch(e){toast(e.message,true);}}
function orderModal(selected=''){const options=state.assets.map(a=>`<option value="${a.id}" ${a.id===selected?'selected':''}>${a.id} — ${escapeHTML(a.name)}</option>`).join('');
 showModal(`<div class="modal-head"><div><div class="eyebrow">MAINTENANCE MANAGEMENT</div><h3>Create a work order</h3><p>Document and prioritize equipment servicing.</p></div><button class="close-button" data-action="close" aria-label="Close modal">×</button></div><form id="order-form"><div class="modal-body"><label class="form-field">Equipment<select name="asset_id" required>${options}</select></label><label class="form-field">Work order title<input name="title" required minlength="3" maxlength="120" placeholder="e.g. Inspect motor bearings"></label><label class="form-field">Priority<select name="priority"><option value="medium">Medium</option><option value="high">High</option><option value="low">Low</option></select></label><label class="form-field">Additional notes<textarea name="notes" maxlength="1000" placeholder="Inspection instructions or observations…"></textarea></label></div><div class="modal-footer"><button class="btn btn-outline" type="button" data-action="close">Cancel</button><button class="btn btn-primary" type="submit">${icon('plus')} Create order</button></div></form>`);
}
async function simulate(){if(state.busy)return;state.busy=true;try{const result=await request('/api/simulate',{method:'POST',body:'{}'});await loadData();toast(`${result.readings_added} sensor readings generated · ${result.alerts_created} new alerts`);}catch(e){toast(e.message,true);}finally{state.busy=false;}}
function csvExport(){const head=['asset_id','name','location','status','risk','temperature_c','vibration_mm_s','pressure_bar','current_a','rpm'];const cells=state.assets.map(a=>[a.id,a.name,a.location,a.status,a.risk,a.temperature,a.vibration,a.pressure,a.current,a.rpm]);const csv=[head,...cells].map(row=>row.map(x=>`"${String(x).replace(/"/g,'""')}"`).join(',')).join('\r\n');const url=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));const a=document.createElement('a');a.href=url;a.download='pulsecore-equipment.csv';a.click();URL.revokeObjectURL(url);toast('Equipment CSV exported');}
document.addEventListener('click',async event=>{
 const nav=event.target.closest('[data-page]');if(nav){go(nav.dataset.page);return;}
 const action=event.target.closest('[data-action]');if(action){const name=action.dataset.action;if(name==='goto-assets')go('assets');else if(name==='goto-alerts')go('alerts');else if(name==='simulate')await simulate();else if(name==='new-order')orderModal(action.dataset.selectedAsset||'');else if(name==='close')closeModal();else if(name==='export')csvExport();else if(name==='ack'){try{await request(`/api/alerts/${action.dataset.id}/acknowledge`,{method:'POST',body:'{}'});await loadData();toast('Alert acknowledged');}catch(e){toast(e.message,true);}}return;}
 const filter=event.target.closest('[data-filter]');if(filter){state.assetFilter=filter.dataset.filter;renderAssets();return;}
 const alertFilter=event.target.closest('[data-alert-filter]');if(alertFilter){state.alertFilter=alertFilter.dataset.alertFilter;renderAlerts();return;}
 const asset=event.target.closest('[data-asset]');if(asset){showAsset(asset.dataset.asset);return;}
 if(event.target.classList.contains('modal-backdrop'))closeModal();
});
document.addEventListener('input',e=>{if(e.target.id==='asset-search'){const start=e.target.selectionStart;state.search=e.target.value;renderAssets();const input=document.getElementById('asset-search');input.focus();input.setSelectionRange(start,start);}});
document.addEventListener('submit',async e=>{if(e.target.id!=='order-form')return;e.preventDefault();const data=Object.fromEntries(new FormData(e.target).entries());try{await request('/api/work-orders',{method:'POST',body:JSON.stringify(data)});closeModal();await loadData();toast('Work order created successfully');if(state.page!=='work-orders')go('work-orders');}catch(err){toast(err.message,true);}});
document.addEventListener('change',async e=>{if(!e.target.matches('[data-order-status]'))return;try{await request(`/api/work-orders/${e.target.dataset.orderStatus}`,{method:'PATCH',body:JSON.stringify({status:e.target.value})});await loadData();toast('Work order status updated');}catch(err){toast(err.message,true);}});
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeModal();if((e.key==='Enter'||e.key===' ')&&e.target.matches('.asset-card[data-asset]')){e.preventDefault();showAsset(e.target.dataset.asset);}});
document.getElementById('refresh-btn').addEventListener('click',async()=>{try{await loadData();toast('Dashboard refreshed');}catch(e){toast(e.message,true);}});
document.querySelectorAll('[data-icon]').forEach(el=>el.innerHTML=icon(el.dataset.icon));
const clock=()=>{document.getElementById('clock').textContent=new Date().toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit',timeZoneName:'short'});};clock();setInterval(clock,30000);
(async()=>{try{state.page=['overview','assets','alerts','work-orders','analytics'].includes(location.hash.slice(1))?location.hash.slice(1):'overview';await loadData();}catch(e){app.innerHTML=`<div class="empty-state"><strong>Could not connect to PulseCore</strong>${escapeHTML(e.message)}<p>Start the application with: <code>python3 run.py</code></p></div>`;}})();
