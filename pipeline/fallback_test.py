"""Hold out each covered market and grade it as if it were uncovered.

Compares benchmarks for a place we have no data for: the pooled US data, other
listings in the same kind of area (Census seasonal-home share and density, see
areas.py), and the nearest covered markets. Error is the mean absolute gap, in
percentile points, from the listing's true percentile within its own market."""
import numpy as np, pandas as pd
import areas, build_benchmarks as bb


def miles(a, b):
    la1, lo1 = np.radians(a); la2, lo2 = np.radians(b)
    return 3959 * np.arccos(np.clip(np.sin(la1) * np.sin(la2) + np.cos(la1) * np.cos(la2) * np.cos(lo1 - lo2), -1, 1))


def main():
    d = bb.load().dropna(subset=["review_scores_rating"])
    c = areas.counties()
    cc = areas.nearest_county(d.latitude.values, d.longitude.values, c)
    d["type"] = areas.area_type(cc.seasonal.values, cc.density.values)
    mk = d.groupby("market")[["latitude", "longitude"]].median()
    rows = []
    for m in mk.index:
        test, others = d[d.market == m], d[d.market != m]
        truth = bb.shrink(test.review_scores_rating, test.number_of_reviews, test.review_scores_rating.mean(), bb.K).rank(pct=True)
        t10 = test.number_of_reviews >= 10

        def score(pool):
            mu = pool.review_scores_rating.mean()
            q = np.quantile(bb.shrink(pool.review_scores_rating, pool.number_of_reviews, mu, bb.K), np.linspace(0, 1, 101))
            p = np.interp(bb.shrink(test.review_scores_rating, test.number_of_reviews, mu, bb.K), q, np.linspace(0, 1, 101))
            return np.abs(p - truth)[t10].mean() * 100

        dist = pd.Series({o: miles(mk.loc[m].values, mk.loc[o].values) for o in mk.index if o != m}).sort_values()
        rows.append({"market": m, "nearest_miles": round(dist.iloc[0]),
                     "us_pool": score(others),
                     "same_area_type": score(others[others.type == test.type.mode()[0]]),
                     "nearest_market": score(others[others.market == dist.index[0]]),
                     "nearest_3": score(others[others.market.isin(dist.index[:3])])})
    r = pd.DataFrame(rows).set_index("market").sort_values("nearest_miles")
    print(r.round(1).to_string())
    print("\nmean error (percentile points):")
    print(r.drop(columns="nearest_miles").mean().round(2).to_string())
    near = r[r.nearest_miles <= bb.FALLBACK_MILES]
    print(f"\nwithin {bb.FALLBACK_MILES} mi ({len(near)} markets): nearest {near.nearest_market.mean():.2f} vs US pool {near.us_pool.mean():.2f}")


if __name__ == "__main__":
    main()
