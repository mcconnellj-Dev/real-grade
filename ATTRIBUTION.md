# Data attribution

Real Grade's market benchmarks (`extension/data/benchmarks.js`) and review-theme
baselines (`extension/data/themes.js`) are derived from data published by
[Inside Airbnb](https://insideairbnb.com), licensed under the
[Creative Commons Attribution 4.0 International License (CC BY 4.0)](https://creativecommons.org/licenses/by/4.0/).

**Changes made.** Listing snapshots for 34 US markets (September 2026) and review text
for 8 markets were reduced to aggregates: per-market means and 101-point percentile
tables of review-adjusted ratings, a 0.02° grid mapping locations to markets, and the
share of reviews mentioning each complaint theme. No listing, host, guest or review is
included. The derived files are shared under the same CC BY 4.0 terms.

`extension/data/calibration.js` holds a 101-point percentile table describing where
search-shown listings fall within their markets, computed by the project.

Real Grade is not affiliated with or endorsed by Inside Airbnb or Airbnb, Inc.
"Airbnb" is a trademark of Airbnb, Inc., used here only to say which site the
extension works on.
