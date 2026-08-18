package com.dengageecomm.demo

import android.content.Intent
import android.os.Bundle
import android.view.View
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import coil.load
import com.dengageecomm.demo.databinding.ActivityProductBinding
import com.google.android.material.snackbar.Snackbar
import kotlinx.coroutines.launch
import java.text.NumberFormat
import java.util.Locale

/* ============================================================================
   One toy, at one shop, and the honest answer between them.

   This screen is the mobile twin of the storefront's product page and it
   follows the same discipline: it makes no availability claim of its own. It
   asks the offer answer, and the offer answer was computed for THIS sku at
   the resolved shop, so the substitute card that appears when the shop cannot
   supply the toy is the same substitute the storefront and the email name.
   One answer, three surfaces, which is the sentence the demo exists to prove.

   When the unavailable answer is shown, the availabilitySeen row is written,
   once per showing, because the row records what the person was told. That is
   the row Use Case 1's segment is built on, and this screen writing it is
   what makes the mobile journey segmentable exactly like the web one.
   ========================================================================== */
class ProductActivity : AppCompatActivity() {

    companion object {
        const val EXTRA_PRODUCT_ID = "product_id"
    }

    private lateinit var binding: ActivityProductBinding
    private val repository by lazy { StoreRepository.get(this) }
    private val money: NumberFormat = NumberFormat.getCurrencyInstance(Locale("pt", "BR"))

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityProductBinding.inflate(layoutInflater)
        setContentView(binding.root)
        setSupportActionBar(binding.toolbar)
        supportActionBar?.setDisplayHomeAsUpEnabled(true)

        val productId = intent.getStringExtra(EXTRA_PRODUCT_ID)
        if (productId == null) { finish(); return }
        load(productId)
    }

    override fun onSupportNavigateUp(): Boolean { finish(); return true }

    private fun load(productId: String) {
        lifecycleScope.launch {
            val product = try {
                repository.products().products.firstOrNull { it.id == productId }
            } catch (err: Exception) { null }

            if (product == null) {
                Snackbar.make(binding.root, R.string.catalogue_failed, Snackbar.LENGTH_LONG).show()
                return@launch
            }

            paintProduct(product)

            /* The product page view fires as soon as the catalogue names the
               toy, before the shop answers, mirroring the web ordering: the
               row needs the product, not the availability. */
            DengageGateway.pageView("product", product)

            binding.addToCart.setOnClickListener {
                DengageGateway.addToCart(product)
                Snackbar.make(binding.root, R.string.added_to_cart, Snackbar.LENGTH_SHORT).show()
            }

            /* Re-resolve with this sku so the answer's substitute slot is
               computed for this exact toy, the same parameter the storefront
               passes from its product page. Prefer the remembered shop, so a
               deeplink's choice survives into the toy it advertised. */
            try {
                val storeId = repository.storeId()
                val answer =
                    if (storeId != null) repository.resolve(storeId = storeId, sku = product.id)
                    else repository.resolve(cep = repository.cep, sku = product.id)
                paintAvailability(product, answer)
            } catch (err: Exception) {
                /* No answer means no claim. The availability block stays
                   hidden rather than guessing either way. */
            }
        }
    }

    private fun paintProduct(product: Product) {
        binding.toolbar.title = product.name
        binding.productName.text = product.name
        binding.productBrand.text = listOfNotNull(product.brand, product.ageDisplay)
            .joinToString("  ·  ")
        binding.productImage.load(repository.imageUrl(product.image)) { crossfade(true) }

        binding.productPrice.text = product.price?.let { money.format(it) } ?: ""
        if (product.listPrice != null && product.price != null && product.listPrice > product.price) {
            binding.productListPrice.visibility = View.VISIBLE
            binding.productListPrice.text = money.format(product.listPrice)
            binding.productListPrice.paintFlags =
                binding.productListPrice.paintFlags or android.graphics.Paint.STRIKE_THRU_TEXT_FLAG
        } else {
            binding.productListPrice.visibility = View.GONE
        }
    }

    private fun paintAvailability(product: Product, answer: StoreAnswer) {
        val store = answer.store ?: return
        val state = answer.stock[product.id] ?: return

        binding.availabilityCard.visibility = View.VISIBLE
        if (state == "available") {
            binding.availabilityBadge.setBackgroundResource(R.drawable.badge_available)
            binding.availabilityBadge.text = getString(R.string.pdp_available, store.name)
            binding.substituteCard.visibility = View.GONE
            return
        }

        binding.availabilityBadge.setBackgroundResource(R.drawable.badge_unavailable)
        binding.availabilityBadge.text = getString(R.string.pdp_unavailable, store.name)

        val substitute = answer.substitute?.takeIf { it.skuId != product.id }
        if (substitute != null) {
            binding.substituteCard.visibility = View.VISIBLE
            binding.substituteName.text = substitute.name
            binding.substitutePrice.text = substitute.price?.let { money.format(it) } ?: ""
            binding.substituteImage.load(substitute.imageUrl) { crossfade(true) }
            binding.substituteCard.setOnClickListener {
                startActivity(
                    Intent(this, ProductActivity::class.java)
                        .putExtra(EXTRA_PRODUCT_ID, substitute.skuId)
                )
            }
        } else {
            binding.substituteCard.visibility = View.GONE
        }

        /* The stored row, written now that the message has been shown. Same
           field set as the web module and the captured example in
           panel/JOURNEY-UC1.md. */
        DengageGateway.availabilitySeen(
            product = product,
            storeId = store.id,
            storeName = store.name,
            cep = answer.cep ?: repository.cep ?: "",
            state = state,
            substituteId = substitute?.skuId,
            substituteReason = if (substitute != null) answer.substituteReason else null
        )
    }
}
