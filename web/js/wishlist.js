/* ============================================================================
   Saved items, and the shop they were saved against.

   Their bundle names this surface: wishlist.addButton "Adicionar aos
   favoritos", wishlist-default-list-name "Lista de desejos",
   wishlist-product-added-to-list, myaccount-empty-list "Esta lista esta vazia",
   and wishlist-login "Iniciar sessao".

   THAT LAST ONE IS A BEHAVIOUR, NOT A LABEL. Their wishlist requires a sign in,
   so ours does too: the heart opens the sign in dialog and says why, rather
   than silently doing nothing. This is why W5 was built before this.

   WHY SAVED ITEMS EARN THEIR PLACE IN THIS DEMO

   A saved item is the longest lived signal a storefront collects. Somebody
   saves a toy in March and comes back in June, and in between the shop that
   serves them can change, the stock certainly does. So this is the surface
   where "available at your shop" stops being about the current page view and
   starts being about a standing intention, which is exactly what a triggered
   campaign acts on.

   The list therefore carries availability the same way the cart does: asked of
   StoreContext, silent when no shop is resolved, and repainted when the shop
   changes.

   THE EVENT PATH IS NOT THE SAME AS THE CART'S, and that is deliberate rather
   than an inconsistency. Wishlist rows go to Dengage through sendDeviceEvent to
   the named wishlist_events table, which dengageEvents.js already implements
   and pins, per the factory rule recorded there. Nothing here needs to know
   that; it calls addToWishlist and removeFromWishlist like anything else.
   ========================================================================== */
