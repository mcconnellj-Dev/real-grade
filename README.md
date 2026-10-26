# Real Grade: vacation rental ratings

A free Chrome extension that shows where a vacation rental really ranks in its area.
Works on Airbnb.com. Not affiliated with or endorsed by Airbnb.

Rental ratings are squeezed into the top half-star: across 34 US markets the median
listing is 4.88, and 95% of listings are 4.5 or higher. A raw 4.85 tells you little.
On every listing page Real Grade shows:

- **Rank in its area**: "Top 20%", "About average", "Bottom 15%" of comparable
  listings, adjusted for review count (a range like "Top 10–25%" when it is an estimate)
- **Weak spot**: the sub-score that lags its market most
- **In your search**: how its rating and price compare with the other places in your
  Airbnb search (same dates, same price display), including vacation towns we have no data for
- **Review red flags**: complaint themes (bugs, noise, broken things, not as pictured...)
  that show up far more than usual; one tap scans every review
- **Ranks on search results**: a badge next to the stars on every result card

## Install (local)

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and choose the `extension/` folder.
3. Open any listing on airbnb.com (`/rooms/...`). The card appears bottom-left.

## How a rank is made

1. **Read the page.** The extension reads the listing's own embedded data: overall
   rating, review count, six sub-scores, star breakdown and map location. It makes no
   requests of its own except to re-read the listing page after in-app navigation.
2. **Find the market.** The location is matched to one of 34 US markets with a
   0.02° grid built from listing coordinates. Places outside them use a pooled US benchmark.
3. **Adjust for review count.** `adjusted = (n × rating + 10 × market average) / (n + 10)`.
   A prior worth 10 reviews means a 5.0 from 3 reviews is not treated as better than a
   4.93 from 300.
4. **Rank within the market.** The adjusted score's percentile among all listings in
   that market (adjusted the same way) is shown rounded to 5%: "Top 20%", "Bottom 15%",
   or "About average" for the 40th–60th percentile. Colors: green for the top 20%,
   blue above average, amber below average, red for the bottom 20%.

   Ranks replaced letter grades (A–F) in v0.4. A percentile grades on a curve, so an
   "F" just meant "bottom 10% of a market where most places are good," which read as a
   verdict the data doesn't support. Estimates show a range sized from the measured
   error (±5 points with a search, ±8 from the nearest market alone).
5. **Weak spot.** The sub-score with the lowest market percentile is flagged when it is
   below the 25th.

## Places outside the 34 markets (Breckenridge, St. Pete, Highlands NC...)

`pipeline/fallback_test.py` holds out each covered market and ranks it as if it
were uncovered. Mean error in percentile points versus the true in-market percentile:

| Benchmark used | Error |
|---|---|
| All US markets pooled | 7.2 |
| Same area type (Census vacation-home share + density) | 7.8 |
| Nearest covered market | 6.0 (5.5 within 300 mi) |
| 80 random local listings | 4.4 |
| 80 top search results | 10.5 |

So an uncovered place starts out ranked against the nearest covered market within
300 miles (Breckenridge → Denver, Highlands NC → Asheville, St. Pete → Broward).

### Correcting for Airbnb's search ranking (v0.3)

Once you have browsed 20+ rated places in a search, the rank uses them. Airbnb shows
better-rated places first, so raw rank within a search is badly biased. To measure the
bias, `pipeline/search_calibration.py` uses 24 live searches (12 covered markets ×
January and June dates, first 4 pages, 1,889 rated listings) where each listing's true
market percentile is known. Search-shown listings sit at about the 69th percentile of
their market on average. A search rank q maps to that distribution's q-th quantile, and
the result is averaged 50/50 with the nearest-market estimate.

| Estimate for a held-out market | Error (pct. points) |
|---|---|
| Raw rank in search | 19.0 |
| Nearest covered market | 8.0 |
| Calibrated search rank | 6.3 |
| **50/50 blend (shipped)** | **5.0** (5.3 when learned on Jan, tested on June) |

