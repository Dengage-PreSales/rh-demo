# The timeout experiment. Do this before anything else is built on the email.

## What this settles

Two things are currently assumed rather than proven, and everything about the
Use Case 1 email depends on both.

**1. Does the Custom API feature work at all with our endpoints?** We have never
seen one of ours succeed. `rh_offer_fixed` timed out; `rh_ping` and `rh_email`
reported themselves missing because they had not been created yet. The only
endpoint known to work in this account is the pre-existing `thy_product`.

**2. Is the cause really the distance to Tokyo?** Measured from a build machine,
a Supabase call takes 0.8 to 1.7 seconds even when the function does nothing,
while our own site answers in about 0.2 seconds. From that I concluded Dengage
is further still and moved the email onto pre-rendered files. **That conclusion
was never tested from Dengage's side**, and acting on it was the wrong call.
This experiment tests it properly.

## What I found while building it, which changes the design

**Supabase refuses its own long queries at about three seconds.** Asking for a
five second delay returns `57014 canceling statement due to statement timeout`
after 4.4 seconds, and even three and four seconds are refused. So a five second
rung is impossible on our side and the ladder is re-spaced.

This is worth knowing on its own: **no live Supabase call can ever take more
than about three seconds**, whatever Dengage allows. Our real query uses about
half a second of that, so there is room, but the ceiling is fixed.

Measured from the build machine, which is the baseline Dengage will differ from:

| Endpoint | Server work | Total | Note |
|---|---|---|---|
| our own site | none | **0.20 s** | the control |
| `rh_sleep(0)` | 0.001 s | **1.65 s** | so the trip itself costs about 1.6 s |
| `rh_sleep(1)` | 1.0 s | about 2.6 s | |
| `rh_sleep(2)` | 2.0 s | **2.92 s** | close to the Supabase ceiling |
| `rh_sleep(3)` | refused | 4.12 s | Supabase kills it |

## Create these four endpoints

Settings, Custom API Endpoints, New, once each. No headers on any of them.

| Name | Method | Url |
|---|---|---|
| `rh_cdn_ping` | GET | `https://dengage-presales.github.io/rh-demo/offer/default.json` |
| `rh_sleep_0` | GET | `https://raextqlludkagdntyzwn.supabase.co/rest/v1/rpc/rh_sleep?seconds=0&apikey=sb_publishable_HcLAWb6E5Gn_d5vVTjPB_Q_zkjklifK` |
| `rh_sleep_1` | GET | `https://raextqlludkagdntyzwn.supabase.co/rest/v1/rpc/rh_sleep?seconds=1&apikey=sb_publishable_HcLAWb6E5Gn_d5vVTjPB_Q_zkjklifK` |
| `rh_sleep_2` | GET | `https://raextqlludkagdntyzwn.supabase.co/rest/v1/rpc/rh_sleep?seconds=2&apikey=sb_publishable_HcLAWb6E5Gn_d5vVTjPB_Q_zkjklifK` |

Then paste `timeout-experiment.html` into Content, Email, Code Editor, and send
it to yourself once. Send me the screenshot.

## How to read the result

Each row prints either an answer or the actual error text. The pattern tells us
which world we are in.

| What comes back | What it means | What we do |
|---|---|---|
| CDN works, `sleep_0` works, `sleep_1` or `sleep_2` fails | Dengage's budget sits between those two. Supabase at about 1.6 s fits inside it | **Put the email back on live Supabase.** The pre-rendered files are never used, and the stock flip works in email too |
| CDN works, **every** sleep fails including `sleep_0` | Supabase is unreachable from Dengage for a reason other than duration: egress rules, address filtering, TLS. The distance theory is wrong | Stop and investigate before trusting anything. Do not assume pre-rendering is the answer |
| CDN also fails | The feature does not work with our endpoints at all, only with ones created earlier | Escalate to the product team with this evidence. Everything downstream is blocked |
| Everything works | The original timeout was transient | Live Supabase, and I owe you an apology for moving off it on one data point |

The most likely useful outcome is the first, and it decides whether the files in
`web/offer/` are a justified cache or a fix for a problem we never had.

## Why this matters beyond one email

If live Supabase is viable from Dengage, then the mid-call stock flip shows up in
the email as well as on the storefront, and the demo has one honest live path
rather than two different ones. That is worth ten minutes of your time to find
out properly.
