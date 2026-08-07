/**
 * Build /seats.html — the interactive seat finder.
 *
 * Paint the part of the auditorium you'd actually sit in, say how many of you
 * there are, and it checks real seat maps for a contiguous block that fits.
 *
 * Zones are painted on a normalised grid rather than one venue's seat map, so a
 * single choice carries across auditoriums of different sizes.
 *
 *   node scripts/build-seats.mjs
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = p => existsSync(join(root, p)) ? JSON.parse(readFileSync(join(root, p), 'utf8')) : {};

/* ---------- auditorium layout, recovered from one saved seat map ---------- */
const SEAT_RE = /<input\b([^>]*?)\baria-label="([^"]+)"([^>]*)>/g;

function buildLayout(file) {
  const html = readFileSync(join(root, file), 'utf8');
  const rows = new Map(); const order = []; const wc = new Set();
  let m;
  while ((m = SEAT_RE.exec(html)) !== null) {
    const attrs = m[1] + m[3];
    if (!attrs.includes('type="checkbox"')) continue;
    const label = m[2].trim();
    const sm = /\b([A-Z]{1,2})(\d{1,2})$/.exec(label);
    if (!sm) continue;
    const [, r, n] = sm;
    if (!rows.has(r)) { rows.set(r, []); order.push(r); }
    rows.get(r).push(+n);
    if (label.includes('Wheelchair')) wc.add(`${r}${n}`);
  }
  const out = [];
  order.forEach((r, ri) => {
    const nums = rows.get(r).sort((a, b) => a - b);
    const lo = nums[0], hi = nums[nums.length - 1];
    const mid = (lo + hi) / 2, half = Math.max((hi - lo) / 2, 1);
    for (const n of nums) {
      const y = ri / Math.max(order.length - 1, 1);
      const x = (n - mid) / half;
      const aisle = n === lo || n === hi;
      // centre line and depth into the house; front rows of a 1.43:1 screen score worst
      const q = Math.max(0.45 * Math.exp(-(x * x) / (2 * 0.35 ** 2))
        + 0.55 * Math.exp(-((y - 0.62) ** 2) / (2 * 0.18 ** 2)) - (aisle ? 0.08 : 0), 0);
      out.push({ id: `${r}${n}`, row: r, num: n, ri, x: +x.toFixed(4), y: +y.toFixed(4),
                 wc: wc.has(`${r}${n}`), q: +q.toFixed(4) });
    }
  });
  return out;
}

const LAYOUT = buildLayout('data/metreon-layout.html');
const store = { ...read('data/seatmaps-extra.json'), ...read('data/seatmaps.json') };
const SHOWS = Object.values(store)
  .filter(s => Array.isArray(s.free))
  .map(s => ({ id: s.id, date: s.date, time: s.time, weekday: s.weekday,
               is_weekend: s.is_weekend, total: s.total, free: s.free,
               theatre: 'AMC Metreon 16' }))
  .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Find a Seat — IMAX 70mm Seat Finder | WhatScares</title>
