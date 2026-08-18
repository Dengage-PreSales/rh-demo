package com.dengageecomm.demo

import android.app.Activity
import android.app.Application
import com.dengage.geofence.DengageGeofence
import com.dengage.sdk.Dengage
import com.dengage.sdk.callback.DengageCallback
import com.dengage.sdk.callback.DengageError
import com.dengage.sdk.data.remote.api.DeviceConfigurationPreference
import com.dengage.sdk.domain.inboxmessage.model.InboxMessage
import com.dengage.sdk.domain.subscription.model.Subscription
import com.dengage.sdk.domain.tag.model.TagItem
import com.dengage.sdk.callback.ReviewDialogCallback
import com.dengage.sdk.liveupdate.DengageLiveUpdateManager
import com.dengage.sdk.ui.inappmessage.InAppInlineElement
import com.dengage.sdk.ui.story.StoriesListView
import com.dengage.sdk.util.DengageLifecycleTracker
import java.util.UUID

/* ============================================================================
   THE ONLY FILE IN THIS APP THAT TALKS TO DENGAGE.

   The web storefront keeps every SDK call in one module, js/dengageEvents.js,
   so that one rule can cover every call site and CI can audit a single file.
   This object is that module's Android twin, and the same reasoning applies
   unchanged: this app writes to event tables that five live demo sites and
   two mobile apps share, columns cannot be added to those tables, and a row
   written wrongly is permanent. One surface is what keeps that auditable.

   Nothing else in this app may CALL into com.dengage.*. Screens call this
   object, and this object calls the SDK. Two files are the deliberate
   exception, and they point the other way: OrderLiveUpdateHandler and
   PushNotificationReceiver implement SDK extension points that the SDK
   invokes when a push arrives. Neither initiates a call.

   THE OMISSION RULE lives here too, exactly as it does on the web: a price or
   a count the catalogue did not genuinely produce is dropped from the payload
   rather than sent as zero. Kotlin does not share JavaScript's Number(null)
   trap, but a HashMap built carelessly does, so put() happens only behind a
   null check.

   EVERY CALL IS RECORDED in a small ring buffer, newest first, which is what
   the debug screen prints. It is this app's version of the storefront's
   ?debug=1 readout, and it makes the same honest claim: it reports what the
   app SENT, never what Dengage stored. The row in Data Space is the only
   proof an event landed.
   ========================================================================== */
object DengageGateway {

    /* `accepted` means the SDK call returned without throwing, which is true
       before any network request is made. It is deliberately not named
       `delivered`, for the same reason the web readout is not: the two have
       been confused twice on this project and each confusion cost a diagnosis. */
    data class CallRecord(
        val at: Long,
        val action: String,
        val detail: String,
        val accepted: Boolean
    )

    private const val LOG_CAPACITY = 40
    private val log = ArrayDeque<CallRecord>()
    private var started = false

    private fun record(action: String, detail: String, accepted: Boolean) {
        synchronized(log) {
            log.addFirst(CallRecord(System.currentTimeMillis(), action, detail, accepted))
            while (log.size > LOG_CAPACITY) log.removeLast()
        }
    }

    /* Newest first, for the debug screen. A copy, so the caller can iterate
       while events keep arriving. */
    fun recent(): List<CallRecord> = synchronized(log) { log.toList() }

    /* ------------------------------------------------------------------ */
    /* Starting up                                                         */

