// js/map.js — hardened against XSS / bad data
const DEBUG = false;

const SCORE_KEYS = ['comfort','availability','scenery','solitude','crow_density'];
const SCORE_MIN = 0, SCORE_MAX = 10;
const NAME_MAX = 100, NOTES_MAX = 1000;

let benches = [];
const fallbackBenches = [
  { id: 1, name: "Riverside Bench", lat: 44.9778, lng: -93.2650, comfort:9, availability:7, scenery:9, solitude:6, crow_density:3, notes: "Great view, solid wood, comfortable backrest." },
  { id: 2, name: "Old Oak Bench", lat: 44.9800, lng: -93.2680, comfort:7, availability:6, scenery:7, solitude:8, crow_density:2, notes: "Shaded and quiet, slightly wobbly on one leg." },
  { id: 3, name: "Lakeside Seat", lat: 44.9750, lng: -93.2620, comfort:6, availability:5, scenery:8, solitude:5, crow_density:5, notes: "Good view but painted metal is hot in sun." },
  { id: 4, name: "Playground Bench", lat: 44.9785, lng: -93.2635, comfort:4, availability:6, scenery:3, solitude:2, crow_density:7, notes: "Close to trash cans; seat is warped." },
  { id: 5, name: "Corner Bench", lat: 44.9762, lng: -93.2665, comfort:2, availability:8, scenery:2, solitude:3, crow_density:6, notes: "Missing slats and low comfort." }
];

function clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, n)); }
function toNum(x) { const n = Number(x); return Number.isFinite(n) ? n : null; }
function shortText(s, max) { if (typeof s !== 'string') return ''; return s.length > max ? (s.slice(0, max) + '…') : s; }

function cryptoRandomId() {
  try { const a = new Uint32Array(1); crypto.getRandomValues(a); return a[0]; }
  catch { return Math.floor(Math.random() * 1e9); }
}

function extractBenchFromFeature(f) {
  if (!f || !f.geometry || f.geometry.type !== 'Point' || !Array.isArray(f.geometry.coordinates)) return null;
  const [lngRaw, latRaw] = f.geometry.coordinates;
  const lat = toNum(latRaw), lng = toNum(lngRaw);
  if (lat === null || lng === null) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;

  const p = (f.properties && typeof f.properties === 'object') ? f.properties : {};
  const id = p.id ?? cryptoRandomId();

  const out = {
    id,
    name: shortText(String(p.name ?? 'Unnamed bench'), NAME_MAX),
    lat, lng,
    notes: shortText(String(p.notes ?? ''), NOTES_MAX)
  };

  SCORE_KEYS.forEach(k => {
    const v = toNum(p[k]);
    out[k] = (v === null) ? undefined : clamp(v, SCORE_MIN, SCORE_MAX);
  });

  return out;
}

async function loadBenches() {
  try {
    const resp = await fetch('benches.geojson', { credentials: 'same-origin', cache: 'no-cache' });
    if (!resp.ok) throw new Error('GeoJSON fetch failed');
    const gj = await resp.json();
    if (!gj || !Array.isArray(gj.features)) throw new Error('Invalid GeoJSON');

    const extracted = [];
    for (const f of gj.features) {
      const b = extractBenchFromFeature(f);
      if (b) extracted.push(b);
      if (extracted.length > 2000) break; // hard cap
    }
    if (extracted.length) { benches = extracted; return; }
  } catch (e) { if (DEBUG) console.warn('loadBenches error:', e); }
  benches = fallbackBenches;
}

function computeDecimalAverage(b) {
  const keys = ['comfort','availability','scenery','solitude','crow_density'];
  let sum = 0, count = 0;
  keys.forEach(k => { if (typeof b[k] === 'number') { sum += b[k]; count++; } });
  if (!count) return null;
  return Math.round((sum / count) * 10) / 10;
}

function averageToColor(avg) {
  if (avg === null) return '#94a3b8';
  if (avg >= 8) return '#16a34a';
  if (avg >= 6) return '#22c55e';
  if (avg >= 4) return '#f59e0b';
  return '#ef4444';
}

const map = L.map('map', { zoomControl: true }).setView([44.9778, -93.2650], 14);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; OpenStreetMap contributors'
}).addTo(map);

const markers = {};
const group = L.featureGroup();
const listEl = document.getElementById('bench-list');

