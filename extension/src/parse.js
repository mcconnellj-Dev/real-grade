/* Real Grade: read listing ratings from Airbnb's embedded page data.
 * Searches the JSON tree by key names instead of fixed paths, so small layout
 * changes on Airbnb's side don't break it. Pure functions; tested in Node. */
(function (root) {
  'use strict';

  const CATEGORY_MAP = {
    ACCURACY: 'accuracy', CLEANLINESS: 'cleanliness', CHECKIN: 'checkin',
    COMMUNICATION: 'communication', LOCATION: 'location', VALUE: 'value'
  };

  // Depth-first search; returns the first value for which test(value, key) is true.
  function find(obj, test, seen) {
    seen = seen || new Set();
    if (!obj || typeof obj !== 'object' || seen.has(obj)) return undefined;
    seen.add(obj);
    for (const key of Object.keys(obj)) {
      const v = obj[key];
      if (test(v, key)) return v;
      const hit = find(v, test, seen);
      if (hit !== undefined) return hit;
    }
    return undefined;
  }

  function num(v) {
    const n = typeof v === 'string' ? parseFloat(v.replace(/,/g, '')) : v;
    return typeof n === 'number' && isFinite(n) ? n : undefined;
  }

  function decodeListingId(id) {
    if (typeof id !== 'string') return undefined;
    try {
      const text = typeof atob === 'function' ? atob(id) : Buffer.from(id, 'base64').toString('utf8');
      const m = /StayListing:(\d+)$/.exec(text);
      return m ? m[1] : undefined;
    } catch (e) {
      return undefined;
    }
  }

  function parseListing(data) {
    const out = { categories: {} };

    const node = find(data, (v) => v && typeof v === 'object' && v.listingRatingStats && v.id);
    if (node) out.listingId = decodeListingId(node.id);

    const stats = find(data, (v, k) => k === 'listingRatingStats' && v && v.overallRatingStats);
    if (stats) {
      out.overall = num(stats.overallRatingStats.ratingAverage);
      out.count = num(stats.overallRatingStats.ratingCount);
      for (const c of stats.categoryRatingStats || []) {
        const key = CATEGORY_MAP[c.categoryTypeA || c.categoryType];
        const val = num(c.value && c.value.ratingAverage);
        if (key && val !== undefined) out.categories[key] = val;
      }
    }

    // Logging block carries the same numbers; use it to fill any gaps.
    const log = find(data, (v) => v && typeof v === 'object' && 'guestSatisfactionOverall' in v);
    if (log) {
      if (out.overall === undefined) out.overall = num(log.guestSatisfactionOverall);
      if (out.count === undefined) out.count = num(log.visibleReviewCount);
      for (const key of Object.values(CATEGORY_MAP)) {
        if (out.categories[key] === undefined) {
          const val = num(log[key + 'Rating']);
          if (val !== undefined) out.categories[key] = val;
        }
      }
      if (out.lat === undefined) { out.lat = num(log.listingLat); out.lng = num(log.listingLng); }
    }

    const dist = find(data, (v, k) => k === 'ratingDistribution' && Array.isArray(v) && v.length);
    if (dist) {
      const stars = {};
      for (const d of dist) {
        const s = parseInt(d.label, 10);
        const p = num(d.percentage);
        if (s >= 1 && s <= 5 && p !== undefined) stars[s] = p;
      }
      if (Object.keys(stars).length === 5) {
        out.stars = stars;
        // Airbnb often rounds the headline to one decimal (4.9); the star shares
        // give the precise average.
        const precise = [1, 2, 3, 4, 5].reduce((a, s) => a + s * stars[s], 0);
        if (out.overall !== undefined && Math.abs(precise - out.overall) < 0.06) out.overall = precise;
      }
    }

    const coord = find(data, (v, k) => k === 'coordinate' && v && typeof v.latitude === 'number');
    if (coord) { out.lat = coord.latitude; out.lng = coord.longitude; }

    const fav = find(data, (v, k) => k === 'isGuestFavorite' && typeof v === 'boolean');
    out.guestFavorite = fav === true;

    const place = find(data, (v, k) => k === 'localizedLocation' && typeof v === 'string');
    if (place) out.place = place;

    // "Condo in Breckenridge · ★4.6 · 1 bedroom · 2 beds · 1 bath"
    const title = find(data, (v, k) => (k === 'ugcTitle' || k === 'ogTitle') && v && typeof v === 'object');
    const titleText = title && find(title, (v, k) => k === 'localizedStringWithTranslationPreference' && typeof v === 'string');
    if (titleText) {
      out.title = titleText;
      if (/\bstudio\b/i.test(titleText)) out.bedrooms = 0;
      else { const b = /(\d+)\s+bedrooms?\b/i.exec(titleText); if (b) out.bedrooms = parseInt(b[1], 10); }
    }

    const passport = find(data, (v, k) => k === 'passportData' && v && v.ratingAverage !== undefined);
    if (passport) out.host = { rating: num(passport.ratingAverage), count: num(passport.ratingCount) };

    return out;
  }

  // Pull the embedded JSON out of a listing page's HTML text.
  function extractStateJson(html) {
    const m = /<script id="data-deferred-state-0"[^>]*>([\s\S]*?)<\/script>/.exec(html);
    if (!m) return undefined;
    try { return JSON.parse(m[1]); } catch (e) { return undefined; }
  }

  const api = { parseListing, extractStateJson, decodeListingId };
  root.RealGrade = Object.assign(root.RealGrade || {}, api);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
