/* ============================================================================
   The bag, on screen.

   The bag itself already existed in cart.js and already recorded which shop
   each line was added at. What did not exist was any way for a person to open
   it, which meant the two events a demo leans on hardest, addToCart and
   removeFromCart, could be fired but never seen by anyone in the room.

   WHY THIS IS NOT JUST SHOP FURNITURE

   Ri Happy ship from store and hold no central warehouse, so a basket is where
   their actual problem becomes visible. Fill a bag in Sao Paulo, change the
   postcode to Porto Alegre, and some of those lines cannot be collected any
   more. That is the whole of Use Case 1 happening to something the visitor
   chose themselves rather than to a grid of tiles.

   So the drawer marks those lines and says which shop it is talking about. It
   does not remove them, and it does not decide for anybody: a customer may well
   still want the item delivered, and quietly emptying somebody's bag because
   they typed a postcode would be its own kind of wrong.

   THE ONE RULE THIS SHARES WITH EVERY OTHER SURFACE

   It makes no availability claim of its own. It asks StoreContext, exactly as
   the grid and the product page do, and when no shop is resolved it says
   nothing at all rather than treating unknown as unavailable.
   ========================================================================== */
(function (window, document) {
    'use strict';

    var OPEN = 'is-open';

    function sf() { return window.Storefront; }
    function ctx() { return window.StoreContext; }
    function t(key, vars) { return sf() ? sf().t(key, vars) : key; }

    function el(id) { return document.getElementById(id); }

    /* ------------------------------------------------------------------ */
    /* Opening and closing                                                 */

    function open() {
        var drawer = el('cart');
        if (!drawer) return;
        paint();
        drawer.classList.add(OPEN);
        var scrim = el('scrim');
        if (scrim) scrim.classList.add(OPEN);
        document.body.classList.add('has-drawer');
        var close = el('cart-close');
        if (close) close.focus();

        /* Announces that the cart is open, so a panel campaign can decide
           whether to place anything in the banner slot above the lines. It goes
           out as rh_cart_opened: dengageEvents prefixes every scenario from the
           config, so this file names the moment and never the prefix.

           The slot is a div that already exists in the markup whether or not
           anything ever fills it, which is what inline campaigns need: they
           inject at a selector, so the selector has to resolve on an untouched
           page. */
        if (window.DengageEvents && window.DengageEvents.scenario) {
            window.DengageEvents.scenario('cart_opened');
        }
    }

    function close() {
        var drawer = el('cart');
        if (drawer) drawer.classList.remove(OPEN);
        var scrim = el('scrim');
        if (scrim) scrim.classList.remove(OPEN);
        document.body.classList.remove('has-drawer');
    }

    function isOpen() {
        var drawer = el('cart');
        return !!(drawer && drawer.classList.contains(OPEN));
    }

    /* ------------------------------------------------------------------ */
    /* Painting                                                            */

    /* Empty string when no shop is resolved, which is the same silence the
       grid keeps. Only a captured answer produces a mark either way. */
    function lineNote(line) {
        var context = ctx();
        if (!context || !context.hasStore()) return '';
        var state = context.availabilityOf(line.id);
        if (state === 'unknown') return '';
        var store = context.storeName();
        if (state === 'available') {
            return '<span class="line-note" data-state="available">' +
                sf().escapeText(t('availableHere', { store: store })) + '</span>';
        }
        return '<span class="line-note" data-state="withoutStock">' +
            sf().escapeText(t('notAvailableHere', { store: store })) + '</span>';
    }

    function lineHtml(line) {
        var s = sf();
        var price = typeof line.price === 'number' && isFinite(line.price)
            ? s.money(line.price)
            : '';

        return '' +
            '<li class="cart-line" data-line-id="' + s.escapeAttr(line.id) + '">' +
                '<div class="line-media">' +
                    (line.image
                        ? '<img src="' + s.escapeAttr(line.image) + '" alt="" loading="lazy">'
                        : '') +
                '</div>' +
                '<div class="line-body">' +
                    '<div class="line-name">' + s.escapeText(line.name) + '</div>' +
                    (price ? '<div class="line-price">' + price + '</div>' : '') +
                    lineNote(line) +
                    '<div class="line-controls">' +
                        '<button type="button" class="step" data-step="-1" ' +
                            'aria-label="One fewer">-</button>' +
                        '<span class="line-qty">' + s.escapeText(String(line.quantity)) + '</span>' +
                        '<button type="button" class="step" data-step="1" ' +
                            'aria-label="One more">+</button>' +
                        '<button type="button" class="button link line-remove">' +
                            s.escapeText(t('cartRemove')) + '</button>' +
                    '</div>' +
                '</div>' +
            '</li>';
    }

    /* The unavailable items block, and the reason this drawer exists.

       NOT OURS, which is worth recording because it was briefly described as an
       invention. Their own site carries this pattern already: its message
       bundle defines unavailableItems.title, a forPickup description, a Remove
       items button and an Enter another location button, alongside availability
       badges reading Recolha em and Recolha indisponivel. This is that block,
       with their labels in English and their two actions.

       So the thing Dengage adds is not the idea that a shop cannot supply
       something. Their storefront says that already. It is that the same answer
       reaches a person who is not on the site.

       It appears only when a shop is resolved AND that shop cannot supply
       something already in the bag. Both halves matter: without the first it
       would be guessing, and without the second it would be noise. */
    function noticeHtml() {
        var context = ctx();
        if (!context || !context.hasStore()) return '';
        var stuck = window.Cart.unavailableHere();
        if (!stuck.length) return '';

        var s = sf();
        var names = stuck.map(function (line) {
            return '<li>' + s.escapeText(line.name) + '</li>';
        }).join('');

        return '' +
            '<div class="notice" data-tone="warn" id="cart-notice">' +
                '<strong>' + s.escapeText(t('cartStuckTitle')) + '</strong>' +
                '<span class="notice-why">' +
                    s.escapeText(t('cartStuckWhy', { store: context.storeName() })) + '</span>' +
                '<ul class="stuck-list">' + names + '</ul>' +
                '<div class="notice-actions">' +
                    '<button type="button" class="button link" id="stuck-remove">' +
                        s.escapeText(t('cartStuckRemove')) + '</button>' +
                    '<button type="button" class="button link" id="stuck-relocate">' +
                        s.escapeText(t('cartStuckRelocate')) + '</button>' +
                '</div>' +
            '</div>';
    }

    function paint() {
        var host = el('cart-lines');
        var lines = window.Cart.lines();
        var s = sf();

        if (host) {
            host.innerHTML = lines.length
                ? lines.map(lineHtml).join('')
                : '<li class="cart-empty">' + s.escapeText(t('cartEmpty')) + '</li>';
        }

        var notice = el('cart-notice-host');
        if (notice) notice.innerHTML = noticeHtml();

        /* Null total means at least one line has no usable price. Showing zero
           there would be inventing a number, and a checkout that implies free
           is worse than one that is politely unavailable. */
        var total = window.Cart.total();
        var totalHost = el('cart-total');
        if (totalHost) totalHost.textContent = total === null ? '' : s.money(total);

        /* Their summary carries Subtotal, Descontos, Impostos and Total. We can
           compute three of those honestly and not the fourth, so tax is absent
           rather than guessed.

           Subtotal is what these lines cost before any saving, which means the
           list price wherever a line has one. The discount is the difference,
           and it is a real figure from their own catalogue rather than a
           decoration: it is only shown when at least one line genuinely carries
           a higher list price. */
        var subtotal = 0;
        var sawEverything = true;
        var lineList = window.Cart.lines();
        for (var i = 0; i < lineList.length; i += 1) {
            var line = lineList[i];
            var before = typeof line.listPrice === 'number' && isFinite(line.listPrice)
                ? line.listPrice
                : line.price;
            if (typeof before !== 'number' || !isFinite(before)) { sawEverything = false; break; }
            subtotal += before * line.quantity;
        }

        var subHost = el('cart-subtotal');
        var discountRow = el('cart-discount-row');
        var discountHost = el('cart-discount');
        var showMoney = sawEverything && total !== null;
        var saved = showMoney ? Math.round((subtotal - total) * 100) / 100 : 0;

        if (subHost) subHost.textContent = showMoney ? s.money(subtotal) : '';
        if (discountRow) discountRow.hidden = !(showMoney && saved > 0);
        if (discountHost) discountHost.textContent = saved > 0 ? '-' + s.money(saved) : '';

        var checkout = el('cart-checkout');
        if (checkout) checkout.disabled = !lines.length || total === null;

        paintCount();
    }

    function paintCount() {
        var badge = el('cart-count');
        if (!badge) return;
        var n = window.Cart.count();
        badge.textContent = String(n);
        badge.hidden = n === 0;
    }

    /* ------------------------------------------------------------------ */
    /* Wiring                                                              */

    function wire() {
        var button = el('cart-button');
        if (button) {
            button.addEventListener('click', function () {
                if (isOpen()) close(); else open();
            });
        }

        var closeButton = el('cart-close');
        if (closeButton) closeButton.addEventListener('click', close);

        var scrim = el('scrim');
        if (scrim) scrim.addEventListener('click', close);

        document.addEventListener('keydown', function (event) {
            if (event.key === 'Escape' && isOpen()) close();
        });

        /* One listener for the whole list rather than one per line, because the
           list is rewritten on every change and per line listeners would be
           rebound each time. */
        var host = el('cart-lines');
        if (host) {
            host.addEventListener('click', function (event) {
                var line = event.target.closest ? event.target.closest('.cart-line') : null;
                if (!line) return;
                var id = line.getAttribute('data-line-id');
                if (!id) return;

                if (event.target.classList.contains('line-remove')) {
                    window.Cart.remove(id);
                    return;
                }
                var step = event.target.getAttribute('data-step');
                if (step) window.Cart.changeQuantity(id, Number(step));
            });
        }

        /* Their two actions on the unavailable items block, and both do the
           thing they say. The block is rewritten on every repaint, so these are
           delegated from the host rather than bound to the buttons. */
        var noticeHost = el('cart-notice-host');
        if (noticeHost) {
            noticeHost.addEventListener('click', function (event) {
                if (event.target.id === 'stuck-remove') {
                    /* Removes exactly the lines named above the button, one at
                       a time so each leaves its own event, the same as pressing
                       Remove on each line. */
                    var stuck = window.Cart.unavailableHere();
                    for (var i = 0; i < stuck.length; i += 1) window.Cart.remove(stuck[i].id);
                    paint();
                }
                if (event.target.id === 'stuck-relocate') {
                    /* Their retry button reopens the location picker, which
                       here is the postcode gateway the storefront already has. */
                    close();
                    if (sf() && sf().openCep) sf().openCep();
                }
            });
        }

        var checkout = el('cart-checkout');
        if (checkout) {
            checkout.addEventListener('click', function () {
                /* Checkout is W2. Until it exists this says so plainly rather
                   than doing nothing, because a button that silently ignores a
                   click is the thing that made this drawer necessary. */
                if (window.CheckoutView && window.CheckoutView.open) {
                    close();
                    window.CheckoutView.open();
                }
            });
        }

        /* Repaint when the bag changes, and when the shop changes, because the
           second is what turns a normal basket into the ship from store scene. */
        window.Cart.onChange(function () { if (isOpen()) paint(); else paintCount(); });
        if (ctx()) ctx().onChange(function () { if (isOpen()) paint(); });

        paintCount();
    }

    window.CartDrawer = {
        open: open,
        close: close,
        isOpen: isOpen,
        paint: paint,
        wire: wire
    };
})(window, document);
