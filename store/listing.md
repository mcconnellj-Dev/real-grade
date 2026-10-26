# Chrome Web Store listing

**Name:** Real Grade: vacation rental ratings

**Summary (132 max):** See how a rental really ranks in its area: ratings adjusted for review count, red flags, and price in context. Works on Airbnb.com.

**Category:** Shopping (alt: Travel)

**Description:**

Almost every vacation rental is rated 4.8 stars or higher, so the stars barely tell
them apart. Real Grade shows where a place actually ranks.

• Rank in its area: "Top 20%" or "Bottom 15%" of comparable listings, adjusted so a
  5.0 from 3 reviews doesn't beat a 4.93 from 300.
• Works in vacation towns: in places outside our data it estimates from the search
  you're browsing, corrected for top-rated places being listed first, and shows a range.
• Ranks on search results: a badge next to the stars on every result.
• Weak spots: the sub-score (cleanliness, accuracy, value...) that lags the area.
• Review red flags: bugs, noise, broken things, "not as pictured", flagged only when
  they show up far more than usual. One tap scans every review.
• Price in context: per-night price against similar places in your own search, on
  your dates, with a call-out for top-rated bargains.

Everything runs in your browser. No account, no tracking, nothing sent anywhere.

Works on Airbnb.com. Real Grade is an independent project and is not affiliated with
or endorsed by Airbnb. Market benchmarks are derived from Inside Airbnb data (CC BY 4.0).

**Single purpose:** Show how a vacation rental listing's ratings compare with similar
listings in its area while the user browses airbnb.com.

**Permission justifications:**
- `storage`: keeps the user's recent searches on their own device so a listing can be
  compared with the other places in the same search, and remembers whether the card is
  minimized.
- Host access to `https://www.airbnb.com/*` (content script): reads the ratings, prices
  and reviews on the pages the user opens and displays the rank card and badges.

**Data usage disclosures:** Does not collect or transmit user data. Website content is
read locally to display results and is not sent anywhere. Not sold, not used for
unrelated purposes, not used for creditworthiness or lending.

**Privacy policy URL:** https://mcconnelldigital.com/realgrade/privacy (publish PRIVACY.md there)

**Assets still needed:** 128px icon (have), at least one 1280x800 screenshot, optional
440x280 promo tile.