    /* Called once from DemoApplication.onCreate. The order is the one
       Dengage's own geofence guidance shows: lifecycle tracker first, then
       init, then startGeofence. Everything here must stay light, because a
       geofence trigger in killed state runs this whole method in the
       background before the user has opened anything. */
    fun start(app: Application) {
        if (started) return
        started = true

        app.registerActivityLifecycleCallbacks(DengageLifecycleTracker())

        val key = BuildConfig.DENGAGE_INTEGRATION_KEY
        if (key.isBlank()) {
            /* Without the integration key nothing below can reach the panel.
               The main screen checks isConfigured() and says so in red,
               because a demo that fails silently fails on a call. */
            record("init", "integration key missing, SDK not started", false)
            return
        }

        try {
            Dengage.init(
                context = app.applicationContext,
                firebaseIntegrationKey = key,
                deviceConfigurationPreference = DeviceConfigurationPreference.Google
            )
            record("init", "firebase key ending " + key.takeLast(6), true)
            /* Marketing pushes arrive on a channel carrying the app's name
               instead of the SDK's default "General", which is what shows in
               the phone's notification settings. */
            Dengage.setNotificationChannelName("Dengage eComm Demo")
            /* One tag, so the panel can target exactly the devices running
               this app: Target Audience, tag `app` equals `rh-demo`. */
            Dengage.setTags(listOf(TagItem("app", "rh-demo")))
        } catch (err: Throwable) {
            record("init", "failed: " + (err.message ?: err.javaClass.simpleName), false)
            return
        }

        /* Live Updates: the SDK routes any push carrying live_notification
           to the handler registered for its activity type, and rendering is
           the app's job. One handler, for the order scenario. */
        try {
            DengageLiveUpdateManager.register("order_status", OrderLiveUpdateHandler())
            record("liveUpdate", "handler registered for order_status", true)
        } catch (err: Throwable) {
            record("liveUpdate", "registration failed: " + (err.message ?: err.javaClass.simpleName), false)
        }

        /* Geofence monitoring starts with the app, not with a button, because
           the whole point of the scenario is a push that arrives while the
           app is closed. The regions themselves are defined in the panel
           under Data Space, Geofence, so starting with none defined is a
           no-op rather than an error. */
        try {
            DengageGeofence.startGeofence()
            record("startGeofence", "monitoring started", true)
        } catch (err: Throwable) {
            record("startGeofence", "failed: " + (err.message ?: err.javaClass.simpleName), false)
        }
    }

    fun isConfigured(): Boolean = BuildConfig.DENGAGE_INTEGRATION_KEY.isNotBlank()

    /* ------------------------------------------------------------------ */
    /* Identity                                                            */

    /* The key is passed VERBATIM, exactly as the web storefront's sign-in
       does. Nothing is invented, trimmed into a new shape, or derived from an
       email address: the person types the contact key they mean, usually a
       DPS- one, and that exact string is what Dengage files the device under.
       Mirroring the web matters because the demo's story is one person seen
       across both surfaces, which only works if both send the same key. */
    fun setContactKey(key: String) {
        if (!started) { record("setContactKey", "SDK not started", false); return }
        try {
            Dengage.setContactKey(key)
            record("setContactKey", key, true)
        } catch (err: Throwable) {
            record("setContactKey", "failed: " + (err.message ?: err.javaClass.simpleName), false)
        }
    }

    fun subscription(): Subscription? =
        if (started) try { Dengage.getSubscription() } catch (err: Throwable) { null } else null

    fun pushToken(): String? =
        if (started) try { Dengage.getToken() } catch (err: Throwable) { null } else null

    fun sdkVersion(): String =
        try { Dengage.getSdkVersion() } catch (err: Throwable) { "unknown" }

    /* ------------------------------------------------------------------ */
    /* Events, mirroring the web module's payloads field for field         */

    /* page_type stays inside the documented vocabulary, same as the web:
       home, product, and nothing invented, because page_view_events is a
       shared table and a private vocabulary written into it never comes out. */
    fun pageView(pageType: String, product: Product? = null) {
        val data = HashMap<String, Any>()
        data["page_type"] = pageType
        if (product != null) {
            data["product_id"] = product.id
            data["category_path"] = product.categoryPath
            product.price?.let { data["price"] = it }
        }
        send("pageView", describe(pageType, product)) { Dengage.pageView(data) }
    }

    /* One line, quantity one, because this companion app has no basket of its
       own: the button exists to land a shopping_cart_events row from the
       mobile device, proving the same behaviour the storefront proves. The
       field names are the web module's exactly. */
    fun addToCart(product: Product) {
        val data = HashMap<String, Any>()
        data["product_id"] = product.id
        data["product_variant_id"] = product.id
        data["quantity"] = 1
        product.price?.let {
            data["unit_price"] = it
            data["discounted_price"] = it
        }
        val line = HashMap<String, Any>()
        line["product_id"] = product.id
        line["product_variant_id"] = product.id
        line["quantity"] = 1
        product.price?.let {
            line["unit_price"] = it
            line["discounted_price"] = it
        }
        data["cartItems"] = arrayListOf(line)
        send("ec:addToCart", describe(null, product)) { Dengage.addToCart(data) }
    }

