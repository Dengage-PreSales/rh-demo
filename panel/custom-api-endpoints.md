# Custom API endpoints to create in the panel

**Settings > Custom API Endpoints > New**, once each. Nothing else in the panel
depends on these being right, and everything on the email and push side does.

Create all three. They are a ladder: the first proves the plumbing with nothing
that can go wrong, the second is the one the real email uses, the third is the
standby if Supabase is ever slow or unreachable during the session.

---

## 1. `rh_offer_fixed` — the plumbing test, no parameters

| Field | Value |
|---|---|
| **Name** | `rh_offer_fixed` |
| **Method** | `GET` |
| **Url** | `https://raextqlludkagdntyzwn.supabase.co/rest/v1/rpc/rh_offer?cep=01310-100&n=4&apikey=sb_publishable_HcLAWb6E5Gn_d5vVTjPB_Q_zkjklifK` |
| **Headers** | none |

Everything is baked in, so if this one does not work in an email the problem is
the endpoint feature itself rather than anything we wrote.

---

## 2. `rh_offer` — the one the real email uses

| Field | Value |
|---|---|
| **Name** | `rh_offer` |
| **Method** | `GET` |
| **Url** | `https://raextqlludkagdntyzwn.supabase.co/rest/v1/rpc/rh_offer?cep=$$param(1)&sku=$$param(2)&n=$$param(3)&apikey=sb_publishable_HcLAWb6E5Gn_d5vVTjPB_Q_zkjklifK` |
| **Headers** | none |

Called as `$CustomApi.rh_offer(cep, sku, count)`.

- **param 1, cep**: the customer's postcode. Punctuation is ignored, so
  `01310-100` and `01310100` behave the same.
- **param 2, sku**: the product the message is about, or empty for none.
- **param 3, count**: how many suggestions to return. Empty means four.

---

## 3. `rh_offer_static` — the standby

| Field | Value |
|---|---|
| **Name** | `rh_offer_static` |
| **Method** | `GET` |
| **Url** | `https://dengage-presales.github.io/rh-demo/fallback/offer-$$param(1).json` |
| **Headers** | none |

Called as `$CustomApi.rh_offer_static(cep)` with the **eight digits and no dash**,
for example `01310100`. It answers from a file published on our own site with
exactly the same shape as the live endpoint, so switching to it is a one word
edit in the email and nothing else changes.

---

## Two things that were checked rather than assumed

**The key is in the URL on purpose.** It also works as an `apikey` header, and
both were tested on 16 August 2026. It is in the URL so that nothing depends on
the panel's Headers field behaving, which is one fewer thing to debug on the day.

This key is Supabase's publishable key. It is public by design, row level
security confines it to reading four tables, and it can write nothing. A request
with no key at all is refused with 401, which was also tested.

**A blank parameter cannot break a send.** Every parameter is text and is parsed
defensively at the database end. This was a real fault: with a numeric parameter,
an empty `n=` answered `400 invalid input syntax for type integer`, which inside
an email means the whole call fails and the message goes out empty or not at all.
Every one of these now returns ordinary JSON with `ok` true:

```
cep=01310-100&sku=&n=            a marketer left two fields empty
cep=&sku=&n=                     all three empty
cep=01310-100&n=abc              something not a number in the count
cep=$Contact.cep&n=4             a merge tag that did not resolve
```

That last one is the important one. If the postcode tag is wrong, the email
still renders and simply shows no availability, rather than failing to send.

---

## What the endpoint answers

The response is the JSON object itself, not wrapped in an array, so
`$CustomApi.rh_offer(...)` can be used directly.

