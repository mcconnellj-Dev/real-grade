/* Real Grade: your-search comparison. Reads Airbnb search result cards, keeps
 * recent searches, and ranks a listing against the other places in the same
 * search (same dates, same price display). Pure functions; tested in Node. */
(function (root) {
  'use strict';

  const MAX_SEARCHES = 20;
  const MAX_AGE_MS = 30 * 24 * 3600 * 1000;
  const MIN_RATED = 20;
  const MIN_PRICED = 8;

  function toNum(s) {
    return parseFloat(String(s).replace(/,/g, ''));
  }

  // "$1,085 for 3 nights, originally $1,285" -> {total: 1085, nights: 3, perNight: 361.67}
  // "$250 night" / "$250 per night" -> {total: 250, nights: 1, perNight: 250}
  function parsePrice(text) {
    if (!text) return null;
    let m = /\$\s?([\d,]+(?:\.\d+)?)\s*(?:USD\s*)?(?:total\s*)?for\s+(\d+)\s+nights?/i.exec(text);
    if (m) {
      const total = toNum(m[1]), nights = parseInt(m[2], 10);
      return nights > 0 ? { total, nights, perNight: total / nights } : null;
    }
    m = /\$\s?([\d,]+(?:\.\d+)?)\s*(?:USD\s*)?(?:per\s+|\/\s*)?night\b/i.exec(text);
    if (m) {
      const total = toNum(m[1]);
      return { total, nights: 1, perNight: total };
    }
    return null;
  }

  // "1 bedroom · 2 beds · 1 bath", "Studio", "3 bedrooms" -> number of bedrooms (studio = 0)
  function parseBedrooms(text) {
    if (!text) return undefined;
    if (/\bstudio\b/i.test(text)) return 0;
    const m = /(\d+)\s+bedrooms?\b/i.exec(text);
    return m ? parseInt(m[1], 10) : undefined;
  }

  // One search card's visible text -> {rating, count, bedrooms, price}
  function parseCard(text) {
    const out = {};
    let m = /(\d\.\d{1,2}) out of 5 average rating,\s*([\d,]+) reviews?/i.exec(text) ||
      /(\d\.\d{1,2})\s*\(([\d,]+)\)/.exec(text);
    if (m) { out.rating = parseFloat(m[1]); out.count = toNum(m[2]); }
    out.isNew = !m && /\bNew\b/.test(text);
    out.bedrooms = parseBedrooms(text);
    out.price = parsePrice(text);
    return out;
  }

  // Key that groups result pages of one search: place + dates + guests.
  function searchKey(url) {
    const u = new URL(url);
    const place = decodeURIComponent((/\/s\/([^/]+)/.exec(u.pathname) || [])[1] || 'map').replace(/--/g, ', ').replace(/-/g, ' ');
    const p = u.searchParams;
    const dates = (p.get('checkin') || p.get('check_in') || '') + '_' + (p.get('checkout') || p.get('check_out') || '');
    const guests = p.get('adults') || '';
    return { key: place + '|' + dates + '|' + guests, place: place.split(',')[0].trim(), checkin: p.get('checkin') || p.get('check_in') || null, checkout: p.get('checkout') || p.get('check_out') || null };
  }

  // Merge result cards into the store; drop old and excess searches.
  function addResults(store, meta, cards, now) {
    store = store || {};
    const s = store[meta.key] || { place: meta.place, checkin: meta.checkin, checkout: meta.checkout, listings: {} };
    s.updated = now;
    for (const c of cards) if (c.id) s.listings[c.id] = Object.assign(s.listings[c.id] || {}, c.data);
    store[meta.key] = s;
    const keys = Object.keys(store)
      .filter((k) => now - store[k].updated <= MAX_AGE_MS)
      .sort((a, b) => store[b].updated - store[a].updated)
      .slice(0, MAX_SEARCHES);
    const kept = {};
    for (const k of keys) kept[k] = store[k];
    return kept;
  }

  // Most recent search containing this listing (dates must match when both known).
  function findSearch(store, listingId, checkin, checkout) {
    let best = null;
    for (const k of Object.keys(store || {})) {
      const s = store[k];
      if (!s.listings[listingId]) continue;
      if (checkin && s.checkin && (s.checkin !== checkin || s.checkout !== checkout)) continue;
      if (!best || s.updated > best.updated) best = s;
    }
    return best;
  }

  function rankOf(value, values) {
    const below = values.filter((v) => v < value).length;
    const equal = values.filter((v) => v === value).length;
    return (below + equal / 2) / values.length;
  }

  function median(values) {
    const v = values.slice().sort((a, b) => a - b);
    const n = v.length;
    return n % 2 ? v[(n - 1) / 2] : (v[n / 2 - 1] + v[n / 2]) / 2;
  }

  // Compare one listing with the others in its search.
  // listing: {id, overall, count, bedrooms, price: {perNight}}
  function compareInSearch(search, listing, shrink, k) {
    const others = Object.keys(search.listings).filter((id) => id !== listing.id).map((id) => search.listings[id]);
    const out = { place: search.place, seen: others.length + 1 };

    const rated = others.filter((o) => o.rating && o.count);
    if (rated.length >= MIN_RATED && listing.overall && listing.count) {
      const mu = rated.reduce((a, o) => a + o.rating, 0) / rated.length;
      const adj = rated.map((o) => shrink(o.rating, o.count, mu, k));
      const mine = shrink(listing.overall, listing.count, mu, k);
      out.rating = {
        n: rated.length,
        percentile: rankOf(mine, adj),
        rank: adj.filter((a) => a > mine).length + 1 // 1 = best adjusted rating among the places seen
      };
    }

    const per = listing.price && listing.price.perNight;
    if (per) {
      const priced = others.filter((o) => o.price && o.price.perNight);
      const same = priced.filter((o) => o.bedrooms !== undefined && o.bedrooms === listing.bedrooms);
      const pool = same.length >= MIN_PRICED ? same : priced;
      if (pool.length >= MIN_PRICED) {
        const values = pool.map((o) => o.price.perNight);
        out.price = {
          n: pool.length,
          sameBedrooms: pool === same,
          bedrooms: listing.bedrooms,
          perNight: per,
          median: median(values),
          percentile: rankOf(per, values)
        };
      }
    }
    return out;
  }

  // Each rated listing's rank percentile within the search, on review-adjusted
  // rating: (places below + half of ties incl. itself) / n, as in the calibration.
  function percentilesInSearch(search, shrink, k) {
    const ids = Object.keys(search.listings).filter((id) => search.listings[id].rating && search.listings[id].count);
    const n = ids.length;
    const out = { n, pct: {} };
    if (!n) return out;
    const mu = ids.reduce((a, id) => a + search.listings[id].rating, 0) / n;
    const adj = {};
    for (const id of ids) adj[id] = shrink(search.listings[id].rating, search.listings[id].count, mu, k);
    const values = ids.map((id) => adj[id]);
    for (const id of ids) {
      const below = values.filter((v) => v < adj[id]).length;
      const equal = values.filter((v) => v === adj[id]).length;
      out.pct[id] = (below + equal / 2) / n;
    }
    return out;
  }

  // One sentence on price, read together with how good the place is.
  // ratingPercentile: the listing's grade percentile; valuePercentile: its value sub-score.
  function priceVerdict(price, valuePercentile, ratingPercentile) {
    if (!price) return null;
    const p = price.percentile;
    const v = typeof valuePercentile === 'number' ? valuePercentile : null;
    const r = typeof ratingPercentile === 'number' ? ratingPercentile : null;
    if (p <= 0.35 && r !== null && r >= 0.7) return { tone: 'good', text: 'Top-rated and cheaper than most similar places: a strong pick.' };
    if (p >= 0.75 && v !== null && v < 0.4) return { tone: 'bad', text: 'Priced above most similar places, and guests rate its value low.' };
    if (p >= 0.75 && v !== null && v >= 0.6) return { tone: 'neutral', text: 'Premium price, but guests rate its value well.' };
    if (p >= 0.75) return { tone: 'neutral', text: 'Priced above most similar places in your search.' };
    if (p <= 0.25) return { tone: 'good', text: 'Cheaper than most similar places in your search.' };
    return { tone: 'neutral', text: 'Priced in the normal range for your search.' };
  }

  function median1(v) {
    const a = v.slice().sort((x, y) => x - y);
    const n = a.length;
    return n % 2 ? a[(n - 1) / 2] : (a[n / 2 - 1] + a[n / 2]) / 2;
  }

  // Center of the area a search covers: the map bounds in the URL when present
  // (after the user moves the map), else the middle of the result coordinates
  // in the page data.
  function searchCenter(url, stateText) {
    const p = new URL(url).searchParams;
    const ne = [p.get('ne_lat'), p.get('ne_lng')].map(parseFloat);
    const sw = [p.get('sw_lat'), p.get('sw_lng')].map(parseFloat);
    if (ne.concat(sw).every(isFinite)) return { lat: (ne[0] + sw[0]) / 2, lng: (ne[1] + sw[1]) / 2, from: 'map' };
    if (!stateText) return null;
    const lat = [], lng = [];
    const re = /"latitude":(-?\d+\.\d+),"longitude":(-?\d+\.\d+)/g;
    let m;
    while ((m = re.exec(stateText))) { lat.push(parseFloat(m[1])); lng.push(parseFloat(m[2])); }
    if (lat.length < 3) return null;
    return { lat: median1(lat), lng: median1(lng), from: 'results' };
  }

  const api = { percentilesInSearch, searchCenter, parsePrice, parseBedrooms, parseCard, searchKey, addResults, findSearch, compareInSearch, priceVerdict, MIN_RATED, MIN_PRICED };
  root.RealGrade = Object.assign(root.RealGrade || {}, api);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
