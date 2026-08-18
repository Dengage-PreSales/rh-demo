package com.dengageecomm.demo

import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.recyclerview.widget.RecyclerView
import coil.load
import com.dengageecomm.demo.databinding.ItemProductBinding
import java.text.NumberFormat
import java.util.Locale

/* ============================================================================
   The product grid.

   Each tile carries the availability badge for the RESOLVED shop, read from
   the same stock map the storefront badges with. Three states, and the third
   is the one that matters: a sku the capture holds no answer for at this shop
   shows no badge at all. Silence, never a guess, exactly the storefront's
   rule, because a wrong availability claim in front of the people who run
   these shops is the most expensive sentence this demo could say.
   ========================================================================== */
class ProductAdapter(
    private val onOpen: (Product) -> Unit
) : RecyclerView.Adapter<ProductAdapter.Holder>() {

    private var products: List<Product> = emptyList()
    private var stock: Map<String, String> = emptyMap()

    /* Prices are Brazilian retail prices, so they render the way that market
       writes them, R$ 99,99, whatever the phone's own locale is. */
    private val money: NumberFormat = NumberFormat.getCurrencyInstance(Locale("pt", "BR"))

    fun submit(products: List<Product>, stock: Map<String, String>) {
        this.products = products
        this.stock = stock
        notifyDataSetChanged()
    }

    class Holder(val binding: ItemProductBinding) : RecyclerView.ViewHolder(binding.root)

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int) =
        Holder(ItemProductBinding.inflate(LayoutInflater.from(parent.context), parent, false))

    override fun getItemCount() = products.size

    override fun onBindViewHolder(holder: Holder, position: Int) {
        val product = products[position]
        val b = holder.binding
        val context = b.root.context

        b.productName.text = product.name
        b.productBrand.text = product.brand ?: ""
        b.productBrand.visibility = if (product.brand == null) View.GONE else View.VISIBLE

        /* A missing price renders as nothing. Never zero. */
        b.productPrice.text = product.price?.let { money.format(it) } ?: ""

        b.productImage.load(StoreRepository.get(context).imageUrl(product.image)) {
            crossfade(true)
        }

        when (stock[product.id]) {
            "available" -> {
                b.productBadge.visibility = View.VISIBLE
                b.productBadge.setBackgroundResource(R.drawable.badge_available)
                b.productBadge.text = context.getString(R.string.badge_available)
            }
            "withoutStock" -> {
                b.productBadge.visibility = View.VISIBLE
                b.productBadge.setBackgroundResource(R.drawable.badge_unavailable)
                b.productBadge.text = context.getString(R.string.badge_unavailable)
            }
            else -> b.productBadge.visibility = View.GONE
        }

        b.root.setOnClickListener { onOpen(product) }
    }
}
