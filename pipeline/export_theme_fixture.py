"""Write tests/fixtures/theme_parity.json: made-up review sentences with the themes
Python finds, so the JS test can confirm the extension matches them the same way."""
import itertools, json, os, re
import build_benchmarks as bb
from review_baselines import THEMES, mentions

PHRASES = {
    "cleanliness": ["the bathroom was dirty", "sheets were stained", "kitchen felt grimy", "there was hair in the shower"],
    "pests": ["we found a cockroach", "saw mice in the garage", "ants in the kitchen", "possible bed bugs"],
    "smell": ["a musty smell in the bedroom", "it smelled like smoke", "strong pet odor", "the couch stank"],
    "noise": ["the street noise was bad", "thin walls between units", "it was very loud at night", "could not sleep because of the bar"],
    "accuracy": ["not as pictured at all", "the photos were outdated", "smaller than the pictures", "nothing like the listing"],
    "maintenance": ["the dishwasher was broken", "the shower was leaking", "the TV did not work", "the sink was clogged"],
    "temperature": ["no AC in July", "the heater was broken", "too cold to sleep", "freezing inside all night"],
    "safety": ["did not feel safe walking back", "the area felt sketchy", "our car was broken into", "a bike was stolen"],
    "host": ["the host never responded", "the host was rude", "messages were unresponsive", "they cancelled on us"],
    "chores": ["so many chores at checkout", "we had to strip the beds", "a long checkout list", "we had to take out the trash"],
}
NEGATED = ["no stains anywhere", "not noisy at all", "never felt unsafe", "nothing was broken", "without any smell"]
NEUTRAL = ["Great stay overall.", "Lovely place and a great location.", "Would stay again.", "Check-in was easy."]

rows = []
for theme, phrases in PHRASES.items():
    for p, n in zip(phrases, itertools.cycle(NEUTRAL)):
        rows.append(f"{n} Only issue: {p}.")
for a, b in [("noise", "maintenance"), ("pests", "cleanliness"), ("smell", "accuracy"), ("temperature", "host")]:
    rows.append(f"{PHRASES[a][0].capitalize()}, and {PHRASES[b][1]}.")
rows += [f"{n} {x.capitalize()}." for n, x in zip(itertools.cycle(NEUTRAL), NEGATED)] + NEUTRAL

pats = {k: re.compile(v["pattern"], re.I) for k, v in THEMES.items()}
out = [{"text": t, "themes": sorted(k for k, p in pats.items() if mentions(t, p))} for t in rows]
json.dump(out, open(os.path.join(bb.ROOT, "tests", "fixtures", "theme_parity.json"), "w"), indent=1)
missed = [r["text"] for r in out[:40] if not r["themes"]]
print(f"wrote {len(out)} sentences; {sum(bool(r['themes']) for r in out)} with a theme; theme sentences missed by patterns: {missed}")