## Price

Price is compared only within your own search. The dataset's prices are base nightly
rates for arbitrary dates without fees, while Airbnb now shows totals with fees for your
dates, so a dataset comparison would overstate prices by roughly 15-25%. In-search
comparisons use the same bedroom count when 8+ such places were seen, and pair the
price percentile with the value sub-score ("Premium price, but guests rate its value well").

## Review red flags

`pipeline/themes.json` defines ten complaint themes, shared by Python and the extension
(a test checks they match on a set of sample sentences). `review_baselines.py` measures how often
each appears across 2.6M reviews since 2024 (0.03-1.1%). A theme is flagged when it is
3x more common than usual and a Poisson test says that count is unlikely for a typical
listing (p < 0.01, or < 0.05 for bugs, safety and not-as-pictured). Negations like
"no stains" are ignored. Opening "Show all reviews" lets it scan hundreds of reviews.

## Why a prior of 10 reviews

`pipeline/backtest.py` scores the fall-2025 snapshot of 12 markets and checks it
against the reviews each listing received over the following year.

| Reviews in 2025 | Error, raw stars | Error, Real Grade | Rank corr., raw | Rank corr., Real Grade |
|---|---|---|---|---|
| 1–4 | 0.359 | 0.198 | 0.260 | 0.291 |
| 5–19 | 0.214 | 0.175 | 0.463 | 0.466 |
| 20–59 | 0.153 | 0.147 | 0.591 | 0.594 |
| 60+ | 0.111 | 0.108 | 0.680 | 0.680 |
| All | 0.186 | 0.150 | 0.505 | 0.556 |

Error is RMSE in stars against the average of the new reviews. A classic
variance-components fit suggests a prior of about 50 reviews, but that over-shrinks:
listings change over time, so old reviews predict less than the model assumes.
Priors of 8–12 performed best; 10 is used for every score.

## Rebuild the benchmarks

```sh
# Inside Airbnb listings files go in data/raw/ as <state>_<market>.csv.gz
# (year-earlier snapshots in data/raw/prev/ for the backtest)
cd pipeline
python3 build_benchmarks.py   # writes extension/data/benchmarks.js
python3 backtest.py           # out-of-sample check
python3 export_expected.py    # refreshes the JS cross-check fixture
python3 review_baselines.py   # theme baselines -> extension/data/themes.js
python3 export_theme_fixture.py
python3 fallback_test.py      # needs Census files in data/raw/census (see areas.py)
python3 search_calibration.py # needs live searches in data/raw/calib -> extension/data/calibration.js
cd .. && node --test tests/*.test.js
```

## Privacy

Everything runs in the browser. No server, no account, no analytics. Recent searches are
kept in the browser's extension storage so listings can be compared with the rest of
the search. See [PRIVACY.md](PRIVACY.md).

## Data and license

Code: [MIT](LICENSE). Market benchmarks and review-theme baselines are derived from
[Inside Airbnb](https://insideairbnb.com) data under
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/); see [ATTRIBUTION.md](ATTRIBUTION.md).
"Airbnb" is a trademark of Airbnb, Inc., used only to say which site this works on.

## Limits

- Benchmarks cover 34 US markets from Inside Airbnb's September 2026 snapshots.
- Airbnb can change its page data at any time; the parser searches by key names to
  survive small changes, but a redesign will need a parser update.
- Search capture reads Airbnb's result cards; a redesign of those cards needs a parser update.
- Red flags read reviews the page has loaded (about 6 by default) until you tap
  "Scan all reviews", which opens Airbnb's own reviews dialog and scrolls it.
- Weak spots are only shown for listings below the top 20%.
- Tested live on airbnb.com (Oct 26, 2026): Breckenridge, St. Petersburg, Highlands NC, Denver.

Real Grade is an independent project by McConnell Digital and is not affiliated with or
endorsed by Airbnb, Inc. or Inside Airbnb.
