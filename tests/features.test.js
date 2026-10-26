const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

require('../extension/data/benchmarks.js');
require('../extension/data/themes.js');
const B = globalThis.REAL_GRADE_BENCHMARKS;
const T = globalThis.REAL_GRADE_THEMES;
const RG = require('../extension/src/grade.js');
const S = require('../extension/src/search.js');
const F = require('../extension/src/flags.js');

const fixture = (name) => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8'));

// ---- vacation areas / uncovered places ----
test('uncovered vacation towns fall back to the nearest covered market', () => {
  const breck = RG.chooseBenchmark(39.4817, -106.0384, B);
  assert.equal(breck.kind, 'nearby');
  assert.equal(breck.key, 'co_denver');
  assert.ok(breck.miles > 50 && breck.miles < 100, `Breckenridge to Denver ${breck.miles}`);

  const highlands = RG.chooseBenchmark(35.0526, -83.1968, B);
  assert.equal(highlands.kind, 'nearby');
  assert.equal(highlands.key, 'nc_asheville');

  const stpete = RG.chooseBenchmark(27.7676, -82.6403, B);
  assert.equal(stpete.kind, 'nearby');
  assert.equal(stpete.key, 'fl_broward-county');

  const highlandFallsNY = RG.chooseBenchmark(41.3693, -73.9660, B);
  assert.equal(highlandFallsNY.key, 'ny_new-york-city');

  assert.equal(RG.chooseBenchmark(39.7392, -104.9903, B).kind, 'market'); // Denver itself
  assert.equal(RG.chooseBenchmark(47.5, -100.5, B).kind, 'national');     // central North Dakota, >300 mi from all
});

test('a nearby-benchmark grade is labeled as an estimate', () => {
  const g = RG.gradeListing({ overall: 4.9, count: 80, categories: { cleanliness: 4.9 }, lat: 39.4817, lng: -106.0384 }, B);
  assert.equal(g.benchmark, 'nearby');
  assert.equal(g.marketName, 'Denver');
  assert.ok(g.fallbackMiles > 0);
  assert.equal(g.margin, RG.MARGIN.nearby);
  assert.equal(g.label, RG.rangeLabel(g.percentile, RG.MARGIN.nearby)); // estimates show a range
});

// ---- search cards and prices (strings copied from live airbnb.com) ----
test('parsePrice handles totals, discounts and per-night', () => {
  assert.deepEqual(S.parsePrice('$1,085 for 3 nights, originally $1,285'), { total: 1085, nights: 3, perNight: 1085 / 3 });
  assert.equal(S.parsePrice('$970\nShow price breakdown\n \nfor 3 nights\n$970 for 3 nights').total, 970);
  assert.equal(S.parsePrice('$250 night').perNight, 250);
  assert.equal(S.parsePrice('Pay $0 today'), null);
  assert.equal(S.parsePrice(''), null);
});

test('parseCard reads rating, reviews, bedrooms and price', () => {
  const c = S.parseCard('Photo 1 of 6\nSuperhost\nCondo in Breckenridge\n4.84 out of 5 average rating, 51 reviews\n4.84 (51)\nSki-in with mountain views\n1 bedroom\n,\n · \n2 beds\n$1,285 \n$1,085\n$1,085 for 3 nights, originally $1,285\nfor 3 nights');
  assert.equal(c.rating, 4.84);
  assert.equal(c.count, 51);
  assert.equal(c.bedrooms, 1);
  assert.equal(c.price.total, 1085);
  const n = S.parseCard('Condo in Breckenridge\nNew place to stay\nNew\nStudio\n$514 for 3 nights');
  assert.equal(n.rating, undefined);
  assert.equal(n.isNew, true);
  assert.equal(n.bedrooms, 0);
});

test('searchKey groups pages of one search', () => {
  const a = S.searchKey('https://www.airbnb.com/s/Breckenridge--Colorado--United-States/homes?checkin=2027-01-15&checkout=2027-01-18&adults=2');
  const b = S.searchKey('https://www.airbnb.com/s/Breckenridge--Colorado--United-States/homes?checkin=2027-01-15&checkout=2027-01-18&adults=2&cursor=abc');
  assert.equal(a.key, b.key);
  assert.equal(a.place, 'Breckenridge');
  assert.equal(a.checkin, '2027-01-15');
});

