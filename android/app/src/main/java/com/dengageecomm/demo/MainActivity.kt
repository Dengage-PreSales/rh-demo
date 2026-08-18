package com.dengageecomm.demo

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.text.InputType
import android.view.Menu
import android.view.MenuItem
import android.view.View
import android.widget.EditText
import android.widget.FrameLayout
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.GridLayoutManager
import com.dengageecomm.demo.databinding.ActivityMainBinding
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import com.google.android.material.snackbar.Snackbar
import kotlinx.coroutines.launch

/* ============================================================================
   The shop, scoped to a shop.

   The grid only ever renders against a resolved shop, the same gate the web
   storefront opens with: a postcode in, a shop out, and every availability
   badge on screen belongs to that shop. Change the postcode and the same
   catalogue repaints with the new shop's answers, which is the storefront's
   one-line story told on a phone.

   The deeplink is the other way in. rhdemo://store/<id> arrives on the push a
   geofence sends, and landing here resolves that exact shop, so the person
   who walked past a shop opens the app already scoped to it. launchMode is
   singleTop, so a tap while the app is open lands in onNewIntent rather than
   stacking a second copy.
   ========================================================================== */
class MainActivity : AppCompatActivity() {

    private lateinit var binding: ActivityMainBinding
    private lateinit var adapter: ProductAdapter
    private val repository by lazy { StoreRepository.get(this) }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)
        setSupportActionBar(binding.toolbar)

        /* A missing integration key fails loudly and on screen. A demo that
           fails silently fails during a call instead. */
        binding.configWarning.visibility =
            if (DengageGateway.isConfigured()) View.GONE else View.VISIBLE

        adapter = ProductAdapter { product ->
            startActivity(
                Intent(this, ProductActivity::class.java)
                    .putExtra(ProductActivity.EXTRA_PRODUCT_ID, product.id)
            )
        }
        binding.productGrid.layoutManager = GridLayoutManager(this, 2)
        binding.productGrid.adapter = adapter

        binding.storeChip.setOnClickListener { askForPostcode() }

        /* The home page view fires once per launch, immediately, exactly as
           the web page fires it before the catalogue loads: its payload needs
           nothing the network provides. */
        DengageGateway.pageView("home")

        if (!handleDeeplink(intent)) {
            val saved = repository.cep
            if (saved.isNullOrBlank()) askForPostcode() else resolve(cep = saved)
        }
        loadCatalogue()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleDeeplink(intent)
    }

    override fun onResume() {
        super.onResume()
        /* The badge answers may have changed while another screen held the
           store context, a substitute was followed, or a deeplink landed. */
        repository.answer?.let { paint(it) }
    }

    /* ------------------------------------------------------------------ */
    /* Ways in                                                             */

    private fun handleDeeplink(intent: Intent?): Boolean {
        val data: Uri = intent?.data ?: return false
        if (data.scheme != "rhdemo" || data.host != "store") return false
        val storeId = data.pathSegments.firstOrNull() ?: return false
        resolve(storeId = storeId, announce = true)
        return true
    }

    private fun askForPostcode() {
        val input = EditText(this).apply {
            inputType = InputType.TYPE_CLASS_NUMBER
            hint = getString(R.string.cep_hint)
            repository.cep?.let { setText(it) }
        }
        val container = FrameLayout(this).apply {
            val pad = (20 * resources.displayMetrics.density).toInt()
            setPadding(pad, pad / 2, pad, 0)
            addView(input)
        }
        MaterialAlertDialogBuilder(this)
            .setTitle(R.string.cep_title)
            .setMessage(R.string.cep_message)
            .setView(container)
            .setPositiveButton(R.string.cep_confirm) { _, _ ->
                val cep = input.text.toString().filter { it.isDigit() }
                if (cep.length == 8) resolve(cep = cep)
                else Snackbar.make(binding.root, R.string.cep_invalid, Snackbar.LENGTH_LONG).show()
            }
            .setNegativeButton(R.string.dialog_cancel, null)
            .show()
    }

    /* ------------------------------------------------------------------ */
    /* Resolving and painting                                              */

    private fun resolve(cep: String? = null, storeId: String? = null, announce: Boolean = false) {
        binding.storeChip.text = getString(R.string.store_resolving)
        lifecycleScope.launch {
            try {
                val answer = repository.resolve(cep = cep, storeId = storeId)
                paint(answer)
                if (announce && answer.store != null) {
                    Snackbar.make(
                        binding.root,
                        getString(R.string.store_deeplink_landed, answer.store.name),
                        Snackbar.LENGTH_LONG
                    ).show()
                }
            } catch (err: Exception) {
                binding.storeChip.text = getString(R.string.store_unresolved)
                Snackbar.make(binding.root, R.string.store_resolve_failed, Snackbar.LENGTH_LONG).show()
            }
        }
    }

    private fun paint(answer: StoreAnswer) {
        binding.storeChip.text = when {
            answer.store != null -> answer.store.name
            answer.resolved == "no_store" -> getString(R.string.store_none_serves)
            else -> getString(R.string.store_unresolved)
        }
        adapter.submit(currentProducts, answer.stock)
    }

    private var currentProducts: List<Product> = emptyList()

    private fun loadCatalogue() {
        lifecycleScope.launch {
            try {
                currentProducts = repository.products().products
                adapter.submit(currentProducts, repository.answer?.stock ?: emptyMap())
            } catch (err: Exception) {
                Snackbar.make(binding.root, R.string.catalogue_failed, Snackbar.LENGTH_INDEFINITE)
                    .setAction(R.string.retry) { loadCatalogue() }
                    .show()
            }
        }
    }

    /* ------------------------------------------------------------------ */
    /* Menu: sign in, inbox, debug                                         */

    override fun onCreateOptionsMenu(menu: Menu): Boolean {
        menuInflater.inflate(R.menu.menu_main, menu)
        return true
    }

    override fun onOptionsItemSelected(item: MenuItem): Boolean = when (item.itemId) {
        R.id.action_sign_in -> { askForContactKey(); true }
        R.id.action_inbox -> { startActivity(Intent(this, InboxActivity::class.java)); true }
        R.id.action_debug -> { startActivity(Intent(this, DebugActivity::class.java)); true }
        else -> super.onOptionsItemSelected(item)
    }

    /* The typed key goes to Dengage VERBATIM, the same contract as the web
       sign-in: no derivation, no normalisation beyond trimming the ends. The
       demo's cross-channel story depends on both surfaces sending the same
       key for the same person. */
    private fun askForContactKey() {
        val input = EditText(this).apply {
            inputType = InputType.TYPE_CLASS_TEXT
            hint = getString(R.string.sign_in_hint)
            repository.contactKey?.let { setText(it) }
        }
        val container = FrameLayout(this).apply {
            val pad = (20 * resources.displayMetrics.density).toInt()
            setPadding(pad, pad / 2, pad, 0)
            addView(input)
        }
        MaterialAlertDialogBuilder(this)
            .setTitle(R.string.sign_in_title)
            .setMessage(R.string.sign_in_message)
            .setView(container)
            .setPositiveButton(R.string.sign_in_confirm) { _, _ ->
                val key = input.text.toString().trim()
                if (key.isNotEmpty()) {
                    repository.contactKey = key
                    DengageGateway.setContactKey(key)
                    Snackbar.make(
                        binding.root,
                        getString(R.string.sign_in_done, key),
                        Snackbar.LENGTH_LONG
                    ).show()
                }
            }
            .setNegativeButton(R.string.dialog_cancel, null)
            .show()
    }
}
