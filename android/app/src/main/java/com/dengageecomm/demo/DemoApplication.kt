package com.dengageecomm.demo

import android.app.Application

/* ============================================================================
   Deliberately this small.

   A geofence trigger in killed state launches the app in the background and
   runs everything here before any screen exists, so onCreate carries exactly
   one job: hand the application to the gateway, which registers the lifecycle
   tracker, initialises the SDK and starts geofence monitoring in the order
   Dengage's own guidance shows. Catalogue loading, shop resolution and every
   network read belong to the screens that need them.
   ========================================================================== */
class DemoApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        DengageGateway.start(this)
    }
}
