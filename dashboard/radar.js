// Launch Radar v2 — dashboard behaviour.
// Data arrives as window.RADAR_DATA (../data.js, written by main.ts from the
// sealed snapshot). Views: board (sortable, filterable), a detail view per
// protocol, methodology, and the already-trading set the multiples came from.
// The starting view is read from the hash: #board, #board?risk=High,
// #board?watch=1, #board?cat=Dexs, #detail/<slug>, #method, #live.

const D = window.RADAR_DATA;
const rows = D.rows;
const bySlug = new Map(rows.map((r) => [r.slug, r]));

const state = { tab: 'board', sortKey: 'rank', sortDir: 1, q: '', cat: '', chain: '', risk: '', watch: false };
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function money(n) {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n}`;
}
function pct(n) {
  if (n === null) return '<span class="slug">n/a</span>';
  const cls = n > 0 ? 'pos' : n < 0 ? 'neg' : '';
  return `<span class="${cls}">${n > 0 ? '+' : ''}${n.toFixed(1)}%</span>`;
}
function ageText(days) {
  if (days === null) return '<span class="slug">n/a</span>';
  if (days >= 730) return `${(days / 365.25).toFixed(1)} yrs`;
  if (days >= 365) return `${(days / 365.25).toFixed(2)} yrs`;
  return `${days} d`;
}
const riskOrder = { High: 0, Medium: 1, Low: 2 };

// ------------------------------------------------------------------ board

function visibleRows() {
  const q = state.q.trim().toLowerCase();
  let out = rows.filter((r) =>
    (!q || r.name.toLowerCase().includes(q) || r.slug.includes(q)) &&
    (!state.cat || r.category === state.cat) &&
    (!state.chain || r.chains.includes(state.chain)) &&
    (!state.risk || r.risk_level === state.risk) &&
    (!state.watch || r.watchlist));
  const k = state.sortKey;
  const dir = state.sortDir;
  const val = (r) => ({
    rank: r.rank, name: r.name.toLowerCase(), category: r.category, tvl: r.tvl_usd,
    chg: r.change_7d === null ? -Infinity : r.change_7d,
    age: r.age_days === null ? -1 : r.age_days,
    implied: r.implied_value_usd, risk: riskOrder[r.risk_level],
  })[k];
  out = [...out].sort((a, b) => (val(a) < val(b) ? -1 : val(a) > val(b) ? 1 : a.rank - b.rank) * dir);
  return out;
}

function renderBoard() {
  const out = visibleRows();
  $('count').textContent = `${out.length} of ${rows.length} protocols`;
  $('rows').innerHTML = out.map((r) => `
    <tr data-slug="${esc(r.slug)}" class="${r.rank <= 3 ? 'top3' : ''}">
      <td class="rank">${r.rank}</td>
      <td><span class="name">${esc(r.name)}</span>${r.watchlist ? ' <span class="star" title="On the house watchlist">★</span>' : ''}<br><span class="slug">${esc(r.slug)}</span></td>
      <td>${esc(r.category)}</td>
      <td class="chains">${esc(r.chains.slice(0, 3).join(', '))}${r.chains.length > 3 ? ` +${r.chains.length - 3}` : ''}</td>
      <td class="num">${money(r.tvl_usd)}</td>
      <td class="num">${pct(r.change_7d)}</td>
      <td class="num">${ageText(r.age_days)}</td>
      <td class="num implied">${money(r.implied_value_usd)}</td>
      <td><span class="badge ${r.risk_level}">${r.risk_level}</span></td>
    </tr>`).join('');
  for (const tr of $('rows').querySelectorAll('tr')) {
    tr.addEventListener('click', () => { location.hash = `#detail/${tr.dataset.slug}`; });
  }
  for (const th of document.querySelectorAll('#board-table th[data-sort]')) {
    const base = th.textContent.replace(/ [▲▼]$/, '');
    th.innerHTML = esc(base) + (th.dataset.sort === state.sortKey ? ` <span class="arrow">${state.sortDir === 1 ? '▲' : '▼'}</span>` : '');
  }
}

