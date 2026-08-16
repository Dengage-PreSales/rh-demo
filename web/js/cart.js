/* ============================================================================
   The bag.

   Small on purpose: this demo is about availability, not about checkout. What
   it does carry is the Dengage side, because a basket is where the standard
   ecommerce events come from and those events are what a campaign is built on.

   Every line remembers which shop it was added at. That is not decoration: if a
   visitor changes postcode after filling a bag, the storefront can say which
   items the new shop cannot supply, which is exactly the ship from store
   problem Ri Happy lives with.

   Storage is namespaced by the demo slug because this site shares an origin
   with the other Dengage demos, and two demos sharing a basket would be a
   confusing thing to discover during a call.
   ========================================================================== */
(function (window) {
    'use strict';

    var slug = window.DEMO_SLUG || 'rh-demo';
    var KEY = 'dps:' + slug + ':cart';
    var lines = read();
    var listeners = [];

    function read() {
        try {
            var raw = window.localStorage.getItem(KEY);
            var parsed = raw ? JSON.parse(raw) : [];
            return Array.isArray(parsed) ? parsed : [];
        } catch (err) { return []; }
    }

    function save() {
        try { window.localStorage.setItem(KEY, JSON.stringify(lines)); }
        catch (err) { /* private browsing */ }
        for (var i = 0; i < listeners.length; i += 1) {
            try { listeners[i](lines); } catch (err) { /* one broken view must not stop the rest */ }
        }
    }

    function lineOf(product) {
        var context = window.StoreContext;
        return {
            id: product.id,
            name: product.name,
            quantity: 1,
            price: product.price,
            categoryPath: product.categoryPath,
            image: product.image,
            /* Which shop this was added at, so a later change of postcode can be
               explained rather than silently changing what is in the bag. */
            storeId: context && context.hasStore() ? context.state().store.id : null,
            storeName: context && context.hasStore() ? context.storeName() : null
        };
    }

    function add(product) {
        var existing = null;
        for (var i = 0; i < lines.length; i += 1) {
            if (lines[i].id === product.id) { existing = lines[i]; break; }
        }
        if (existing) existing.quantity += 1;
        else lines.push(lineOf(product));
        save();
        if (window.DengageEvents) {
            window.DengageEvents.addToCart({
                id: product.id, quantity: 1, price: product.price,
                categoryPath: product.categoryPath
            }, lines);
        }
        return lines;
    }

    function remove(productId) {
        var removed = null;
        lines = lines.filter(function (line) {
            if (line.id !== productId) return true;
            removed = line;
            return false;
        });
        save();
        if (removed && window.DengageEvents) {
            window.DengageEvents.removeFromCart({
                id: removed.id, quantity: removed.quantity, price: removed.price,
                categoryPath: removed.categoryPath
            }, lines);
        }
        return lines;
    }

    function clear() {
        lines = [];
        save();
        if (window.DengageEvents) window.DengageEvents.deleteCart();
    }

    function count() {
        var total = 0;
        for (var i = 0; i < lines.length; i += 1) total += lines[i].quantity;
        return total;
    }

    /* Null rather than zero when any line has no usable price. A total that
       silently treats unknown as free is the exact trap this project refuses. */
    function total() {
        var sum = 0;
        for (var i = 0; i < lines.length; i += 1) {
            var price = lines[i].price;
            if (typeof price !== 'number' || !isFinite(price)) return null;
            sum += price * lines[i].quantity;
        }
        return Math.round(sum * 100) / 100;
    }

    /** Lines the currently resolved shop cannot supply. */
    function unavailableHere() {
        var context = window.StoreContext;
        if (!context || !context.hasStore()) return [];
        return lines.filter(function (line) {
            return context.availabilityOf(line.id) === 'withoutStock';
        });
    }

    window.Cart = {
        add: add,
        remove: remove,
        clear: clear,
        lines: function () { return lines.slice(); },
        count: count,
        total: total,
        unavailableHere: unavailableHere,
        onChange: function (fn) { listeners.push(fn); return fn; },
        key: KEY
    };
})(window);