    /* The row a segment can be built on: this person was told a shop could
       not supply a toy. It records what was SHOWN, not what is true, which is
       what a campaign should act on, and it stays correct after the stock
       behind it changes.

       The payload is the web module's availabilitySeen row field for field,
       and panel/JOURNEY-UC1.md holds a captured example beside the table
       definition. Three fields sit outside the documented sendDeviceEvent
       payload and all three are required for the row to store at all:
       event_id, event_type and is_used. The table rh_availability_events has
       to exist in the panel first; until it does the call is accepted and
       dropped, which looks identical to success from here. Confirm the row
       in Data Space, never the 200. */
    fun availabilitySeen(
        product: Product,
        storeId: String,
        storeName: String,
        cep: String,
        state: String,
        substituteId: String? = null,
        substituteReason: String? = null
    ) {
        val row = HashMap<String, Any>()
        row["product_id"] = product.id
        row["store_id"] = storeId
        row["store_name"] = storeName
        row["cep"] = cep
        row["state"] = state
        product.price?.let { row["price"] = it }
        substituteId?.let { row["substitute_id"] = it }
        substituteReason?.let { row["substitute_reason"] = it }
        row["event_id"] = UUID.randomUUID().toString()
        row["event_type"] = if (state == "available") "available" else "unavailable"
        row["is_used"] = false
        send("availabilitySeen", product.id + " at " + storeId + ": " + state) {
            Dengage.sendDeviceEvent("rh_availability_events", row)
        }
    }

    private fun describe(pageType: String?, product: Product?): String =
        listOfNotNull(pageType, product?.id).joinToString(" ").ifBlank { "-" }

    private fun send(action: String, detail: String, call: () -> Unit) {
        if (!started) { record(action, "SDK not started: $detail", false); return }
        try {
            call()
            record(action, detail, true)
        } catch (err: Throwable) {
            record(action, detail + " failed: " + (err.message ?: err.javaClass.simpleName), false)
        }
    }

    /* ------------------------------------------------------------------ */
    /* The inbox                                                           */

    /* Reads the messages Dengage holds for THIS DEVICE. Opening a message
       reports the click through setInboxMessageAsClicked, exactly what the
       web inbox reports. Dismissing one is local only, the same shared
       account rule the web inbox states: deleteInboxMessage removes the
       message from the account's copy for this device, and on an account
       whose messages a salesperson may be about to present, a cleanup click
       must never be able to empty the demo. So no delete call exists on this
       surface at all. */
    fun inboxMessages(
        limit: Int,
        offset: Int,
        onResult: (List<InboxMessage>) -> Unit,
        onError: (String) -> Unit
    ) {
        if (!started) { onError("SDK not started"); return }
        try {
            Dengage.getInboxMessages(limit, offset, object : DengageCallback<MutableList<InboxMessage>> {
                override fun onResult(result: MutableList<InboxMessage>) {
                    record("getInboxMessages", result.size.toString() + " message(s)", true)
                    onResult(result)
                }
                override fun onError(error: DengageError) {
                    val message = error.errorMessage ?: "inbox error"
                    record("getInboxMessages", message, false)
                    onError(message)
                }
            })
        } catch (err: Throwable) {
            val message = err.message ?: err.javaClass.simpleName
            record("getInboxMessages", message, false)
            onError(message)
        }
    }

    fun inboxMessageOpened(messageId: String) {
        send("setInboxMessageAsClicked", messageId) { Dengage.setInboxMessageAsClicked(messageId) }
    }

    /* ------------------------------------------------------------------ */
    /* Permissions, asked in context from the debug screen                 */

    fun requestNotificationPermission(activity: Activity) {
        send("requestNotificationPermission", "prompted") {
            Dengage.requestNotificationPermission(activity)
        }
    }

    /* Fine location first, then background as "Allow all the time". The OS
       forces the two step flow; the SDK's helper walks it. */
    fun requestLocationPermissions(activity: Activity) {
        send("requestLocationPermissions", "prompted") {
            DengageGeofence.requestLocationPermissions(activity)
        }
    }

    fun startGeofence() {
        send("startGeofence", "restarted from debug screen") { DengageGeofence.startGeofence() }
    }

    /* ------------------------------------------------------------------ */
    /* In-app messages, on every screen                                    */

