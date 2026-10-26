"""Build Real Grade benchmarks from Inside Airbnb listing snapshots.

Outputs extension/data/benchmarks.js (a global the content script reads) and
pipeline/out/fit.json (the shrinkage fit, for the README and tests).

Method
------
A listing's average rating r_i over n_i reviews is treated as its true quality
theta_i plus noise:  r_i = theta_i + e_i,  Var(e_i) = sigma^2 / n_i,
theta_i ~ (mu_market, tau^2).  Across listings, Var(r | n) = tau^2 + sigma^2/n,
so regressing the within-market variance of r on 1/n (by review-count bucket)
gives tau^2 (intercept) and sigma^2 (slope).  The posterior-mean estimate is
    shrunk_i = (n_i * r_i + k * mu_market) / (n_i + k),   k = sigma^2 / tau^2
i.e. k is how many "average" reviews the prior is worth.

The variance fit gives k of about 50, but backtest.py shows that over-shrinks:
listings change over time, so old reviews predict less than the model assumes.
Scoring the 2025 snapshot against the next year's reviews, k = 8-12 with the
market mean as the prior beats raw stars in every review-count band, so we use
K = 10 for every score and keep the variance fit only as a diagnostic.
"""
import glob
import json
import os

import numpy as np
import pandas as pd

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "data", "raw")
OUT = os.path.join(ROOT, "pipeline", "out")
EXT = os.path.join(ROOT, "extension", "data")

SCORES = {
    "overall": "review_scores_rating",
    "accuracy": "review_scores_accuracy",
    "cleanliness": "review_scores_cleanliness",
    "checkin": "review_scores_checkin",
    "communication": "review_scores_communication",
    "location": "review_scores_location",
    "value": "review_scores_value",
}
MARKET_NAMES = {
    "nj_newark": "Newark", "ma_boston": "Boston", "ny_new-york-city": "New York City",
    "fl_broward-county": "Broward County, FL", "nj_jersey-city": "Jersey City",
    "ma_cambridge": "Cambridge, MA", "ny_albany": "Albany", "dc_washington-dc": "Washington, DC",
    "il_chicago": "Chicago", "la_new-orleans": "New Orleans", "tx_dallas": "Dallas",
    "nv_clark-county-nv": "Las Vegas area", "oh_columbus": "Columbus", "hi_hawaii": "Hawaii",
    "ca_santa-clara-county": "Santa Clara County", "ca_los-angeles": "Los Angeles",
    "ca_san-mateo-county": "San Mateo County", "ca_san-francisco": "San Francisco",
    "ca_oakland": "Oakland", "ca_san-diego": "San Diego", "ny_rochester": "Rochester, NY",
    "ca_santa-cruz-county": "Santa Cruz County", "tx_fort-worth": "Fort Worth",
    "wa_seattle": "Seattle", "mn_twin-cities-msa": "Twin Cities", "tn_nashville": "Nashville",
    "ri_rhode-island": "Rhode Island", "tx_austin": "Austin", "ca_pacific-grove": "Pacific Grove",
    "or_portland": "Portland, OR", "co_denver": "Denver", "or_salem-or": "Salem, OR",
    "nc_asheville": "Asheville", "mt_bozeman": "Bozeman",
}
CELL = 0.02  # degrees, ~2 km
K = 10  # prior strength in reviews, chosen by backtest.py
# Outside the covered markets, compare with the nearest one if it is this close
# (fallback_test.py: nearest market 6.0 pts error vs 7.2 for the US pool).
FALLBACK_MILES = 300
N_BUCKETS = [1, 2, 3, 5, 8, 12, 20, 35, 60, 100, 200, 100000]


def load():
    frames = []
    for f in sorted(glob.glob(os.path.join(RAW, "*_*.csv.gz"))):
        key = os.path.basename(f)[:-7]
        if key not in MARKET_NAMES:
            continue
        d = pd.read_csv(f, usecols=["id", "number_of_reviews", "latitude", "longitude", *SCORES.values()],
                        low_memory=False)
        d["market"] = key
        frames.append(d)
    d = pd.concat(frames, ignore_index=True)
    return d[d.number_of_reviews >= 1].copy()


