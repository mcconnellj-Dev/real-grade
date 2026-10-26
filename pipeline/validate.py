"""Check that Real Grade scores track review complaints better than raw stars.

Outcome: share of a listing's reviews containing complaint keywords (8 markets
with review text). Higher-graded listings should have fewer complaints.
"""
import glob, json, os, re
import numpy as np, pandas as pd
from scipy.stats import spearmanr
import build_benchmarks as bb

NEG = re.compile(r"\b(dirty|filthy|disappoint\w*|not clean|wasn'?t clean|smell\w*|stain\w*|cockroach\w*|roach\w*|bed ?bugs?|mold|broken|misleading|not as (?:described|pictured)|would not (?:stay|recommend)|wouldn'?t (?:stay|recommend)|do not recommend|don'?t recommend|unsafe|noisy|refund)\b", re.I)


def main():
    fit = json.load(open(os.path.join(bb.OUT, "fit.json")))
    d = bb.load()
    k = fit["overall"]["k"]
    d["mu"] = d.groupby("market").review_scores_rating.transform("mean")
    d["shrunk"] = bb.shrink(d.review_scores_rating, d.number_of_reviews, d.mu, k)
    d["pct"] = d.groupby("market").shrunk.rank(pct=True)
    d["raw_pct"] = d.groupby("market").review_scores_rating.rank(pct=True)
    rev = []
    for f in glob.glob(os.path.join(bb.RAW, "iab_rev_*.csv.gz")):
        r = pd.read_csv(f, usecols=["listing_id", "comments"]).dropna()
        r["neg"] = r.comments.str.contains(NEG)
        rev.append(r.groupby("listing_id").neg.agg(["mean", "size"]))
    c = pd.concat(rev)
    x = d.merge(c, left_on="id", right_index=True).dropna(subset=["review_scores_rating"])
    x = x[x["size"] >= 5]
    print(f"listings with 5+ text reviews in 8 markets: {len(x):,}")
    print("Spearman with complaint share (more negative = better at spotting problems):")
    for lo, hi in [(5, 20), (20, 100), (100, 10**6), (5, 10**6)]:
        s = x[(x.number_of_reviews >= lo) & (x.number_of_reviews < hi)]
        a = spearmanr(s.review_scores_rating, s["mean"]).statistic
        b = spearmanr(s.raw_pct, s["mean"]).statistic
        g = spearmanr(s.pct, s["mean"]).statistic
        print(f"  reviews {lo:>3}-{'' if hi > 10**5 else hi:<4} n={len(s):6,}  raw stars {a:+.3f}  raw pct-in-market {b:+.3f}  Real Grade pct {g:+.3f}")
    # Grade bands vs complaint rate
    cut = [0, .10, .20, .30, .40, .50, .60, .70, .80, .90, .97, 1.0001]
    lab = ["F", "D", "C-", "C", "C+", "B-", "B", "B+", "A-", "A", "A+"]
    x["grade"] = pd.cut(x.pct, cut, labels=lab, right=False)
    print("\ncomplaint share by Real Grade:")
    print((x.groupby("grade", observed=True)["mean"].mean() * 100).round(2).to_string())


if __name__ == "__main__":
    main()