    /* One call per screen entry unlocks BOTH in-app families: setNavigation
       serves the scheduled kind, showRealTimeInApp evaluates the real time
       kind, and each takes the screen name so a panel campaign can target
       "home", "product", "cart", "inbox" or "debug" by name. A screen that
       skips this can never show an in-app message, which is invisible until
       the one afternoon a campaign is aimed at it, so every Activity calls
       it from onResume. */
    fun screen(activity: Activity, screenName: String) {
        if (!started) { record("screen", screenName + ": SDK not started", false); return }
        try {
            Dengage.setNavigation(activity = activity, screenName = screenName)
            Dengage.showRealTimeInApp(activity = activity, screenName = screenName)
            record("screen", screenName + " (setNavigation + showRealTimeInApp)", true)
        } catch (err: Throwable) {
            record("screen", screenName + " failed: " + (err.message ?: err.javaClass.simpleName), false)
        }
    }

    /* The facts a real time in-app rule can compare against, and the values
       a message template can print. dnInAppDeviceInfo.store_name in a
       template renders the shop this device resolved, which is the same
       personalisation the email does, arriving through a different door. */
    fun shopContext(storeId: String, storeName: String, city: String?, cep: String?) {
        send("shopContext", storeName) {
            Dengage.setInAppDeviceInfo("store_id", storeId)
            Dengage.setInAppDeviceInfo("store_name", storeName)
            if (!cep.isNullOrBlank()) Dengage.setInAppDeviceInfo("cep", cep)
            if (!city.isNullOrBlank()) Dengage.setCity(city)
        }
    }

    fun categoryContext(path: String) {
        send("categoryContext", path) { Dengage.setCategoryPath(path) }
    }

    /* Count and amount go as exact strings, "139.99" and not 139. The SDK
       also offers setCart with per-item comparisons, and it is deliberately
       not used: its price fields are integers, and these prices do not fit
       in an integer without rounding them into figures nobody set. */
    fun cartContext(itemCount: Int, amount: Double) {
        send("cartContext", itemCount.toString() + " item(s), " + formatAmount(amount)) {
            Dengage.setCartItemCount(itemCount.toString())
            Dengage.setCartAmount(formatAmount(amount))
        }
    }

    private fun formatAmount(amount: Double): String =
        if (amount == amount.toLong().toDouble()) amount.toLong().toString()
        else String.format(java.util.Locale.US, "%.2f", amount)

    fun dismissInApp() {
        send("removeInAppMessageDisplay", "dismissed current in-app") {
            Dengage.removeInAppMessageDisplay()
        }
    }

    /* ------------------------------------------------------------------ */
    /* The rest of the commerce vocabulary                                 */

    fun categoryViewed(categoryId: String) {
        val data = HashMap<String, Any>()
        data["page_type"] = "category"
        data["category_id"] = categoryId
        send("pageView", "category " + categoryId) { Dengage.pageView(data) }
    }

    fun removeFromCart(product: Product, quantity: Int) {
        val data = cartLine(product, quantity)
        send("ec:removeFromCart", product.id) { Dengage.removeFromCart(data) }
    }

    fun viewCart() {
        send("ec:viewCart", "-") { Dengage.viewCart(HashMap()) }
    }

    fun beginCheckout(lines: List<Pair<Product, Int>>) {
        val data = HashMap<String, Any>()
        data["cartItems"] = cartItems(lines)
        send("ec:beginCheckout", lines.size.toString() + " line(s)") { Dengage.beginCheckout(data) }
    }

    fun order(orderId: String, lines: List<Pair<Product, Int>>, totalAmount: Double) {
        val data = HashMap<String, Any>()
        data["order_id"] = orderId
        data["item_count"] = lines.sumOf { it.second }
        data["total_amount"] = totalAmount
        data["discounted_price"] = totalAmount
        data["payment_method"] = "credit_card"
        data["cartItems"] = cartItems(lines)
        send("ec:order", orderId + ", " + formatAmount(totalAmount)) { Dengage.order(data) }
    }

    fun cancelOrder(orderId: String, itemCount: Int, totalAmount: Double) {
        val data = HashMap<String, Any>()
        data["order_id"] = orderId
        data["item_count"] = itemCount
        data["total_amount"] = totalAmount
        data["discounted_price"] = totalAmount
        send("ec:cancelOrder", orderId) { Dengage.cancelOrder(data) }
    }

    /* Fires once per SETTLED query, never per keystroke. The caller owns the
       settling; this only records, the same division the web module states. */
    fun search(term: String, resultCount: Int) {
        val data = HashMap<String, Any>()
        data["keywords"] = term
        data["result_count"] = resultCount
        send("ec:search", "\"" + term + "\" -> " + resultCount) { Dengage.search(data) }
    }

