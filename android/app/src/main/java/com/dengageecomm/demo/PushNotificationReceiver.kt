package com.dengageecomm.demo

import android.app.Notification
import android.content.Context
import android.content.Intent
import android.widget.RemoteViews
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.dengage.sdk.domain.push.model.CarouselItem
import com.dengage.sdk.domain.push.model.Message
import com.dengage.sdk.push.NotificationReceiver

/* ============================================================================
   Carousel push, the one notification style the SDK cannot draw alone.

   Text and rich pushes render out of the box. A carousel does not: the SDK
   parses the message, computes which three items are in view, and then calls
   onCarouselRender, which in the base class does nothing, so a carousel push
   without this receiver shows NOTHING at all. The layouts are the app's, in
   res/layout/den_carousel_*.xml, and the manifest registers this class for
   the push actions so arrow taps keep working after the process dies.

   This is an SDK extension point rather than a call site: the SDK invokes
   this class, the app never does. DengageGateway remains the only file that
   calls into the SDK.

   Adapted from Dengage's own reference implementation for exactly this
   receiver, with one deliberate omission: no setSound on the builder,
   because from Android 8 the channel owns the sound and the builder's value
   is ignored.
   ========================================================================== */
class PushNotificationReceiver : NotificationReceiver() {

    override fun onCarouselRender(
        context: Context,
        intent: Intent,
        message: Message,
        leftCarouselItem: CarouselItem,
        currentCarouselItem: CarouselItem,
        rightCarouselItem: CarouselItem
    ) {
        super.onCarouselRender(
            context, intent, message,
            leftCarouselItem, currentCarouselItem, rightCarouselItem
        )

        /* The intents the SDK prepares: arrows re-render in place, the item
           opens its target, delete reports the dismissal. */
        val itemIntent = getItemClickIntent(intent.extras, context.packageName)
        val leftIntent = getLeftItemIntent(intent.extras, context.packageName)
        val rightIntent = getRightItemIntent(intent.extras, context.packageName)
        val deleteIntent = getDeleteIntent(intent.extras, context.packageName)
        val contentIntent = getContentIntent(intent.extras, context.packageName)

        val carouselItemIntent = getPendingIntent(context, 0, itemIntent)
        val carouselLeftIntent = getCarouselDirectionIntent(context, 1, leftIntent)
        val carouselRightIntent = getCarouselDirectionIntent(context, 2, rightIntent)
        val deletePendingIntent = getDeletePendingIntent(context, 4, deleteIntent)
        val contentPendingIntent = getPendingIntent(context, 5, contentIntent)

        val collapsedView = RemoteViews(context.packageName, R.layout.den_carousel_collapsed)
        collapsedView.setTextViewText(R.id.den_carousel_title, message.title)
        collapsedView.setTextViewText(R.id.den_carousel_message, message.message)

        val carouselView = RemoteViews(context.packageName, R.layout.den_carousel_portrait)
        carouselView.setTextViewText(R.id.den_carousel_title, message.title)
        carouselView.setTextViewText(R.id.den_carousel_message, message.message)
        carouselView.setTextViewText(R.id.den_carousel_item_title, currentCarouselItem.title)
        carouselView.setTextViewText(R.id.den_carousel_item_description, currentCarouselItem.description)

        carouselView.setOnClickPendingIntent(R.id.den_carousel_left_arrow, carouselLeftIntent)
        carouselView.setOnClickPendingIntent(R.id.den_carousel_right_arrow, carouselRightIntent)
        carouselView.setOnClickPendingIntent(R.id.den_carousel_portrait_current_image, carouselItemIntent)
        carouselView.setOnClickPendingIntent(R.id.den_carousel_item_title, carouselItemIntent)
        carouselView.setOnClickPendingIntent(R.id.den_carousel_item_description, carouselItemIntent)

        val channelId = createNotificationChannel(context, message)

        loadCarouselImageToView(carouselView, R.id.den_carousel_portrait_left_image, leftCarouselItem)
        loadCarouselImageToView(carouselView, R.id.den_carousel_portrait_current_image, currentCarouselItem)
        loadCarouselImageToView(carouselView, R.id.den_carousel_portrait_right_image, rightCarouselItem)

        val notification = NotificationCompat.Builder(context, channelId)
            .setSmallIcon(R.drawable.ic_stat_notification)
            .setCustomContentView(collapsedView)
            .setCustomBigContentView(carouselView)
            .setContentIntent(contentPendingIntent)
            .setDeleteIntent(deletePendingIntent)
            .build()

        /* Arrow taps re-post the same id silently: the flags keep the swap
           from re-alerting, and auto cancel clears it on open. */
        notification.flags = Notification.FLAG_AUTO_CANCEL or Notification.FLAG_ONLY_ALERT_ONCE

        val requestCode = intent.extras?.getInt("requestCode") ?: return
        try {
            NotificationManagerCompat.from(context).notify(requestCode, notification)
        } catch (err: SecurityException) {
            /* Notification permission was revoked between arrival and render.
               Nothing to show, and nothing to crash. */
        }
    }
}