def fit_shrinkage(d, col):
    """Fit tau^2 and sigma^2 for one score; return (k, tau2, sigma2, table)."""
    x = d[["market", "number_of_reviews", col]].dropna().copy()
    x["dev"] = x[col] - x.groupby("market")[col].transform("mean")
    x["bucket"] = pd.cut(x.number_of_reviews, N_BUCKETS, right=False)
    t = x.groupby("bucket", observed=True).agg(var=("dev", "var"), inv_n=("number_of_reviews", lambda s: (1 / s).mean()),
                                               count=("dev", "size"))
    # 1-4 review listings are mostly brand-new and far noisier than the model allows;
    # fitting on n >= 5 keeps them from swamping the intercept.
    t = t[(t["count"] >= 200) & (t.index.map(lambda b: b.left) >= 5)]
    w = t["count"].values
    A = np.vstack([np.ones(len(t)), t.inv_n.values]).T
    tau2, sigma2 = np.linalg.lstsq(A * np.sqrt(w)[:, None], t["var"].values * np.sqrt(w), rcond=None)[0]
    tau2 = max(tau2, 1e-4)
    sigma2 = max(sigma2, 1e-4)
    return sigma2 / tau2, tau2, sigma2, t


def shrink(r, n, mu, k):
    return (n * r + k * mu) / (n + k)


def quantiles(s):
    return [round(float(v), 4) for v in np.quantile(s.dropna(), np.linspace(0, 1, 101))]


def main():
    os.makedirs(OUT, exist_ok=True)
    os.makedirs(EXT, exist_ok=True)
    d = load()
    print(f"listings with 1+ review: {len(d):,} in {d.market.nunique()} markets")

    fit = {}
    for name, col in SCORES.items():
        k, tau2, sigma2, t = fit_shrinkage(d, col)
        fit[name] = {"k": K, "k_variance_fit": round(float(k), 2), "tau2": float(tau2), "sigma2": float(sigma2)}
        print(f"{name:14s} variance-fit k={k:6.2f}  tau={np.sqrt(tau2):.3f}  sigma(per review)={np.sqrt(sigma2):.3f}  -> using k={K}")

    # Market priors, shrunk scores, quantiles
    markets = {}
    pooled = {name: [] for name in SCORES}
    for key, g in d.groupby("market"):
        entry = {"name": MARKET_NAMES[key], "listings": int(len(g)), "prior": {}, "q": {}}
        for name, col in SCORES.items():
            mu = float(g[col].mean())
            s = shrink(g[col], g.number_of_reviews, mu, fit[name]["k"])
            entry["prior"][name] = round(mu, 4)
            entry["q"][name] = quantiles(s)
            pooled[name].append(s)
        markets[key] = entry

    national = {"name": "US (34 markets)", "listings": int(len(d)), "prior": {}, "q": {}}
    for name, col in SCORES.items():
        national["prior"][name] = round(float(d[col].mean()), 4)
        national["q"][name] = quantiles(pd.concat(pooled[name]))

    # Market lookup grid: each 0.02-degree cell -> the market with most listings in it
    d["cell"] = (np.floor(d.latitude / CELL).astype(int).astype(str) + ","
                 + np.floor(d.longitude / CELL).astype(int).astype(str))
    keys = sorted(markets)
    idx = {k: i for i, k in enumerate(keys)}
    cells = d.groupby("cell").market.agg(lambda s: s.value_counts().index[0])
    grid = {c: idx[m] for c, m in cells.items()}
    bbox = {k: [round(float(v), 3) for v in (g.latitude.quantile(.005), g.longitude.quantile(.005),
                                             g.latitude.quantile(.995), g.longitude.quantile(.995))]
            for k, g in d.groupby("market")}
    center = {k: [round(float(g.latitude.median()), 4), round(float(g.longitude.median()), 4)]
              for k, g in d.groupby("market")}
    print(f"grid cells: {len(grid):,}")

    bench = {
        "version": "2026-09",
        "source": "Inside Airbnb, September 2026 snapshots",
        "cell": CELL,
        "fit": {n: {"k": f["k"]} for n, f in fit.items()},
        "marketKeys": keys,
        "markets": markets,
        "national": national,
        "bbox": bbox,
        "center": center,
        "fallbackMiles": FALLBACK_MILES,
        "grid": grid,
    }
    with open(os.path.join(OUT, "fit.json"), "w") as f:
        json.dump(fit, f, indent=2)
    js = "/* Generated by pipeline/build_benchmarks.py. Do not edit. */\n" \
         "globalThis.REAL_GRADE_BENCHMARKS = " + json.dumps(bench, separators=(",", ":")) + ";\n"
    with open(os.path.join(EXT, "benchmarks.js"), "w") as f:
        f.write(js)
    print(f"wrote extension/data/benchmarks.js ({len(js) / 1024:.0f} KB)")


if __name__ == "__main__":
    main()
