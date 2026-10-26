const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

require('../extension/data/benchmarks.js');
const B = globalThis.REAL_GRADE_BENCHMARKS;
const RG = require('../extension/src/grade.js');
const { parseListing, extractStateJson, decodeListingId } = require('../extension/src/parse.js');

const fixture = (name) => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8'));

test('shrink pulls small samples toward the prior', () => {
  assert.equal(RG.shrink(5, 0, 4.8, 10), 4.8);
  assert.ok(Math.abs(RG.shrink(5, 2, 4.8, 10) - 4.8333) < 1e-3);
  assert.ok(Math.abs(RG.shrink(4.9, 1000, 4.8, 10) - 4.899) < 1e-3);
});

test('percentile interpolates and splits ties', () => {
  const q = Array.from({ length: 101 }, (_, i) => i / 100);
  assert.equal(RG.percentile(-1, q), 0);
  assert.equal(RG.percentile(2, q), 1);
  assert.ok(Math.abs(RG.percentile(0.255, q) - 0.255) < 1e-9);
  const tied = Array.from({ length: 101 }, (_, i) => (i < 60 ? i / 100 : 5));
  assert.ok(Math.abs(RG.percentile(5, tied) - 0.8) < 1e-9); // indices 60..100 -> midpoint 80
});

test('rank labels round to 5% and soften the middle', () => {
  assert.equal(RG.rankLabel(0.99), 'Top 5%');
  assert.equal(RG.rankLabel(0.82), 'Top 20%');
  assert.equal(RG.rankLabel(0.62), 'Top 40%');
  assert.equal(RG.rankLabel(0.55), 'About average');
  assert.equal(RG.rankLabel(0.41), 'About average');
  assert.equal(RG.rankLabel(0.12), 'Bottom 15%');
  assert.equal(RG.rankLabel(0.03), 'Bottom 5%');
  assert.equal(RG.rangeLabel(0.82, 0.05), 'Top 10\u201325%');
  assert.equal(RG.rangeLabel(0.18, 0.05), 'Bottom 10\u201325%');
  assert.equal(RG.rangeLabel(0.52, 0.05), 'About average');
  assert.deepEqual([0.9, 0.6, 0.3, 0.1].map(RG.tier), ['a', 'b', 'c', 'd']);
});

test('market lookup handles neighboring and uncovered places', () => {
  assert.equal(RG.findMarket(39.7392, -104.9903, B), 'co_denver');
  assert.equal(RG.findMarket(37.7793, -122.4193, B), 'ca_san-francisco');
  assert.equal(RG.findMarket(37.8044, -122.2712, B), 'ca_oakland');
  assert.equal(RG.findMarket(40.6782, -73.9442, B), 'ny_new-york-city');
  assert.equal(RG.findMarket(40.7178, -74.0431, B), 'nj_jersey-city');
  assert.equal(RG.findMarket(38.5, -98.0, B), null); // central Kansas
  assert.equal(RG.findMarket(undefined, undefined, B), null);
});

test('JS grades match the Python pipeline on real listings', () => {
  const rows = fixture('expected_grades.json');
  let marketHits = 0;
  for (const [i, r] of rows.entries()) {
    r.id = 'row ' + i;
    if (RG.findMarket(r.lat, r.lng, B) === r.market) marketHits++;
    const g = RG.gradeListing({ ...r, lat: undefined, lng: undefined }, B); // national, then force market below
    assert.ok(g.ok);
    const bench = B.markets[r.market];
    const adj = RG.shrink(r.overall, r.count, bench.prior.overall, B.fit.overall.k);
    assert.ok(Math.abs(adj - r.adjusted) < 1e-3, `adjusted ${r.id}: ${adj} vs ${r.adjusted}`);
    const p = RG.percentile(adj, bench.q.overall);
    assert.ok(Math.abs(p - r.percentile) < 0.03, `percentile ${r.id}: ${p} vs ${r.percentile}`);
  }
  assert.ok(marketHits / rows.length >= 0.95, `market match ${marketHits}/${rows.length}`);
});

// listing_sample.json keeps the structure of a real Airbnb listing page with made-up values.
test('parser reads a listing page (structure of a real page, made-up values)', () => {
  const p = parseListing(fixture('listing_sample.json'));
  assert.equal(p.listingId, '1000001');
  assert.equal(p.count, 180);
  assert.ok(Math.abs(p.overall - 4.89) < 0.002, `precise overall from star shares, got ${p.overall}`);
  assert.equal(p.categories.cleanliness, 4.62);
  assert.equal(p.categories.value, 4.87);
  assert.equal(Object.keys(p.categories).length, 6);
  assert.ok(Math.abs(p.lat - 39.74) < 1e-6 && Math.abs(p.lng + 104.95) < 1e-6);
  assert.equal(p.guestFavorite, true);
  assert.equal(p.place, 'Denver');
  assert.deepEqual(p.host, { rating: 4.85, count: 500 });
  assert.ok(Math.abs(p.stars[5] - 0.9) < 1e-9);
});

test('end to end: sample listing in Denver', () => {
  const g = RG.gradeListing(parseListing(fixture('listing_sample.json')), B);
  assert.equal(g.marketKey, 'co_denver');
  assert.equal(g.confidence, 'high');
  assert.equal(g.margin, 0);
  assert.equal(g.weakSpot, 'cleanliness'); // 4.62 cleanliness is low for Denver
  assert.equal(g.label, RG.rankLabel(g.percentile));
});

test('parser copes with missing pieces', () => {
  assert.deepEqual(parseListing({}).categories, {});
  assert.equal(parseListing(null).overall, undefined);
  assert.equal(extractStateJson('<html>no data</html>'), undefined);
  assert.equal(decodeListingId('not base64!!'), undefined);
  const g = RG.gradeListing(parseListing({}), B);
  assert.equal(g.ok, false);
});
