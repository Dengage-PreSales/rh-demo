/* ============================================================================
   Which shop is serving this visitor, and what that shop can actually hand over.

   This is the feature the whole demo exists to show. Everything else on the page
   is an ordinary storefront; this is the part that answers Ri Happy's question:
   availability is a fact about a pair, this product at that shop, and it changes
   with the customer's postcode.

   HOW A SHOP IS RESOLVED, in the order it is tried:

     1. a store id in the address bar, which is how the push notification and
        the app hand a visitor straight to a shop
     2. a postcode the visitor types
     3. the browser's own location, if they offer it and permission is granted
     4. nothing, and the storefront says so rather than guessing

   FOUR THINGS THIS MODULE REFUSES TO DO, each because the alternative would put
   a false claim on screen in front of the people who own the real stock ledger:

     it never shows a unit count, because their checkout publishes none
     it never treats "we have no answer" as "in stock"
     it never blocks the page on a slow lookup: after the timeout the shop
       badge disappears and the grid renders with no availability claims at all
     it never keeps a stale answer for a shop the visitor has since changed

   The answer is cached for a minute so moving around the site is instant, and
   deliberately re-fetched on every product page and whenever the visitor asks,
   because "current at render" is the requirement being demonstrated.
   ========================================================================== */
(function (window, document) {
    'use strict';

    var slug = window.DEMO_SLUG || 'rh-demo';
    var STORE_KEY = 'dps:' + slug + ':store';
    var FRESH_MS = 60000;

    var state = {
        status: 'idle',   /* idle | loading | store | no_store | unknown_cep | unavailable */
        cep: null,
        store: null,
        stores: [],
        region: null,
        stock: {},
        offers: [],
        hero: null,
        substitute: null,
        substituteReason: null,
        fetchedAt: 0,
        source: null      /* deeplink | cep | geolocation | cache */
    };

    var listeners = [];

    function config() { return window.DEMO_CONFIG || {}; }
    function api() { return (config().api) || {}; }

    function notify() {
        for (var i = 0; i < listeners.length; i += 1) {
            try { listeners[i](state); } catch (err) { /* a broken view must not stop the others */ }
        }
    }

    /* ------------------------------------------------------------------ */
    /* Talking to the offer endpoint                                       */

    /* Add ?offline=1 to any page and the live call fails on purpose, so the
       stored answer is what renders. It is the only way to see the fallback
       without waiting for a real outage, and a path that is never rehearsed is
       a path nobody should rely on during a call.

       It fails by asking this site for something that is not here, rather than
       by returning early. That matters: an early return would skip the response
       check, the catch and the chain into the fallback, which is to say it
       would skip everything the rehearsal is for. This way the real code runs
       and only the destination is wrong. */
    function offline() {
        try {
            return new window.URLSearchParams(window.location.search).get('offline') === '1';
        } catch (err) { return false; }
    }

    function buildUrl(params) {
        if (offline()) return 'offer/deliberately-not-here.json';
        var base = api().base;
        var query = [];
        for (var key in params) {
            if (params[key] === null || params[key] === undefined || params[key] === '') continue;
            query.push(encodeURIComponent(key) + '=' + encodeURIComponent(params[key]));
        }
        return base + '/rh_offer?' + query.join('&');
    }

    /* The timeout is the point of this function. A sales conversation cannot
       wait on a network call, so the page gives up quickly and renders without
       availability rather than showing a spinner while somebody is presenting. */
    function request(params) {
        var timeoutMs = api().timeoutMs || 3000;
        var controller = typeof AbortController === 'function' ? new AbortController() : null;
        var timer = window.setTimeout(function () { if (controller) controller.abort(); }, timeoutMs);

        return window.fetch(buildUrl(params), {
            method: 'GET',
            headers: { apikey: api().key, Accept: 'application/json' },
            signal: controller ? controller.signal : undefined
        }).then(function (response) {
            window.clearTimeout(timer);
            if (!response.ok) throw new Error('offer endpoint returned ' + response.status);
            return response.json();
        }).catch(function (err) {
            window.clearTimeout(timer);
            throw err;
        });
    }

    /* When the live call does not come back, a stored answer for that postcode
       is served from this site instead. It is marked, so the debug readout can
       always say which one was used.

       These files carry the page's shape rather than the message's. The two are
       not interchangeable and the difference is invisible if you get it wrong:
       a message needs one shop and one product, while a page needs the whole
       stock map to badge every tile, the store object for the header chip and
       the list of shops serving the postcode. An earlier version of this pointed
       at the message shaped files, which would have reported a perfectly
       successful fallback and then drawn a storefront with no chip and no badges
       anywhere, which is the feature quietly absent rather than a visible
       failure. tools/build-offers.mjs asserts all three fields as it writes
       them, so the mistake cannot be made again without the build stopping.

       Resolving by location rather than by postcode has nothing to fall back on,
       and says so, because there is no stored answer keyed by shop in this
       shape. The page then renders without availability, which is the same
       thing it does for any other failure and is the honest outcome. */
    function fallback(params) {
        var cep = String(params.cep || '').replace(/[^0-9]/g, '');
        if (!cep) return Promise.reject(new Error('nothing stored to fall back on without a postcode'));
        var base = api().fallbackBase || 'offer/storefront';
        return window.fetch(base + '/' + cep + '.json', { cache: 'no-store' })
            .then(function (response) {
                if (!response.ok) throw new Error('no stored answer for this postcode');
                return response.json();
            })
            .then(function (data) { data.servedFrom = 'stored answer'; return data; });
    }

    function apply(data, source) {
        state.status = data.resolved === 'store' ? 'store' : data.resolved;
        state.cep = data.cep || state.cep;
        state.store = data.store || null;
        state.stores = data.stores || [];
        state.region = data.region || null;
        state.stock = data.stock || {};
        state.offers = data.offers || [];
        state.hero = data.hero || null;
        state.substitute = data.substitute || null;
        state.substituteReason = data.substituteReason || null;
        state.servedFrom = data.servedFrom || 'live';
        state.fetchedAt = Date.now();
        state.source = source;
        remember();
        report(data, source);
        notify();
        return state;
    }

    /* What the page tells Dengage. These are the events a campaign can be built
       on, and every one of them is a moment a marketer would want to act on. */
    function report(data, source) {
        var events = window.DengageEvents;
        if (!events || typeof events.scenario !== 'function') return;
        if (data.resolved === 'store' && data.store) {
            events.scenario('store_resolved');
        } else if (data.resolved === 'no_store') {
            events.scenario('store_none_nearby');
        } else if (data.resolved === 'unknown_cep') {
            events.scenario('cep_unresolved');
        }
    }

    function failed(err) {
        /* Availability silence. The shop badge goes, the badges go, the shop
           stays unknown, and the catalogue is still fully browsable. */
        state.status = 'unavailable';
        state.store = null;
        state.stock = {};
        state.stores = [];
        state.fetchedAt = Date.now();
        state.error = err && err.message ? err.message : 'the availability service did not answer';
        forget();
        if (window.DengageEvents && window.DengageEvents.scenario) {
            window.DengageEvents.scenario('availability_unavailable');
        }
        notify();
        return state;
    }

    /* ------------------------------------------------------------------ */
    /* Remembering the visitor's shop between pages                        */

    function remember() {
        try {
            window.localStorage.setItem(STORE_KEY, JSON.stringify({
                cep: state.cep, storeId: state.store ? state.store.id : null,
                at: state.fetchedAt, source: state.source
            }));
        } catch (err) { /* private browsing */ }
    }

    function forget() {
        try { window.localStorage.removeItem(STORE_KEY); } catch (err) { /* nothing to do */ }
    }

    function remembered() {
        try {
            var raw = window.localStorage.getItem(STORE_KEY);
            return raw ? JSON.parse(raw) : null;
        } catch (err) { return null; }
    }

    /* ------------------------------------------------------------------ */
    /* The ways in                                                         */

    function load(params, source) {
        state.status = 'loading';
        notify();
        return request(params)
            .then(function (data) { return apply(data, source); })
            .catch(function (liveError) {
                return fallback(params)
                    .then(function (data) { return apply(data, source); })
                    .catch(function () { return failed(liveError); });
            });
    }

    function setCep(cep, options) {
        var digits = String(cep || '').replace(/[^0-9]/g, '');
        if (digits.length < 8) {
            state.status = 'unknown_cep';
            state.store = null;
            state.stock = {};
            notify();
            return Promise.resolve(state);
        }
        state.cep = digits;
        return load({ cep: digits, sku: (options && options.sku) || null, n: 8 }, 'cep');
    }

    function setStore(storeId, options) {
        if (!storeId) return Promise.resolve(state);
        return load({ store_id: storeId, sku: (options && options.sku) || null, n: 8 }, 'deeplink');
    }

    /* The browser's own position. Permission being refused is a normal answer
       rather than an error: the storefront says so and stays on the postcode
       path, which is the behaviour Ri Happy asked to see defined. */
    function useLocation(options) {
        if (!window.navigator || !window.navigator.geolocation) {
            state.status = 'unknown_cep';
            state.locationRefused = 'this browser cannot report a location';
            notify();
            return Promise.resolve(state);
        }
        state.status = 'loading';
        notify();
        return new Promise(function (resolve) {
            window.navigator.geolocation.getCurrentPosition(function (position) {
                var nearest = nearestStore(position.coords.latitude, position.coords.longitude);
                if (!nearest) {
                    state.status = 'no_store';
                    state.locationRefused = null;
                    notify();
                    resolve(state);
                    return;
                }
                resolve(setStore(nearest.id, options).then(function (result) {
                    result.source = 'geolocation';
                    return result;
                }));
            }, function (error) {
                state.status = 'idle';
                state.locationRefused = error && error.code === 1
                    ? 'location permission was declined'
                    : 'the browser could not provide a location';
                if (window.DengageEvents && window.DengageEvents.scenario) {
                    window.DengageEvents.scenario('location_declined');
                }
                notify();
                resolve(state);
            }, { enableHighAccuracy: false, timeout: 8000, maximumAge: 120000 });
        });
    }

    /* Straight line distance is enough to pick the closest shop from a list of
       this size, and it needs no network call. */
    function nearestStore(lat, lng) {
        var stores = window.STORE_DIRECTORY || [];
        var best = null;
        var bestDistance = Infinity;
        for (var i = 0; i < stores.length; i += 1) {
            var store = stores[i];
            if (typeof store.lat !== 'number' || typeof store.lng !== 'number') continue;
            var dLat = (store.lat - lat) * 111;
            var dLng = (store.lng - lng) * 111 * Math.cos(lat * Math.PI / 180);
            var distance = Math.sqrt(dLat * dLat + dLng * dLng);
            if (distance < bestDistance) { bestDistance = distance; best = store; }
        }
        if (!best) return null;
        best.distanceKm = Math.round(bestDistance * 10) / 10;
        return best;
    }

    /* ------------------------------------------------------------------ */
    /* What the rest of the page asks                                      */

    /* The only place anything is allowed to ask "can this shop supply this".
       Unknown is never yes: a product we hold no answer for reads as unknown and
       shows no badge, rather than quietly rendering as available. */
    function availabilityOf(productId) {
        if (state.status !== 'store') return 'unknown';
        var value = state.stock[String(productId)];
        if (value === 'available') return 'available';
        if (value === 'withoutStock') return 'withoutStock';
        return 'unknown';
    }

    function hasStore() { return state.status === 'store' && !!state.store; }
    function storeName() { return hasStore() ? state.store.name : null; }
    function isFresh() { return Date.now() - state.fetchedAt < FRESH_MS; }

    /* Used by the product page, which re-asks on every load so what a visitor
       sees is resolved at the moment they look at it. */
    function refresh(options) {
        if (state.store) return setStore(state.store.id, options);
        if (state.cep) return setCep(state.cep, options);
        return Promise.resolve(state);
    }

    function boot(options) {
        var params = new window.URLSearchParams(window.location.search);
        var storeParam = params.get('store');
        var cepParam = params.get('cep');
        if (storeParam) return setStore(storeParam, options);
        if (cepParam) return setCep(cepParam, options);

        var saved = remembered();
        if (saved && saved.storeId) return setStore(saved.storeId, options);
        if (saved && saved.cep) return setCep(saved.cep, options);

        state.status = 'idle';
        notify();
        return Promise.resolve(state);
    }

    function clear() {
        forget();
        state.status = 'idle';
        state.cep = null;
        state.store = null;
        state.stores = [];
        state.stock = {};
        state.offers = [];
        state.fetchedAt = 0;
        notify();
    }

    window.StoreContext = {
        boot: boot,
        setCep: setCep,
        setStore: setStore,
        useLocation: useLocation,
        refresh: refresh,
        clear: clear,
        onChange: function (fn) { listeners.push(fn); return fn; },
        state: function () { return state; },
        availabilityOf: availabilityOf,
        hasStore: hasStore,
        storeName: storeName,
        isFresh: isFresh,
        keys: { store: STORE_KEY }
    };
})(window, document);