test('search store keeps recent searches and finds a listing by dates', () => {
  const now = Date.UTC(2026, 9, 26);
  let store = {};
  const meta = S.searchKey('https://www.airbnb.com/s/St-Petersburg--FL/homes?checkin=2027-03-01&checkout=2027-03-05&adults=2');
  store = S.addResults(store, meta, [{ id: '1', data: { rating: 4.9, count: 10 } }], now);
  store = S.addResults(store, meta, [{ id: '2', data: { rating: 4.7, count: 30 } }], now + 1000);
  assert.equal(Object.keys(store[meta.key].listings).length, 2);
  assert.ok(S.findSearch(store, '2', '2027-03-01', '2027-03-05'));
  assert.equal(S.findSearch(store, '2', '2027-04-01', '2027-04-05'), null);
  // old searches age out
  store = S.addResults(store, S.searchKey('https://www.airbnb.com/s/Denver/homes'), [{ id: '9', data: {} }], now + 40 * 864e5);
  assert.equal(Object.keys(store).length, 1);
});

function fakeSearch(n) {
  const listings = {};
  for (let i = 0; i < n; i++) {
    listings[String(i)] = { rating: 4.6 + (i % 5) * 0.08, count: 20 + i, bedrooms: i % 2 ? 1 : 2, price: { perNight: 200 + i * 10 } };
  }
  return { place: 'Breckenridge', listings };
}

test('compareInSearch ranks rating and price among the other places', () => {
  const s = fakeSearch(40);
  const top = S.compareInSearch(s, { id: 'x', overall: 4.99, count: 200, bedrooms: 1, price: { perNight: 900 } }, RG.shrink, 10);
  assert.ok(top.rating.percentile > 0.9);
  assert.equal(top.price.sameBedrooms, true);
  assert.equal(top.price.n, 20);
  assert.equal(top.price.percentile, 1);
  const few = S.compareInSearch(fakeSearch(5), { id: 'x', overall: 4.9, count: 50, bedrooms: 1, price: { perNight: 300 } }, RG.shrink, 10);
  assert.equal(few.rating, undefined);
  assert.equal(few.price, undefined);
});

test('priceVerdict pairs price with value', () => {
  assert.equal(S.priceVerdict({ percentile: 0.9 }, 0.2).tone, 'bad');
  assert.match(S.priceVerdict({ percentile: 0.9 }, 0.8).text, /Premium/);
  assert.equal(S.priceVerdict({ percentile: 0.1 }, 0.5).tone, 'good');
  assert.equal(S.priceVerdict(null, 0.5), null);
});

// ---- review red flags ----
test('parseReviewText reads stars and body from a live review', () => {
  const r = F.parseReviewText('Jim\nHamilton, Ohio\nRating, 5 stars\n,\n·\n3 weeks ago\n,\n·\nStayed a few nights\nVery nice condo. Excellent location.\nShow more');
  assert.equal(r.stars, 5);
  assert.equal(r.text, 'Very nice condo. Excellent location.');
});

test('analyzeReviews flags repeated and severe themes, ignores negations', () => {
  const ok = Array.from({ length: 6 }, () => ({ stars: 5, text: 'Great stay, spotless and quiet.' }));
  assert.equal(F.analyzeReviews(ok, T).flags.length, 0);
  const negated = [{ stars: 5, text: 'No stains anywhere, not noisy at all.' }, ...ok];
  assert.equal(F.analyzeReviews(negated, T).flags.length, 0);
  const noisy = [{ stars: 3, text: 'Very noisy at night.' }, { stars: 4, text: 'Thin walls, hard to sleep.' }, ...ok];
  const a = F.analyzeReviews(noisy, T);
  assert.equal(a.flags[0].key, 'noise');
  assert.equal(a.low, 1);
  const bugs = [{ stars: 2, text: 'We found a cockroach in the kitchen.' }, ...ok];
  assert.equal(F.analyzeReviews(bugs, T).flags[0].key, 'pests'); // severe: one mention in a few reviews
  const many = [{ stars: 2, text: 'We found a cockroach in the kitchen.' }, ...Array.from({ length: 300 }, () => ok[0])];
  assert.equal(F.analyzeReviews(many, T).flags.length, 0); // one in 300 is within normal
  const broken = [...Array.from({ length: 9 }, () => ({ stars: 3, text: 'The dishwasher was broken.' })), ...Array.from({ length: 205 }, () => ok[0])];
  assert.equal(F.analyzeReviews(broken, T).flags[0].key, 'maintenance'); // 9 of 214 is ~4x usual
});

