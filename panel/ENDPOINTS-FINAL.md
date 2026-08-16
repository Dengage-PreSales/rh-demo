# The endpoints to use. Replace the earlier three with these.

Diagnostic 2 settled it. `rh_offer_fixed` did not report itself missing, it
reported **`The request timed out`**, while `rh_ping` and `rh_email` correctly
reported that they did not exist yet. That separated the two possible faults
cleanly and pointed at the real one.

## Why the first attempt timed out

Not the size of the answer. The distance to it.

| Called from here | Answer | Time |
|---|---|---|
| Supabase `rh_ping`, 26 bytes | Tokyo | 0.79 to 1.43 s |
| Supabase `rh_email`, 2 KB | Tokyo | 0.97 s |
| Supabase `rh_offer`, 12.7 KB | Tokyo | 0.90 to 1.72 s |
| **Our own site, 102 KB file** | **CDN edge** | **0.19 to 0.25 s** |

Even a function that does nothing takes about a second, so the cost is the trip
rather than the work. That Supabase project is in Tokyo, and every project on
the account is in Asia Pacific, so there is no nearer database to move to.
Dengage sends from further away than this machine, and its call gave up.

Our own site answers in about a fifth of a second from its edge network while
serving forty times more data. So that is where the message answers now live.

## Create this one endpoint

| Field | Value |
|---|---|
| **Name** | `rh_store_offer` |
| **Method** | `GET` |
| **Url** | `https://dengage-presales.github.io/rh-demo/offer/store/$$param(1).json` |
| **Headers** | none |

Called as `$CustomApi.rh_store_offer(shopId)`.

And this one, for a contact who carries a postcode rather than a shop:

| Field | Value |
|---|---|
| **Name** | `rh_cep_offer` |
| **Method** | `GET` |
| **Url** | `https://dengage-presales.github.io/rh-demo/offer/cep/$$param(1).json` |
| **Headers** | none |

Called as `$CustomApi.rh_cep_offer(postcode)` with **eight digits and no dash**.

The three earlier endpoints can stay. `rh_offer` and `rh_offer_fixed` are still
correct and are what the storefront uses; they are simply too far away to be
called from inside a send.

## Which contact field to use

The first diagnostic printed every attribute a contact carries. There is **no
postcode column**, so nothing is being left unused. There is `nearest_store`,
which is a better fit anyway: the storefront resolves a postcode to a shop, so
storing the resolved shop skips a step and removes a way to be wrong.

So set `nearest_store` on the demo contacts to a shop id from the table below,
and the email reads `$Contact.nearest_store`.

## The two contact scene, ready to use

Both files are published and were checked after publishing.

| | Contact A | Contact B |
|---|---|---|
| `nearest_store` | `sp-pb-eldorado` | `poa-barra-sul` |
| shop that answers | PBKIDS Shopping Eldorado | Ri Happy Baby Barra Shopping Sul |
| Spider-Man Titan Hero | **available** | **not available** |
| offered instead | nothing needed | **Amazing Spider-Man figure** |
| reason | | `same_licence` |
| file size | 1,844 bytes | 2,244 bytes |

One campaign, one block of content, two different emails. Of the 137 shops that
can fulfil, **93 cannot supply that figure**, and each of their files already
carries the replacement the substitution rule chose, so almost any shop id
produces a real substitution rather than a rehearsed one.

## What this changes about what we can claim, which is nothing

The message is still assembled per recipient at the moment of sending: Dengage
fetches this contact's shop while composing for this contact, and two contacts
get different content from one campaign.

What is a snapshot is the availability behind it. That was already true when the
call went to Supabase, because the availability itself was captured from Ri
Happy rather than read from them live. So the honest sentence on the day is
unchanged: **the assembly is live, the stock is as fresh as the last capture.**

The storefront still reads Supabase directly. A browser can afford the second,
and it gains a genuinely live read, which is what makes the stock flip scene
work on screen.

## Shop ids for the other cities

`web/offer/store/` in the repo holds one file per shop and the file name is the
id. A few useful ones:

| City | Shop id |
|---|---|
| Sao Paulo | `sp-pb-eldorado` |
| Porto Alegre | `poa-barra-sul`, `poa-praia-de-belas`, `poa-bourbon-carlos-gomes` |
| Rio de Janeiro | see `web/offer/store/rj-*.json` |
| Belem | `bel-boulevard-belem`, `bel-parque-belem` |

For a contact with no shop set, or a shop we hold nothing for, point the
endpoint at `https://dengage-presales.github.io/rh-demo/offer/default.json`,
which names no shop and makes no availability claim.
