// Token Radar dashboard. Reads window.RADAR (written by main.ts from the
// same board as board.json), so the page and the board can never disagree.
// No network, no framework, no tracking.
(function () {
  'use strict';
  var D = window.RADAR;
  if (!D) { document.body.innerHTML = '<p style="padding:24px">Token Radar: data.js did not load.</p>'; return; }

  var $ = function (id) { return document.getElementById(id); };
  var rows = D.rows, live = D.live;

  // -- formatting ---------------------------------------------------------
  function usd(n) {
    if (n == null) return '—';
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2).replace(/\.00$/, '') + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + Math.round(n);
  }
  function pct(n) {
    if (n == null) return '—';
    return (n >= 0 ? '+' : '') + n.toFixed(1) + '%';
  }
  function age(n) {
    if (n == null) return '—';
    if (n >= 365) return (n / 365).toFixed(1) + 'y';
    return n + 'd';
  }
  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; });
  }

  // -- header + stats ------------------------------------------------------
  $('as-of').textContent = 'snapshot ' + D.as_of + ' · ' + D.source;
  $('foot-date').textContent = D.as_of;
  $('foot-count').textContent = (D.board_size + D.live_size) + ' protocols';
  var top = rows[0];
  $('stats').innerHTML = [
    ['Protocols scored', String(D.board_size)],
    ['Watchlist covered', D.watchlist_size + ' / ' + D.watchlist_size],
    ['Live comparables', String(D.model.live_count)],
    ['Top implied value', usd(top.implied_value_usd)],
  ].map(function (s) { return '<div class="stat"><b>' + esc(s[1]) + '</b><span>' + esc(s[0]) + '</span></div>'; }).join('');

  // -- filter controls -----------------------------------------------------
  var cats = Array.from(new Set(rows.map(function (r) { return r.category || 'Other'; }))).sort();
  var chains = Array.from(new Set(rows.flatMap(function (r) { return r.chains; }))).sort();
  cats.forEach(function (c) { $('category').insertAdjacentHTML('beforeend', '<option>' + esc(c) + '</option>'); });
  chains.forEach(function (c) { $('chain').insertAdjacentHTML('beforeend', '<option>' + esc(c) + '</option>'); });

  // -- multiples table -----------------------------------------------------
  $('multiples').querySelector('tbody').innerHTML = D.multiples.map(function (m) {
    return '<tr><td>' + esc(m.category) + '</td><td class="num">×' + m.multiple.toFixed(3) + '</td><td class="num">' + m.comparables + '</td></tr>';
  }).join('') + '<tr><td>Global fallback</td><td class="num">×' + D.model.global_multiple.toFixed(3) + '</td><td class="num">—</td></tr>';

  // -- state ---------------------------------------------------------------
  var state = { q: '', category: '', chain: '', mintvl: 0, sort: 'implied', tab: 'pre', page: 1, slug: null };
  function readHash() {
    var h = new URLSearchParams(location.hash.slice(1));
    state.q = h.get('q') || ''; state.category = h.get('category') || '';
    state.chain = h.get('chain') || ''; state.mintvl = Number(h.get('mintvl') || 0);
    state.sort = h.get('sort') || 'implied'; state.tab = h.get('tab') || 'pre';
    state.page = Math.max(1, Number(h.get('page') || 1)); state.slug = h.get('p');
  }
  function writeHash() {
    var h = new URLSearchParams();
    if (state.q) h.set('q', state.q);
    if (state.category) h.set('category', state.category);
    if (state.chain) h.set('chain', state.chain);
    if (state.mintvl) h.set('mintvl', String(state.mintvl));
    if (state.sort !== 'implied') h.set('sort', state.sort);
    if (state.tab !== 'pre') h.set('tab', state.tab);
    if (state.page > 1) h.set('page', String(state.page));
    if (state.slug) h.set('p', state.slug);
    history.replaceState(null, '', '#' + h.toString());
  }

  // -- filtering + sorting ---------------------------------------------------
  var PAGE = 20;
  function filtered() {
    var q = state.q.trim().toLowerCase();
    var list = rows.filter(function (r) {
      if (state.category && (r.category || 'Other') !== state.category) return false;
      if (state.chain && r.chains.indexOf(state.chain) < 0) return false;
      if (r.tvl_usd < state.mintvl) return false;
      if (q && (r.name + ' ' + r.slug + ' ' + (r.category || '')).toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
    var by = {
      implied: function (a, b) { return a.implied_value_usd - b.implied_value_usd; },
      tvl: function (a, b) { return a.tvl_usd - b.tvl_usd; },
      growth: function (a, b) { return (a.change_7d || 0) - (b.change_7d || 0); },
      age: function (a, b) { return (a.age_days || 0) - (b.age_days || 0); },
      name: function (a, b) { return a.name.localeCompare(b.name); },
      multiple: function (a, b) { return a.multiple - b.multiple; },
    }[state.sort] || function (a, b) { return a.implied_value_usd - b.implied_value_usd; };
    list.sort(function (a, b) { return by(b, a) || a.slug.localeCompare(b.slug); });
    return list;
  }

  function render() {
    $('q').value = state.q; $('category').value = state.category; $('chain').value = state.chain;
    $('mintvl').value = String(state.mintvl); $('sort').value = state.sort;
    $('tab-pre').classList.toggle('active', state.tab === 'pre');
    $('tab-live').classList.toggle('active', state.tab === 'live');
    $('board').style.display = state.tab === 'pre' ? '' : 'none';
    $('live-wrap').hidden = state.tab !== 'live';
    $('pager').style.display = state.tab === 'pre' ? '' : 'none';
    if (state.tab === 'live') { renderLive(); $('count').textContent = live.length + ' live-token comparables, by market cap.'; return; }
    var list = filtered();
    var pages = Math.max(1, Math.ceil(list.length / PAGE));
    state.page = Math.min(state.page, pages);
    var start = (state.page - 1) * PAGE;
    var page = list.slice(start, start + PAGE);
    var maxImp = rows[0].implied_value_usd;
    $('rows').innerHTML = page.map(function (r) {
      var w = Math.max(2, Math.round((r.implied_value_usd / maxImp) * 100));
      return '<tr data-slug="' + esc(r.slug) + '"><td class="num rank">' + r.rank + '</td>' +
        '<td><span class="name">' + esc(r.name) + '</span><span class="sub">' + esc(r.category || 'Other') + ' · ' + esc(r.chains.join(', ')) + '</span></td>' +
        '<td class="num">' + usd(r.tvl_usd) + '</td>' +
        '<td class="num ' + ((r.change_7d || 0) >= 0 ? 'pos' : 'neg') + '">' + pct(r.change_7d) + '</td>' +
        '<td class="num">' + age(r.age_days) + '</td>' +
        '<td class="num">×' + r.multiple.toFixed(3) + '</td>' +
        '<td><span class="val">' + usd(r.implied_value_usd) + '</span><span class="bar"><i style="width:' + w + '%"></i></span></td>' +
        '<td><span class="sig ' + esc(r.signal) + '">' + esc(r.signal) + '</span></td></tr>';
    }).join('') || '<tr><td colspan="8">No protocols match these filters.</td></tr>';
    $('count').textContent = list.length + ' of ' + rows.length + ' pre-token protocols' +
      (state.category ? ' · category ' + state.category : '') +
      (state.chain ? ' · chain ' + state.chain : '') +
      (state.mintvl ? ' · TVL ≥ ' + usd(state.mintvl) : '') + '.';
    var btns = [];
    btns.push('<button data-page="prev"' + (state.page <= 1 ? ' disabled' : '') + '>← Prev</button>');
    for (var p = 1; p <= pages; p++) {
      if (pages > 9 && Math.abs(p - state.page) > 2 && p !== 1 && p !== pages) { if (btns[btns.length - 1] !== '…') btns.push('…'); continue; }
      btns.push('<button data-page="' + p + '"' + (p === state.page ? ' class="active"' : '') + '>' + p + '</button>');
    }
    btns.push('<button data-page="next"' + (state.page >= pages ? ' disabled' : '') + '>Next →</button>');
    $('pager').innerHTML = btns.join('');
  }

  function renderLive() {
    $('live-rows').innerHTML = live.map(function (r) {
      return '<tr><td><span class="name">' + esc(r.name) + '</span><span class="sub">' + esc(r.category || 'Other') + ' · ' + esc(r.chains.join(', ')) + '</span></td>' +
        '<td class="num">' + usd(r.tvl_usd) + '</td>' +
        '<td class="num">' + usd(r.mcap_usd) + '</td>' +
        '<td class="num">×' + r.multiple.toFixed(3) + '</td>' +
        '<td class="num">' + age(r.age_days) + '</td></tr>';
    }).join('');
  }

  // -- farm plan: the same derivation as lib/model.ts, so the page and the
  // board print the same seven steps for the same protocol. --------------
  var GAS = { Ethereum: '$9', Solana: '$0.01', Base: '$0.60', Arbitrum: '$0.80', Optimism: '$0.60', Polygon: '$0.05', Avalanche: '$0.30', Binance: '$0.20', Bitcoin: '$2.50', Monad: '$0.02' };
  function capital(tvl) { return tvl >= 5e9 ? 250 : tvl >= 1e9 ? 150 : tvl >= 1e8 ? 100 : 50; }
  function holdDays(a) { var age = a == null ? 365 : a; return age < 180 ? 60 : age < 365 ? 45 : 30; }
  function gas(chain) { return GAS[chain] || '$1'; }
  function action(p, cap, chain) {
    switch (p.category) {
      case 'Lending': return 'Supply $' + cap + ' of USDC to the ' + p.name + ' lending market on ' + chain + '.';
      case 'Dexs': return 'Provide $' + cap + ' of liquidity to the main ' + p.name + ' pool on ' + chain + '.';
      case 'Yield': case 'Yield Aggregator': return 'Deposit $' + cap + ' into the top ' + p.name + ' vault on ' + chain + '.';
      case 'RWA': return 'Mint or buy $' + cap + ' of the ' + p.name + ' yield-bearing asset on ' + chain + '.';
      case 'Risk Curators': return 'Deposit $' + cap + ' into a curated ' + p.name + ' vault on ' + chain + '.';
      case 'Onchain Capital Allocator': return 'Deposit $' + cap + ' into a ' + p.name + ' allocation vault on ' + chain + '.';
      case 'CDP': return 'Mint the ' + p.name + ' stablecoin against $' + cap + ' of collateral on ' + chain + '.';
      case 'Derivatives': case 'Basis Trading': case 'Perpetual': return 'Deposit $' + cap + ' of margin to ' + p.name + ' on ' + chain + '.';
      case 'Bridge': case 'Canonical Bridge': case 'Cross Chain Bridge': return 'Bridge $' + cap + ' through ' + p.name + ' to ' + chain + '.';
      case 'Liquid Staking': case 'Staking Pool': case 'Restaking': case 'Restaked BTC': return 'Stake $' + cap + ' of the asset with ' + p.name + ' on ' + chain + '.';
      case 'Stablecoin Wrapper': case 'Stablecoins': return 'Mint or deposit $' + cap + ' of the ' + p.name + ' stable asset on ' + chain + '.';
      case 'Insurance': return 'Buy $' + cap + ' of cover from ' + p.name + ' on ' + chain + '.';
      case 'Payments': return 'Fund $' + cap + ' into your ' + p.name + ' account on ' + chain + '.';
      case 'Governance Incentives': return 'Deposit $' + cap + ' and stake it for voting in ' + p.name + ' on ' + chain + '.';
      case 'Chain': return 'Bridge $' + cap + ' to ' + p.name + ' and fund a wallet on the chain.';
      case 'Indexes': return 'Buy $' + cap + ' of the ' + p.name + ' index token on ' + chain + '.';
      case 'Privacy': return 'Deposit $' + cap + ' into the ' + p.name + ' privacy pool on ' + chain + '.';
      case 'Prediction Market': return 'Fund $' + cap + ' into your ' + p.name + ' account on ' + chain + '.';
      default: return 'Deposit $' + cap + ' of USDC into ' + p.name + ' on ' + chain + '.';
    }
  }
  function second(p) {
    switch (p.category) {
      case 'Lending': return 'Borrow a small amount against the deposit, then repay it in full.';
      case 'Dexs': return 'Make one swap through the pool you just joined, so the address is a user as well as a provider.';
      case 'Yield': case 'Yield Aggregator': return 'Harvest and compound the position once, so the vault records two distinct actions.';
      case 'RWA': return 'Check the redemption window and the underlying asset report, then hold the position.';
      case 'Risk Curators': return 'Read the vault allocation report and note which markets the curator is running.';
      case 'Onchain Capital Allocator': return 'Read the allocator monthly report and note the strategy mix it is running.';
      case 'CDP': return 'Check the collateral ratio stays above the minimum and top it up if it drifts.';
      case 'Derivatives': case 'Basis Trading': case 'Perpetual': return 'Open one small hedged position, then close it, to register as an active trader.';
      case 'Bridge': case 'Canonical Bridge': case 'Cross Chain Bridge': return 'Use the bridged funds in one app on the destination chain.';
      case 'Liquid Staking': case 'Staking Pool': case 'Restaking': case 'Restaked BTC': return 'Keep the receipt token in the wallet and check the staking rewards accrue.';
      case 'Stablecoin Wrapper': case 'Stablecoins': return 'Hold the stable asset through one full epoch or distribution cycle.';
      case 'Insurance': return 'Keep the policy active and note its expiry date in your log.';
      case 'Payments': return 'Make one real payment through the account, so it is used and not just funded.';
      case 'Governance Incentives': return 'Vote on one live proposal, so the staked position is counted as participating.';
      case 'Chain': return 'Use one native app on the chain, so the wallet is active beyond the bridge.';
      case 'Indexes': return 'Hold through one rebalance and note the new composition.';
      case 'Privacy': return 'Withdraw to a fresh address you control, and keep the record in your log.';
      case 'Prediction Market': return 'Place one market position, so the account is a trader and not just funded.';
      default: return 'Make one more qualifying action, such as a swap, a deposit or a vote.';
    }
  }
  function farmSteps(p) {
    var cap = capital(p.tvl_usd), chain = p.chains[0] || 'Ethereum', g = gas(chain);
    var hold = holdDays(p.age_days);
    return [
      'Set up a fresh wallet for ' + p.name + ' and write the seed phrase down offline; never share it and never paste it anywhere. Cost: nothing but the paper. Time: 5 minutes.',
      action(p, cap, chain) + ' Cost: $' + cap + ' of capital and about ' + g + ' of gas. Time: 15 minutes to set up.',
      second(p) + ' Cost: about ' + g + ' of gas. Time: 10 minutes.',
      'Repeat one qualifying action a week for the next month, on the same wallet, so the address shows a real usage pattern instead of a single visit. Cost: about ' + g + ' of gas a week. Time: 10 minutes a week.',
      'Leave the $' + cap + ' position in place for ' + hold + ' days; a position that survives a month is a user, a position that leaves in an hour is a tourist. Cost: the $' + cap + ' stays in the position. Time: ' + hold + ' days.',
      'Open the ' + p.name + ' points or rewards page and check that your activity is showing; if it is not, retrace the steps above before the snapshot window closes. Cost: no fee to check, and never pay to claim. Time: 10 minutes.',
      'Write the wallet address, the dates and the transaction hashes in your log, then plan the exit: unstake or withdraw in the same order you entered, and leave enough gas in the wallet to get out. Cost: nothing but the log. Time: 5 minutes.',
    ];
  }

  // -- detail dialog ---------------------------------------------------------
  var dlg = $('detail');
  function openDetail(slug) {
    var r = rows.find(function (x) { return x.slug === slug; });
    if (!r) return;
    var comps = live.filter(function (l) { return (l.category || 'Other') === (r.category || 'Other'); }).slice(0, 5);
    var compNote = '';
    if (comps.length === 0) {
      // No live-token protocol shares this category, so the board falls back
      // to the global median. Show the live protocols whose mcap / TVL sits
      // closest to that median — the ones that actually justify it — instead
      // of the largest tokens, whose multiples run to the hundreds.
      comps = live.slice().sort(function (a, b) {
        return Math.abs(a.multiple - r.multiple) - Math.abs(b.multiple - r.multiple);
      }).slice(0, 5);
      compNote = 'No live-token protocol shares this category, so the board falls back to the global median ×' + r.multiple.toFixed(3) + '. Showing the live protocols whose mcap / TVL sits closest to that median.';
    }
    var steps = farmSteps(r).map(function (s) {
      var parts = s.split(' Cost: ');
      var head = parts[0], tail = parts[1] || '';
      var t = tail.split(' Time: ');
      return '<li>' + esc(head) + '<br><span class="cost"><b>Cost:</b> ' + esc(t[0] || '') + (t[1] ? ' · <b>Time:</b> ' + esc(t[1]) : '') + '</span></li>';
    }).join('');
    dlg.innerHTML = '<div class="detail"><button class="close">Close ✕</button>' +
      '<h2>#' + r.rank + ' ' + esc(r.name) + '</h2>' +
      '<p class="meta">' + esc(r.category || 'Other') + ' · ' + esc(r.chains.join(', ')) + ' · <span class="sig ' + esc(r.signal) + '">' + esc(r.signal) + '</span></p>' +
      '<div class="kv">' +
      '<div><b>' + usd(r.tvl_usd) + '</b><span>Total value locked</span></div>' +
      '<div><b>' + pct(r.change_7d) + '</b><span>TVL change, 7d</span></div>' +
      '<div><b>' + age(r.age_days) + '</b><span>Age on the list</span></div>' +
      '<div><b>×' + r.multiple.toFixed(3) + '</b><span>Category multiple</span></div></div>' +
      '<h3>Why this value</h3><div class="eq">' +
      '<div><span>TVL × category multiple</span><span>' + usd(r.tvl_usd) + ' × ' + r.multiple.toFixed(3) + ' = ' + usd(r.base_value_usd) + '</span></div>' +
      '<div><span>× growth (' + pct(r.change_7d) + ' 7d)</span><span>× ' + r.growth_mult.toFixed(3) + '</span></div>' +
      '<div><span>× maturity (' + age(r.age_days) + ')</span><span>× ' + r.maturity_mult.toFixed(3) + '</span></div>' +
      '<div><span>× breadth (' + r.chains.length + ' chain' + (r.chains.length === 1 ? '' : 's') + ')</span><span>× ' + r.breadth_mult.toFixed(3) + '</span></div>' +
      '<div class="total"><span>Implied value</span><span>' + usd(r.implied_value_usd) + '</span></div></div>' +
      '<h3>Same-category comparables</h3>' +
      (compNote ? '<p class="note">' + esc(compNote) + '</p>' : '') +
      '<table><thead><tr><th>Protocol</th><th class="num">Market cap</th><th class="num">TVL</th><th class="num">mcap / TVL</th></tr></thead><tbody>' +
      comps.map(function (l) { return '<tr><td>' + esc(l.name) + '</td><td class="num">' + usd(l.mcap_usd) + '</td><td class="num">' + usd(l.tvl_usd) + '</td><td class="num">×' + l.multiple.toFixed(3) + '</td></tr>'; }).join('') +
      '</tbody></table>' +
      '<h3>Farm plan — 7 steps</h3><ol>' + steps + '</ol>' +
      '<p class="note">A farm plan earns a position; it does not promise a token. Never share a seed phrase, and never pay to claim.</p></div>';
    dlg.querySelector('.close').addEventListener('click', closeDetail);
    if (!dlg.open) dlg.showModal();
  }
  function closeDetail() {
    if (dlg.open) dlg.close();
    if (state.slug) { state.slug = null; writeHash(); }
  }
  dlg.addEventListener('click', function (e) { if (e.target === dlg) closeDetail(); });
  dlg.addEventListener('close', function () { if (state.slug) { state.slug = null; writeHash(); } });

  // -- events ---------------------------------------------------------------
  $('q').addEventListener('input', function () { state.q = $('q').value; state.page = 1; writeHash(); render(); });
  $('category').addEventListener('change', function () { state.category = $('category').value; state.page = 1; writeHash(); render(); });
  $('chain').addEventListener('change', function () { state.chain = $('chain').value; state.page = 1; writeHash(); render(); });
  $('mintvl').addEventListener('change', function () { state.mintvl = Number($('mintvl').value); state.page = 1; writeHash(); render(); });
  $('sort').addEventListener('change', function () { state.sort = $('sort').value; state.page = 1; writeHash(); render(); });
  $('tab-pre').addEventListener('click', function () { state.tab = 'pre'; writeHash(); render(); });
  $('tab-live').addEventListener('click', function () { state.tab = 'live'; writeHash(); render(); });
  $('pager').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-page]'); if (!b || b.disabled) return;
    var v = b.getAttribute('data-page');
    var pages = Math.max(1, Math.ceil(filtered().length / PAGE));
    if (v === 'prev') state.page = Math.max(1, state.page - 1);
    else if (v === 'next') state.page = Math.min(pages, state.page + 1);
    else state.page = Number(v);
    writeHash(); render();
  });
  $('rows').addEventListener('click', function (e) {
    var tr = e.target.closest('tr[data-slug]'); if (!tr) return;
    state.slug = tr.getAttribute('data-slug'); writeHash(); openDetail(state.slug);
  });
  window.addEventListener('hashchange', function () {
    readHash();
    render();
    if (state.slug) openDetail(state.slug);
    else if (dlg.open) dlg.close();
  });

  readHash();
  render();
  if (state.slug) openDetail(state.slug);
})();
