# Ri Happy demo

A working toy storefront, an Android app and the Dengage panel assets behind
them, built for one sales conversation on 24 August 2026.

**Live storefront:** https://dengage-presales.github.io/rh-demo/

## What this demonstrates

Ri Happy fulfils every online order from a physical shop rather than a central
warehouse. So whether a toy is available is a fact about a **pair**, this product
at that shop, and it changes with the customer's postcode. Two capabilities
follow from that, and both are what this demo exists to show.

**Store level inventory personalisation.** A customer gives a postcode. The shop
that would actually serve them is resolved, and from that moment the storefront,
the email and the push all show what that shop can hand over. When the thing they
wanted is not there, a similar toy that is there gets offered in its place, and
the substitution is labelled rather than slipped in.

**Proximity activation.** Walking near a shop triggers a message composed at that
moment, naming that shop, opening on that shop's shelves.

## How it is put together

```
storefront (GitHub Pages)  ─┐
Dengage email at send time  ├─→  rh_offer  ─→  Supabase (our copy of the data)
Android app on push tap     ─┘
```

One question, one answer, three channels. `rh_offer` resolves a postcode to a
shop, reports what that shop holds, and picks the substitute. Nothing at demo
time talks to Ri Happy's own systems: their catalogue and availability are
captured beforehand by `tools/capture.mjs` and committed, which is what makes the
demo repeatable and independent of anyone else's uptime.

## Layout

| Path | What it is |
|---|---|
| `web/` | the storefront. Published at the root of the site |
| `android/` | the Kotlin app that receives the geofence push |
| `supabase/` | the tables and the `rh_offer` function, as applied |
| `tools/` | capture and build scripts. Run before a demo, never during one |
| `data/` | the committed catalogue, stores and availability snapshots |
| `panel/` | paste ready assets for whoever sets up the Dengage panel |
| `docs/` | run of show, speaker notes, architecture |

## Running the storefront locally

```bash
cd web && python3 -m http.server 8200
# http://localhost:8200/
```

Add `?debug=1` to any page to see every event the page sends, which is the
fastest way to answer "did that button do anything".

## Rules this project keeps

The storefront carries the Dengage logo, never Ri Happy's. Their product names,
photographs, prices and categories are real and used as they are; their brand
identity is not borrowed.

No number is invented. Availability is a state, in stock or not at this shop,
because their checkout publishes which shops hold a product and never how many
are on the shelf. Nothing here shows a unit count, and a price with no source is
omitted rather than defaulted to zero.

No credential is committed. The publishable Supabase key is public by design and
confined by row level security; everything else lives outside this repository.
