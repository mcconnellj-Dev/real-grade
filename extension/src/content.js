/* Real Grade: content script.
 * On search pages it remembers the result cards (rating, reviews, bedrooms, price).
 * On listing pages it grades the listing against its market, compares it with the
 * other places in your search, checks price, and scans loaded reviews for red flags. */
(function () {
  'use strict';
  const B = globalThis.REAL_GRADE_BENCHMARKS;
  const T = globalThis.REAL_GRADE_THEMES;
  const CAL = globalThis.REAL_GRADE_CALIBRATION;
  const RG = globalThis.RealGrade;
  const HOST_ID = 'real-grade-card-host';
  const POLL_MS = 1500;
  let collapsed = false;
  let listingState = null; // {id, listing, grade}
  let lastSignature = '';
  let searches = {};
  let scanState = null; // null | 'running' | 'done' | 'missing'
  let searchCtx = { key: null, center: null };
  let searchPillText = '';
  const initialHref = location.href;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const CSS = `
:host { all: initial;
  --bg:#ffffff; --fg:#1d1f24; --muted:#636a76; --line:#e3e6ec; --track:#eef0f4; --shadow:0 8px 28px rgba(18,24,38,.18);
  --a:#1c7c54; --b:#2a6fb0; --c:#b7791f; --d:#c2412d; --on:#ffffff; }
@media (prefers-color-scheme: dark) {
  :host { --bg:#1b1e24; --fg:#eef0f4; --muted:#a2a9b5; --line:#2f343d; --track:#2a2f38; --shadow:0 8px 28px rgba(0,0,0,.5);
    --a:#4cc38a; --b:#6aa8e8; --c:#e0a84a; --d:#f07a64; --on:#111418; }
}
.card { position:fixed; left:20px; bottom:20px; z-index:2147483646; width:330px; max-width:calc(100vw - 40px);
  max-height:calc(100vh - 40px); overflow-y:auto; overscroll-behavior:contain;
  font:13px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  color:var(--fg); background:var(--bg); border:1px solid var(--line); border-radius:14px; box-shadow:var(--shadow); }
.top { display:flex; align-items:center; justify-content:space-between; gap:8px; padding:10px 12px 0 14px; }
.brand { font-size:11px; font-weight:600; letter-spacing:.06em; text-transform:uppercase; color:var(--muted); }
.btn { all:unset; cursor:pointer; color:var(--muted); font-size:12px; padding:4px 6px; border-radius:6px; }
.btn:hover, .btn:focus-visible { background:var(--track); color:var(--fg); }
.pill:focus-visible { outline:2px solid var(--b); outline-offset:2px; }
.hero { display:flex; gap:14px; align-items:center; padding:8px 14px 12px; }
.letter { flex:none; min-width:64px; max-width:104px; min-height:64px; padding:6px 8px; box-sizing:border-box; border-radius:12px;
  display:grid; place-items:center; text-align:center; font-size:17px; line-height:1.15; font-weight:700; color:var(--on); letter-spacing:-.01em; }
.g-a { background:var(--a); } .g-b { background:var(--b); } .g-c { background:var(--c); } .g-d { background:var(--d); }
.headline { font-size:14px; font-weight:600; }
.sub { color:var(--muted); font-size:12px; }
.chips { display:flex; flex-wrap:wrap; gap:6px; padding:0 14px 10px; }
.chip { font-size:11px; padding:2px 8px; border-radius:999px; background:var(--track); color:var(--muted); }
.chip.warn { color:var(--d); }
.callout { margin:0 14px 10px; padding:8px 10px; border-radius:8px; background:var(--track); font-size:12px; }
.callout b { color:var(--d); font-weight:600; }
.callout.good b { color:var(--a); }
.sec { padding:8px 14px 10px; border-top:1px solid var(--line); display:flex; flex-direction:column; gap:4px; }
.sec h3 { all:unset; display:block; font-size:11px; font-weight:600; letter-spacing:.06em; text-transform:uppercase; color:var(--muted); }
.sec p { margin:0; font-size:12px; }
.sec .bad { color:var(--d); } .sec .good { color:var(--a); }
.flag { display:flex; justify-content:space-between; gap:8px; font-size:12px; }
.flag b { color:var(--d); font-weight:600; }
.rows { padding:2px 14px 10px; display:flex; flex-direction:column; gap:6px; }
.row { display:grid; grid-template-columns:96px 34px 1fr 40px; align-items:center; gap:8px; font-variant-numeric:tabular-nums; }
.row .name { color:var(--fg); }
.row .val { color:var(--muted); text-align:right; }
.row .pct { color:var(--muted); text-align:right; font-size:12px; }
.bar { position:relative; height:6px; border-radius:3px; background:var(--track); }
.bar i { position:absolute; left:0; top:0; bottom:0; border-radius:3px; }
.row.weak .name, .row.weak .pct { color:var(--d); font-weight:600; }
.stars { padding:0 14px 10px; color:var(--muted); font-size:12px; font-variant-numeric:tabular-nums; }
.foot { border-top:1px solid var(--line); padding:8px 14px 10px; color:var(--muted); font-size:11px; }
.foot a { color:inherit; }
.pill { all:unset; position:fixed; left:20px; bottom:20px; z-index:2147483646; cursor:pointer; display:flex; align-items:center; gap:8px;
  padding:6px 12px 6px 6px; border-radius:999px; background:var(--bg); color:var(--fg); box-shadow:var(--shadow);
  font:600 13px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; }
.pill .letter { min-width:0; max-width:none; min-height:0; padding:5px 10px; font-size:12px; border-radius:999px; }
.msg { padding:4px 14px 14px; color:var(--muted); }
.pill.note { cursor:default; padding:8px 12px; gap:10px; font-weight:400; font-size:12px; max-width:min(420px, calc(100vw - 40px)); }
.pill.note .brand { flex:none; }
.scan { all:unset; cursor:pointer; align-self:flex-start; font-size:12px; font-weight:600; color:var(--b); padding:2px 0; }
.scan:hover, .scan:focus-visible { text-decoration:underline; }
`;

  // ---------- small helpers ----------
  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }
  function ordinal(n) {
    const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }
  function link(text, href) {
    const a = el('a', '', text);
    a.href = href;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    return a;
  }
  function gradeClass(g) { return 'g-' + g.tier; }
  function pct(p) { return Math.max(0, Math.min(99, Math.round(p * 100))); }
  function money(v) { return '$' + Math.round(v).toLocaleString(); }
  function storageGet(keys) {
    return new Promise((resolve) => {
      try { chrome.storage.local.get(keys, (v) => resolve(v || {})); } catch (e) { resolve({}); }
    });
  }
  function storageSet(obj) { try { chrome.storage.local.set(obj); } catch (e) { /* storage unavailable */ } }

  // ---------- search pages ----------
  const BADGE_CSS = `
:host { all: initial; display: inline-flex; vertical-align: middle; margin-left: 6px; }
span { display: inline-grid; place-items: center; min-width: 22px; height: 18px; padding: 0 5px; border-radius: 5px;
  font: 700 11px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #fff; letter-spacing: -.01em; }
span { white-space: nowrap; }
.a { background: #1c7c54; } .b { background: #2a6fb0; } .c { background: #b7791f; } .d { background: #c2412d; }
`;

  function readSearchCards() {
    const cards = [];
    for (const c of document.querySelectorAll('[data-testid="card-container"]')) {
      const a = c.querySelector('a[href*="/rooms/"]');
      const id = a && (/\/rooms\/(?:plus\/)?(\d+)/.exec(a.getAttribute('href')) || [])[1];
      if (!id) continue;
      const data = RG.parseCard(c.innerText || '');
      if (data.rating || data.price) cards.push({ id, data, el: c });
    }
    return cards;
  }

  // Where this search is: the map bounds, else the result coordinates in the page
  // data (fetched fresh when the user moved to a new search inside the app).
  async function ensureSearchCenter(meta) {
    const u = new URL(location.href);
    const key = meta.key + '|' + ['ne_lat', 'ne_lng', 'sw_lat', 'sw_lng'].map((k) => u.searchParams.get(k)).join(',');
    if (searchCtx.key === key) return;
    searchCtx = { key, center: RG.searchCenter(location.href, null) };
    if (searchCtx.center) return;
    let text = null;
    if (location.href === initialHref) {
      const st = document.getElementById('data-deferred-state-0');
      text = st && st.textContent;
    } else {
      try { text = await (await fetch(location.href, { credentials: 'include' })).text(); } catch (e) { /* offline */ }
    }
    if (searchCtx.key === key) searchCtx.center = RG.searchCenter(location.href, text);
  }

  function cardGrade(id, data, inSearch) {
    const c = searchCtx.center;
    if (!c || !data.rating || !data.count) return null;
    let g = RG.gradeListing({ overall: data.rating, count: data.count, lat: c.lat, lng: c.lng }, B);
    if (g.ok && g.benchmark !== 'market' && inSearch.pct[id] !== undefined) {
      g = RG.withSearch(g, inSearch.pct[id], inSearch.n - 1, CAL);
    }
    return g.ok ? g : null;
  }

  function paintBadge(cardEl, g, data) {
    const ratingEl = [...cardEl.querySelectorAll('span[aria-hidden="true"]')]
      .find((e) => e.children.length === 0 && /^\d\.\d{1,2}\s*\(\d[\d,]*\)$/.test(e.textContent.trim()));
    if (!ratingEl) return;
    let host = ratingEl.parentElement.querySelector(':scope > .rg-badge');
    if (!host) {
      host = document.createElement('span');
      host.className = 'rg-badge';
      host.attachShadow({ mode: 'open' });
      ratingEl.after(host);
    }
    const est = g.benchmark !== 'market';
    const who = g.benchmark === 'market' ? 'listings in ' + g.marketName
      : g.benchmark === 'search' ? 'this area (estimated from your search)'
        : g.benchmark === 'nearby' ? g.marketName + ' listings (estimate)' : 'US listings (estimate)';
    const title = 'Real Grade ' + g.label + ': better than about ' + pct(g.percentile) + '% of ' + who +
      ', adjusted for ' + data.count.toLocaleString() + ' reviews' + (g.confidence === 'low' ? '. Few reviews, provisional.' : '.');
    if (host.title === title) return;
    host.title = title;
    const style = document.createElement('style');
    style.textContent = BADGE_CSS;
    host.shadowRoot.replaceChildren(style, el('span', g.tier + (est ? ' est' : ''), g.label));
  }

  function renderSearchPill(text) {
    if (text === searchPillText) return;
    searchPillText = text;
    const root = mount();
    const pill = el('div', 'pill note');
    pill.appendChild(el('span', 'brand', 'Real Grade'));
    pill.appendChild(el('span', '', text));
    root.appendChild(pill);
  }

  async function onSearchPage() {
    const cards = readSearchCards();
    if (!cards.length) return;
    const meta = RG.searchKey(location.href);
    const sig = 'search:' + location.href + ':' + cards.map((c) => c.id).join(',');
    if (sig !== lastSignature) {
      lastSignature = sig;
      const stored = (await storageGet('searches')).searches || {};
      searches = RG.addResults(stored, meta, cards.map((c) => ({ id: c.id, data: c.data })), Date.now());
      storageSet({ searches });
    }
    await ensureSearchCenter(meta);
    if (!searchCtx.center) return;
    const search = searches[meta.key];
    const inSearch = search ? RG.percentilesInSearch(search, RG.shrink, B.fit.overall.k) : { n: 0, pct: {} };
    let sample = null;
    for (const c of cards) {
      const g = cardGrade(c.id, c.data, inSearch);
      if (!g) continue;
      sample = sample || g;
      paintBadge(c.el, g, c.data);
    }
    if (!sample) return;
    let text;
    if (sample.benchmark === 'market') text = 'Ranks compare each place with listings in ' + sample.marketName + '.';
    else if (sample.benchmark === 'search') text = 'Ranges are estimates from the ' + inSearch.n + ' places in this search' +
      (sample.baseBenchmark === 'nearby' ? ' and ' + sample.marketName + ' data.' : '.');
    else text = 'Ranges are rough estimates vs ' + (sample.benchmark === 'nearby' ? sample.marketName : 'all US markets') +
      '. Page through about ' + Math.max(1, CAL.minRated + 1 - inSearch.n) + ' more places to sharpen them.';
    renderSearchPill(text);
  }

  // ---------- listing pages ----------
  function roomId() {
    const m = /\/rooms\/(?:plus\/)?(\d+)/.exec(location.pathname);
    return m ? m[1] : null;
  }

  async function loadListing(id) {
    const script = document.getElementById('data-deferred-state-0');
    if (script) {
      try {
        const parsed = RG.parseListing(JSON.parse(script.textContent));
        if (parsed.listingId === id && parsed.overall !== undefined) return parsed;
      } catch (e) { /* fall through to a fresh copy */ }
    }
    // After in-app navigation the embedded data is stale: read this listing's page.
    const res = await fetch('/rooms/' + id, { credentials: 'include' });
    if (!res.ok) return null;
    const data = RG.extractStateJson(await res.text());
    return data ? RG.parseListing(data) : null;
  }

  function readPagePrice() {
    for (const id of ['BOOK_IT_SIDEBAR', 'BOOK_IT_NAV', 'BOOK_IT_FLOATING_FOOTER']) {
      const s = document.querySelector('[data-section-id="' + id + '"]');
      const p = s && RG.parsePrice(s.innerText || '');
      if (p) return p;
    }
    return null;
  }

  function readPageReviews() {
    const seen = new Set();
    const out = [];
    // Reviews section items are role=listitem; the Show-all dialog marks each with data-review-id.
    for (const item of document.querySelectorAll('[role="listitem"], [data-review-id]')) {
      const text = item.innerText || '';
      if (!/Rating,\s*\d\s*stars?/i.test(text)) continue;
      const r = RG.parseReviewText(text);
      if (!r || !r.text) continue;
      const key = r.text.slice(0, 120);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(r);
    }
    return out;
  }

  async function onListingPage(id) {
    if (!listingState || listingState.id !== id) {
      searchPillText = '';
      scanState = null;
      listingState = { id, loading: true };
      lastSignature = '';
      try {
        const listing = await loadListing(id);
        if (roomId() !== id) return;
        listingState = { id, listing, grade: listing ? RG.gradeListing(listing, B) : { ok: false } };
      } catch (e) {
        listingState = { id, listing: null, grade: { ok: false } };
      }
      searches = (await storageGet('searches')).searches || {};
    }
    if (listingState.loading) return;
    const price = readPagePrice();
    const reviews = readPageReviews();
    const sig = ['listing', id, collapsed, price && price.total, price && price.nights, reviews.length].join(':');
    if (sig === lastSignature) return;
    lastSignature = sig;
    render(listingState.listing, listingState.grade, price, reviews);
  }

  // ---------- rendering ----------
  function mount() {
    let host = document.getElementById(HOST_ID);
    if (!host) {
      host = document.createElement('div');
      host.id = HOST_ID;
      host.attachShadow({ mode: 'open' });
      document.documentElement.appendChild(host);
    }
    const root = host.shadowRoot;
    root.replaceChildren();
    const style = document.createElement('style');
    style.textContent = CSS;
    root.appendChild(style);
    return root;
  }
  function unmount() {
    const host = document.getElementById(HOST_ID);
    if (host) host.remove();
  }
  function setCollapsed(v) {
    collapsed = v;
    storageSet({ collapsed });
    lastSignature = '';
  }
  function frame(root) {
    const card = el('section', 'card');
    card.setAttribute('aria-label', 'Real Grade');
    const top = el('div', 'top');
    top.appendChild(el('span', 'brand', 'Real Grade'));
    const btn = el('button', 'btn', 'Minimize');
    btn.addEventListener('click', () => setCollapsed(true));
    top.appendChild(btn);
    card.appendChild(top);
    root.appendChild(card);
    return card;
  }

  // Who the headline grade compares against.
  function benchmarkPhrase(g, listing) {
    if (g.benchmark === 'market') return 'listings in ' + g.marketName;
    if (g.benchmark === 'search') return (listing.place || 'nearby') + ' listings (estimated)';
    if (g.benchmark === 'nearby') return g.marketName + ' listings';
    return 'US listings';
  }
  // Who the sub-scores compare against (always the market data, never the search).
  function marketPhrase(g) {
    const kind = g.benchmark === 'search' ? g.baseBenchmark : g.benchmark;
    if (kind === 'market') return 'listings in ' + g.marketName;
    if (kind === 'nearby') return g.marketName + ' listings';
    return 'US listings';
  }

  function searchInfo(listing, price) {
    const p = new URLSearchParams(location.search);
    const search = RG.findSearch(searches, listingState.id, p.get('check_in'), p.get('check_out'));
    if (!search) return { search: null, cmp: null };
    const cmp = RG.compareInSearch(search, {
      id: listingState.id, overall: listing.overall, count: listing.count, bedrooms: listing.bedrooms, price
    }, RG.shrink, B.fit.overall.k);
    return { search, cmp };
  }

  function render(listing, g, price, reviews) {
    if (!g || !g.ok) {
      const root = mount();
      frame(root).appendChild(el('div', 'msg', g && g.reason === 'no-ratings'
        ? 'No ratings yet, so there is nothing to grade.'
        : 'Couldn’t read this listing’s ratings.'));
      return;
    }
    const root = mount();
    const S = searchInfo(listing, price);
    if (S.cmp && S.cmp.rating) g = RG.withSearch(g, S.cmp.rating.percentile, S.cmp.rating.n, CAL);
    const place = benchmarkPhrase(g, listing);
    const subPlace = marketPhrase(g);

    if (collapsed) {
      const pill = el('button', 'pill');
      pill.setAttribute('aria-label', 'Show Real Grade: ' + g.label);
      pill.appendChild(el('span', 'letter ' + gradeClass(g), g.label));
      pill.appendChild(el('span', '', 'Real Grade'));
      pill.addEventListener('click', () => setCollapsed(false));
      root.appendChild(pill);
      return;
    }

    const card = frame(root);
    const hero = el('div', 'hero');
    hero.appendChild(el('div', 'letter ' + gradeClass(g), g.label));
    const words = el('div');
    words.appendChild(el('div', 'headline', 'Better than ' + pct(g.percentile) + '% of ' + place));
    words.appendChild(el('div', 'sub',
      'Airbnb shows ★' + g.raw.toFixed(2) + ' from ' + g.count.toLocaleString() + ' review' + (g.count === 1 ? '' : 's') +
      '. Adjusted for review count: ' + g.adjusted.toFixed(2) + '.'));
    hero.appendChild(words);
    card.appendChild(hero);

    const chips = el('div', 'chips');
    const conf = { high: 'Plenty of reviews', medium: 'Moderate review count', low: 'Few reviews, grade is provisional' }[g.confidence];
    chips.appendChild(el('span', 'chip' + (g.confidence === 'low' ? ' warn' : ''), conf));
    if (listing.guestFavorite) chips.appendChild(el('span', 'chip', 'Airbnb Guest favorite'));
    if (g.benchmark === 'search') {
      chips.appendChild(el('span', 'chip warn',
        'Estimated from ' + g.searchN + ' places in your ' + S.search.place + ' search' +
        (g.baseBenchmark === 'nearby' ? ' and ' + g.marketName + ' data (' + Math.round(g.fallbackMiles) + ' mi)' : '')));
    } else if (g.benchmark === 'nearby') {
      chips.appendChild(el('span', 'chip warn',
        'Estimate: ' + (listing.place || 'this area') + ' isn’t in our data; nearest is ' + g.marketName + ' (' + Math.round(g.fallbackMiles) + ' mi)'));
    } else if (g.benchmark === 'national') {
      chips.appendChild(el('span', 'chip warn', 'Area not covered, using all US markets'));
    }
    card.appendChild(chips);

    if (g.weakSpot) {
      const s = g.scores[g.weakSpot];
      const c = el('div', 'callout');
      c.appendChild(el('b', '', 'Weak spot: ' + s.label + '. '));
      c.appendChild(document.createTextNode('Lower than ' + (100 - pct(s.percentile)) + '% of ' + subPlace + '.'));
      card.appendChild(c);
    } else if (g.strength) {
      const s = g.scores[g.strength];
      const c = el('div', 'callout good');
      c.appendChild(el('b', '', 'Standout: ' + s.label + '. '));
      c.appendChild(document.createTextNode('Better than ' + pct(s.percentile) + '% of ' + subPlace + '.'));
      card.appendChild(c);
    }

    renderSearch(card, g, price, S);
    renderFlags(card, reviews);

    const rows = el('div', 'rows');
    for (const key of RG.SCORES.slice(1)) {
      const s = g.scores[key];
      if (!s) continue;
      const row = el('div', 'row' + (key === g.weakSpot ? ' weak' : ''));
      row.appendChild(el('span', 'name', s.label));
      row.appendChild(el('span', 'val', s.raw.toFixed(2)));
      const bar = el('span', 'bar');
      const fill = el('i');
      const p = pct(s.percentile);
      fill.style.width = Math.max(3, p) + '%';
      fill.style.background = p < 25 ? 'var(--d)' : p < 50 ? 'var(--c)' : p < 75 ? 'var(--b)' : 'var(--a)';
      bar.appendChild(fill);
      row.appendChild(bar);
      row.appendChild(el('span', 'pct', ordinal(p)));
      row.title = s.label + ': ' + s.raw.toFixed(2) + ', ' + ordinal(p) + ' percentile among ' + subPlace;
      rows.appendChild(row);
    }
    const subHead = el('div', 'sec');
    subHead.appendChild(el('h3', '', 'Sub-scores vs ' + subPlace));
    card.appendChild(subHead);
    card.appendChild(rows);

    if (listing.stars) {
      const st = listing.stars;
      const f = (v) => (v * 100 < 1 && v > 0 ? '<1' : Math.round(v * 100)) + '%';
      card.appendChild(el('div', 'stars',
        'Star breakdown: 5★ ' + f(st[5]) + ' · 4★ ' + f(st[4]) + ' · 3★ or lower ' + f(st[1] + st[2] + st[3])));
    }
    if (listing.host && listing.host.rating && listing.host.count) {
      card.appendChild(el('div', 'stars',
        'Host rating across all their listings: ★' + listing.host.rating.toFixed(2) + ' (' + listing.host.count.toLocaleString() + ' reviews)'));
    }
    const foot = el('div', 'foot');
    foot.appendChild(document.createTextNode(g.benchmark === 'search'
      ? 'This area isn\u2019t in our data, so the rank blends your search (corrected for top-rated places being listed first) with the nearest market. '
      : 'Ranks compare this listing with ' + place + ' after adjusting for review count. '));
    foot.appendChild(document.createTextNode('Benchmarks derived from '));
    foot.appendChild(link('Inside Airbnb', 'https://insideairbnb.com'));
    foot.appendChild(document.createTextNode(' data (' + B.version + ', '));
    foot.appendChild(link('CC BY 4.0', 'https://creativecommons.org/licenses/by/4.0/'));
    foot.appendChild(document.createTextNode('), aggregated into market percentiles. Not affiliated with or endorsed by Airbnb.'));
    card.appendChild(foot);
  }

  function renderSearch(card, g, price, S) {
    const sec = el('div', 'sec');
    sec.appendChild(el('h3', '', S.search ? 'In your ' + S.search.place + ' search' : 'Your search'));
    if (!S.search) {
      sec.appendChild(el('p', 'sub', 'Search on Airbnb first, with dates, to compare rating and price with the other places you saw.'));
      card.appendChild(sec);
      return;
    }
    const cmp = S.cmp;
    if (cmp.rating) {
      sec.appendChild(el('p', '', 'Ranks #' + cmp.rating.rank + ' of the ' + (cmp.rating.n + 1) + ' rated places you\u2019ve seen, by review-adjusted rating.'));
    } else {
      sec.appendChild(el('p', 'sub', 'Page through more results to rank it (needs ' + RG.MIN_RATED + '+ rated places; you\u2019ve seen ' + (cmp.seen - 1) + ').'));
    }
    if (cmp.price) {
      const what = cmp.price.sameBedrooms
        ? (cmp.price.bedrooms === 0 ? 'studios' : cmp.price.bedrooms + '-bedroom places')
        : 'places';
      sec.appendChild(el('p', '',
        money(cmp.price.perNight) + '/night vs ' + money(cmp.price.median) + ' median for ' + what + ' in your search (' +
        ordinal(pct(cmp.price.percentile)) + ' percentile of ' + cmp.price.n + ').'));
      const value = g.scores.value && g.scores.value.percentile;
      const verdict = RG.priceVerdict(cmp.price, value, g.percentile);
      if (verdict) sec.appendChild(el('p', verdict.tone === 'bad' ? 'bad' : verdict.tone === 'good' ? 'good' : '', verdict.text));
    } else if (!price) {
      sec.appendChild(el('p', 'sub', 'Pick dates to compare price.'));
    }
    card.appendChild(sec);
  }

  // Opens Airbnb's own "Show all reviews" dialog and scrolls it so more reviews load.
  async function scanAllReviews() {
    if (scanState === 'running') return;
    scanState = 'running';
    lastSignature = '';
    try {
      let dlg = document.querySelector('[role="dialog"]');
      if (!dlg || !dlg.querySelector('[data-review-id]')) {
        const open = [...document.querySelectorAll('button, a')].find((b) => /^Show all [\d,]+ reviews$/i.test((b.innerText || '').trim()));
        if (!open) { scanState = 'missing'; return; }
        open.click();
        for (let i = 0; i < 30 && !(dlg = document.querySelector('[role="dialog"]')); i++) await sleep(200);
      }
      let last = -1, still = 0;
      for (let i = 0; dlg && i < 40 && still < 3; i++) {
        const box = [...dlg.querySelectorAll('*')].find((e) => e.scrollHeight > e.clientHeight + 50 && /(auto|scroll)/.test(getComputedStyle(e).overflowY));
        if (!box) break;
        box.scrollTop = box.scrollHeight;
        await sleep(900);
        const n = dlg.querySelectorAll('[data-review-id]').length;
        still = n === last ? still + 1 : 0;
        last = n;
      }
    } finally {
      if (scanState === 'running') scanState = 'done';
      lastSignature = '';
    }
  }

  function scanButton(sec, loaded) {
    const total = listingState.listing && listingState.listing.count;
    if (scanState === 'running') {
      sec.appendChild(el('p', 'sub', 'Scanning reviews… ' + loaded + ' so far.'));
    } else if (scanState === 'missing') {
      sec.appendChild(el('p', 'sub', 'This listing has no “Show all reviews” list to scan.'));
    } else if (loaded < 20 && total > loaded) {
      const btn = el('button', 'scan', 'Scan all ' + total.toLocaleString() + ' reviews');
      btn.addEventListener('click', scanAllReviews);
      sec.appendChild(btn);
    }
  }

  function renderFlags(card, reviews) {
    const sec = el('div', 'sec');
    sec.appendChild(el('h3', '', 'Review red flags'));
    if (!reviews.length) {
      sec.appendChild(el('p', 'sub', 'No reviews loaded yet.'));
      scanButton(sec, 0);
      card.appendChild(sec);
      return;
    }
    const a = RG.analyzeReviews(reviews, T);
    if (!a.flags.length) {
      sec.appendChild(el('p', '', 'None in the ' + a.n + ' reviews loaded.'));
    }
    for (const f of a.flags) {
      const row = el('div', 'flag');
      row.appendChild(el('b', '', f.label));
      const share = (x) => (x < 0.01 ? (x * 100).toFixed(1) : Math.round(x * 100)) + '%';
      row.appendChild(el('span', 'sub', f.count + ' of ' + a.n + ' reviews (' + share(f.rate) + ' vs ' + share(T.themes[f.key].baseline) + ' usually)'));
      sec.appendChild(row);
    }
    if (a.low) {
      sec.appendChild(el('p', a.low / a.n >= 0.2 ? 'bad' : 'sub',
        a.low + ' of the ' + a.n + ' reviews loaded gave 3 stars or fewer.'));
    }
    scanButton(sec, a.n);
    card.appendChild(sec);
  }

  // ---------- main loop ----------
  async function tick() {
    const path = location.pathname;
    if (/^\/rooms\//.test(path)) {
      const id = roomId();
      if (id) return onListingPage(id);
    }
    listingState = null;
    if (/^\/s\//.test(path)) return onSearchPage();
    searchPillText = '';
    unmount();
  }

  let busy = false;
  async function loop() {
    if (busy) return;
    busy = true;
    try { await tick(); } catch (e) { /* keep polling */ } finally { busy = false; }
  }

  storageGet(['collapsed', 'searches']).then((v) => {
    collapsed = !!v.collapsed;
    searches = v.searches || {};
    loop();
    setInterval(loop, POLL_MS);
  });
})();
