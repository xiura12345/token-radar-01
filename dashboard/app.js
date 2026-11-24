// Launch Radar's page. It renders window.RADAR — the dataset main.ts writes beside
// dashboard/ from the same board it hands in — as three views chosen by the hash: the
// ranked board (#/), one protocol's detail (#/p/<slug>) and the already-trading set
// (#/live). The board's filters live in the hash too, so any view can be linked or
// captured as it stands. No network: every byte rendered is in data.js.
(function () {
  'use strict';

  var D = window.RADAR;
  if (!D) return;
  var view = document.getElementById('view');
  var bySlug = {};
  D.rows.forEach(function (r) { bySlug[r.slug] = r; });
  var maxImplied = D.rows.reduce(function (m, r) { return Math.max(m, r.implied_value_usd); }, 0);

  document.getElementById('freshness').textContent =
    'Snapshot as of ' + D.as_of + ' · model ' + D.model_version + ' · ' + D.source;

  /* ---------- formatting ---------- */
  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return '$' + Math.round(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return '<span class="flat">n/a</span>';
    var cls = n > 0.05 ? 'up' : n < -0.05 ? 'down' : 'flat';
    return '<span class="' + cls + '">' + (n > 0 ? '+' : '') + n.toFixed(2) + '%</span>';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unreported';
    if (days >= 365) return (days / 365).toFixed(1) + ' yrs';
    return Math.round(days) + ' days';
  }
  function fmtMult(n) { return '×' + Number(n).toFixed(4).replace(/0+$/, '').replace(/\.$/, '.0'); }
  function badge(r) {
    return r.on_watchlist
      ? '<span class="badge watch">Watchlist</span>'
      : '<span class="badge early">Early find</span>';
  }

  /* ---------- routing ---------- */
  function parseHash() {
    var h = location.hash.replace(/^#/, '') || '/';
    var qAt = h.indexOf('?');
    var path = qAt >= 0 ? h.slice(0, qAt) : h;
    var params = new URLSearchParams(qAt >= 0 ? h.slice(qAt + 1) : '');
    return { path: path, params: params };
  }
  function boardState(params) {
    return {
      q: params.get('q') || '',
      cat: params.get('cat') || 'all',
      chain: params.get('chain') || 'all',
      wl: params.get('wl') === '1',
      min: Number(params.get('min') || 0),
      sort: params.get('sort') || 'rank',
      dir: Number(params.get('dir') || 1)
    };
  }
  function boardHash(st) {
    var p = new URLSearchParams();
    if (st.q) p.set('q', st.q);
    if (st.cat !== 'all') p.set('cat', st.cat);
    if (st.chain !== 'all') p.set('chain', st.chain);
    if (st.wl) p.set('wl', '1');
    if (st.min) p.set('min', String(st.min));
    if (st.sort !== 'rank') p.set('sort', st.sort);
    if (st.dir !== 1) p.set('dir', String(st.dir));
    var s = p.toString();
    return '#/' + (s ? '?' + s : '');
  }

  function setTab(name) {
    var links = document.querySelectorAll('.tabs a');
    for (var i = 0; i < links.length; i++) {
      links[i].classList.toggle('on', links[i].getAttribute('data-tab') === name);
    }
  }

  /* ---------- the board ---------- */
  var SORTS = {
    rank: function (r) { return r.rank; },
    name: function (r) { return r.name.toLowerCase(); },
    tvl: function (r) { return r.tvl_usd; },
    change: function (r) { return r.change_7d === null ? -Infinity : r.change_7d; },
    age: function (r) { return r.model.age_days === null ? -1 : r.model.age_days; },
    implied: function (r) { return r.implied_value_usd; }
  };

  function filteredRows(st) {
    var q = st.q.trim().toLowerCase();
    var rows = D.rows.filter(function (r) {
      if (st.wl && !r.on_watchlist) return false;
      if (st.cat !== 'all' && (r.category || 'Uncategorised') !== st.cat) return false;
      if (st.chain !== 'all' && r.chains.indexOf(st.chain) < 0) return false;
      if (st.min && r.tvl_usd < st.min) return false;
      if (q && (r.name + ' ' + r.slug + ' ' + (r.category || '')).toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
    var key = SORTS[st.sort] || SORTS.rank;
    rows.sort(function (a, b) {
      var ka = key(a), kb = key(b);
      var cmp = ka < kb ? -1 : ka > kb ? 1 : a.rank - b.rank;
      return cmp * st.dir;
    });
    return rows;
  }

  function options(values, current, allLabel) {
    var out = '<option value="all">' + allLabel + '</option>';
    values.forEach(function (v) {
      out += '<option value="' + esc(v) + '"' + (v === current ? ' selected' : '') + '>' + esc(v) + '</option>';
    });
    return out;
  }

  function renderBoard(st) {
    setTab('board');
    var cats = [];
    var chains = {};
    D.rows.forEach(function (r) {
      var c = r.category || 'Uncategorised';
      if (cats.indexOf(c) < 0) cats.push(c);
      r.chains.forEach(function (ch) { chains[ch] = (chains[ch] || 0) + 1; });
    });
    cats.sort();
    var chainNames = Object.keys(chains).sort(function (a, b) { return chains[b] - chains[a]; }).slice(0, 24);
    var topCats = D.categories.slice(0, 6);

    var html = '';
    html += '<section class="stats">'
      + '<div class="stat"><b>' + D.counts.protocols + '</b><span>protocols in the snapshot</span></div>'
      + '<div class="stat"><b>' + D.counts.pre_token + '</b><span>record no token yet</span></div>'
      + '<div class="stat hot"><b>' + D.counts.board + '</b><span>ranked on the board</span></div>'
      + '<div class="stat"><b>' + D.counts.watchlist + ' / ' + D.counts.watchlist + '</b><span>watchlist covered</span></div>'
      + '<div class="stat"><b>' + D.counts.early + '</b><span>early finds below the ' + fmtUsd(D.floor_usd) + ' floor</span></div>'
      + '<div class="stat"><b>' + fmtUsd(maxImplied) + '</b><span>highest implied value</span></div>'
      + '</section>';

    html += '<section class="method"><h2>How the radar prices a launch that has not happened</h2>'
      + '<p class="formula">implied value = TVL × category multiple × growth × maturity × reach</p>'
      + '<p>The <strong>category multiple</strong> is measured, not chosen: among the ' + D.market_samples
      + ' snapshot protocols whose token already trades, the market pays a median of <strong>' + fmtMult(D.market_multiple)
      + '</strong> of market cap per TVL dollar, and each category with at least ' + D.shape.min_category_samples
      + ' trading samples gets its own median. <strong>Growth</strong> squashes the 7-day TVL change through tanh so one wild week cannot dominate. '
      + '<strong>Maturity</strong> pays for years survived with no token. <strong>Reach</strong> adds a little for every chain past the first. '
      + 'No protocol’s name is an input: the same function scores every row, and each detail view shows its row’s arithmetic.</p>'
      + '<details><summary>The measured category multiples</summary>'
      + '<table class="mini"><thead><tr><th>Category</th><th class="n">Live samples</th><th class="n">Median cap / TVL</th><th>Basis</th></tr></thead><tbody>';
    topCats.forEach(function (c) {
      html += '<tr><td>' + esc(c.category) + '</td><td class="n">' + c.samples + '</td><td class="n">' + fmtMult(c.multiple)
        + '</td><td>' + (c.source === 'category' ? 'its own median' : 'market median (thin sample)') + '</td></tr>';
    });
    html += '</tbody></table></details></section>';

    html += '<form class="controls" id="controls">'
      + '<input type="search" id="f-q" placeholder="Search name, slug, category…" value="' + esc(st.q) + '" aria-label="Search">'
      + '<select id="f-cat" aria-label="Category">' + options(cats, st.cat, 'All categories') + '</select>'
      + '<select id="f-chain" aria-label="Chain">' + options(chainNames, st.chain, 'All chains') + '</select>'
      + '<select id="f-min" aria-label="Minimum TVL">'
      + '<option value="0"' + (st.min === 0 ? ' selected' : '') + '>Any TVL</option>'
      + '<option value="50000000"' + (st.min === 50000000 ? ' selected' : '') + '>$50M+</option>'
      + '<option value="250000000"' + (st.min === 250000000 ? ' selected' : '') + '>$250M+</option>'
      + '<option value="1000000000"' + (st.min === 1000000000 ? ' selected' : '') + '>$1B+</option></select>'
      + '<label class="check"><input type="checkbox" id="f-wl"' + (st.wl ? ' checked' : '') + '> Watchlist only</label>'
      + '<span class="count" id="f-count"></span></form>'
      + '<div id="table-wrap"></div>';

    view.innerHTML = html;
    view.setAttribute('aria-busy', 'false');

    var state = st;
    function paint() {
      var rows = filteredRows(state);
      document.getElementById('f-count').textContent = rows.length + ' of ' + D.counts.board + ' protocols';
      var wrap = document.getElementById('table-wrap');
      if (rows.length === 0) {
        wrap.innerHTML = '<div class="empty">No protocol matches that sweep. Loosen a filter and sweep again.</div>';
        return;
      }
      var arrow = function (k) { return state.sort === k ? ' <span class="arrow">' + (state.dir === 1 ? '▲' : '▼') + '</span>' : ''; };
      var t = '<table class="board"><thead><tr>'
        + '<th class="sortable" data-sort="rank">Rank' + arrow('rank') + '</th>'
        + '<th class="sortable" data-sort="name">Protocol' + arrow('name') + '</th>'
        + '<th>Category</th><th class="hide-s">Chains</th>'
        + '<th class="n sortable" data-sort="tvl">TVL' + arrow('tvl') + '</th>'
        + '<th class="n sortable" data-sort="change">7d' + arrow('change') + '</th>'
        + '<th class="n hide-s sortable" data-sort="age">Age' + arrow('age') + '</th>'
        + '<th class="n sortable" data-sort="implied">Implied value' + arrow('implied') + '</th>'
        + '</tr></thead><tbody>';
      rows.forEach(function (r) {
        t += '<tr data-slug="' + esc(r.slug) + '">'
          + '<td><span class="rank' + (r.rank <= 3 ? ' top' : '') + '">' + r.rank + '</span></td>'
          + '<td><span class="pname">' + esc(r.name) + '</span>' + badge(r) + '<br><span class="pslug">' + esc(r.slug) + '</span></td>'
          + '<td class="cat">' + esc(r.category || 'Uncategorised') + '</td>'
          + '<td class="chains hide-s">' + esc(r.chains.slice(0, 3).join(', ')) + (r.chains.length > 3 ? ' +' + (r.chains.length - 3) : '') + '</td>'
          + '<td class="n">' + fmtUsd(r.tvl_usd) + '</td>'
          + '<td class="n">' + fmtPct(r.change_7d) + '</td>'
          + '<td class="n hide-s">' + fmtAge(r.model.age_days) + '</td>'
          + '<td class="n"><span class="implied">' + fmtUsd(r.implied_value_usd) + '</span>'
          + '<span class="bar"><i style="width:' + Math.max(2, Math.round(100 * r.implied_value_usd / maxImplied)) + '%"></i></span></td>'
          + '</tr>';
      });
      wrap.innerHTML = t + '</tbody></table>';
      var trs = wrap.querySelectorAll('tbody tr');
      for (var i = 0; i < trs.length; i++) {
        trs[i].addEventListener('click', function () { location.hash = '#/p/' + this.getAttribute('data-slug'); });
      }
      var ths = wrap.querySelectorAll('th.sortable');
      for (var j = 0; j < ths.length; j++) {
        ths[j].addEventListener('click', function () {
          var k = this.getAttribute('data-sort');
          if (state.sort === k) { state.dir = -state.dir; }
          else { state.sort = k; state.dir = (k === 'rank' || k === 'name') ? 1 : -1; }
          history.replaceState(null, '', boardHash(state));
          paint();
        });
      }
    }
    paint();

    function sync() {
      state.q = document.getElementById('f-q').value;
      state.cat = document.getElementById('f-cat').value;
      state.chain = document.getElementById('f-chain').value;
      state.min = Number(document.getElementById('f-min').value);
      state.wl = document.getElementById('f-wl').checked;
      history.replaceState(null, '', boardHash(state));
      paint();
    }
    document.getElementById('f-q').addEventListener('input', sync);
    document.getElementById('f-cat').addEventListener('change', sync);
    document.getElementById('f-chain').addEventListener('change', sync);
    document.getElementById('f-min').addEventListener('change', sync);
    document.getElementById('f-wl').addEventListener('change', sync);
    document.getElementById('controls').addEventListener('submit', function (e) { e.preventDefault(); });
  }

  /* ---------- one protocol ---------- */
  function parseStep(s) {
    var ci = s.lastIndexOf(' Cost: ');
    var ti = s.lastIndexOf('. Time: ');
    if (ci < 0 || ti < ci) return { action: s, cost: '', time: '' };
    return {
      action: s.slice(0, ci),
      cost: s.slice(ci + 7, ti),
      time: s.slice(ti + 8).replace(/\.$/, '')
    };
  }

  function renderDetail(slug) {
    var r = bySlug[slug];
    if (!r) { renderBoard(boardState(new URLSearchParams())); return; }
    setTab('board');
    var m = r.model;
    var html = '<a class="back" href="#/">← Back to the board</a>'
      + '<div class="detail-head"><span class="rank' + (r.rank <= 3 ? ' top' : '') + '">#' + r.rank + '</span>'
      + '<h2>' + esc(r.name) + '</h2>' + badge(r)
      + '<span class="cat">' + esc(r.category || 'Uncategorised') + ' · ' + esc(r.slug) + '</span></div>'
      + '<section class="kv">'
      + '<div><span>Implied value</span><b>' + fmtUsd(r.implied_value_usd) + '</b></div>'
      + '<div><span>TVL (snapshot)</span><b>' + fmtUsd(r.tvl_usd) + '</b></div>'
      + '<div><span>TVL change, 7d</span><b>' + (r.change_7d === null ? 'n/a' : fmtPct(r.change_7d)) + '</b></div>'
      + '<div><span>Running since</span><b>' + (r.listed_at || 'unreported') + '</b></div>'
      + '<div><span>Age with no token</span><b>' + fmtAge(m.age_days) + '</b></div>'
      + '<div><span>Token status</span><b>No token recorded</b></div>'
      + '</section>'
      + '<section class="panel"><h3>Why this value — the row’s own arithmetic</h3>'
      + '<table class="calc"><tbody>'
      + '<tr><td>Total value locked, the base the market would price</td><td class="n">' + fmtUsd(r.tvl_usd) + '</td></tr>'
      + '<tr><td>Category multiple — ' + (m.multiple_source === 'category'
          ? 'median cap/TVL of the ' + m.category_samples + ' trading ' + esc(r.category || 'Uncategorised') + ' protocols'
          : 'market median (this category has too few trading samples of its own)') + '</td><td class="n">' + fmtMult(m.category_multiple) + '</td></tr>'
      + '<tr><td>Growth — 7-day TVL change of ' + (m.growth_pct === null ? 'unreported, scored neutral' : m.growth_pct.toFixed(2) + '%') + ', tanh-squashed</td><td class="n">' + fmtMult(m.growth_multiplier) + '</td></tr>'
      + '<tr><td>Maturity — ' + fmtAge(m.age_used_days) + ' with no token' + (m.age_days === null ? ' (listing date unreported: the pre-token median age stands in)' : '') + '</td><td class="n">' + fmtMult(m.maturity_multiplier) + '</td></tr>'
      + '<tr><td>Reach — ' + m.chain_count + ' chain' + (m.chain_count === 1 ? '' : 's') + '</td><td class="n">' + fmtMult(m.reach_multiplier) + '</td></tr>'
      + '<tr class="total"><td>Implied value if it launched at these figures</td><td class="n">' + fmtUsd(r.implied_value_usd) + '</td></tr>'
      + '</tbody></table>'
      + '<p>Factors are shown rounded to four places; the board’s figure is computed before rounding. Chains: ' + esc(r.chains.join(', ') || 'none named') + '.</p></section>'
      + '<section class="panel"><h3>Farm plan — what to do before a launch</h3><ol class="steps">';
    r.farm_steps.forEach(function (s) {
      var st = parseStep(s);
      html += '<li><span class="act">' + esc(st.action) + '</span>'
        + (st.cost ? '<span class="chip">Cost <b>' + esc(st.cost) + '</b></span>' : '')
        + (st.time ? '<span class="chip">Time <b>' + esc(st.time) + '</b></span>' : '') + '</li>';
    });
    html += '</ol><p>Costs are working estimates from the protocol’s size and its home chain’s fee class, not quotes; the position’s capital is the real price, and no plan here is a promise that a token, an airdrop or a reward follows.</p></section>';

    var prev = D.rows[r.rank - 2], next = D.rows[r.rank];
    html += '<nav class="pager">'
      + (prev ? '<a href="#/p/' + esc(prev.slug) + '">← #' + prev.rank + ' ' + esc(prev.name) + '</a>' : '<span></span>')
      + (next ? '<a href="#/p/' + esc(next.slug) + '">#' + next.rank + ' ' + esc(next.name) + ' →</a>' : '<span></span>')
      + '</nav>';
    view.innerHTML = html;
    view.setAttribute('aria-busy', 'false');
    window.scrollTo(0, 0);
  }

  /* ---------- already trading ---------- */
  function renderLive() {
    setTab('live');
    var html = '<section class="method"><h2>Already trading — the comparison set, never ranked</h2>'
      + '<p>These protocols’ tokens exist, so the radar does not guess at their value: it shows the market’s own market cap. '
      + 'They earn their place on this page twice over — they are the sample the board’s category multiples are measured from, '
      + 'and the line between a launch that already happened and one still to come. The largest ' + D.live.length + ' by market cap are shown.</p></section>'
      + '<table class="board"><thead><tr><th>Protocol</th><th>Symbol</th><th>Category</th>'
      + '<th class="n">TVL</th><th class="n">Market cap</th><th class="n">Cap / TVL</th><th class="n">7d</th></tr></thead><tbody>';
    D.live.forEach(function (r) {
      html += '<tr><td><span class="pname">' + esc(r.name) + '</span><br><span class="pslug">' + esc(r.slug) + '</span></td>'
        + '<td class="num">' + esc(r.symbol || '—') + '</td>'
        + '<td class="cat">' + esc(r.category || 'Uncategorised') + '</td>'
        + '<td class="n">' + fmtUsd(r.tvl_usd) + '</td>'
        + '<td class="n">' + fmtUsd(r.mcap_usd) + '</td>'
        + '<td class="n">' + (r.mcap_tvl === null ? 'n/a' : fmtMult(r.mcap_tvl)) + '</td>'
        + '<td class="n">' + fmtPct(r.change_7d) + '</td></tr>';
    });
    view.innerHTML = html + '</tbody></table>';
    view.setAttribute('aria-busy', 'false');
  }

  /* ---------- dispatch ---------- */
  function render() {
    var route = parseHash();
    if (route.path === '/live') { renderLive(); return; }
    if (route.path.indexOf('/p/') === 0) { renderDetail(decodeURIComponent(route.path.slice(3))); return; }
    renderBoard(boardState(route.params));
  }
  window.addEventListener('hashchange', render);
  render();
})();
