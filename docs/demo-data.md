# The data the demo runs on, and the scenes it supports

Captured from Ri Happy's own public storefront on 16 August 2026. Nothing here
is invented and nothing is refreshed during a session.

## Coverage

200 products across 42 subcategories and 9 departments, ages from a few months
to teenage. 215 shops, of which 137 were named by their checkout as able to
fulfil and 78 are on their published list but never named, so they appear on the
map and make no availability claim. 27,400 product and shop pairs, 11,175 of
them available.

## The gradient, which is the demo

Availability per city, out of 200 products, measured against their own checkout:

| City | Reachable | Shops | City | Reachable | Shops |
|---|---|---|---|---|---|
| Sao Paulo | 172 | 38 | Sao Luis | 158 | 3 |
| Rio de Janeiro | 168 | 20 | Porto Alegre | 157 | 4 |
| Fortaleza | 164 | 12 | Goiania | 157 | 4 |
| Campinas | 163 | 5 | Florianopolis | 156 | 3 |
| Recife | 162 | 7 | Belem | 154 | 3 |
| Belo Horizonte | 161 | 10 | Teresina | 153 | 2 |
| Brasilia | 161 | 5 | Manaus | 152 | 3 |
| Curitiba | 160 | 4 | Campo Grande | 144 | 2 |
| Salvador | 159 | 7 | Maceio | 142 | 3 |
| Natal | 159 | 1 | Cuiaba | 137 | 2 |
| | | | Vitoria | 116 | 0 |
| | | | Rio Branco | 0 | 0 |

An executive can type almost any major Brazilian postcode in the room and get a
truthful answer, rather than one of three rehearsed cities.

## The three states, and what each one is for

| Postcode | Answer | Why it matters |
|---|---|---|
| 01310-100 Sao Paulo | a shop, 37 serving | the normal case, richest availability |
| 90010-150 Porto Alegre | a shop, 4 serving | scarcity: the same toy is often not there |
| 29010-000 Vitoria | no collection point | 116 products can reach the city, no shop can hand one over |
| 69900-000 Rio Branco | no collection point | Ri Happy has a branch there and online fulfilment reaches none of it |
| anything unrecognised | unknown postcode | shown without any collection promise |

**Vitoria and Rio Branco are different situations and the copy is careful about
it.** Our data models collection specifically, so the wording says no collection
point rather than no shop. Saying "no shop serves you" would be wrong in Vitoria,
where delivery works.

## The hero for the two contact email scene

Chosen from the data rather than picked in advance, by asking which products are
available at the shop a Sao Paulo postcode resolves to, absent at the Porto
Alegre one, and have a same franchise replacement Porto Alegre genuinely holds.

**Primary: `100184971`, Boneco Articulado Disney Marvel Homem Aranha Titan Hero,
R$ 99.99.** Porto Alegre offers the Amazing Spider-Man figure instead: same
franchise, same shelf, close price. It is the most convincing substitution in
the set because a parent would accept it without complaint.

Alternatives held in reserve, all verified the same way:

| SKU | Hero | Porto Alegre offers |
|---|---|---|
| 1002909752 | Funko Pop McLaren Ayrton Senna, R$ 199.99 | Funko Pop K-Pop Zoey |
| 1002794399 | Patrulha Canina backpack, R$ 109.99 | Patrulha Canina musical toy |
| 1003055382 | Sonic handheld game, R$ 86.99 | Sonic laptop toy |
| 100354084 | Hot Wheels skateboard, R$ 399.99 | Hot Wheels adjustable skates |

The Senna one is the strongest emotionally for a Brazilian room, and the
Spider-Man one is the strongest logically. Either works; the substitution rule
picks the replacement itself in both cases.
