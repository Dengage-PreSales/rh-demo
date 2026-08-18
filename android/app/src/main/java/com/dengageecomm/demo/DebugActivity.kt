package com.dengageecomm.demo

import android.content.ClipData
import android.content.ClipboardManager
import android.os.Bundle
import androidx.appcompat.app.AppCompatActivity
import com.dengageecomm.demo.databinding.ActivityDebugBinding
import com.google.android.material.snackbar.Snackbar
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/* ============================================================================
   The screen for the honest numbers.

   The storefront's ?debug=1 readout, as an Activity. It answers the questions
   a rehearsal actually asks: which device is this, does it hold a push token,
   which contact is it filed under, which shop answered, did that answer come
   from the live endpoint or a stored one, and what has the app sent.

   It reports what the app SENT, never what Dengage stored. An accepted call
   and a stored row are different facts, they have been confused twice on this
   project, and each time the confusion cost a diagnosis. The row in Data
   Space is the only proof an event landed.

   The permission buttons live here rather than on launch, so the prompts are
   asked in context, on purpose, at the moment the person presenting wants
   them on screen. Location is a two step flow the OS enforces: fine location
   first, then background as "Allow all the time".
   ========================================================================== */
class DebugActivity : AppCompatActivity() {

    private lateinit var binding: ActivityDebugBinding
    private val repository by lazy { StoreRepository.get(this) }
    private val clock = SimpleDateFormat("HH:mm:ss", Locale.US)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityDebugBinding.inflate(layoutInflater)
        setContentView(binding.root)
        setSupportActionBar(binding.toolbar)
        supportActionBar?.setDisplayHomeAsUpEnabled(true)

        binding.debugRefresh.setOnClickListener { paint() }
        binding.debugNotificationPermission.setOnClickListener {
            DengageGateway.requestNotificationPermission(this)
            paint()
        }
        binding.debugLocationPermission.setOnClickListener {
            DengageGateway.requestLocationPermissions(this)
            paint()
        }
        binding.debugStartGeofence.setOnClickListener {
            DengageGateway.startGeofence()
            paint()
        }
        binding.debugTestPage.setOnClickListener { DengageGateway.openTestPage(this) }
        binding.debugDismissInApp.setOnClickListener { DengageGateway.dismissInApp(); paint() }
        binding.debugRatingDialog.setOnClickListener { DengageGateway.showRatingDialog(this); paint() }
        binding.debugLastPush.setOnClickListener {
            val payload = DengageGateway.lastPushPayload()
            com.google.android.material.dialog.MaterialAlertDialogBuilder(this)
                .setTitle(R.string.debug_last_push)
                .setMessage(payload)
                .setPositiveButton(android.R.string.ok, null)
                .show()
            paint()
        }
        binding.debugCopyToken.setOnClickListener {
            val token = DengageGateway.pushToken()
            if (token.isNullOrBlank()) {
                Snackbar.make(binding.root, R.string.debug_no_token, Snackbar.LENGTH_SHORT).show()
            } else {
                val clipboard = getSystemService(CLIPBOARD_SERVICE) as ClipboardManager
                clipboard.setPrimaryClip(ClipData.newPlainText("push token", token))
                Snackbar.make(binding.root, R.string.debug_token_copied, Snackbar.LENGTH_SHORT).show()
            }
        }
    }

    override fun onResume() {
        super.onResume()
        paint()
        DengageGateway.screen(this, "debug")
    }

    override fun onSupportNavigateUp(): Boolean { finish(); return true }

    private fun paint() {
        binding.debugIdentity.text = identityReport()
        binding.debugContext.text = contextReport()
        binding.debugCalls.text = callsReport()
    }

    private fun identityReport(): String {
        val sub = DengageGateway.subscription()
        val token = DengageGateway.pushToken()
        return buildString {
            appendLine("app            " + BuildConfig.APPLICATION_ID + " " + BuildConfig.VERSION_NAME)
            appendLine("sdk            " + DengageGateway.sdkVersion())
            appendLine("integrationKey " + (if (DengageGateway.isConfigured())
                "present, ending " + BuildConfig.DENGAGE_INTEGRATION_KEY.takeLast(6) else "MISSING"))
            appendLine("deviceId       " + (sub?.deviceId ?: "not yet assigned"))
            appendLine("contactKey     " + (sub?.contactKey.takeUnless { it.isNullOrBlank() }
                ?: "anonymous"))
            appendLine("pushPermission " + (sub?.permission?.toString() ?: "unknown"))
            appendLine("locationPerm   " + (sub?.locationPermission.takeUnless { it.isNullOrBlank() }
                ?: "not reported yet"))
            appendLine("userPerm       " + (DengageGateway.userPermission()?.toString() ?: "unknown"))
            appendLine("trackingPerm   " + (DengageGateway.trackingPermission()?.toString() ?: "unknown"))
            append("pushToken      " + when {
                token.isNullOrBlank() -> "none. Ask for notification permission below"
                else -> token.take(24) + "... (" + token.length + " chars, copy below)"
            })
        }
    }

    private fun contextReport(): String {
        val answer = repository.answer
        return buildString {
            appendLine("cep            " + (repository.cep ?: "not chosen"))
            appendLine("store          " + (repository.storeName() ?: "not resolved"))
            appendLine("answeredBy     " + (answer?.servedFrom ?: "no answer this launch"))
            appendLine("stockAnswers   " + (answer?.stock?.size ?: 0))
            append("signedInAs     " + (repository.contactKey ?: "nobody on this surface yet"))
        }
    }

    private fun callsReport(): String {
        val calls = DengageGateway.recent()
        if (calls.isEmpty()) return getString(R.string.debug_no_calls)
        return calls.joinToString("\n") { call ->
            clock.format(Date(call.at)) +
                (if (call.accepted) "  ok    " else "  FAIL  ") +
                call.action + "  " + call.detail
        }
    }
}
