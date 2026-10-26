"""Out-of-sample test: grade listings on the fall-2025 snapshot, then check how
well each score predicts the reviews those listings got over the next year.

Outcome 1: implied average star rating of the new reviews,
           (r_2026 * n_2026 - r_2025 * n_2025) / (n_2026 - n_2025).
Outcome 2: share of reviews posted after the 2025 snapshot that contain
           complaint words (8 markets with review text).
"""
import glob, os
import numpy as np, pandas as pd
from scipy.stats import spearmanr
import build_benchmarks as bb
from validate import NEG

C = ["id", "number_of_reviews", "review_scores_rating", "last_scraped"]
rows = []
for f in sorted(glob.glob(os.path.join(bb.RAW, "prev", "*.csv.gz"))):
    key = os.path.basename(f)[:-7]
    a = pd.read_csv(f, usecols=C, low_memory=False)
    b = pd.read_csv(os.path.join(bb.RAW, key + ".csv.gz"), usecols=C[:3], low_memory=False)
    m = a.merge(b, on="id", suffixes=("_a", "_b"))
    m["market"] = key
    rows.append(m)
d = pd.concat(rows, ignore_index=True)
d = d[(d.number_of_reviews_a >= 1)].dropna(subset=["review_scores_rating_a"])

# Fit shrinkage on the 2025 snapshot only (no peeking at the future)
prev = d.rename(columns={"number_of_reviews_a": "number_of_reviews", "review_scores_rating_a": "review_scores_rating"})
k_fit, *_ = bb.fit_shrinkage(prev, "review_scores_rating")
k = bb.K
print(f"variance-fit k on 2025 snapshot: {k_fit:.1f}; scoring with k = {k}")
d["mu"] = d.groupby("market").review_scores_rating_a.transform("mean")
d["shrunk"] = bb.shrink(d.review_scores_rating_a, d.number_of_reviews_a, d.mu, k)

dn = d.number_of_reviews_b - d.number_of_reviews_a
d["new_avg"] = (d.review_scores_rating_b * d.number_of_reviews_b - d.review_scores_rating_a * d.number_of_reviews_a) / dn
ok = (dn >= 10) & (dn >= 0.3 * d.number_of_reviews_a) & d.review_scores_rating_b.notna()
t = d[ok].copy()
t["new_avg"] = t.new_avg.clip(1, 5)
print(f"\nOutcome 1 — new reviews' average stars ({len(t):,} listings with 10+ new reviews)")
print(f"{'reviews in 2025':16s} {'n':>7s}  {'RMSE raw':>9s} {'RMSE grade':>10s}  {'rank corr raw':>13s} {'grade':>6s}")
for lo, hi in [(1, 5), (5, 20), (20, 60), (60, 10**6), (1, 10**6)]:
    s = t[(t.number_of_reviews_a >= lo) & (t.number_of_reviews_a < hi)]
    e_raw = np.sqrt(((s.review_scores_rating_a - s.new_avg) ** 2).mean())
    e_shr = np.sqrt(((s.shrunk - s.new_avg) ** 2).mean())
    c_raw = spearmanr(s.review_scores_rating_a, s.new_avg).statistic
    c_shr = spearmanr(s.shrunk, s.new_avg).statistic
    label = f"{lo}-{hi - 1}" if hi < 10**5 else (f"{lo}+" )
    print(f"{label:16s} {len(s):7,}  {e_raw:9.3f} {e_shr:10.3f}  {c_raw:13.3f} {c_shr:6.3f}")

# Outcome 2: complaint words in reviews written after the 2025 snapshot
rev = []
for f in glob.glob(os.path.join(bb.RAW, "iab_rev_*.csv.gz")):
    r = pd.read_csv(f, usecols=["listing_id", "date", "comments"]).dropna()
    r["neg"] = r.comments.str.contains(NEG)
    rev.append(r[["listing_id", "date", "neg"]])
r = pd.concat(rev).merge(d[["id", "last_scraped"]], left_on="listing_id", right_on="id")
r = r[r.date > r.last_scraped]
g = r.groupby("listing_id").neg.agg(["mean", "size"])
x = d.merge(g, left_on="id", right_index=True)
x = x[x["size"] >= 5]
print(f"\nOutcome 2 — complaint share in later reviews ({len(x):,} listings with 5+ later reviews)")
print("rank correlation (more negative = better):")
for lo, hi in [(1, 5), (5, 20), (20, 60), (60, 10**6), (1, 10**6)]:
    s = x[(x.number_of_reviews_a >= lo) & (x.number_of_reviews_a < hi)]
    label = f"{lo}-{hi - 1}" if hi < 10**5 else f"{lo}+"
    print(f"  {label:8s} n={len(s):6,}  raw {spearmanr(s.review_scores_rating_a, s['mean']).statistic:+.3f}   grade {spearmanr(s.shrunk, s['mean']).statistic:+.3f}")
