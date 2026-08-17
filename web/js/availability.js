/* ============================================================================
   Putting availability on screen.

   One module owns every availability claim the storefront makes, so there is a
   single place to check that the rules below hold. They are the rules Ri Happy
   is buying, and each one is here because the opposite is what their incumbent
   did.

     A badge appears only when a shop is resolved AND a captured answer exists
     for that exact pair. Unknown renders nothing at all, because silence is
     honest and a guess is not.

     No badge ever carries a number. Their checkout tells us which shops can
     hand a product over and never how many are on the shelf, so a count would
     be invented, and inventing one in front of the people who own the real
     stock ledger is the fastest way to lose the room.

     A substitution is always labelled, always names the shop it is about, and
     always says why that particular toy was chosen. A quiet swap is the same
     failure as a false promise, just better dressed.
   ========================================================================== */
(function (window, document) {
    'use strict';

    function t(key, vars) {
        return window.Storefront ? window.Storefront.t(key, vars) : key;
    }

    function money(value) {
        return window.Storefront ? window.Storefront.money(value) : String(value);
    }

    function context() { return window.StoreContext; }

    /* ------------------------------------------------------------------ */
    /* Badges                                                              */

    /**
     * The markup for one product's availability, or an empty string.
     * Empty is a real answer and the common one before a shop is chosen.
     */
    function badgeFor(productId) {
        var ctx = context();
        if (!ctx || !ctx.hasStore()) return '';
        var state = ctx.availabilityOf(productId);
        if (state === 'unknown') return '';
        var store = ctx.storeName();
        var label = state === 'available'
            ? t('availableHere', { store: store })
            : t('notAvailableHere', { store: store });
        var mark = state === 'available' ? '✓' : '✗';
        return '<span class="avail" data-state="' + state + '">' + mark + ' ' +
               window.Storefront.escapeText(label) + '</span>';
    }

    /** Repaint every tile already on the page after the shop changes. */
    function paintGrid(root) {
        var scope = root || document;
        var cards = scope.querySelectorAll('.card[data-product-id]');
        for (var i = 0; i < cards.length; i += 1) {
            paintCard(cards[i]);
        }
    }

    function paintCard(card) {
        var ctx = context();
        var id = card.getAttribute('data-product-id');
        var slot = card.querySelector('[data-availability-slot]');
        var state = ctx && ctx.hasStore() ? ctx.availabilityOf(id) : 'unknown';
        card.setAttribute('data-availability', state);
        if (slot) slot.innerHTML = badgeFor(id);

        /* A product the resolved shop cannot supply is not addable, and the
           button says which shop it is talking about rather than just greying
           out with no explanation. */
        var button = card.querySelector('.add-button');
        if (!button) return;
        if (state === 'withoutStock') {
            button.setAttribute('disabled', 'disabled');
            button.textContent = t('outOfStockHere');
        } else {
            button.removeAttribute('disabled');
            button.textContent = t('addToCart');
        }
    }

    /* ------------------------------------------------------------------ */
    /* Substitution                                                        */

    var REASON_COPY = {
        same_licence: 'substituteReasonSameLicence',
        same_age_and_shelf: 'substituteReasonSameAgeShelf',
        same_shelf: 'substituteReasonSameShelf',
        nearby_price: 'substituteReasonNearbyPrice'
    };

    /**
     * The panel shown on a product page when the resolved shop cannot supply
     * the product being looked at.
     *
     * The replacement is taken from the offer endpoint when it provided one, so
     * the page and the email agree, and computed locally only as a fallback.
     * Either way the candidate must be available at this shop: a substitution
     * that is itself unavailable is worse than none.
     */
    function substitutionFor(product) {
        var ctx = context();
        if (!ctx || !ctx.hasStore()) return null;
        if (ctx.availabilityOf(product.id) !== 'withoutStock') return null;

        var state = ctx.state();
        var chosen = null;
        var reason = null;

        if (state.substitute && state.hero && String(state.hero.sku_id) === String(product.id)) {
            chosen = window.Catalog.get(state.substitute.sku_id) || null;
            reason = state.substituteReason;
        }

        if (!chosen) {
            var pool = window.Catalog.all().filter(function (candidate) {
                return ctx.availabilityOf(candidate.id) === 'available';
            });
            var ranked = window.Catalog.similarTo(product, pool, 1);
            if (ranked.length) {
                chosen = ranked[0].product;
                reason = ranked[0].reason;
            }
        }

        if (!chosen) return { product: null, reason: null };
        return { product: chosen, reason: reason };
    }

    function renderSubstitution(product, host) {
        if (!host) return;
        var result = substitutionFor(product);
        if (!result) { host.innerHTML = ''; return; }

        var store = context().storeName();
        if (!result.product) {
            host.innerHTML = '<div class="notice" data-tone="warn"><div><strong>' +
                window.Storefront.escapeText(t('substituteHead', { store: store })) +
                '</strong>' + window.Storefront.escapeText(t('substituteNone')) + '</div></div>';
            return;
        }

        var replacement = result.product;
        var reasonKey = REASON_COPY[result.reason] || 'substituteReasonNearbyPrice';
        host.innerHTML =
            '<div class="substitute">' +
                '<div class="substitute-head">' +
                    window.Storefront.escapeText(t('substituteHead', { store: store })) +
                    '<span class="substitute-reason">' +
                        window.Storefront.escapeText(t(reasonKey)) +
                    '</span>' +
                '</div>' +
                '<div class="substitute-why">' +
                    window.Storefront.escapeText(t('substituteWhy')) +
                '</div>' +
                '<div class="substitute-body">' +
                    '<a class="card-media" href="' + window.Storefront.escapeAttr(replacement.url) + '">' +
                        window.Storefront.media(replacement) +
                    '</a>' +
                    '<div>' +
                        '<a href="' + window.Storefront.escapeAttr(replacement.url) + '">' +
                            '<div class="card-name">' +
                                window.Storefront.escapeText(replacement.name) +
                            '</div>' +
                        '</a>' +
                        '<div class="price-row">' +
                            '<span class="price-now">' + money(replacement.price) + '</span>' +
                        '</div>' +
                        '<div style="margin-top:8px">' + badgeFor(replacement.id) + '</div>' +
                    '</div>' +
                '</div>' +
            '</div>';

        /* TWO REPORTS OF ONE MOMENT, and they are not interchangeable.

           A customer shown a replacement is a customer whose first choice was
           not there, which is exactly the moment a marketer wants to follow up.
           Reporting it needs both of these:

             scenario() fires an on-site trigger. It reaches dataLayer and a
               window event and NOTHING ELSE. It never leaves the browser, so a
               segment can never be built on it, however plainly it shows in the
               readout.
             availabilitySeen() writes a stored row, which is the one a segment
               and therefore a journey can act on.

           The first was here alone for a while and looked sufficient. It is
           not: it drives widgets, not audiences. */
        var ctx = context();
        var state = ctx ? ctx.state() : null;

        if (window.DengageEvents && window.DengageEvents.scenario) {
            window.DengageEvents.scenario('substitution_shown');
        }
        if (window.DengageEvents && window.DengageEvents.availabilitySeen && state && state.store) {
            window.DengageEvents.availabilitySeen({
                id: product.id,
                price: product.price,
                cep: state.cep,
                substituteId: replacement.id,
                substituteReason: result.reason
            }, state.store, 'withoutStock');
        }
    }

    /* ------------------------------------------------------------------ */
    /* The banner explaining an unresolved or unusual state                */

    function renderStateNotice(host) {
        if (!host) return;
        var ctx = context();
        var state = ctx ? ctx.state() : null;
        if (!state) { host.innerHTML = ''; return; }

        var tone = 'info';
        var head = '';
        var body = '';

        if (state.status === 'no_store') {
            tone = 'warn';
            head = t('noStoreHead');
            body = t('noStoreBody', { region: state.region || '' });
        } else if (state.status === 'unknown_cep') {
            tone = 'warn';
            head = t('unknownCepHead');
            body = t('unknownCepBody');
        } else if (state.status === 'unavailable') {
            tone = 'quiet';
            head = t('unavailableHead');
            body = t('unavailableBody');
        } else if (state.locationRefused) {
            tone = 'quiet';
            head = '';
            body = t('cepLocationDenied');
        } else {
            host.innerHTML = '';
            return;
        }

        host.innerHTML = '<div class="notice" data-tone="' + tone + '"><div>' +
            (head ? '<strong>' + window.Storefront.escapeText(head) + '</strong>' : '') +
            window.Storefront.escapeText(body) +
            '</div></div>';
    }

    window.Availability = {
        badgeFor: badgeFor,
        paintGrid: paintGrid,
        paintCard: paintCard,
        substitutionFor: substitutionFor,
        renderSubstitution: renderSubstitution,
        renderStateNotice: renderStateNotice
    };
})(window, document);