```json
{
  "ok": true,
  "resolved": "store",
  "cep": "01310100",
  "region": "Sao Paulo",
  "store":  { "id": "sp-augusta", "name": "Ri Happy Augusta", "mall": "...", "lat": -23.5, "lng": -46.6 },
  "stores": [ { "id": "...", "name": "..." } ],
  "storeCount": 11,
  "hero":       { "sku_id": "...", "name": "...", "price": 213.99, "image_url": "...", "page_url": "...", "available": false },
  "substitute": { "sku_id": "...", "name": "...", "price": 222.99, "image_url": "...", "page_url": "..." },
  "substituteReason": "same_licence",
  "offers": [ "...same shape as substitute..." ],
  "stock": { "1003137934": "withoutStock", "1002800281": "available" },
  "generatedAt": "2026-08-16T13:12:10Z"
}
```

`resolved` is the field to branch on, and it has exactly three values:

| `resolved` | Means | What a message should say |
|---|---|---|
| `store` | a shop serves this postcode | name it, and show what it has |
| `no_store` | the area is known, no shop reaches it | show products, promise nothing about availability |
| `unknown_cep` | the postcode did not resolve | same, and never name a shop |

`hero.available` is only ever true when we hold a captured answer saying so.
Unknown is treated as not available, never the other way round.

---

## 4. `rh_ping` — fault isolation only

| Field | Value |
|---|---|
| **Name** | `rh_ping` |
| **Method** | `GET` |
| **Url** | `https://raextqlludkagdntyzwn.supabase.co/rest/v1/rpc/rh_ping?apikey=sb_publishable_HcLAWb6E5Gn_d5vVTjPB_Q_zkjklifK` |
| **Headers** | none |

Returns 26 bytes and nothing else. It exists so that a failure cannot be blamed
on the size of the response.

---

## 5. `rh_email` — the one messages should actually use

| Field | Value |
|---|---|
| **Name** | `rh_email` |
| **Method** | `GET` |
| **Url** | `https://raextqlludkagdntyzwn.supabase.co/rest/v1/rpc/rh_email?cep=$$param(1)&sku=$$param(2)&n=$$param(3)&apikey=sb_publishable_HcLAWb6E5Gn_d5vVTjPB_Q_zkjklifK` |
| **Headers** | none |

Called as `$CustomApi.rh_email(cep, sku, count)`, the same three parameters as
`rh_offer`.

**Why a second endpoint rather than reusing `rh_offer`.** `rh_offer` answers the
storefront, which wants one call to paint every tile, so it carries the
availability of all 200 products at the shop plus the full shop list. That is
12.7 kilobytes, of which **83 percent is data a message never reads**, and it is
fetched once per recipient at send time. `rh_email` runs the same resolution and
the same substitution and returns about 2 kilobytes.

Measured on 16 August 2026:

| | Bytes |
|---|---|
| `rh_offer`, what the first diagnostic called | 12,690 |
| `rh_email`, Sao Paulo | 1,959 |
| `rh_email`, Porto Alegre with a substitution | 2,388 |
| `rh_ping` | 26 |

What it returns, flattened so a message can read it without digging:

```json
{
  "ok": true,
  "resolved": "store",
  "cep": "01310100",
  "region": "Sao Paulo",
  "storeName": "PBKIDS SHOPPING ELDORADO - Loja Parceira",
  "storeId": "sp-pb-eldorado",
  "storeCount": 37,
  "hero":       { "sku_id": "100184971", "name": "...", "price": 99.99, "image_url": "...", "page_url": "...", "available": true },
  "substitute": { "sku_id": "...", "name": "...", "price": 87.99, "image_url": "...", "page_url": "..." },
  "substituteReason": "same_licence",
  "offers": [ "...three of them..." ],
  "generatedAt": "2026-08-16T14:05:00Z"
}
```

**The two contact scene, verified against live data.** One campaign, the same
Spider-Man figure, two postcodes:

| | Sao Paulo 01310-100 | Porto Alegre 90010-150 |
|---|---|---|
| shop | PBKIDS Shopping Eldorado | Ri Happy Praia de Belas |
| hero available | **true** | **false** |
| offered instead | nothing needed | **Amazing Spider-Man figure** |
| reason | | `same_licence` |
