# What rihappy.com.br already does when a product is unavailable

Read from the live site on 18 August 2026, from the server rendered PDP and
category pages. It matters because it decides what Use Case 1 can honestly claim
as new in front of the people who own that storefront.

**Read this before saying "and now the site can offer a substitute".** Part of
that already exists.

---

## 2. The product page already shows a shelf when the product is unavailable

**Yes, and it is purpose built rather than incidental.** Their product template
carries a block with this exact path:

```
store.product
  /flex-layout.row#product-main
    /flex-layout.col#product-main-col-2
      /unavailable-product-shelf
```

configured as:

```json
{ "message": "Produto indisponível", "blockClass": "unavailable-product-shelf" }
```

and its child list:

```json
{ "orderBy": "OrderByTopSaleDESC", "maxItems": 12 }
```

So an unavailable product page says "Produto indisponível" and shows twelve
other products underneath it.

**CORRECTED 18 August 2026, after seeing it rendered.** An earlier revision of
this file read `OrderByTopSaleDESC` and concluded the shelf was generic best
sellers, "the same twelve products for every visitor". That was wrong, and it
was wrong in the direction that would have embarrassed us in the room. Screenshots
of the live pages show the suggestions are clearly related to the product:

| Unavailable product | What they suggested |
|---|---|
| Mini Brands Magic Cook Kitchen | Mini Brands Fill The Fridge, same line |
| Mesa Para Jogo de Botão Sportv | Jogo Clássico Futebol de Botão, same game |

So the ordering is top sellers **within the product's own category**, not across
the shop. Their shelf is contextually relevant. Do not claim otherwise.

Their copy on it, verbatim:

> Poxa! O produto não está mais disponível... Confira abaixo nossas sugestões
> para você:

### So what is actually left, and it is one thing, and it is provable

**Their suggestion is not filtered by what the shop serving you can hand over.**

Measured through their own checkout simulation, on the exact pair a shopper in
Porto Alegre sees:

| | Porto Alegre `90010150` | Sao Paulo `01310100` |
|---|---|---|
| Magic Cook, the toy wanted | `withoutStock`, 0 pickup options | `available`, 5 pickup options |
| Fill The Fridge, **their suggestion** | `available`, **0 pickup options** | `available`, 3 pickup options |

Read the middle cell twice. In Porto Alegre their own suggestion is deliverable
and **cannot be collected from any shop serving that postcode.** The page answers
a store level problem with a delivery.

That is the whole argument, and it is now narrow, specific and true:

| Their shelf today | Use Case 1 |
|---|---|
| Top sellers in the same category | The toy they actually looked at |
| Not checked against the serving shop | Filtered to what that shop can hand over |
| No collection promise | "Collect at Ri Happy Praia de Belas Prime Offices" |
| On the page, if they come back | In an email, sent because they did not |

Two of those four rows are new since the correction. The first row is theirs and
it is good work, so say so.

---

## 1. Unavailable products still appear in listings

**Yes, on the evidence available.** Their category template sets

```json
"context": { "skusFilter": "FIRST_AVAILABLE", "maxItemsPerPage": 18 }
```

`FIRST_AVAILABLE` picks the first sellable SKU of a product where one exists. It
is a SKU choice, not a filter: it does not remove a product whose SKUs are all
unavailable.

`hideUnavailableItems: true` does appear on the page, but **only on the
search-not-found fallback shelf** (`search-not-found-layout`, collection 3754),
which is the shelf shown when a search returns nothing. It is not on the main
grid.

Supporting, from their own message bundle:

```
store/add-to-cart.label-unavailable            "Indisponível"
store/buyButton-label-unavailable              "Indisponível"
store/product-list.unavailableItems            "{quantity} produto(s) indisponíve(l|is)"
```

An "unavailable" state for the add to cart button only makes sense on a page
that renders for an unavailable product.

**Stated as strongly as the evidence allows and no more:** the first eighteen
products of the category read were all available, so this is read from the
template configuration rather than from an unavailable product observed in a
grid. Confirm it visually on a regionalised listing before quoting it as a fact
in the room.

---

## What their storefront does know about store level availability

Their zipcode component ships a badge with four states:

```
store/shipping-option-zipcode.availabilityBadge.deliveryAvailable    "Entrega disponível"
store/shipping-option-zipcode.availabilityBadge.deliveryUnavailable  "Entrega indisponível"
store/shipping-option-zipcode.availabilityBadge.pickupUnavailable    "Recolha indisponível"
store/shipping-option-zipcode.locationModal.noPickupsState.title     "Loja indisponível na região"
```

So the site already tells a shopper that a shop cannot supply. What it does not
do is act on it afterwards, and that is the gap Use Case 1 fills.

---

## How this was read, and its one limit

`curl --compressed` against the live PDP and category pages, then the VTEX IO
block tree and message bundle out of the server rendered HTML. The regionalised
seller list per postcode came from
`/api/checkout/pub/regions/?country=BRA&postalCode=...`, which returns the
individual store sellers for a postcode: eight for `90010150`, fifteen for
`01310100`.

**No screenshots.** A headless browser cannot reach rihappy.com.br from the
build environment: every navigation ends in `ERR_CONNECTION_RESET` while `curl`
to the same URL returns 200. The evidence above is the page's own configuration
rather than a picture of it, which is stronger for the block tree and weaker for
anything that depends on what a specific product renders.