(function (window, document) {
    'use strict';

    var OPEN = 'is-open';
    var slug = window.DEMO_SLUG || 'rh-demo';
    var KEY = 'dps:' + slug + ':wishlist';

    var items = read();
    var listeners = [];

    function sf() { return window.Storefront; }
    function ctx() { return window.StoreContext; }
    function t(key, vars) { return sf() ? sf().t(key, vars) : key; }
    function el(id) { return document.getElementById(id); }

    function read() {
        try {
            var raw = window.localStorage.getItem(KEY);
            var parsed = raw ? JSON.parse(raw) : [];
            return Array.isArray(parsed) ? parsed : [];
        } catch (err) { return []; }
    }

    function save() {
        try { window.localStorage.setItem(KEY, JSON.stringify(items)); }
        catch (err) { /* private browsing */ }
        for (var i = 0; i < listeners.length; i += 1) {
            try { listeners[i](items); } catch (err) { /* one view must not stop the rest */ }
        }
        paintHearts();
        paintCount();
        if (isOpen()) paint();
    }

    function has(productId) {
        for (var i = 0; i < items.length; i += 1) {
            if (items[i].id === productId) return true;
        }
        return false;
    }

    /* ------------------------------------------------------------------ */
    /* Adding and removing                                                 */

    function add(product) {
        if (has(product.id)) return items;
        var context = ctx();
        items.push({
            id: product.id,
            name: product.name,
            price: product.price,
            listPrice: typeof product.listPrice === 'number' ? product.listPrice : null,
            image: product.image,
            categoryPath: product.categoryPath,
            /* The shop it was saved at, so a later change can be explained the
               same way the cart explains one. */
            savedAtStore: context && context.hasStore() ? context.storeName() : null,
            savedAt: Date.now()
        });
        save();
        if (window.DengageEvents) window.DengageEvents.addToWishlist(product);
        return items;
    }

    function remove(productId) {
        var removed = null;
        items = items.filter(function (item) {
            if (item.id !== productId) return true;
            removed = item;
            return false;
        });
        save();
        if (removed && window.DengageEvents) {
            window.DengageEvents.removeFromWishlist({ id: removed.id });
        }
        return items;
    }

    /* The heart. Their site sends an unauthenticated visitor to sign in, so
       this does too, and says which action prompted it. */
    function toggle(productId) {
        if (window.Account && !window.Account.isSignedIn()) {
            window.Account.open('loginWishlistReason');
            return false;
        }
        if (has(productId)) { remove(productId); return false; }
        var product = window.Catalog.get(productId);
        if (product) { add(product); return true; }
        return false;
    }

    /* ------------------------------------------------------------------ */
    /* Painting                                                            */

    function paintCount() {
        var badge = el('wishlist-count');
        if (!badge) return;
        badge.textContent = String(items.length);
        badge.hidden = items.length === 0;
    }

    /* Hearts live on tiles the grid rewrites, so this runs after any repaint
       rather than binding state into the card markup. */
    function paintHearts(root) {
        var scope = root || document;
        var hearts = scope.querySelectorAll('[data-heart]');
        for (var i = 0; i < hearts.length; i += 1) {
            var id = hearts[i].getAttribute('data-heart');
            var on = has(id);
            hearts[i].setAttribute('aria-pressed', on ? 'true' : 'false');
            hearts[i].textContent = on ? '♥' : '♡';
        }
    }

    function itemHtml(item) {
        var s = sf();
        var context = ctx();
        var note = '';
        if (context && context.hasStore()) {
            var state = context.availabilityOf(item.id);
            if (state !== 'unknown') {
                note = '<span class="line-note" data-state="' + state + '">' +
                    s.escapeText(state === 'available'
                        ? t('availableHere', { store: context.storeName() })
                        : t('notAvailableHere')) + '</span>';
            }
        }
        return '' +
            '<li class="cart-line" data-line-id="' + s.escapeAttr(item.id) + '">' +
                '<div class="line-media">' +
                    (item.image ? '<img src="' + s.escapeAttr(item.image) + '" alt="" loading="lazy">' : '') +
                '</div>' +
                '<div class="line-body">' +
                    '<div class="line-name">' + s.escapeText(item.name) + '</div>' +
                    (typeof item.price === 'number'
                        ? '<div class="line-price">' + s.money(item.price) + '</div>' : '') +
                    note +
                    '<div class="line-controls">' +
                        '<button type="button" class="button link wish-add">' +
                            s.escapeText(t('addToCart')) + '</button>' +
                        '<button type="button" class="button link wish-remove">' +
                            s.escapeText(t('cartRemove')) + '</button>' +
                    '</div>' +
                '</div>' +
            '</li>';
    }

    function paint() {
        var host = el('wishlist-lines');
        if (!host) return;
        host.innerHTML = items.length
            ? items.map(itemHtml).join('')
            : '<li class="cart-empty">' + sf().escapeText(t('wishlistEmpty')) + '</li>';
    }

    /* ------------------------------------------------------------------ */
    /* Opening and closing                                                 */

    function open() {
        var drawer = el('wishlist');
        if (!drawer) return;
        paint();
        drawer.classList.add(OPEN);
        var scrim = el('scrim');
        if (scrim) scrim.classList.add(OPEN);
        document.body.classList.add('has-drawer');
    }

    function close() {
        var drawer = el('wishlist');
        if (drawer) drawer.classList.remove(OPEN);
        var scrim = el('scrim');
        if (scrim && !(window.CartDrawer && window.CartDrawer.isOpen())) {
            scrim.classList.remove(OPEN);
        }
        document.body.classList.remove('has-drawer');
    }

    function isOpen() {
        var drawer = el('wishlist');
        return !!(drawer && drawer.classList.contains(OPEN));
    }

    /* ------------------------------------------------------------------ */
    /* Wiring                                                              */

    function wire() {
        var button = el('wishlist-button');
        if (button) {
            button.addEventListener('click', function () {
                if (isOpen()) close(); else open();
            });
        }

        var closeButton = el('wishlist-close');
        if (closeButton) closeButton.addEventListener('click', close);

        document.addEventListener('keydown', function (event) {
            if (event.key === 'Escape' && isOpen()) close();
        });

        /* Hearts anywhere on the page, including ones the grid has not drawn
           yet, which is why this is delegated from the document. */
        document.addEventListener('click', function (event) {
            var heart = event.target.closest ? event.target.closest('[data-heart]') : null;
            if (!heart) return;
            event.preventDefault();
            toggle(heart.getAttribute('data-heart'));
        });

        var host = el('wishlist-lines');
        if (host) {
            host.addEventListener('click', function (event) {
                var line = event.target.closest ? event.target.closest('.cart-line') : null;
                if (!line) return;
                var id = line.getAttribute('data-line-id');
                if (!id) return;
                if (event.target.classList.contains('wish-remove')) { remove(id); return; }
                if (event.target.classList.contains('wish-add')) {
                    var product = window.Catalog.get(id);
                    if (product) window.Cart.add(product);
                }
            });
        }

        if (ctx()) ctx().onChange(function () { if (isOpen()) paint(); });

        paintHearts();
        paintCount();
    }

    window.Wishlist = {
        wire: wire,
        open: open,
        close: close,
        isOpen: isOpen,
        add: add,
        remove: remove,
        toggle: toggle,
        has: has,
        items: function () { return items.slice(); },
        paintHearts: paintHearts,
        onChange: function (fn) { listeners.push(fn); return fn; }
    };
})(window, document);
