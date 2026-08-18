package com.dengageecomm.demo

import android.content.Context
import android.content.SharedPreferences
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/* ============================================================================
   Everything this app reads, from the two places the web storefront reads.

   The catalogue comes from the published demo site's products.json, so the
   app and the storefront can never disagree about what is for sale. The shop
   answer comes from the same rh_offer endpoint the storefront calls, with the
   same fallback behind it: when the live call does not come back within the
   timeout, the pre-rendered answer for that postcode or shop is served from
   the site instead, marked so the debug screen can say which one was used. A
   sales conversation cannot wait on a network call, and a fallback that is
   not exercised the same way as the live path is not a fallback.

   The Supabase key here is the storefront's own anon key for a read-only
   endpoint, the same string every visitor's browser already carries.
   ========================================================================== */
class StoreRepository private constructor(private val prefs: SharedPreferences) {

    companion object {
        private const val PREFS = "rh_demo"
        const val KEY_CEP = "cep"
        const val KEY_STORE_ID = "store_id"
        const val KEY_STORE_NAME = "store_name"
        const val KEY_CONTACT = "contact_key"

        @Volatile private var instance: StoreRepository? = null
        fun get(context: Context): StoreRepository =
            instance ?: synchronized(this) {
                instance ?: StoreRepository(
                    context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                ).also { instance = it }
            }
    }

    /* The same quick-give-up budget the storefront uses. */
    private val http = OkHttpClient.Builder()
        .connectTimeout(3, TimeUnit.SECONDS)
        .readTimeout(4, TimeUnit.SECONDS)
        .build()

    private var catalogue: Catalogue? = null
    @Volatile var answer: StoreAnswer? = null
        private set

    /* ------------------------------------------------------------------ */
    /* What the person chose, kept across launches                         */

    var cep: String?
        get() = prefs.getString(KEY_CEP, null)
        set(value) { prefs.edit().putString(KEY_CEP, value).apply() }

    var contactKey: String?
        get() = prefs.getString(KEY_CONTACT, null)
        set(value) { prefs.edit().putString(KEY_CONTACT, value).apply() }

    fun rememberStore(store: Store?) {
        prefs.edit()
            .putString(KEY_STORE_ID, store?.id)
            .putString(KEY_STORE_NAME, store?.name)
            .apply()
    }

    fun storeName(): String? = prefs.getString(KEY_STORE_NAME, null)
    fun storeId(): String? = prefs.getString(KEY_STORE_ID, null)

    /* ------------------------------------------------------------------ */
    /* The catalogue                                                       */

    suspend fun products(): Catalogue = withContext(Dispatchers.IO) {
        catalogue ?: parseCatalogue(fetch(BuildConfig.DEMO_BASE_URL + "/products.json"))
            .also { catalogue = it }
    }

    fun imageUrl(path: String?): String? =
        path?.let { BuildConfig.DEMO_BASE_URL + "/" + it.trimStart('/') }

    /* ------------------------------------------------------------------ */
    /* Resolving a shop                                                    */

    /* By postcode, or by shop id when a deeplink names one. `sku` rides along
       so the answer's substitute slot is computed for the toy being looked
       at, exactly as the storefront passes the product page's sku. */
    suspend fun resolve(cep: String? = null, storeId: String? = null, sku: String? = null): StoreAnswer =
        withContext(Dispatchers.IO) {
            val digits = cep?.filter { it.isDigit() }
            val resolved = try {
                parseAnswer(fetch(offerUrl(digits, storeId, sku), supabase = true), "live")
            } catch (err: Exception) {
                /* Same order as the web: live first, stored answer second,
                   and the stored files carry the page's shape because the
                   same builder writes both. */
                parseAnswer(fetch(fallbackUrl(digits, storeId)), "stored answer")
            }
            answer = resolved
            if (resolved.store != null) rememberStore(resolved.store)
            resolved.cep?.let { this@StoreRepository.cep = it }
            resolved
        }

    private fun offerUrl(cep: String?, storeId: String?, sku: String?): String {
        val query = buildList {
            if (!storeId.isNullOrBlank()) add("store_id=" + storeId)
            else if (!cep.isNullOrBlank()) add("cep=" + cep)
            if (!sku.isNullOrBlank()) add("sku=" + sku)
            add("n=8")
        }.joinToString("&")
        return BuildConfig.SUPABASE_REST + "/rh_offer?" + query
    }

