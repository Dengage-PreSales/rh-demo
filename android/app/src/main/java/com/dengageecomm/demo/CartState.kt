package com.dengageecomm.demo

/* ============================================================================
   The basket, held in memory for the length of a session.

   It exists so the cart, checkout and order events carry real lines with real
   quantities and a real total, rather than being buttons that emit invented
   payloads. Nothing here talks to Dengage: screens change this state and call
   the gateway themselves, keeping the one-surface rule intact.

   Deliberately not persisted. A demo basket that resurrects across launches
   confuses a rehearsal more than it helps one, and a geofence cold start in
   the background must not pay for loading it.
   ========================================================================== */
object CartState {

    data class Line(val product: Product, var quantity: Int)

    private val lines = LinkedHashMap<String, Line>()
    private val listeners = mutableListOf<() -> Unit>()

    fun add(product: Product) {
        val line = lines[product.id]
        if (line == null) lines[product.id] = Line(product, 1) else line.quantity += 1
        changed()
    }

    /* Removes the whole line and returns it, so the caller can report the
       removed quantity honestly. */
    fun remove(productId: String): Line? {
        val line = lines.remove(productId)
        if (line != null) changed()
        return line
    }

    fun clear() {
        if (lines.isEmpty()) return
        lines.clear()
        changed()
    }

    fun lines(): List<Line> = lines.values.toList()

    fun asPairs(): List<Pair<Product, Int>> = lines.values.map { it.product to it.quantity }

    fun itemCount(): Int = lines.values.sumOf { it.quantity }

    /* Lines whose price the catalogue never produced contribute nothing,
       rather than a zero that would misstate the total. The order event's
       total is this figure, so the rule lands in a shared table. */
    fun totalAmount(): Double = lines.values.sumOf { (it.product.price ?: 0.0) * it.quantity }

    fun onChange(listener: () -> Unit) { listeners.add(listener) }

    fun removeOnChange(listener: () -> Unit) { listeners.remove(listener) }

    private fun changed() {
        listeners.forEach { it() }
        DengageGateway.cartContext(itemCount(), totalAmount())
    }
}
