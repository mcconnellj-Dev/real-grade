"""Write tests/fixtures/expected_grades.json: made-up listings (coordinates rounded to
0.01 degrees from real listing locations, random ratings and review counts) with the
adjusted score and market percentile Python computes against the full data, so the JS
tests can check the extension's lookup and math. No real listing is identifiable."""
import json, os
import numpy as np
import build_benchmarks as bb

rng = np.random.default_rng(7)
d = bb.load().dropna(subset=["review_scores_rating"])
d["mu"] = d.groupby("market").review_scores_rating.transform("mean")
d["adj"] = bb.shrink(d.review_scores_rating, d.number_of_reviews, d.mu, bb.K)
out = []
for m, g in d.groupby("market"):
    pts = g.sample(min(len(g), 8), random_state=7)
    for lat, lng in zip(pts.latitude, pts.longitude):
        rating = round(float(rng.choice([4.5, 4.7, 4.8, 4.85, 4.9, 4.95, 5.0])), 2)
        count = int(rng.choice([1, 3, 12, 40, 150, 400]))
        mu = float(g.mu.iloc[0])
        adj = (count * rating + bb.K * mu) / (count + bb.K)
        s = g.adj
        # same tie rule as the extension (grade.js TIE): values within 1.5e-4 count as equal
        tie = 1.5e-4
        emp = float((s < adj - tie).mean() + 0.5 * (np.abs(s - adj) <= tie).mean())
        out.append({"market": m, "lat": round(float(lat), 2), "lng": round(float(lng), 2), "overall": rating,
                    "count": count, "adjusted": round(adj, 4), "percentile": round(emp, 4)})
json.dump(out, open(os.path.join(bb.ROOT, "tests", "fixtures", "expected_grades.json"), "w"), indent=1)
print(f"wrote {len(out)} synthetic listings")