    /* The Android SDK has first class wishlist calls, so they are used here.
       The web writes its wishlist rows through sendDeviceEvent instead, and
       the difference is deliberate on both sides: each surface uses the
       documented mechanism its own SDK provides for the same table. */
    fun addToWishlist(product: Product) {
        val data = HashMap<String, Any>()
        data["product_id"] = product.id
        product.price?.let { data["price"] = it }
        send("ec:addToWishlist", product.id) { Dengage.addToWishList(data) }
    }

    fun removeFromWishlist(product: Product) {
        val data = HashMap<String, Any>()
        data["product_id"] = product.id
        send("ec:removeFromWishlist", product.id) { Dengage.removeFromWishList(data) }
    }

    private fun cartLine(product: Product, quantity: Int): HashMap<String, Any> {
        val line = HashMap<String, Any>()
        line["product_id"] = product.id
        line["product_variant_id"] = product.id
        line["quantity"] = quantity
        product.price?.let {
            line["unit_price"] = it
            line["discounted_price"] = it
        }
        return line
    }

    private fun cartItems(lines: List<Pair<Product, Int>>): ArrayList<HashMap<String, Any>> {
        val items = ArrayList<HashMap<String, Any>>(lines.size)
        lines.forEach { (product, quantity) -> items.add(cartLine(product, quantity)) }
        return items
    }

    /* ------------------------------------------------------------------ */
    /* Inbox, the non-destructive extras                                   */

    fun inboxMarkAllRead() {
        send("setAllInboxMessagesAsClicked", "all read") { Dengage.setAllInboxMessagesAsClicked() }
    }

    /* ------------------------------------------------------------------ */
    /* Debug surfaces the SDK ships with                                   */

    /* Dengage's own diagnostics screen: subscription, cache, push and
       in-app state, from inside the SDK itself. */
    fun openTestPage(activity: Activity) {
        send("showTestPage", "opened") { Dengage.showTestPage(activity) }
    }

    /* Reading it also CLEARS it in the SDK, so the debug screen labels the
       button accordingly and shows what it got. */
    fun lastPushPayload(): String {
        if (!started) return "SDK not started"
        return try {
            val payload = Dengage.getLastPushPayload()
            record("getLastPushPayload", if (payload.isBlank()) "empty" else payload.take(60), true)
            payload.ifBlank { "no payload stored" }
        } catch (err: Throwable) {
            record("getLastPushPayload", "failed", false)
            "failed: " + (err.message ?: err.javaClass.simpleName)
        }
    }

    /* App Stories and the inline in-app slot. Both are panel driven: the
       view stays empty until a campaign in the panel is created against the
       property id the screen passes, so wiring them costs nothing until the
       day they are wanted on a call. */
    fun showStories(activity: Activity, view: StoriesListView, propertyId: String, screenName: String) {
        send("showStoriesList", propertyId + " on " + screenName) {
            Dengage.showStoriesList(
                storyPropertyId = propertyId,
                storiesListView = view,
                activity = activity,
                screenName = screenName,
                hideIfNotFound = true
            )
        }
    }

    fun showInline(activity: Activity, view: InAppInlineElement, propertyId: String, screenName: String) {
        send("showInlineInApp", propertyId + " on " + screenName) {
            Dengage.showInlineInApp(
                propertyId = propertyId,
                inAppInlineElement = view,
                activity = activity,
                screenName = screenName,
                hideIfNotFound = true
            )
        }
    }

    /* Play's in-app review flow, through the SDK's wrapper. On a sideloaded
       debug build Play usually declines to show it, which the record makes
       visible instead of mysterious. */
    fun showRatingDialog(activity: Activity) {
        if (!started) { record("showRatingDialog", "SDK not started", false); return }
        try {
            Dengage.showRatingDialog(activity, object : ReviewDialogCallback {
                override fun onCompletion() { record("showRatingDialog", "completed", true) }
                override fun onError() { record("showRatingDialog", "declined or failed", false) }
            })
            record("showRatingDialog", "requested", true)
        } catch (err: Throwable) {
            record("showRatingDialog", "failed: " + (err.message ?: err.javaClass.simpleName), false)
        }
    }

    fun userPermission(): Boolean? =
        if (started) try { Dengage.getUserPermission() } catch (err: Throwable) { null } else null

    fun trackingPermission(): Boolean? =
        if (started) try { Dengage.getTrackingPermission() } catch (err: Throwable) { null } else null
}
