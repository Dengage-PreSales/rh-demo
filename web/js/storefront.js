/* ============================================================================
   Rendering the storefront.

   Layout and behaviour follow Ri Happy's own site closely: a yellow header band
   with a postcode chip in it, a postcode gateway on first visit, gift by age
   chips as first class navigation, and product cards carrying a discount badge,
   an instalment line and a green add button.

   This module draws. It never decides whether something is available: every
   availability claim on the page comes from Availability, which in turn only
   speaks when StoreContext has an answer for that exact product and shop.
   ========================================================================== */
(function (window, document) {
    'use strict';

    var copy = {};
    var config = {};

    /* ------------------------------------------------------------------ */
    /* Words, money and escaping                                           */

    function t(key, vars) {
        var text = copy[key];
        if (text === undefined) return key;
        if (!vars) return text;
        return String(text).replace(/\{(\w+)\}/g, function (whole, name) {
            return vars[name] === undefined || vars[name] === null ? '' : String(vars[name]);
        });
    }

    function locale() { return (config.locale || {}).numberLocale || 'pt-BR'; }
    function symbol() { return (config.locale || {}).currencySymbol || 'R$'; }

    /* A price is only ever formatted from a real number. Anything else returns
       an empty string rather than a zero, because a zero reads as free. */
    function money(value) {
        if (typeof value !== 'number' || !isFinite(value)) return '';
        var formatted = new Intl.NumberFormat(locale(), {
            minimumFractionDigits: 2, maximumFractionDigits: 2
        }).format(value);
        return symbol() + ' ' + formatted;
    }

    function escapeText(value) {
        return String(value === undefined || value === null ? '' : value)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function escapeAttr(value) {
        return escapeText(value).replace(/"/g, '&quot;');
    }

    function media(product) {
        if (product && product.image) {
            return '<img src="' + escapeAttr(product.image) + '" alt="' +
                   escapeAttr(product.name) + '" loading="lazy">';
        }
        return '<div class="card-media"></div>';
    }

    /* Their own cards carry an instalment line under the price, which is a very
       Brazilian detail and one of the first things that makes the page read as
       theirs. The split is chosen the way a shop does it: bigger baskets get
       more instalments, and anything cheap is shown as a single payment. */
    function instalmentLine(price) {
        if (typeof price !== 'number' || !isFinite(price) || price <= 0) return '';
        var count = price >= 300 ? 6 : price >= 150 ? 4 : price >= 60 ? 2 : 1;
        var each = Math.round((price / count) * 100) / 100;
        return t('instalments', { n: count, price: money(each) });
    }

    /* ------------------------------------------------------------------ */
    /* Cards                                                               */

    function card(product) {
        var discount = product.listPrice
            ? Math.round((1 - product.price / product.listPrice) * 100)
            : 0;
        return '' +
        '<article class="card" data-product-id="' + escapeAttr(product.id) + '">' +
            (discount >= 5 ? '<span class="card-flag">' +
                escapeText(t('saveBadge', { n: discount })) + '</span>' : '') +
            /* Their favourite control sits on the tile itself. It carries no
               state here: Wishlist paints every heart after any repaint, so a
               grid redrawn on a shop change cannot leave a stale one. */
            '<button class="heart" data-heart="' + escapeAttr(product.id) + '" ' +
                'aria-pressed="false" aria-label="' + escapeAttr(t('wishlistAdd')) + '">' +
                '\u2661</button>' +
            '<a class="card-media" href="' + escapeAttr(product.url) + '">' +
                media(product) +
            '</a>' +
            '<div class="card-body">' +
                '<a href="' + escapeAttr(product.url) + '">' +
                    '<div class="card-name">' + escapeText(product.name) + '</div>' +
                '</a>' +
                '<div class="price-row">' +
                    (product.listPrice
                        ? '<span class="price-was">' + money(product.listPrice) + '</span>'
                        : '') +
                    '<span class="price-now">' + money(product.price) + '</span>' +
                '</div>' +
                '<div class="installments">' + escapeText(instalmentLine(product.price)) + '</div>' +
                '<div data-availability-slot></div>' +
                '<button class="add-button" data-add="' + escapeAttr(product.id) + '">' +
                    escapeText(t('addToCart')) +
                '</button>' +
            '</div>' +
        '</article>';
    }

    function renderGrid(host, products) {
        if (!host) return;
        host.innerHTML = products.map(card).join('');
        window.Availability.paintGrid(host);
    }

    /* ------------------------------------------------------------------ */
    /* The header chip, which mirrors the one on their own site            */

    function paintChip() {
        var chip = document.getElementById('store-chip');
        if (!chip) return;
        var ctx = window.StoreContext;
        var state = ctx.state();
        var text = '';
        var label = '';

        if (state.status === 'loading') {
            text = t('storeChipLoading');
        } else if (state.status === 'store' && state.store) {
            label = t('storeChipLabel');
            text = state.store.name;
        } else if (state.status === 'unavailable') {
            text = t('storeChipUnavailable');
        } else {
            text = t('storeChipEmpty');
        }

        chip.setAttribute('data-state', state.status);
        chip.innerHTML = '<span class="pin">▾</span>' +
            (label ? '<span class="chip-label">' + escapeText(label) + '</span>' : '') +
            '<span class="chip-text">' + escapeText(text) + '</span>';
    }

    /* ------------------------------------------------------------------ */
    /* The postcode gateway                                                */

    function openCep() {
        var overlay = document.getElementById('cep-overlay');
        if (!overlay) return;
        overlay.classList.add('is-open');
        var input = document.getElementById('cep-input');
        if (input) { input.value = ''; input.focus(); }
        setCepError('');
        paintOtherStores();
    }

    function closeCep() {
        var overlay = document.getElementById('cep-overlay');
        if (overlay) overlay.classList.remove('is-open');
    }

    function setCepError(message) {
        var host = document.getElementById('cep-error');
        if (host) host.textContent = message || '';
    }

    /* The other shops serving this postcode. Shown because a customer choosing
       between two nearby shops is a real thing their site supports, and because
       it makes plain that "the shop" is a resolved choice rather than magic. */
    function paintOtherStores() {
        var host = document.getElementById('cep-stores');
        if (!host) return;
        var state = window.StoreContext.state();
        var others = (state.stores || []).filter(function (s) {
            return !state.store || s.id !== state.store.id;
        });
        if (!others.length) { host.innerHTML = ''; return; }

        /* The count is stated and the list scrolls, rather than eight being
           shown as though eight were all there were. 37 shops serve Avenida
           Paulista; a silent cap made that look like 9 and made the resolved
           shop look like a shortlist rather than a choice out of many. A cap
           that hides how much it hid is the same fault as a filter that
           silently matches everything. */
        var total = (state.stores || []).length;
        host.innerHTML =
            '<div class="store-list-head">' +
                escapeText(t('cepOtherStores', { count: total })) +
            '</div>' +
            '<div class="store-list">' + others.map(function (s) {
                return '<button type="button" data-pick-store="' + escapeAttr(s.id) + '">' +
                    '<span class="store-name">' + escapeText(s.name) + '</span>' +
                    (s.mall ? '<span class="store-where">' + escapeText(s.mall) + '</span>' : '') +
                '</button>';
            }).join('') + '</div>';
    }

    function submitCep() {
        var input = document.getElementById('cep-input');
        if (!input) return;
        var digits = String(input.value || '').replace(/[^0-9]/g, '');
        if (digits.length !== 8) { setCepError(t('cepInvalid')); return; }
        setCepError('');
        window.StoreContext.setCep(digits, { sku: currentProductId() }).then(function (state) {
            if (state.status === 'unknown_cep') { setCepError(t('cepUnknown')); return; }
            closeCep();
        });
    }

    function useLocation() {
        setCepError('');
        window.StoreContext.useLocation({ sku: currentProductId() }).then(function (state) {
            if (state.locationRefused) { setCepError(t('cepLocationDenied')); return; }
            if (state.status === 'store' || state.status === 'no_store') closeCep();
        });
    }

    function currentProductId() {
        var match = /[?&]id=([^&#]*)/.exec(window.location.search);
        if (!match) return null;
        try { return decodeURIComponent(match[1]); } catch (err) { return match[1]; }
    }

    /* ------------------------------------------------------------------ */
    /* Age chips, mirroring their "gift by age" navigation                 */

    var activeAge = null;
    var activeDepartment = null;
    var outletOnly = false;

    function ageChips(host) {
        if (!host) return;
        var chips = config.ageChips || [];
        /* The tints are their own, sampled from their gift by age row, so this
           section is recognisably the one on their site rather than a pastel
           approximation of it. */
        host.innerHTML = chips.map(function (chip) {
            return '<button class="age-chip" data-age="' + escapeAttr(chip.id) + '" ' +
                   'aria-pressed="false" style="background:' + escapeAttr(chip.tint || '#eee') + '">' +
                   escapeText(chip.label) + '</button>';
        }).join('');
    }

    function matchesAge(product, chip) {
        if (product.ageMinMonths === null || product.ageMinMonths === undefined) return false;
        var min = chip.minMonths === undefined ? 0 : chip.minMonths;
        var max = chip.maxMonths === undefined ? 100000 : chip.maxMonths;
        var productMax = product.ageMaxMonths === null || product.ageMaxMonths === undefined
            ? 216 : product.ageMaxMonths;
        return product.ageMinMonths <= max && productMax >= min;
    }

    /* ------------------------------------------------------------------ */
    /* Filtering                                                           */

    var availableOnly = false;

    function visibleProducts() {
        var list = window.Catalog.all();
        /* Their department, from the catalogue's own values rather than a list
           written here, so it cannot drift from what was captured. */
        if (activeDepartment) {
            list = list.filter(function (p) { return p.department === activeDepartment; });
        }
        /* Outlet is a real discount or it is nothing. catalog.js already drops
           any list price that is not genuinely higher, so this cannot select a
           product whose saving was invented. */
        if (outletOnly) {
            list = list.filter(function (p) { return !!p.listPrice; });
        }
        if (activeAge) {
            var chip = (config.ageChips || []).filter(function (c) { return c.id === activeAge; })[0];
            if (chip) list = list.filter(function (p) { return matchesAge(p, chip); });
        }
        if (availableOnly && window.StoreContext.hasStore()) {
            list = list.filter(function (p) {
                return window.StoreContext.availabilityOf(p.id) === 'available';
            });
        }
        return list;
    }

    function paintHome() {
        var list = visibleProducts();
        renderGrid(document.getElementById('product-grid'), list);
        var count = document.getElementById('result-count');
        if (count) {
            count.textContent = t('resultCount', { count: list.length });
        }
        var filterButton = document.getElementById('filter-available');
        if (filterButton) {
            var has = window.StoreContext.hasStore();
            filterButton.hidden = !has;
            filterButton.setAttribute('aria-pressed', availableOnly ? 'true' : 'false');
            if (has) filterButton.textContent = t('filterAvailableOnly', { store: window.StoreContext.storeName() });
        }
        window.Availability.renderStateNotice(document.getElementById('state-notice'));
    }

    window.Storefront = {
        t: t,
        money: money,
        media: media,
        card: card,
        renderGrid: renderGrid,
        escapeText: escapeText,
        escapeAttr: escapeAttr,
        instalmentLine: instalmentLine,
        paintChip: paintChip,
        paintHome: paintHome,
        openCep: openCep,
        closeCep: closeCep,
        ageChips: ageChips,
        visibleProducts: visibleProducts,
        currentProductId: currentProductId,

        setCopy: function (value) { copy = value || {}; },
        setConfig: function (value) { config = value || {}; },
        setAge: function (id) { activeAge = id; },
        activeAge: function () { return activeAge; },
        setAvailableOnly: function (value) { availableOnly = !!value; },
        availableOnly: function () { return availableOnly; },
        setDepartment: function (name) { activeDepartment = name || null; },
        activeDepartment: function () { return activeDepartment; },
        setOutlet: function (value) { outletOnly = !!value; },
        outletOnly: function () { return outletOnly; },

        wire: function () {
            document.addEventListener('click', function (event) {
                var chip = event.target.closest ? event.target.closest('#store-chip') : null;
                if (chip) { openCep(); return; }

                var close = event.target.closest ? event.target.closest('[data-close-cep]') : null;
                if (close) { closeCep(); return; }

                var submit = event.target.closest ? event.target.closest('#cep-submit') : null;
                if (submit) { submitCep(); return; }

                var locate = event.target.closest ? event.target.closest('#cep-locate') : null;
                if (locate) { useLocation(); return; }

                var clear = event.target.closest ? event.target.closest('#cep-clear') : null;
                if (clear) { window.StoreContext.clear(); closeCep(); return; }

                var pick = event.target.closest ? event.target.closest('[data-pick-store]') : null;
                if (pick) {
                    window.StoreContext.setStore(pick.getAttribute('data-pick-store'),
                                                 { sku: currentProductId() }).then(closeCep);
                    return;
                }

                var age = event.target.closest ? event.target.closest('[data-age]') : null;
                if (age) {
                    var id = age.getAttribute('data-age');
                    activeAge = activeAge === id ? null : id;
                    var all = document.querySelectorAll('[data-age]');
                    for (var i = 0; i < all.length; i += 1) {
                        all[i].setAttribute('aria-pressed',
                            all[i].getAttribute('data-age') === activeAge ? 'true' : 'false');
                    }
                    paintHome();
                    return;
                }

                var filter = event.target.closest ? event.target.closest('#filter-available') : null;
                if (filter) { availableOnly = !availableOnly; paintHome(); return; }

                var add = event.target.closest ? event.target.closest('[data-add]') : null;
                if (add && !add.hasAttribute('disabled')) {
                    var product = window.Catalog.get(add.getAttribute('data-add'));
                    if (product) window.Cart.add(product);
                    return;
                }
            });

            var input = document.getElementById('cep-input');
            if (input) {
                input.addEventListener('keydown', function (event) {
                    if (event.key === 'Enter') { event.preventDefault(); submitCep(); }
                });
                /* Format as they type, the way their own field does. */
                input.addEventListener('input', function () {
                    var digits = input.value.replace(/[^0-9]/g, '').slice(0, 8);
                    input.value = digits.length > 5 ? digits.slice(0, 5) + '-' + digits.slice(5) : digits;
                });
            }
        }
    };
})(window, document);