    private fun fallbackUrl(cep: String?, storeId: String?): String =
        if (!storeId.isNullOrBlank())
            BuildConfig.DEMO_BASE_URL + "/offer/storefront/store/" + storeId + ".json"
        else
            BuildConfig.DEMO_BASE_URL + "/offer/storefront/" + (cep ?: "") + ".json"

    private fun fetch(url: String, supabase: Boolean = false): String {
        val request = Request.Builder().url(url)
            .header("Accept", "application/json")
            .apply { if (supabase) header("apikey", BuildConfig.SUPABASE_ANON_KEY) }
            .build()
        http.newCall(request).execute().use { response ->
            if (!response.isSuccessful) throw IllegalStateException(url + " returned " + response.code)
            return response.body?.string() ?: throw IllegalStateException("empty body from " + url)
        }
    }

    /* ------------------------------------------------------------------ */
    /* Parsing. org.json rather than a mapper, so a missing field is a      */
    /* null in one visible place instead of a default hidden in a class.    */

    private fun parseCatalogue(body: String): Catalogue {
        val root = JSONObject(body)
        val items = root.getJSONArray("products")
        val products = ArrayList<Product>(items.length())
        for (i in 0 until items.length()) {
            val p = items.getJSONObject(i)
            products.add(
                Product(
                    id = p.getString("id"),
                    name = p.getString("name"),
                    brand = p.optStringOrNull("brand"),
                    licence = p.optStringOrNull("licence"),
                    department = p.optStringOrNull("department"),
                    category = p.optStringOrNull("category"),
                    categoryPath = p.optString("categoryPath", ""),
                    price = p.optDoubleOrNull("price"),
                    listPrice = p.optDoubleOrNull("listPrice"),
                    ageDisplay = p.optStringOrNull("ageDisplay"),
                    image = p.optStringOrNull("image")
                )
            )
        }
        val departments = ArrayList<String>()
        root.optJSONArray("departments")?.let { d ->
            for (i in 0 until d.length()) departments.add(d.getString(i))
        }
        return Catalogue(root.optStringOrNull("capturedAt"), departments, products)
    }

    private fun parseAnswer(body: String, servedFrom: String): StoreAnswer {
        val root = JSONObject(body)
        val storeJson = root.optJSONObject("store")
        val store = storeJson?.let {
            Store(it.getString("id"), it.getString("name"), it.optStringOrNull("city"))
        }
        val stock = HashMap<String, String>()
        root.optJSONObject("stock")?.let { s ->
            for (key in s.keys()) stock[key] = s.getString(key)
        }
        val offers = ArrayList<OfferItem>()
        root.optJSONArray("offers")?.let { list ->
            for (i in 0 until list.length()) offers.add(parseOffer(list.getJSONObject(i)))
        }
        return StoreAnswer(
            ok = root.optBoolean("ok", false),
            resolved = root.optStringOrNull("resolved"),
            cep = root.optStringOrNull("cep"),
            store = store,
            stock = stock,
            substitute = root.optJSONObject("substitute")?.let { parseOffer(it) },
            substituteReason = root.optStringOrNull("substituteReason"),
            offers = offers,
            servedFrom = servedFrom
        )
    }

    private fun parseOffer(o: JSONObject) = OfferItem(
        skuId = o.getString("sku_id"),
        name = o.getString("name"),
        brand = o.optStringOrNull("brand"),
        price = o.optDoubleOrNull("price"),
        listPrice = o.optDoubleOrNull("list_price"),
        imageUrl = o.optStringOrNull("image_url"),
        pageUrl = o.optStringOrNull("page_url")
    )
}

/* JSON nulls arrive as the sentinel JSONObject.NULL, and optString turns them
   into the literal text "null". These two return an honest Kotlin null
   instead, which is what keeps the omission rule mechanical rather than
   remembered. */
private fun JSONObject.optStringOrNull(name: String): String? =
    if (isNull(name)) null else optString(name).takeIf { it.isNotBlank() }

private fun JSONObject.optDoubleOrNull(name: String): Double? =
    if (isNull(name)) null else optDouble(name).takeIf { !it.isNaN() }
