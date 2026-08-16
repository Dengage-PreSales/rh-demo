/* ============================================================================
   Checkout, built to the shape their own site describes.

   Their message bundle names every part of this, so none of it is invented:

     shippingSelectionModal.title            Escolha um metodo de envio
     shippingSelectionModal.deliveryButton   Entrega
     shippingSelectionModal.pickupButton     Retirada
     pickupSelection.title                   Escolha uma loja
     pickupSelection.noStoresState.title     Nao ha lojas disponiveis
     pickupSelection.noStoresState.button    Continuar com entrega
     checkout-summary.Items / Discounts / Shipping / Total
     checkout-summary.disclaimer             Taxas e frete calculados no Carrinho
     payment-form                            Meios de pagamento

   WHY THE DELIVERY AND PICKUP SPLIT IS THE POINT

   Ri Happy are 100 percent ship from store. Pickup is the mode where the
   resolved shop decides what you can have, so choosing Retirada is what turns
   an ordinary basket into their actual problem. Choose Entrega and the same
   basket is fine, because delivery is not constrained to one shop's shelf.

   That is also why their own no-stores state offers Continuar com entrega:
   when nothing serves a postcode, their site does not fail, it falls through
   to delivery. Vitoria and Rio Branco land exactly there, and so do we.

   THE ONE NUMBER THIS REFUSES TO PRINT

   We hold no freight table, so delivery has no shipping cost we could state
   without inventing it. Their own summary carries the disclaimer that fees and
   freight are calculated in the cart, so that is what delivery shows. Pickup
   shows free, which is not a guess: collecting it yourself has no freight by
   definition.
   ========================================================================== */
