/* Real Grade: review red flags. Counts complaint themes in the reviews the page
 * has loaded and compares them with how often reviews mention each theme across
 * Airbnb in general (pipeline/review_baselines.py). Pure functions; tested in Node. */
(function (root) {
  'use strict';

  // Flag a theme when it shows up at least 3x more than usual AND that many mentions
  // would be unlikely for a typical listing (Poisson tail). Severe themes use a looser
  // cutoff, so one cockroach in 6 reviews flags but one in 200 does not.
  const RATIO = 3;
  const P_NORMAL = 0.01;
  const P_SEVERE = 0.05;

  // P(X >= k) for X ~ Poisson(lambda)
  function poissonTail(k, lambda) {
    let term = Math.exp(-lambda), cdf = 0;
    for (let i = 0; i < k; i++) { cdf += term; term *= lambda / (i + 1); }
    return Math.max(0, 1 - cdf);
  }

  function compile(T) {
    const neg = new RegExp(T.negation.pattern, 'i');
    const themes = Object.keys(T.themes).map((key) => {
      const t = T.themes[key];
      return { key, label: t.label, severe: t.severe, baseline: t.baseline, re: new RegExp(t.pattern, 'gi') };
    });
    return { neg, window: T.negation.window, themes };
  }

  function mentions(text, theme, C) {
    theme.re.lastIndex = 0;
    let m;
    while ((m = theme.re.exec(text))) {
      const before = text.slice(Math.max(0, m.index - C.window), m.index);
      if (!C.neg.test(before)) return true;
    }
    return false;
  }

  // reviews: [{stars, text}] -> {n, low, flags: [{key, label, count, rate, ratio, severe}]}
  function analyzeReviews(reviews, T) {
    const C = compile(T);
    const n = reviews.length;
    const out = { n, low: reviews.filter((r) => r.stars && r.stars <= 3).length, flags: [] };
    if (!n) return out;
    for (const t of C.themes) {
      const count = reviews.filter((r) => r.text && mentions(r.text, t, C)).length;
      if (!count) continue;
      const rate = count / n;
      const ratio = rate / t.baseline;
      const p = poissonTail(count, n * t.baseline);
      if (ratio >= RATIO && p < (t.severe ? P_SEVERE : P_NORMAL)) {
        out.flags.push({ key: t.key, label: t.label, count, rate, ratio, p, severe: t.severe });
      }
    }
    out.flags.sort((a, b) => (b.severe - a.severe) || (b.count - a.count));
    return out;
  }

  // Visible text of one review list item -> {stars, text}
  function parseReviewText(itemText) {
    const m = /Rating,\s*(\d)\s*stars?/i.exec(itemText);
    if (!m) return null;
    const lines = itemText.split('\n').map((l) => l.trim()).filter(Boolean);
    const stayed = lines.findIndex((l) => /^Stayed\b/i.test(l));
    const start = stayed >= 0 ? stayed + 1 : lines.findIndex((l) => /Rating,/.test(l)) + 1;
    const body = lines.slice(start).filter((l) => !/^(Show more|Translate|Translated|Response from)/i.test(l) && l !== '·' && l !== ',');
    return { stars: parseInt(m[1], 10), text: body.join(' ') };
  }

  const api = { analyzeReviews, parseReviewText, poissonTail };
  root.RealGrade = Object.assign(root.RealGrade || {}, api);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
