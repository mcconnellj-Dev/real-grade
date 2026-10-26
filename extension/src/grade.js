/* Real Grade: grading math. Pure functions, shared by the content script and Node tests. */
(function (root) {
  'use strict';

  const SCORES = ['overall', 'accuracy', 'cleanliness', 'checkin', 'communication', 'location', 'value'];
  const LABELS = {
    overall: 'Overall', accuracy: 'Accuracy', cleanliness: 'Cleanliness', checkin: 'Check-in',
    communication: 'Communication', location: 'Location', value: 'Value'
  };
  // Error margins (percentile points / 100) for estimates, from the held-out tests:
  // search-calibrated blend 5.0 pts, nearest market alone 8.0, pooled US data 7.2 but
  // much worse for resort towns.
  const MARGIN = { market: 0, search: 0.05, nearby: 0.08, national: 0.1 };

  const WEAK_SPOT_MAX = 0.8;

  function shrink(rating, n, prior, k) {
    return (n * rating + k * prior) / (n + k);
  }

  // Share of the market at or below `value`, from 101 quantiles (0th..100th).
  // Ties (many listings at exactly 5.00) count half, so a tied value lands mid-range.
  // Benchmarks are stored to 4 decimals, so values within TIE of a quantile count
  // as equal. That keeps big ties (every one-review 5.0 listing lands on the same
  // adjusted score) from being missed by a rounding hair.
  const TIE = 1.5e-4;
  function percentile(value, q) {
    const last = q.length - 1;
    let below = 0;
    while (below <= last && q[below] < value - TIE) below++;
    let equal = 0;
    while (below + equal <= last && Math.abs(q[below + equal] - value) <= TIE) equal++;
    if (equal) return (below + (equal - 1) / 2) / last;
    if (below === 0) return 0;
    if (below > last) return 1;
    const f = (value - q[below - 1]) / (q[below] - q[below - 1]);
    return (below - 1 + f) / last;
  }

  // Color tier: a = top 20%, b = above average, c = below average, d = bottom 20%.
  function tier(p) {
    return p >= 0.8 ? 'a' : p >= 0.5 ? 'b' : p >= 0.2 ? 'c' : 'd';
  }

  function step5(x, up) {
    return Math.max(1, Math.min(50, (up ? Math.ceil(x * 20 - 1e-9) : Math.floor(x * 20 + 1e-9)) * 5));
  }

  // "Top 20%" / "Bottom 15%", rounded to 5 so it doesn't claim more precision than it
  // has; the middle fifth reads "About average" rather than "Bottom 45%".
  function rankLabel(p) {
    if (p >= 0.4 && p < 0.6) return 'About average';
    return p >= 0.6 ? 'Top ' + step5(1 - p, true) + '%' : 'Bottom ' + step5(p, true) + '%';
  }

  // Estimates show a range: "Top 10–25%", "Bottom 20–35%", or "About average".
  function rangeLabel(p, m) {
    const lo = Math.max(0, p - m), hi = Math.min(1, p + m);
    if (lo >= 0.5) return 'Top ' + step5(1 - hi, false) + '\u2013' + step5(1 - lo, true) + '%';
    if (hi < 0.5) return 'Bottom ' + step5(lo, false) + '\u2013' + step5(hi, true) + '%';
    return 'About average';
  }

  function labelFor(p, m) {
    return m > 0 ? rangeLabel(p, m) : rankLabel(p);
  }

  function cellKey(lat, lng, size) {
    return Math.floor(lat / size) + ',' + Math.floor(lng / size);
  }

  // Market for a coordinate: its grid cell, else the most common market in nearby
  // cells (up to ~6 km), else a market whose bounding box contains it.
  function findMarket(lat, lng, B) {
    if (typeof lat !== 'number' || typeof lng !== 'number') return null;
    const i = Math.floor(lat / B.cell), j = Math.floor(lng / B.cell);
    const hit = B.grid[i + ',' + j];
    if (hit !== undefined) return B.marketKeys[hit];
    for (let r = 1; r <= 3; r++) {
      const votes = {};
      for (let di = -r; di <= r; di++) {
        for (let dj = -r; dj <= r; dj++) {
          const m = B.grid[(i + di) + ',' + (j + dj)];
          if (m !== undefined) votes[m] = (votes[m] || 0) + 1;
        }
      }
      const best = Object.keys(votes).sort((a, b) => votes[b] - votes[a])[0];
      if (best !== undefined) return B.marketKeys[+best];
    }
    for (const key of B.marketKeys) {
      const [la0, lo0, la1, lo1] = B.bbox[key];
      if (lat >= la0 && lat <= la1 && lng >= lo0 && lng <= lo1) return key;
    }
    return null;
  }

  function miles(lat1, lng1, lat2, lng2) {
    const r = Math.PI / 180;
    const x = Math.sin(lat1 * r) * Math.sin(lat2 * r) + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.cos((lng1 - lng2) * r);
    return 3959 * Math.acos(Math.max(-1, Math.min(1, x)));
  }

  // Closest covered market by center, with its distance in miles.
  function nearestMarket(lat, lng, B) {
    if (typeof lat !== 'number' || typeof lng !== 'number') return null;
    let best = null;
    for (const key of B.marketKeys) {
      const [la, lo] = B.center[key];
      const d = miles(lat, lng, la, lo);
      if (!best || d < best.miles) best = { key, miles: d };
    }
    return best;
  }

  // Which benchmark to grade against: the listing's own market; else the nearest
  // market within B.fallbackMiles (an estimate); else the pooled US data.
  function chooseBenchmark(lat, lng, B) {
    const key = findMarket(lat, lng, B);
    if (key) return { key, bench: B.markets[key], kind: 'market' };
    const near = nearestMarket(lat, lng, B);
    if (near && near.miles <= B.fallbackMiles) {
      return { key: near.key, bench: B.markets[near.key], kind: 'nearby', miles: near.miles };
    }
    return { key: null, bench: B.national, kind: 'national' };
  }

  function confidence(n) {
    if (n >= 50) return 'high';
    if (n >= 10) return 'medium';
    return 'low';
  }

  // listing: {overall, count, categories: {cleanliness: 4.64, ...}, lat, lng}
  function gradeListing(listing, B) {
    if (!listing || typeof listing.overall !== 'number' || !(listing.count > 0)) {
      return { ok: false, reason: 'no-ratings' };
    }
    const choice = chooseBenchmark(listing.lat, listing.lng, B);
    const bench = choice.bench;
    const scores = {};
    for (const s of SCORES) {
      const raw = s === 'overall' ? listing.overall : listing.categories && listing.categories[s];
      if (typeof raw !== 'number') continue;
      const k = B.fit[s].k;
      const adjusted = shrink(raw, listing.count, bench.prior[s], k);
      const p = percentile(adjusted, bench.q[s]);
      scores[s] = { label: LABELS[s], raw, adjusted, percentile: p };
    }
    const subs = SCORES.slice(1).filter((s) => scores[s]);
    const sorted = subs.slice().sort((a, b) => scores[a].percentile - scores[b].percentile);
    const weakest = sorted[0];
    const strongest = sorted[sorted.length - 1];
    return {
      ok: true,
      marketKey: choice.key,
      marketName: bench.name,
      benchmark: choice.kind,
      fallbackMiles: choice.miles,
      isNational: choice.kind === 'national',
      tier: tier(scores.overall.percentile),
      margin: MARGIN[choice.kind],
      label: labelFor(scores.overall.percentile, MARGIN[choice.kind]),
      percentile: scores.overall.percentile,
      adjusted: scores.overall.adjusted,
      raw: listing.overall,
      count: listing.count,
      confidence: confidence(listing.count),
      scores,
      // On A-range listings a "weak spot" is noise, so only flag it below the 80th percentile.
      weakSpot: weakest && scores[weakest].percentile < 0.25 && scores.overall.percentile < WEAK_SPOT_MAX ? weakest : null,
      strength: strongest && scores[strongest].percentile >= 0.75 ? strongest : null
    };
  }

  // Search results lean toward top-rated places. C.q holds the true market percentiles
  // of search-shown listings (pipeline/search_calibration.py), so rank q in a search
  // maps to market percentile C.q at q.
  function fromSearch(searchPct, C) {
    const x = Math.max(0, Math.min(1, searchPct)) * 100;
    const i = Math.min(99, Math.floor(x));
    return C.q[i] + (C.q[i + 1] - C.q[i]) * (x - i);
  }

  // For places outside the covered markets, re-estimate the grade from the user's own
  // search: calibrated search rank, blended with the nearby market when there is one.
  // Held-out test: 5.0 percentile points of error vs 8.0 for the nearby market alone.
  function withSearch(g, searchPct, n, C) {
    if (!g || !g.ok || g.benchmark === 'market' || !C || typeof searchPct !== 'number' || !(n >= C.minRated)) return g;
    const cal = fromSearch(searchPct, C);
    const p = g.benchmark === 'nearby' ? C.blend * cal + (1 - C.blend) * g.percentile : cal;
    return Object.assign({}, g, {
      percentile: p,
      tier: tier(p),
      margin: MARGIN.search,
      label: labelFor(p, MARGIN.search),
      benchmark: 'search',
      baseBenchmark: g.benchmark,
      searchN: n,
      weakSpot: p < WEAK_SPOT_MAX ? g.weakSpot : null
    });
  }

  const api = { fromSearch, withSearch, SCORES, LABELS, MARGIN, shrink, percentile, tier, rankLabel, rangeLabel, labelFor, cellKey, findMarket, miles, nearestMarket, chooseBenchmark, confidence, gradeListing };
  root.RealGrade = Object.assign(root.RealGrade || {}, api);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