<meta name="description" content="Paint the part of the auditorium you'd sit in and it checks real IMAX 70mm seat maps for seats that fit — across ${SHOWS.length} showings at AMC Metreon.">
<link rel="canonical" href="https://whatscares.com/seats.html">
<meta property="og:title" content="Find a Seat — IMAX 70mm Seat Finder">
<meta property="og:description" content="Pick where you'd sit. It checks the cinema's real seat maps.">
<meta property="og:url" content="https://whatscares.com/seats.html">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<style>
  :root{--bg:#e9e3d5;--surface:#f4f0e6;--surface-2:#dcd3c0;--border:#cdc2ab;
        --text:#191512;--text-2:#584f44;--text-3:#6b6153;--accent:#a82e22;--gold:#7d5c0d;
        --off:#d3c9b4}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--text);
       font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,sans-serif}
  a{color:var(--accent)}
  .wrap{max-width:1120px;margin:0 auto;padding:28px 20px 72px}
  .home{font-size:13px;letter-spacing:.14em;text-transform:uppercase;color:var(--text-3);text-decoration:none}
  .home:hover{color:var(--accent)}
  .eyebrow{margin:26px 0 6px;font-size:12px;letter-spacing:.22em;text-transform:uppercase;color:var(--accent)}
  h1{margin:0 0 10px;font-family:Georgia,serif;font-weight:400;
     font-size:clamp(30px,5.5vw,46px);line-height:1.08;text-wrap:balance}
  h1 em{font-style:italic;color:var(--accent)}
  .lede{margin:0;color:var(--text-2);max-width:60ch}
  .cols{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,360px);gap:20px;
        align-items:start;margin-top:26px}
  @media (max-width:900px){.cols{grid-template-columns:1fr}}
  .panel{background:var(--surface);border:1px solid var(--border);border-radius:3px;
         padding:16px 17px;margin-bottom:16px}
  .step{display:flex;align-items:baseline;gap:9px;margin-bottom:12px;flex-wrap:wrap}
  .step i{font-style:normal;font-weight:700;font-size:10px;background:var(--accent);color:#fff;
          width:18px;height:18px;border-radius:50%;display:grid;place-items:center;flex:none}
  .step h2{margin:0;font-size:15px;font-weight:600}
  .step small{color:var(--text-3);font-size:12px}
  .chips{display:flex;flex-wrap:wrap;gap:6px}
  .chip{border:1px solid var(--border);background:transparent;color:var(--text-2);
        font:inherit;font-size:13px;padding:6px 12px;border-radius:100px;cursor:pointer;
        transition:.14s;white-space:nowrap}
  .chip:hover{border-color:var(--accent);color:var(--text)}
  .chip[aria-pressed="true"]{background:var(--accent);border-color:var(--accent);color:#fff;font-weight:600}
  .maphead{display:flex;justify-content:space-between;align-items:center;gap:10px;
           flex-wrap:wrap;margin-bottom:9px}
  .selinfo{font-size:12px;color:var(--text-3)}
  .selinfo b{color:var(--accent)}
  .stage{background:var(--bg);border:1px solid var(--border);border-radius:3px;
         padding:14px 10px 10px;touch-action:none}
  svg{display:block;width:100%;height:auto;user-select:none}
  .cell{cursor:crosshair}
  .hint{margin:8px 0 0;font-size:12px;color:var(--text-3)}
  .rhead{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:10px}
  .rhead h2{margin:0;font-size:15px;font-weight:600}
  .rhead span{font-size:12px;color:var(--text-3)}
  .rlist{display:flex;flex-direction:column;gap:8px;max-height:min(72vh,760px);overflow-y:auto}
  .rcard{background:var(--bg);border:1px solid var(--border);border-left:3px solid var(--accent);
         border-radius:2px;padding:10px 12px}
  .rcard.none{border-left-color:var(--surface-2);opacity:.6}
  .c1{display:flex;justify-content:space-between;align-items:baseline;gap:10px}
  .when{font-weight:600;font-size:14px}
  .when em{font-style:normal;color:var(--text-3);font-weight:400;font-size:12px;margin-left:5px}
  .cnt{font-size:19px;font-weight:700;color:var(--accent);font-variant-numeric:tabular-nums;
       text-align:right;line-height:1.1;flex:none}
  .cnt small{display:block;font-size:9px;letter-spacing:.1em;color:var(--text-3);font-weight:400}
  .blk{margin:5px 0 0;font-size:12.5px;color:var(--gold);font-variant-numeric:tabular-nums}
  .blk.no{color:var(--text-3)}
  .rcard a{font-size:12px;display:inline-block;margin-top:5px}
  .empty{background:var(--bg);border:1px dashed var(--border);border-radius:2px;
         padding:20px 14px;color:var(--text-3);font-size:13px;text-align:center}
  .empty b{display:block;color:var(--text);margin-bottom:4px;font-size:14px}
  .legend{display:flex;gap:14px;flex-wrap:wrap;font-size:12px;color:var(--text-3);margin-top:9px}
  .key{display:flex;align-items:center;gap:6px}
  .sw{width:12px;height:10px;border-radius:2px;display:inline-block}
  footer{margin-top:38px;padding-top:15px;border-top:1px solid var(--border);
         font-size:12.5px;color:var(--text-3);line-height:1.75}
</style>
</head>
<body>
<div class="wrap">
  <a class="home" href="/showtimes.html">← Showtimes</a>
  <p class="eyebrow">AMC Metreon 16 · IMAX 70mm · The Odyssey</p>
  <h1>Find a <em>seat worth having</em></h1>
  <p class="lede">Paint the part of the room you'd actually sit in. It checks the
     cinema's real seat maps for a block that fits — not just whether tickets exist.</p>

  <div class="cols">
    <div>
      <div class="panel">
        <div class="step"><i>1</i><h2>Where you'll sit</h2>
          <small>drag to paint · shift-drag to erase</small></div>
        <div class="maphead">
          <div class="chips" id="presets"></div>
          <div class="selinfo"><b id="selPct">0</b>% of the room</div>
        </div>
        <div class="stage">
          <svg id="grid" viewBox="0 0 1000 470" role="application"
               aria-label="Auditorium zone picker — drag to select where you're willing to sit"></svg>
        </div>
        <div class="legend">
          <span class="key"><i class="sw" style="background:#a82e22"></i>selected</span>
          <span class="key"><i class="sw" style="background:#d3c9b4"></i>not selected</span>
        </div>
        <p class="hint">The grid is relative to the room, so front/back and centre/side
           mean the same thing in any auditorium.</p>
      </div>
      <div class="panel">
        <div class="step"><i>2</i><h2>How many of you</h2>
          <small>seats must be adjacent in the same row</small></div>
        <div class="chips" id="fParty"></div>
      </div>
      <div class="panel">
        <div class="step"><i>3</i><h2>When</h2></div>
        <div class="chips" id="fDay" style="margin-bottom:8px"></div>
        <div class="chips" id="fTime"></div>
      </div>
    </div>
    <div style="position:sticky;top:16px">
      <div class="panel" style="margin:0">
        <div class="rhead"><h2>Showings that fit</h2><span id="rcount"></span></div>
        <div class="rlist" id="rlist"></div>
      </div>
    </div>
  </div>

  <footer id="foot"></footer>
</div>

<script>
const LAYOUT = ${JSON.stringify(LAYOUT)};
const SHOWS  = ${JSON.stringify(SHOWS)};
const DAY = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
const BUCKETS = [['morning','Morning'],['afternoon','Afternoon'],['evening','Evening'],['late','Late']];
const COLS = 14, ROWS = 10;

const bucketOf = t => { const m=/^(\\d{1,2}):(\\d{2})(am|pm)$/i.exec((t||'').trim());
  if(!m) return 'evening'; let h=+m[1]%12; if(/pm/i.test(m[3])) h+=12;
  return h<12?'morning':h<17?'afternoon':h<21?'evening':'late'; };
const cellOf = (x,y) => Math.min(ROWS-1,Math.max(0,Math.floor(y*ROWS)))*COLS
  + Math.min(COLS-1,Math.max(0,Math.floor((x+1)/2*COLS)));
for (const s of LAYOUT) s.cell = cellOf(s.x,s.y);
const ROWNAMES = [...new Set(LAYOUT.map(s=>s.row))];

const PRESETS = {
  'Sweet spot': (c,r)=> r>=4&&r<=7&&c>=3&&c<=10,
  'Dead centre':(c,r)=> c>=5&&c<=8,
  'Back half':  (c,r)=> r>=5,
  'Anywhere':   ()=> true,
};
let party=2, dayMode='any', times=new Set(BUCKETS.map(b=>b[0])), sel=new Set();
const $ = s => document.querySelector(s);

function chips(el, items, isOn, pick){
  el.innerHTML='';
  for(const it of items){
    const b=document.createElement('button');
    b.className='chip'; b.textContent=it.label;
    b.setAttribute('aria-pressed', String(isOn(it.val)));
    b.onclick=()=>{ pick(it.val); render(); };
    el.appendChild(b);
  }
}

const GW=52, GH=30, GX0=150, GY0=118;
function drawGrid(){
  let g = '<path d="M 200 78 Q 500 46 800 78" stroke="#a82e22" stroke-width="5" fill="none" stroke-linecap="round" opacity=".55"/>'
    + '<text x="500" y="104" text-anchor="middle" fill="#6b6153" font-size="11" letter-spacing="6" font-family="Georgia,serif">SCREEN</text>';
  for(let r=0;r<ROWS;r++) for(let c=0;c<COLS;c++){
    const id=r*COLS+c, on=sel.has(id);
    g += '<rect class="cell" data-c="'+id+'" x="'+(GX0+c*GW)+'" y="'+(GY0+r*GH)+'" width="'+(GW-4)+'" height="'+(GH-4)+'" rx="2" fill="'+(on?'#a82e22':'#d3c9b4')+'"/>';
  }
  g += '<text x="'+(GX0-12)+'" y="'+(GY0+13)+'" text-anchor="end" fill="#6b6153" font-size="11">front</text>'
    +  '<text x="'+(GX0-12)+'" y="'+(GY0+(ROWS-1)*GH+13)+'" text-anchor="end" fill="#6b6153" font-size="11">back</text>';
  $('#grid').innerHTML=g;
}
let painting=false, erase=false;
const paint = t => { const c=t&&t.getAttribute&&t.getAttribute('data-c');
  if(c==null) return; if(erase) sel.delete(+c); else sel.add(+c); };
function repaint(){
  for(const el of $('#grid').querySelectorAll('rect[data-c]'))
    el.setAttribute('fill', sel.has(+el.getAttribute('data-c'))?'#a82e22':'#d3c9b4');
  $('#selPct').textContent=Math.round(sel.size/(COLS*ROWS)*100);
}
$('#grid').addEventListener('pointerdown', e=>{
  const c=e.target.getAttribute&&e.target.getAttribute('data-c'); if(c==null) return;
  painting=true; erase=e.shiftKey||sel.has(+c); paint(e.target); repaint(); });
$('#grid').addEventListener('pointermove', e=>{
  if(!painting) return; paint(document.elementFromPoint(e.clientX,e.clientY)); repaint(); });
addEventListener('pointerup', ()=>{ if(painting){painting=false; render();} });

function blocks(freeSet, n){
  const rows={};
  for(const s of LAYOUT){
    if(s.wc || !sel.has(s.cell) || !freeSet.has(s.id)) continue;
    (rows[s.row] = rows[s.row]||[]).push(s);
  }
  const out=[];
  for(const r of Object.keys(rows)){
    const line=rows[r].sort((a,b)=>b.num-a.num);
    let run=[], prev=null;
    const flush=()=>{ for(let i=0;i+n<=run.length;i++){ const w=run.slice(i,i+n);
      out.push({ids:w.map(s=>s.id), q:w.reduce((t,s)=>t+s.q,0)/n}); } run=[]; };
    for(const s of line){ if(prev!==null && prev-s.num!==1) flush(); run.push(s); prev=s.num; }
    flush();
  }
  return out.sort((a,b)=>b.q-a.q);
}

function render(){
  chips($('#presets'), Object.keys(PRESETS).map(k=>({val:k,label:k})), ()=>false,
    k=>{ sel=new Set(); const f=PRESETS[k];
         for(let r=0;r<ROWS;r++) for(let c=0;c<COLS;c++) if(f(c,r)) sel.add(r*COLS+c); });
  chips($('#fParty'), [1,2,3,4].map(n=>({val:n,label:n===1?'Just me':n+' people'})),
    v=>party===v, v=>party=v);
  chips($('#fDay'), [{val:'any',label:'Any day'},{val:'weekday',label:'Weekdays'},
    {val:'weekend',label:'Weekends'}], v=>dayMode===v, v=>dayMode=v);
  chips($('#fTime'), BUCKETS.map(([v,l])=>({val:v,label:l})), v=>times.has(v),
    v=>{ times.has(v)?times.delete(v):times.add(v); if(!times.size) times.add(v); });
  drawGrid(); $('#selPct').textContent=Math.round(sel.size/(COLS*ROWS)*100);

  const res = SHOWS.filter(s=>{
      if(dayMode==='weekday'&&s.is_weekend) return false;
      if(dayMode==='weekend'&&!s.is_weekend) return false;
      return times.has(bucketOf(s.time));
    }).map(s=>{
      const f=new Set(s.free);
      const inZone=LAYOUT.filter(x=>!x.wc&&sel.has(x.cell)&&f.has(x.id)).length;
      return {...s, inZone, best: blocks(f,party)[0]||null};
    }).sort((a,b)=> (b.best?1:0)-(a.best?1:0) || (b.best?b.best.q:0)-(a.best?a.best.q:0)
                  || b.inZone-a.inZone);
  const hit=res.filter(r=>r.best);
  $('#rcount').textContent = hit.length+' of '+res.length+' fit';

  if(!sel.size){
    $('#rlist').innerHTML='<div class="empty"><b>Pick where you\\'d sit</b>Drag on the grid, or use a preset above.</div>';
  } else if(!res.length){
    $('#rlist').innerHTML='<div class="empty"><b>Nothing in that time window</b>Try widening the days or times.</div>';
  } else if(!hit.length){
    const free=res.reduce((t,r)=>t+r.free.length,0);
    $('#rlist').innerHTML='<div class="empty"><b>No block of '+party+' in your zone</b>'
      +'These showings have '+free+' free seats between them, but none of them adjacent inside '
      +'the area you picked — almost everything left is down at the front. '
      +'<br><br><button class="chip" id="widen">Show me where seats actually are →</button></div>';
    const w=$('#widen'); if(w) w.onclick=()=>{ sel=new Set();
      for(let i=0;i<COLS*ROWS;i++) sel.add(i); render(); };
  } else {
    $('#rlist').innerHTML = res.map(r=>{
      const dn=DAY[(new Date(r.date+'T12:00:00').getDay()+6)%7];
      const head='<div class="c1"><div class="when">'+dn+' '+r.date.slice(5)+' <em>'+r.time+'</em></div>';
      if(!r.best) return '<div class="rcard none">'+head+'<div class="cnt">—<small>NO FIT</small></div></div>'
        +'<p class="blk no">'+(r.inZone? r.inZone+' free in your zone, not adjacent'
          : 'nothing free in your zone · '+r.free.length+' left in the house')+'</p></div>';
      return '<div class="rcard">'+head+'<div class="cnt">'+r.inZone+'<small>IN ZONE</small></div></div>'
        +'<p class="blk">'+(party>1?party+' together':'seat')+' · '+r.best.ids.join(' · ')+'</p>'
        +'<a href="https://www.amctheatres.com/showtimes/'+r.id+'" target="_blank" rel="noopener nofollow">Get tickets →</a></div>';
    }).join('');
  }

  $('#foot').innerHTML = SHOWS.length+' showings with full seat maps read from AMC\\'s own '
    +'booking pages, sampled across a month. Accessible seats and their companion seats are '
    +'excluded from every recommendation.<br>Seat quality is geometric: distance from the '
    +'centre line and depth into the house. On a 1.43:1 IMAX screen the front rows are the '
    +'worst seats — and they are usually the only ones left.';
}
sel=new Set();
for(let r=0;r<ROWS;r++) for(let c=0;c<COLS;c++) if(PRESETS['Sweet spot'](c,r)) sel.add(r*COLS+c);
render();
</script>
</body>
</html>
`;

writeFileSync(join(root, 'seats.html'), html);
console.log(`seats.html written`);
console.log(`  layout: ${LAYOUT.length} seats, ${new Set(LAYOUT.map(s => s.row)).size} rows`);
console.log(`  showings with seat maps: ${SHOWS.length}`);
console.log(`  ${(Buffer.byteLength(html)/1024).toFixed(0)} KB`);