test('poissonTail matches known values', () => {
  assert.ok(Math.abs(F.poissonTail(0, 2) - 1) < 1e-12);
  assert.ok(Math.abs(F.poissonTail(1, 2) - (1 - Math.exp(-2))) < 1e-12);
  assert.ok(Math.abs(F.poissonTail(3, 1) - 0.0803014) < 1e-6);
});

test('JS theme matching agrees with the Python baselines', () => {
  const rows = fixture('theme_parity.json');
  let mismatch = 0;
  for (const r of rows) {
    const js = Object.keys(T.themes).filter((k) => F.analyzeReviews([{ stars: 5, text: r.text }], {
      ...T, themes: { [k]: { ...T.themes[k], baseline: 1e-9, severe: true } }
    }).flags.length).sort();
    if (JSON.stringify(js) !== JSON.stringify(r.themes)) {
      mismatch++;
      if (mismatch <= 3) console.log('  mismatch:', r.themes, js, r.text.slice(0, 120));
    }
  }
  assert.ok(mismatch / rows.length <= 0.01, `${mismatch} of ${rows.length} reviews differ`);
});

// ---- v0.3: search calibration, bargains, weak spots, search badges ----
require('../extension/data/calibration.js');
const CAL = globalThis.REAL_GRADE_CALIBRATION;

test('search rank maps to a higher market percentile (search shows top places first)', () => {
  const mid = RG.fromSearch(0.5, CAL);
  assert.ok(mid > 0.6 && mid < 0.85, `median search listing -> ${mid}`);
  assert.ok(RG.fromSearch(0, CAL) <= RG.fromSearch(0.2, CAL));
  assert.ok(RG.fromSearch(1, CAL) <= 1);
});

test('withSearch blends calibrated search rank with the nearby market, only off-market', () => {
  const near = RG.gradeListing({ overall: 4.6, count: 132, categories: { checkin: 4.66 }, lat: 39.4817, lng: -106.0384 }, B);
  assert.equal(near.benchmark, 'nearby');
  const s = RG.withSearch(near, 0.12, 64, CAL);
  assert.equal(s.benchmark, 'search');
  const expected = CAL.blend * RG.fromSearch(0.12, CAL) + (1 - CAL.blend) * near.percentile;
  assert.ok(Math.abs(s.percentile - expected) < 1e-9);
  assert.equal(RG.withSearch(near, 0.12, 5, CAL), near); // too few places: unchanged
  const denver = RG.gradeListing({ overall: 4.9, count: 229, lat: 39.7392, lng: -104.9903 }, B);
  assert.equal(RG.withSearch(denver, 0.1, 80, CAL), denver); // covered market: data wins
});

test('weak spots are hidden on A-range listings', () => {
  const top = RG.gradeListing({ overall: 4.99, count: 300, lat: 39.7392, lng: -104.9903,
    categories: { accuracy: 5, cleanliness: 5, checkin: 4.7, communication: 5, location: 5, value: 5 } }, B);
  assert.ok(top.percentile >= 0.8);
  assert.equal(top.weakSpot, null);
});

test('priceVerdict calls out top-rated bargains', () => {
  assert.equal(S.priceVerdict({ percentile: 0.2 }, 0.9, 0.95).tone, 'good');
  assert.match(S.priceVerdict({ percentile: 0.3 }, 0.9, 0.95).text, /Top-rated and cheaper/);
  assert.match(S.priceVerdict({ percentile: 0.3 }, 0.5, 0.4).text, /normal range/);
});

test('percentilesInSearch and searchCenter', () => {
  const r = S.percentilesInSearch(fakeSearch(40), RG.shrink, 10);
  assert.equal(r.n, 40);
  const vals = Object.values(r.pct);
  assert.ok(Math.min(...vals) > 0 && Math.max(...vals) < 1);
  const fromMap = S.searchCenter('https://www.airbnb.com/s/x/homes?ne_lat=40&ne_lng=-105&sw_lat=39&sw_lng=-106', null);
  assert.deepEqual([fromMap.lat, fromMap.lng, fromMap.from], [39.5, -105.5, 'map']);
  const state = '"latitude":39.48,"longitude":-106.04 "latitude":39.50,"longitude":-106.05 "latitude":39.47,"longitude":-106.03';
  const fromState = S.searchCenter('https://www.airbnb.com/s/Breckenridge/homes', state);
  assert.equal(fromState.from, 'results');
  assert.ok(Math.abs(fromState.lat - 39.48) < 1e-9);
  assert.equal(S.searchCenter('https://www.airbnb.com/s/x/homes', ''), null);
});
