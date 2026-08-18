package com.dengageecomm.demo

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.appcompat.app.AppCompatActivity
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.dengageecomm.demo.databinding.ActivityCartBinding
import com.dengageecomm.demo.databinding.ItemCartBinding
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import com.google.android.material.snackbar.Snackbar
import java.text.NumberFormat
import java.util.Locale

/* ============================================================================
   The basket, and the rest of the order vocabulary.

   Opening it records a cart page view and a viewCart event. Removing a line
   records removeFromCart with the line it removed. Checkout records
   beginCheckout, placing the order records the order with its real lines and
   real total, and the snackbar's undo records cancelOrder against the same
   order id. Five events a segment or a journey can hang off, each fired by a
   person doing the thing the event names, none invented.
   ========================================================================== */
class CartActivity : AppCompatActivity() {

    private lateinit var binding: ActivityCartBinding
    private val money: NumberFormat = NumberFormat.getCurrencyInstance(Locale("pt", "BR"))

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityCartBinding.inflate(layoutInflater)
        setContentView(binding.root)
        setSupportActionBar(binding.toolbar)
        supportActionBar?.setDisplayHomeAsUpEnabled(true)

        binding.cartList.layoutManager = LinearLayoutManager(this)

        DengageGateway.pageView("cart")
        DengageGateway.viewCart()

        binding.checkoutButton.setOnClickListener { checkout() }
        paint()
    }

    override fun onResume() {
        super.onResume()
        DengageGateway.screen(this, "cart")
    }

    override fun onSupportNavigateUp(): Boolean { finish(); return true }

    private fun paint() {
        val lines = CartState.lines()
        binding.cartEmpty.visibility = if (lines.isEmpty()) View.VISIBLE else View.GONE
        binding.cartList.visibility = if (lines.isEmpty()) View.GONE else View.VISIBLE
        binding.checkoutButton.isEnabled = lines.isNotEmpty()
        binding.cartTotal.text = getString(R.string.cart_total, money.format(CartState.totalAmount()))
        binding.cartList.adapter = CartAdapter(lines) { line ->
            CartState.remove(line.product.id)?.let {
                DengageGateway.removeFromCart(it.product, it.quantity)
            }
            paint()
        }
    }

    private fun checkout() {
        val pairs = CartState.asPairs()
        if (pairs.isEmpty()) return
        val total = CartState.totalAmount()
        DengageGateway.beginCheckout(pairs)

        MaterialAlertDialogBuilder(this)
            .setTitle(R.string.checkout_title)
            .setMessage(getString(R.string.checkout_message, money.format(total)))
            .setPositiveButton(R.string.checkout_confirm) { _, _ -> placeOrder(pairs, total) }
            .setNegativeButton(R.string.dialog_cancel, null)
            .show()
    }

    private fun placeOrder(pairs: List<Pair<Product, Int>>, total: Double) {
        val orderId = "APP-" + (System.currentTimeMillis() % 1000000)
        val itemCount = pairs.sumOf { it.second }
        DengageGateway.order(orderId, pairs, total)
        CartState.clear()
        paint()
        Snackbar.make(binding.root, getString(R.string.order_placed, orderId), Snackbar.LENGTH_LONG)
            .setAction(R.string.order_cancel) {
                DengageGateway.cancelOrder(orderId, itemCount, total)
                Snackbar.make(binding.root, R.string.order_cancelled, Snackbar.LENGTH_SHORT).show()
            }
            .show()
    }

    private inner class CartAdapter(
        private val lines: List<CartState.Line>,
        private val onRemove: (CartState.Line) -> Unit
    ) : RecyclerView.Adapter<CartAdapter.Holder>() {

        inner class Holder(val binding: ItemCartBinding) : RecyclerView.ViewHolder(binding.root)

        override fun onCreateViewHolder(parent: ViewGroup, viewType: Int) =
            Holder(ItemCartBinding.inflate(LayoutInflater.from(parent.context), parent, false))

        override fun getItemCount() = lines.size

        override fun onBindViewHolder(holder: Holder, position: Int) {
            val line = lines[position]
            holder.binding.cartItemName.text = line.product.name
            holder.binding.cartItemDetail.text = line.product.price?.let {
                getString(R.string.cart_line_detail, line.quantity, money.format(it))
            } ?: getString(R.string.cart_line_detail_no_price, line.quantity)
            holder.binding.cartItemRemove.setOnClickListener { onRemove(line) }
        }
    }
}