function setActiveBench(id) {
  document.querySelectorAll('.bench-item').forEach(i => i.classList.remove('active'));
  const el = document.querySelector(`.bench-item[data-id="${CSS.escape(String(id))}"]`);
  if (el) { el.classList.add('active'); el.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
}

function makeScoreLine(label, valueNum) {
  const wrap = document.createElement('div'); wrap.className = 'score-line';
  const lab = document.createElement('div'); lab.className = 'score-label'; lab.textContent = label;
  const bar = document.createElement('div'); bar.className = 'score-bar';
  const i = document.createElement('i'); const pct = (typeof valueNum === 'number') ? (valueNum / 10) * 100 : 0;
  i.style.width = `${pct}%`; bar.appendChild(i);
  const val = document.createElement('div'); val.className = 'score-value';
  val.textContent = (typeof valueNum === 'number') ? valueNum.toFixed(1) : '—';
  wrap.append(lab, bar, val); return wrap;
}

function buildPopupNode(bench) {
  const root = document.createElement('div'); root.className = 'bench-popup';
  const title = document.createElement('div'); title.className = 'bench-title'; title.textContent = bench.name;
  const overall = document.createElement('div'); overall.className = 'bench-popup-overall';
  const avg = bench._avg; overall.textContent = `Overall Score: ${(avg === null) ? '—' : avg.toFixed(1)}`;
  const scoreList = document.createElement('div'); scoreList.className = 'score-list';
  scoreList.append(
    makeScoreLine('Comfort', bench.comfort),
    makeScoreLine('Availability', bench.availability),
    makeScoreLine('Scenery', bench.scenery),
    makeScoreLine('Solitude', bench.solitude),
    makeScoreLine('Low Crow', bench.crow_density)
  );
  const notes = document.createElement('div'); notes.className = 'bench-popup-notes'; notes.textContent = bench.notes || '';
  const coords = document.createElement('div'); coords.className = 'bench-popup-coords';
  coords.textContent = `Lat: ${bench.lat.toFixed(5)}, Lng: ${bench.lng.toFixed(5)}`;
  root.append(title, overall, scoreList, notes, coords); return root;
}

function buildListItemNode(bench) {
  const item = document.createElement('div'); item.className = 'bench-item'; item.setAttribute('data-id', String(bench.id));
  const title = document.createElement('div'); title.className = 'bench-title'; title.textContent = bench.name;
  const meta1 = document.createElement('div'); meta1.className = 'bench-meta bench-meta--spaced';
  const strong = document.createElement('strong'); strong.textContent = `Overall Score: ${(bench._avg === null) ? '—' : bench._avg.toFixed(1)}`; meta1.appendChild(strong);
  const meta2 = document.createElement('div'); meta2.className = 'bench-meta'; meta2.textContent = bench.notes || '';
  const scoresWrap = document.createElement('div'); scoresWrap.className = 'score-list bench-scores-compact';
  scoresWrap.append(
    makeScoreLine('Comfort', bench.comfort),
    makeScoreLine('Availability', bench.availability),
    makeScoreLine('Scenery', bench.scenery),
    makeScoreLine('Solitude', bench.solitude),
    makeScoreLine('Low Crow', bench.crow_density)
  );
  item.append(title, meta1, meta2, scoresWrap); return item;
}

async function init() {
  await loadBenches();
  benches = benches.map(b => { SCORE_KEYS.forEach(k => { if (typeof b[k] === 'number') b[k] = clamp(b[k], SCORE_MIN, SCORE_MAX); }); b._avg = computeDecimalAverage(b); return b; });

  const listFrag = document.createDocumentFragment();
  benches.forEach(bench => {
    const color = averageToColor(bench._avg);
    const avgDisplay = (bench._avg === null) ? '—' : bench._avg.toFixed(1);

    // Safe: derived numbers only
    const icon = L.divIcon({
      className: 'bench-dot-wrapper',
      html: `<div class="bench-dot-icon"><div class="bench-dot" style="background:${color};">${avgDisplay}</div></div>`,
      iconSize: [28,28], iconAnchor: [14,14]
    });

    const marker = L.marker([bench.lat, bench.lng], { icon }).addTo(map);
    marker.bindPopup(buildPopupNode(bench));
    markers[bench.id] = marker;
    group.addLayer(marker);

    marker.on('click', () => {
      const { lat, lng } = marker.getLatLng();
      map.setView([lat, lng], 17, { animate: true });
      markers[bench.id].openPopup();
      setActiveBench(bench.id);
    });

    const itemNode = buildListItemNode(bench);
    itemNode.addEventListener('click', () => {
      map.setView([bench.lat, bench.lng], 17, { animate: true });
      markers[bench.id].openPopup();
      setActiveBench(bench.id);
    });
    listFrag.appendChild(itemNode);
  });

  listEl.appendChild(listFrag);

  if (group.getLayers().length) {
    const bounds = group.getBounds().pad(0.2);
    map.fitBounds(bounds);
    try { map.setMinZoom(Math.min(Math.floor(map.getBoundsZoom(bounds, true)), 5)); } catch { map.setMinZoom(5); }
    const first = benches[0];
    if (first && markers[first.id]) markers[first.id].openPopup();
  }

  if (DEBUG) {
    Object.defineProperty(window, '_benches', { value: benches, configurable: true });
    Object.defineProperty(window, '_markers', { value: markers, configurable: true });
  }
}

init();
