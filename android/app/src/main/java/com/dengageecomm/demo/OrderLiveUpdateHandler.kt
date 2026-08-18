package com.dengageecomm.demo

import android.app.Notification
import android.content.Context
import com.dengage.sdk.liveupdate.LiveUpdateHandler
import com.dengage.sdk.liveupdate.LiveUpdatePayload

/* ============================================================================
   Live Updates: the persistent, self-updating notification.

   This is the Android counterpart of what iOS calls a Live Activity. The SDK
   provides the plumbing: a push whose data carries `live_notification` is
   routed by FcmMessagingService into DengageLiveUpdateManager, which parses
   the payload and dispatches it to the handler registered for its
   activity_type. START begins the activity, UPDATE refreshes the same
   notification in place, END shows the final state and dismisses it. What
   the notification looks like is the app's job, which is this class.

   The scenario this handler tells: an order making its way to the shop.
   "Being prepared", "Ready to collect", updated on the same notification as
   pushes arrive, with a progress bar when the payload carries one.

   The push that drives it is sent with a data payload like:

     {"live_notification": "{\"activity_type\":\"order_status\",
       \"event\":\"start\",\"activityId\":\"demo-1\",
       \"content_state\":{\"order_id\":\"APP-1\",\"status\":\"Being prepared\",
       \"detail\":\"Ri Happy Praia de Belas\",\"progress\":\"40\"}}"}

   Every content_state key is optional except status; the handler renders
   what it is given and invents nothing.
   ========================================================================== */
class OrderLiveUpdateHandler : LiveUpdateHandler {

    override val channelId = "rh_demo_order_status"
    override val channelName = "Order status"
    override val channelDescription = "Live order updates from the Dengage eComm Demo"

    override fun buildNotification(context: Context, payload: LiveUpdatePayload): Notification? {
        val state = payload.contentState
        val status = state["status"] ?: return null

        val orderId = state["order_id"]
        val title = if (orderId.isNullOrBlank()) status else "Order $orderId: $status"

        val builder = Notification.Builder(context, channelId)
            .setSmallIcon(R.drawable.ic_stat_notification)
            .setContentTitle(title)
            .setOnlyAlertOnce(true)
            .setOngoing(payload.event != com.dengage.sdk.liveupdate.LiveUpdateEvent.END)

        state["detail"]?.takeIf { it.isNotBlank() }?.let { builder.setContentText(it) }

        /* A progress value renders the bar; its absence renders none. The
           payload's string is trusted only as far as it parses. */
        state["progress"]?.toIntOrNull()?.let { progress ->
            builder.setProgress(100, progress.coerceIn(0, 100), false)
        }

        return builder.build()
    }
}
