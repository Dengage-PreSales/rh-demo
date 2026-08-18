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

   Nothing else in this app may import com.dengage.*. Screens call this
   object, and this object calls the SDK.

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
        } catch (err: Throwable) {
            record("init", "failed: " + (err.message ?: err.javaClass.simpleName), false)
            return
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
}
