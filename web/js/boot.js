/* ============================================================================
   Starting the storefront.

   Order matters here and it is worth stating why, because getting it wrong is
   silent rather than loud.

     identity.js has already run, in the head, before the Dengage snippet. That
     is what makes the contact key available to initialize rather than arriving
     five seconds later, by which time the first page view has gone out and
     landed on an anonymous device.

     Config and copy are fetched before anything is drawn, so no element is ever
     painted with a placeholder and then corrected on screen.

     The page view fires once the catalogue is known, so it can carry the page
     type. Every page fires one: that call is what makes this demo's rows
     findable afterwards, and a page that skips it writes basket rows nothing
     can attribute.

     The shop is resolved last, and the grid is repainted when it lands rather
     than waited for. A slow availability lookup must never hold up the shop.
   ========================================================================== */
(function (window, document) {
    'use strict';

    function applyTheme(theme) {
        if (!theme) return;
        var root = document.documentElement;
        var map = {
            header: '--header', onHeader: '--on-header',
            primary: '--primary', onPrimary: '--on-primary',
            accent: '--accent', sale: '--sale', highlight: '--highlight',
            cta: '--cta', onCta: '--on-cta',
            ink: '--ink', muted: '--muted', surface: '--surface',
            page: '--page', line: '--line', radius: '--radius'
        };
        for (var key in map) {
            if (theme[key]) root.style.setProperty(map[key], theme[key]);
        }
        if (theme.displayFont) root.style.setProperty('--display-font', theme.displayFont + ', system-ui, sans-serif');
        if (theme.bodyFont) root.style.setProperty('--body-font', theme.bodyFont + ', system-ui, sans-serif');
    }

    /* Fill every element carrying a copy key. Doing it from one file means a
       Portuguese version is a file swap rather than an edit of the markup. */
    function applyCopy(copy) {
        var nodes = document.querySelectorAll('[data-copy]');
        for (var i = 0; i < nodes.length; i += 1) {
            var key = nodes[i].getAttribute('data-copy');
            if (copy[key] !== undefined) nodes[i].textContent = copy[key];
        }
        var attrNodes = document.querySelectorAll('[data-copy-attr]');
        for (var j = 0; j < attrNodes.length; j += 1) {
            var pair = attrNodes[j].getAttribute('data-copy-attr').split(':');
            if (pair.length === 2 && copy[pair[1]] !== undefined) {
                attrNodes[j].setAttribute(pair[0], copy[pair[1]]);
            }
        }
    }

    function fail(message) {
        var main = document.querySelector('main');
        if (main) {
            main.innerHTML = '<div class="wrap"><div class="notice" data-tone="warn">' +
                '<div><strong>This demo could not load its catalogue.</strong>' +
                String(message || '') + '</div></div></div>';
        }
    }

    function json(url) {
        return window.fetch(url, { cache: 'no-store' }).then(function (response) {
            if (!response.ok) throw new Error(url + ' returned ' + response.status);
            return response.json();
        });
    }


    /* A real title per page, for the browser tab and for the row Dengage keeps. */
    function setTitle(pageType) {
        var suffix = 'Dengage eComm Demo';
        if (pageType === 'product') {
            var product = window.Catalog.get(window.Storefront.currentProductId());
            document.title = product ? product.name + ' | ' + suffix : suffix;
            return;
        }
        document.title = 'Toys, gifts and games | ' + suffix;
    }

    /* THE SHOP LIST IS 108 KB AND ONLY "use my location" READS IT, so it is
       fetched when that button is pressed rather than on every page load. It
       used to sit in the blocking set below, which meant every visitor
       downloaded it and every page view waited behind it. Almost nobody presses
       the button.

       FULFILLING SHOPS ONLY, and this filter is the whole point of the list
       rather than a detail. 78 of the 202 shops we hold are ones their own
       checkout never offered for collection at any postcode we tested, and
       every one of them still carries a full stock map. Without the filter,
       pressing "use my location" anywhere near one of those 78 resolved it and
       the storefront then answered every availability question about a shop
       that does not fulfil. The postcode path never had this problem because
       rh_offer selects on is_pickup itself. Two paths, one of them filtering
       and the other not, is how a demo ends up contradicting the real
       storefront in front of the people who know it best. */
    var storesPromise = null;
    function loadStores() {
        if (!storesPromise) {
            storesPromise = json('stores.json')
                .catch(function () { return { stores: [] }; })
                .then(function (data) {
                    window.STORE_DIRECTORY = (data.stores || []).filter(function (s) {
                        return s.is_pickup === true &&
                               typeof s.lat === 'number' && typeof s.lng === 'number';
                    }).map(function (s) {
                        return { id: s.store_id, name: s.name, lat: s.lat, lng: s.lng };
                    });
                    return window.STORE_DIRECTORY;
                });
        }
        return storesPromise;
    }

    /* THE FIRST EVENT NO LONGER WAITS FOR THE SHOP LIST OR THE CATALOGUE, and
       that ordering is the point of this function rather than a refinement.

       Measured at 1051 ms on localhost with no network in the way. Every page
       view sat behind two round trips and roughly 220 KB: config, copy and the
       shop list together, and only then the catalogue. On a conference room
       network that is seconds, and it made this demo slower to report than any
       other implementation, which is exactly how it was noticed.

       A home page view needs nothing. Its title is a fixed string and its
       payload is empty, so it fires at once. A product page view needs the
       catalogue, for its product id, price and category path, and for the title
       the SDK reads at the moment of the call, so it waits on that one fetch
       and on nothing else.

       tools/check-first-event.mjs measures both and fails over budget. */
    function boot(pageType) {
        var configPromise = json('demo.config.json');
        var copyPromise = json('copy.json');
        var catalogPromise = window.Catalog.load('products.json');

        if (pageType === 'home') {
            setTitle('home');
            if (window.DengageEvents) window.DengageEvents.pageview('home', {});
        } else {
            catalogPromise.then(function () {
                setTitle('product');
                if (!window.DengageEvents) return;
                var early = window.Catalog.get(window.Storefront.currentProductId());
                window.DengageEvents.pageview('product', early ? {
                    productId: early.id,
                    price: early.price,
                    categoryPath: early.categoryPath
                } : {});
            });
        }

        return Promise.all([configPromise, copyPromise, catalogPromise]).then(function (results) {
            var config = results[0];
            var copy = results[1];

            window.DEMO_CONFIG = config;
            window.DEMO_COPY = copy;

            /* The slug the storefront namespaces everything under must agree
               with the one in the markup, or two demos on this shared origin
               would quietly share a basket. */
            if (config.slug && window.DEMO_SLUG && config.slug !== window.DEMO_SLUG) {
                window.console.error('slug mismatch: markup says ' + window.DEMO_SLUG +
                                     ' and the config says ' + config.slug);
            }

            applyTheme(config.theme);
            applyCopy(copy);
            window.Storefront.setConfig(config);
            window.Storefront.setCopy(copy);

            return window.Catalog.load('products.json').then(function () {
                return { config: config, copy: copy };
            });
        }).then(function (loaded) {
            window.Storefront.wire();
            /* After Storefront.wire, because the drawer takes over the cart
               button and the count badge that the header set up. */
            if (window.CartDrawer) window.CartDrawer.wire();
            if (window.CheckoutView) window.CheckoutView.wire();
            if (window.SearchPanel) window.SearchPanel.wire();
            if (window.Account) window.Account.wire();
            if (window.Wishlist) window.Wishlist.wire();
            if (window.Nav && pageType === 'home') window.Nav.wire();
            window.Storefront.paintChip();

            window.StoreContext.onChange(function () {
                window.Storefront.paintChip();
                if (pageType === 'home') window.Storefront.paintHome();
                if (window.Wishlist) window.Wishlist.paintHearts();
                if (window.RhProductPage) window.RhProductPage.repaint();
            });

            /* The count badge used to be repainted here as well as in the
               drawer. Two owners for one element is how a number ends up stale
               in one place and current in the other, so the drawer owns it
               alone now, through the same listener that repaints the lines. */

            /* THE PAGE VIEW HAS ALREADY GONE, from the top of this function,
               and it does not fire again here. One page per row.

               The title is still set before it, and that order is the whole
               point. Every page used to call itself "Dengage eComm Demo", so
               page_title was the same string on every row in Dengage and could
               tell nobody which page anything happened on. The SDK reads the
               document title at the moment of the call, so it has to be right
               first, which is why setTitle sits beside each emit above rather
               than here.

               It names the page, never the prospect. "Ri Happy" in a browser
               tab would read as their own site, which is the one thing this
               demo must never imply. */

            return loaded;
        });
    }

    window.RhBoot = { boot: boot, fail: fail, loadStores: loadStores };
})(window, document);