(function (window, document) {
    'use strict';

    var OPEN = 'is-open';
    var mode = 'pickup';   /* pickup | delivery */

    function sf() { return window.Storefront; }
    function ctx() { return window.StoreContext; }
    function t(key, vars) { return sf() ? sf().t(key, vars) : key; }
    function el(id) { return document.getElementById(id); }

    /* ------------------------------------------------------------------ */
    /* Opening and closing                                                 */

    function open() {
        var overlay = el('checkout-overlay');
        if (!overlay) return;
        if (!window.Cart.lines().length) return;

        /* Pickup unless no shop serves this visitor, in which case their own
           site's answer is delivery and so is ours. */
        mode = (ctx() && ctx().hasStore()) ? 'pickup' : 'delivery';

        paint();
        overlay.classList.add(OPEN);
        document.body.classList.add('has-drawer');

        if (window.DengageEvents) {
            window.DengageEvents.beginCheckout(window.Cart.lines());
        }
    }

    function close() {
        var overlay = el('checkout-overlay');
        if (overlay) overlay.classList.remove(OPEN);
        document.body.classList.remove('has-drawer');
    }

    function isOpen() {
        var overlay = el('checkout-overlay');
        return !!(overlay && overlay.classList.contains(OPEN));
    }

    /* ------------------------------------------------------------------ */
    /* What can actually be collected                                      */

    /* Lines the resolved shop cannot hand over. Empty when collecting is not
       the chosen mode, because delivery is not constrained to one shelf, and
       empty when no shop is resolved, because then nobody has been asked. */
    function blocked() {
        if (mode !== 'pickup') return [];
        return window.Cart.unavailableHere();
    }

    /* ------------------------------------------------------------------ */
    /* Painting                                                            */

    function methodHtml() {
        var s = sf();
        var context = ctx();
        var hasStore = context && context.hasStore();

        var pickupLabel = hasStore
            ? s.escapeText(t('checkoutPickupAt', { store: context.storeName() }))
            : s.escapeText(t('checkoutNoStores'));

        return '' +
            '<div class="method-choice" role="radiogroup" aria-label="' +
                s.escapeAttr(t('checkoutMethodTitle')) + '">' +
                '<button type="button" class="method" data-method="delivery"' +
                    (mode === 'delivery' ? ' aria-checked="true"' : ' aria-checked="false"') +
                    ' role="radio">' +
                    '<span class="method-name">' + s.escapeText(t('checkoutDelivery')) + '</span>' +
                    '<span class="method-note">' + s.escapeText(t('checkoutDeliveryNote')) + '</span>' +
                '</button>' +
                '<button type="button" class="method" data-method="pickup"' +
                    (mode === 'pickup' ? ' aria-checked="true"' : ' aria-checked="false"') +
                    (hasStore ? '' : ' disabled') +
                    ' role="radio">' +
                    '<span class="method-name">' + s.escapeText(t('checkoutPickup')) + '</span>' +
                    '<span class="method-note">' + pickupLabel + '</span>' +
                '</button>' +
            '</div>';
    }

    /* Their noStoresState, shown in the one situation it was written for. */
    function noStoresHtml() {
        if (ctx() && ctx().hasStore()) return '';
        var s = sf();
        return '' +
            '<div class="notice" data-tone="info">' +
                '<strong>' + s.escapeText(t('checkoutNoStoresTitle')) + '</strong>' +
                '<span class="notice-why">' + s.escapeText(t('checkoutNoStoresWhy')) + '</span>' +
            '</div>';
    }

    function blockedHtml() {
        var stuck = blocked();
        if (!stuck.length) return '';
        var s = sf();
        return '' +
            '<div class="notice" data-tone="warn">' +
                '<strong>' + s.escapeText(t('cartStuckTitle')) + '</strong>' +
                '<span class="notice-why">' +
                    s.escapeText(t('cartStuckWhy', { store: ctx().storeName() })) + '</span>' +
                '<ul class="stuck-list">' + stuck.map(function (line) {
                    return '<li>' + s.escapeText(line.name) + '</li>';
                }).join('') + '</ul>' +
                '<div class="notice-actions">' +
                    '<button type="button" class="button link" id="checkout-switch-delivery">' +
                        s.escapeText(t('checkoutContinueWithDelivery')) + '</button>' +
                '</div>' +
            '</div>';
    }

    function summaryHtml() {
        var s = sf();
        var lines = window.Cart.lines();
        var total = window.Cart.total();

        var subtotal = 0;
        var complete = total !== null;
        for (var i = 0; i < lines.length && complete; i += 1) {
            var before = typeof lines[i].listPrice === 'number' && isFinite(lines[i].listPrice)
                ? lines[i].listPrice
                : lines[i].price;
            if (typeof before !== 'number' || !isFinite(before)) { complete = false; break; }
            subtotal += before * lines[i].quantity;
        }
        var saved = complete ? Math.round((subtotal - total) * 100) / 100 : 0;

        /* Pickup is free because collecting it yourself has no freight. Delivery
           carries their own disclaimer rather than a figure we do not hold. */
        var shipping = mode === 'pickup'
            ? s.escapeText(t('checkoutShippingFree'))
            : s.escapeText(t('checkoutShippingDisclaimer'));

        return '' +
            '<dl class="cart-summary">' +
                '<div class="summary-row"><dt>' + s.escapeText(t('cartSubtotal')) + '</dt>' +
                    '<dd>' + (complete ? s.money(subtotal) : '') + '</dd></div>' +
                (saved > 0
                    ? '<div class="summary-row"><dt>' + s.escapeText(t('cartDiscounts')) + '</dt>' +
                      '<dd>-' + s.money(saved) + '</dd></div>'
                    : '') +
                '<div class="summary-row"><dt>' + s.escapeText(t('checkoutShipping')) + '</dt>' +
                    '<dd>' + shipping + '</dd></div>' +
                '<div class="summary-row is-total"><dt>' + s.escapeText(t('cartTotal')) + '</dt>' +
                    '<dd>' + (complete ? s.money(total) : '') + '</dd></div>' +
            '</dl>';
    }

    function paint() {
        var host = el('checkout-body');
        if (!host) return;
        host.innerHTML =
            noStoresHtml() +
            methodHtml() +
            blockedHtml() +
            summaryHtml() +
            '<div class="payment-block">' +
                '<h3>' + sf().escapeText(t('checkoutPayment')) + '</h3>' +
                '<label class="pay-option">' +
                    '<input type="radio" name="pay" value="credit_card" checked> ' +
                    sf().escapeText(t('checkoutCard')) +
                '</label>' +
                '<label class="pay-option">' +
                    '<input type="radio" name="pay" value="pix"> ' +
                    sf().escapeText(t('checkoutPix')) +
                '</label>' +
            '</div>';

        /* Collecting something the shop cannot hand over is the one state that
           must not be orderable, because it is the exact contradiction the
           storefront is being trusted not to make. */
        var place = el('checkout-place');
        if (place) place.disabled = blocked().length > 0 || window.Cart.total() === null;
    }

    /* ------------------------------------------------------------------ */
    /* Placing it                                                          */

    function place() {
        var lines = window.Cart.lines();
        var total = window.Cart.total();
        if (!lines.length || total === null || blocked().length) return;

        var chosen = document.querySelector('input[name="pay"]:checked');
        var itemCount = 0;
        for (var i = 0; i < lines.length; i += 1) itemCount += lines[i].quantity;

        /* The order id is this demo's own, and it says so. It is not a Ri Happy
           order number and must never be mistaken for one on a shared screen. */
        var orderId = 'RHDEMO-' + String(Date.now()).slice(-8);

        if (window.DengageEvents) {
            window.DengageEvents.order({
                orderId: orderId,
                itemCount: itemCount,
                totalAmount: total,
                discountedTotal: total,
                paymentMethod: chosen ? chosen.value : 'credit_card'
            }, lines);
        }

        window.Cart.clear();
        showDone(orderId);
    }

    function showDone(orderId) {
        var host = el('checkout-body');
        var s = sf();
        if (host) {
            host.innerHTML =
                '<div class="checkout-done">' +
                    '<div class="done-mark" aria-hidden="true">&#10003;</div>' +
                    '<h3>' + s.escapeText(t('checkoutDone')) + '</h3>' +
                    '<p>' + s.escapeText(t(mode === 'pickup'
                        ? 'checkoutDonePickup' : 'checkoutDoneDelivery',
                        { store: ctx() && ctx().hasStore() ? ctx().storeName() : '' })) + '</p>' +
                    '<p class="order-ref">' + s.escapeText(orderId) + '</p>' +
                '</div>';
        }
        var place = el('checkout-place');
        if (place) place.hidden = true;
        var done = el('checkout-close-done');
        if (done) done.hidden = false;
    }

    /* ------------------------------------------------------------------ */
    /* Wiring                                                              */

    function wire() {
        var closeButton = el('checkout-close');
        if (closeButton) closeButton.addEventListener('click', close);

        var overlay = el('checkout-overlay');
        if (overlay) {
            overlay.addEventListener('click', function (event) {
                if (event.target === overlay) close();
            });
        }

        document.addEventListener('keydown', function (event) {
            if (event.key === 'Escape' && isOpen()) close();
        });

        var body = el('checkout-body');
        if (body) {
            body.addEventListener('click', function (event) {
                var method = event.target.closest ? event.target.closest('.method') : null;
                if (method && !method.disabled) {
                    mode = method.getAttribute('data-method');
                    paint();
                    return;
                }
                if (event.target.id === 'checkout-switch-delivery') {
                    mode = 'delivery';
                    paint();
                }
            });
        }

        var place = el('checkout-place');
        if (place) place.addEventListener('click', placeSafely);

        var doneButton = el('checkout-close-done');
        if (doneButton) {
            doneButton.addEventListener('click', function () {
                close();
                var p = el('checkout-place');
                if (p) p.hidden = false;
                doneButton.hidden = true;
            });
        }
    }

    function placeSafely() {
        try { place(); } catch (err) {
            if (window.console) window.console.error('[checkout] ' + err.message);
        }
    }

    window.CheckoutView = {
        open: open,
        close: close,
        isOpen: isOpen,
        wire: wire,
        mode: function () { return mode; }
    };
})(window, document);
