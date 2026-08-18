package com.dengageecomm.demo

/* ============================================================================
   The shapes this app reads, and nothing it invents.

   Both come from surfaces the web storefront already publishes and consumes:
   products.json for the catalogue and the rh_offer answer for the shop, its
   stock map and the substitute. The field names below are that contract's,
   not this app's, so a change on the web side is a change here too and
   android/README.md says where each one is produced.

   Prices are nullable ON PURPOSE. A price the capture did not produce stays
   null and every consumer renders around the gap, because a zero standing in
   for unknown is the exact bug the omission rule exists to keep out of the
   shared tables.
   ========================================================================== */

data class Product(
    val id: String,
    val name: String,
    val brand: String?,
    val licence: String?,
    val department: String?,
    val category: String?,
    val categoryPath: String,
    val price: Double?,
    val listPrice: Double?,
    val ageDisplay: String?,
    /* Relative to the published demo site, for example img/products/1234.jpg.
       StoreRepository.imageUrl turns it absolute. */
    val image: String?
)

data class Catalogue(
    val capturedAt: String?,
    val departments: List<String>,
    val products: List<Product>
)

data class Store(
    val id: String,
    val name: String,
    val city: String?
)

/* One item from the offers list or the substitute slot. Same shape either
   way, because rh_offer builds them from the same query. */
data class OfferItem(
    val skuId: String,
    val name: String,
    val brand: String?,
    val price: Double?,
    val listPrice: Double?,
    val imageUrl: String?,
    val pageUrl: String?
)

/* The storefront shaped answer: a resolved shop, the stock map that badges
   every tile, and the substitute when the asked-for toy is not available.
   `servedFrom` says whether the live endpoint or a stored answer produced it,
   which the debug screen reports, because a fallback that cannot be seen is a
   fallback nobody rehearses. */
data class StoreAnswer(
    val ok: Boolean,
    val resolved: String?,
    val cep: String?,
    val store: Store?,
    /* sku id to state, "available" or "withoutStock". A sku absent from the
       map was not captured for this shop, and absence renders as silence,
       never as a claim either way. */
    val stock: Map<String, String>,
    val substitute: OfferItem?,
    val substituteReason: String?,
    val offers: List<OfferItem>,
    val servedFrom: String
)
