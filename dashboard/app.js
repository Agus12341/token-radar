// Token Launch Radar — the page's behaviour. Renders window.RADAR_DATA, the
// file main.ts writes beside this page from the same board it hands in, so
// what a reader sees is the entry's board and nothing else. No network, no
// framework: filtering, sorting and the detail view all run on the data in
// the page. The view state lives in the location hash (#detail=<slug>,
// #cat=<category>&watch=1&sort=tvl…), so any view can be linked or captured.

const D = window.RADAR_DATA;
const rows = D.rows;
const bySlug = new Map(rows.map((r) => [r.slug, r]));

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function money(v) {
  if (v >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B';
  if (v >= 1e6) return '$' + (v / 1e6).toFixed(1) + 'M';
  if (v >= 1e3) return '$' + (v / 1e3).toFixed(1) + 'K';
  return '$' + v;
}
function pct(v) {
  if (v === null) return '<span class="flat">—</span>';
  const cls = v > 0.05 ? 'pos' : v < -0.05 ? 'neg' : 'flat';
  return `<span class="${cls}">${v > 0 ? '+' : ''}${v.toFixed(1)}%</span>`;
}
function ageText(days) {
  if (days === null) return '—';
  if (days < 90) return days + 'd';
  if (days < 730) return (days / 30.44).toFixed(1) + ' mo';
  return (days / 365.25).toFixed(1) + ' yrs';
}

// ---- masthead, model strip, footer ---------------------------------------

$('mastStats').innerHTML = [
  [D.scanned, 'protocols scanned'],
  [rows.length, 'pre-token candidates'],
  [D.watchlist_size + ' / ' + D.watchlist_size, 'watchlist covered'],
  [money(D.aggregate_implied_usd), 'aggregate implied'],
].map(([v, l]) => `<div class="stat"><b>${v}</b><span>${l}</span></div>`).join('');
$('globalMultiple').textContent = D.global_multiple.toFixed(2) + 'x';
$('multiples').innerHTML =
  '<span class="m-label">Category multiples (median mcap / TVL of traded peers)</span>' +
  D.multiples.slice(0, 10).map((m) => `<span class="chip">${esc(m.category)} <b>${m.multiple.toFixed(2)}x</b> · n=${m.samples}</span>`).join('');
$('asOf').textContent = D.as_of;
$('boardFoot').textContent =
  `${D.early_size} of these sit below the house's $${(D.floor_usd / 1e6).toFixed(0)}M watchlist floor — the early ones a radar exists to find. ` +
  `${D.live_size} protocols were set aside because their token already trades or they are a product of one that does. Click any row for its farm plan.`;

// ---- filter options -------------------------------------------------------

for (const c of [...new Set(rows.map((r) => r.category ?? 'Uncategorised'))].sort()) {
  $('cat').insertAdjacentHTML('beforeend', `<option>${esc(c)}</option>`);
}
for (const c of [...new Set(rows.flatMap((r) => r.chains))].sort()) {
  $('chain').insertAdjacentHTML('beforeend', `<option>${esc(c)}</option>`);
}

// ---- state ----------------------------------------------------------------

function readState() {
  const h = new URLSearchParams(location.hash.replace(/^#/, ''));
  return {
    q: h.get('q') ?? '',
    cat: h.get('cat') ?? '',
    chain: h.get('chain') ?? '',
    min: Number(h.get('min') ?? 0),
    watch: h.get('watch') === '1',
    sort: h.get('sort') ?? 'rank',
    detail: h.get('detail') ?? '',
  };
}
function writeState(s) {
  const h = new URLSearchParams();
  if (s.detail) h.set('detail', s.detail);
  if (s.q) h.set('q', s.q);
  if (s.cat) h.set('cat', s.cat);
  if (s.chain) h.set('chain', s.chain);
  if (s.min) h.set('min', String(s.min));
  if (s.watch) h.set('watch', '1');
  if (s.sort && s.sort !== 'rank') h.set('sort', s.sort);
  history.replaceState(null, '', '#' + h.toString());
}

// ---- board ----------------------------------------------------------------

const SORTERS = {
  rank: (a, b) => a.rank - b.rank,
  tvl: (a, b) => b.tvl_usd - a.tvl_usd,
  change: (a, b) => (b.change_7d ?? -Infinity) - (a.change_7d ?? -Infinity),
  age: (a, b) => (b.age_days ?? -1) - (a.age_days ?? -1),
  score: (a, b) => b.radar_score - a.radar_score,
};

function visibleRows(s) {
  const q = s.q.trim().toLowerCase();
  return rows
    .filter((r) => !q || r.name.toLowerCase().includes(q) || r.slug.includes(q))
    .filter((r) => !s.cat || (r.category ?? 'Uncategorised') === s.cat)
    .filter((r) => !s.chain || r.chains.includes(s.chain))
    .filter((r) => r.tvl_usd >= s.min)
    .filter((r) => !s.watch || r.on_watchlist)
    .sort(SORTERS[s.sort] ?? SORTERS.rank);
}

function renderBoard(s) {
  const list = visibleRows(s);
  $('rowCount').textContent = list.length + ' of ' + rows.length + ' shown';
  $('boardBody').innerHTML = list.map((r) => `
    <tr data-slug="${esc(r.slug)}">
      <td class="num rank">${r.rank}</td>
      <td><span class="pname">${esc(r.name)}</span>${r.on_watchlist ? '<span class="wl">WATCHLIST</span>' : ''}<span class="pslug">${esc(r.slug)}</span></td>
      <td>${esc(r.category ?? 'Uncategorised')}</td>
      <td class="num">${money(r.tvl_usd)}</td>
      <td class="num">${pct(r.change_7d)}</td>
      <td class="num">${ageText(r.age_days)}</td>
      <td class="num">${r.multiple.toFixed(2)}x</td>
      <td class="num value">${money(r.implied_value_usd)}</td>
      <td><span class="scorebar"><i style="width:${r.radar_score}%"></i></span><span class="scorenum">${r.radar_score}</span></td>
    </tr>`).join('');
  for (const tr of $('boardBody').querySelectorAll('tr')) {
    tr.addEventListener('click', () => {
      const st = readState();
      st.detail = tr.dataset.slug;
      writeState(st);
      apply();
    });
  }
}

// ---- detail ---------------------------------------------------------------

function renderDetail(r) {
  const implied = r.tvl_usd * r.multiple * r.momentum_factor * r.seasoning_factor;
  $('detailBody').innerHTML = `
    <div class="detail-head">
      <div>
        <h2>${esc(r.name)}${r.on_watchlist ? '<span class="wl">WATCHLIST</span>' : ''}</h2>
        <p class="detail-sub">${esc(r.slug)} · rank #${r.rank} of ${rows.length} · records no token on DefiLlama as of ${D.as_of}</p>
      </div>
      <div class="big-value"><span>Implied launch value</span><b>${money(r.implied_value_usd)}</b></div>
    </div>
    <div class="math">
      <div class="tile"><span>TVL</span><b>${money(r.tvl_usd)}</b></div><span class="op">&times;</span>
      <div class="tile"><span>${esc(r.category ?? 'Uncategorised')} multiple</span><b>${r.multiple.toFixed(2)}x</b></div><span class="op">&times;</span>
      <div class="tile"><span>Momentum (7d ${r.change_7d === null ? 'n/a' : (r.change_7d > 0 ? '+' : '') + r.change_7d.toFixed(1) + '%'})</span><b>${r.momentum_factor.toFixed(2)}x</b></div><span class="op">&times;</span>
      <div class="tile"><span>Seasoning (${ageText(r.age_days)} tokenless)</span><b>${r.seasoning_factor.toFixed(2)}x</b></div><span class="op">=</span>
      <div class="tile"><span>Model value</span><b>${money(Math.round(implied))}</b></div>
    </div>
    <div class="meta-grid">
      <div><b>Category</b>${esc(r.category ?? 'Uncategorised')}</div>
      <div><b>Chains</b>${r.chains.map(esc).join(', ')}</div>
      <div><b>TVL change, 7d</b>${r.change_7d === null ? 'not reported' : (r.change_7d > 0 ? '+' : '') + r.change_7d.toFixed(1) + '%'}</div>
      <div><b>Tracked since</b>${r.listed_at ?? 'not recorded'}${r.age_days !== null ? ` (${r.age_days} days)` : ''}</div>
      <div><b>Radar score</b>${r.radar_score} / 100</div>
      <div><b>On the house watchlist</b>${r.on_watchlist ? 'Yes — at or above the $' + (D.floor_usd / 1e6).toFixed(0) + 'M floor' : r.tvl_usd >= D.floor_usd ? 'No — above the floor, but the house rule left it off (its DefiLlama record names a parent protocol the snapshot does not carry)' : 'No — below the floor, found by the radar'}</div>
      <div><b>Token recorded</b>None (no CoinGecko id, no symbol)</div>
      <div><b>Board rank basis</b>Implied value, highest first</div>
    </div>
    <h3>How to farm it</h3>
    <ol class="steps">${r.farm_steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>`;
}

// ---- wiring -----------------------------------------------------------------

function apply() {
  const s = readState();
  $('q').value = s.q;
  $('cat').value = s.cat;
  $('chain').value = s.chain;
  $('minTvl').value = String(s.min);
  $('watchOnly').checked = s.watch;
  $('sort').value = s.sort;
  const detail = s.detail ? bySlug.get(s.detail) : undefined;
  if (detail) {
    renderDetail(detail);
    $('modelPanel').hidden = true;
    $('boardView').hidden = true;
    $('detailView').hidden = false;
  } else {
    $('detailView').hidden = true;
    $('modelPanel').hidden = false;
    $('boardView').hidden = false;
    renderBoard(s);
  }
}

function onControl() {
  const s = readState();
  s.q = $('q').value;
  s.cat = $('cat').value;
  s.chain = $('chain').value;
  s.min = Number($('minTvl').value);
  s.watch = $('watchOnly').checked;
  s.sort = $('sort').value;
  writeState(s);
  apply();
}
for (const id of ['q', 'cat', 'chain', 'minTvl', 'watchOnly', 'sort']) {
  $(id).addEventListener('input', onControl);
  $(id).addEventListener('change', onControl);
}
$('backBtn').addEventListener('click', () => {
  const s = readState();
  s.detail = '';
  writeState(s);
  apply();
});
window.addEventListener('hashchange', apply);
apply();