// ------------------------------------------------------------------ detail

function factorBar(label, value, frac, note) {
  return `<div class="factor"><span class="fl">${label}</span><div class="track"><div class="fill" style="width:${Math.round(frac * 100)}%"></div></div><span class="fv">${value}</span></div>
  <div class="factor"><span></span><span class="slug">${note}</span><span></span></div>`;
}

function renderDetail(slug) {
  const r = bySlug.get(slug);
  if (!r) { showTab('board'); return; }
  const f = r.factors;
  $('view-detail').innerHTML = `
    <button class="back" id="back">← Back to the board</button>
    <div class="detail-head">
      <div>
        <h2>${esc(r.name)}${r.watchlist ? ' <span class="star">★</span>' : ''}</h2>
        <div class="sub">${esc(r.slug)} · ${esc(r.category)} · rank #${r.rank} of ${rows.length} · <span class="badge ${r.risk_level}">${r.risk_level} risk</span></div>
      </div>
      <div class="big-implied"><span>Implied value</span><b>${money(r.implied_value_usd)}</b></div>
    </div>
    <div class="kv">
      <div class="cell"><span>TVL</span><b>${money(r.tvl_usd)}</b></div>
      <div class="cell"><span>7-day change</span><b>${r.change_7d === null ? 'n/a' : `${r.change_7d > 0 ? '+' : ''}${r.change_7d.toFixed(1)}%`}</b></div>
      <div class="cell"><span>Tracked for</span><b>${r.age_days === null ? 'n/a' : `${r.age_days} days`}</b></div>
      <div class="cell"><span>Chains</span><b>${r.chains.length}</b></div>
    </div>
    <div class="cols">
      <div class="card">
        <h3>How the implied value is built</h3>
        ${factorBar('TVL', money(r.tvl_usd), Math.min(1, Math.log10(Math.max(10, r.tvl_usd)) / 11), 'the protocol’s own locked value in the snapshot')}
        ${factorBar('Category multiple', `× ${r.multiple.toFixed(3)}`, r.multiple / 4, `median cap/TVL of token-bearing ${esc(r.category)} protocols, shrunk to the global median`)}
        ${factorBar('Momentum', `× ${f.momentum.toFixed(3)}`, (f.momentum - 0.65) / 0.7, 'from the 7-day TVL change, tanh-shaped, ±35% at most')}
        ${factorBar('Maturity', `× ${f.maturity.toFixed(3)}`, (f.maturity - 1) / 0.5, 'how long it has run with no token')}
        ${factorBar('Reach', `× ${f.reach.toFixed(3)}`, (f.reach - 1) / 0.45, `${r.chains.length} chain${r.chains.length === 1 ? '' : 's'}: ${esc(r.chains.join(', '))}`)}
        <p class="hint">= ${money(r.implied_value_usd)} implied value. Every input is a figure from the sealed snapshot.</p>
      </div>
      <div class="card">
        <h3>Risk flags</h3>
        ${r.risk_flags.length ? `<ul class="flags">${r.risk_flags.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : '<p class="noflag">No flags: steady TVL, dated track record, more than one chain, room in its category.</p>'}
        <h3 style="margin-top:16px">Farm plan — six steps</h3>
        <ol class="steps">${r.farm_steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
      </div>
    </div>`;
  $('back').addEventListener('click', () => { location.hash = '#board'; });
}

// ------------------------------------------------------------------ other views

function renderMethod() {
  $('global-mult').textContent = `The global median cap/TVL across all token-bearing protocols is ${D.global_multiple.toFixed(3)}×.`;
  $('mult-rows').innerHTML = D.multiples.map((m) => `
    <tr><td>${esc(m.category)}</td><td class="num">${m.sample}</td><td class="num">${m.multiple.toFixed(3)}×</td></tr>`).join('');
}

function renderLive() {
  $('live-rows').innerHTML = D.live.map((p) => `
    <tr>
      <td><span class="name">${esc(p.name)}</span><br><span class="slug">${esc(p.slug)}</span></td>
      <td>${esc(p.symbol ?? '—')}</td>
      <td>${esc(p.category)}</td>
      <td class="num">${money(p.tvl_usd)}</td>
      <td class="num">${p.mcap_usd ? money(p.mcap_usd) : '<span class="slug">n/a</span>'}</td>
      <td class="num">${p.ratio ? `${p.ratio.toFixed(3)}×` : '<span class="slug">n/a</span>'}</td>
    </tr>`).join('');
}

// ------------------------------------------------------------------ routing

function showTab(tab) {
  state.tab = tab;
  for (const b of document.querySelectorAll('.tab')) b.classList.toggle('active', b.dataset.tab === tab);
  $('view-board').hidden = tab !== 'board';
  $('view-detail').hidden = tab !== 'detail';
  $('view-method').hidden = tab !== 'method';
  $('view-live').hidden = tab !== 'live';
}

function route() {
  const hash = location.hash || '#board';
  if (hash.startsWith('#detail/')) {
    showTab('detail');
    renderDetail(decodeURIComponent(hash.slice('#detail/'.length)));
  } else if (hash.startsWith('#method')) {
    showTab('method');
  } else if (hash.startsWith('#live')) {
    showTab('live');
  } else {
    const params = new URLSearchParams(hash.includes('?') ? hash.slice(hash.indexOf('?') + 1) : '');
    if (params.has('risk')) { state.risk = params.get('risk'); $('f-risk').value = state.risk; }
    if (params.has('cat')) { state.cat = params.get('cat'); $('f-cat').value = state.cat; }
    if (params.has('watch')) { state.watch = params.get('watch') === '1'; $('f-watch').checked = state.watch; }
    showTab('board');
    renderBoard();
  }
  window.scrollTo(0, 0);
}

// ------------------------------------------------------------------ init

function fillSelect(id, values) {
  const sel = $(id);
  for (const v of values) {
    const o = document.createElement('option');
    o.value = v; o.textContent = v;
    sel.appendChild(o);
  }
}
fillSelect('f-cat', [...new Set(rows.map((r) => r.category))].sort());
fillSelect('f-chain', [...new Set(rows.flatMap((r) => r.chains))].sort());

const watchCount = rows.filter((r) => r.watchlist).length;
$('stats').innerHTML = `
  <div class="stat"><b>${rows.length}</b><span>pre-token ranked</span></div>
  <div class="stat"><b>${watchCount}</b><span>on the watchlist</span></div>
  <div class="stat"><b>${D.live.length}</b><span>already trading</span></div>
  <div class="stat"><b>${esc(D.as_of)}</b><span>snapshot date</span></div>`;
$('foot-note').textContent = `Data: ${D.source}. Board generated from the sealed snapshot; nothing here is fetched live.`;

for (const b of document.querySelectorAll('.tab')) {
  b.addEventListener('click', () => { location.hash = b.dataset.tab === 'board' ? '#board' : `#${b.dataset.tab}`; });
}
$('q').addEventListener('input', (e) => { state.q = e.target.value; renderBoard(); });
$('f-cat').addEventListener('change', (e) => { state.cat = e.target.value; renderBoard(); });
$('f-chain').addEventListener('change', (e) => { state.chain = e.target.value; renderBoard(); });
$('f-risk').addEventListener('change', (e) => { state.risk = e.target.value; renderBoard(); });
$('f-watch').addEventListener('change', (e) => { state.watch = e.target.checked; renderBoard(); });
for (const th of document.querySelectorAll('#board-table th[data-sort]')) {
  th.addEventListener('click', () => {
    const k = th.dataset.sort;
    if (state.sortKey === k) state.sortDir *= -1;
    else { state.sortKey = k; state.sortDir = k === 'name' || k === 'category' ? 1 : -1; }
    renderBoard();
  });
}
window.addEventListener('hashchange', route);
renderMethod();
renderLive();
route();
