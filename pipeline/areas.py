"""County-level area profile from the Census: share of homes held for seasonal or
vacation use (ACS 2022 5-year, B25004_006 / B25001) and housing density.
Used to pick a benchmark for places outside the 34 covered markets."""
import os
import numpy as np, pandas as pd

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CEN = os.path.join(ROOT, "data", "raw", "census")


def counties():
    g = pd.read_csv(os.path.join(CEN, "2023_Gaz_counties_national.txt"), sep="\t", dtype={"GEOID": str})
    g.columns = [c.strip() for c in g.columns]
    vac = pd.read_csv(os.path.join(CEN, "acs_b25004.dat"), sep="|", usecols=["GEO_ID", "B25004_E006"])
    tot = pd.read_csv(os.path.join(CEN, "acs_b25001.dat"), sep="|", usecols=["GEO_ID", "B25001_E001"])
    a = vac.merge(tot, on="GEO_ID")
    a = a[a.GEO_ID.str.startswith("0500000US")]
    a["GEOID"] = a.GEO_ID.str[-5:]
    c = g.merge(a, on="GEOID")
    c["seasonal"] = c.B25004_E006 / c.B25001_E001.clip(lower=1)
    c["density"] = c.B25001_E001 / (c.ALAND_SQMI.clip(lower=0.1))  # homes per sq mi
    return c.rename(columns={"INTPTLAT": "lat", "INTPTLONG": "lng"})[["GEOID", "NAME", "USPS", "lat", "lng", "seasonal", "density"]]


def area_type(seasonal, density):
    """Vacation-heavy places first, then by how built-up they are."""
    s = np.asarray(seasonal); d = np.asarray(density)
    return np.select([s >= 0.25, s >= 0.08, d >= 1500, d >= 150],
                     ["resort", "vacation", "urban", "suburban"], "rural")


def nearest_county(lat, lng, c):
    """Nearest county centroid (longitude scaled by latitude)."""
    from scipy.spatial import cKDTree
    k = np.cos(np.radians(38))
    tree = cKDTree(np.c_[c.lat.values, c.lng.values * k])
    _, i = tree.query(np.c_[lat, np.asarray(lng) * k])
    return c.iloc[i].reset_index(drop=True)
