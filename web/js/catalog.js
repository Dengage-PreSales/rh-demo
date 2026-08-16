/* ============================================================================
   The catalogue, in memory.

   Loads web/products.json once and answers the questions the pages ask of it.
   It knows nothing about shops or availability: that is StoreContext's job, and
   keeping the two apart is what lets the same catalogue render with or without
   a shop resolved.

   THE SUBSTITUTION RULE LIVES HERE TOO, in similarTo(). The database runs the
   same ladder for the email, and this is the storefront's copy of it. They are
   written to agree, and both are ordered the way somebody who sells toys would
   order them rather than the way a database would find convenient:

     same franchise      a child who asked for LEGO wants LEGO
     overlapping age     the wrong age band is a returned present
     same shelf          department, then category
     near the price      within thirty percent either way

   A product with no franchise is not guessed into one. It falls through to age
   and shelf, which is a weaker match and honestly labelled as such.
   ========================================================================== */
(function (window) {
    'use strict';

    var products = [];
    var byId = {};
    var departments = [];
    var categories = [];

    function toNumber(value) {
        return typeof value === 'number' && isFinite(value) ? value : null;
    }

    function normalise(raw) {
        var id = raw && raw.id !== undefined && raw.id !== null ? String(raw.id) : '';
        if (!id) return null;
        var price = toNumber(raw.price);
        if (price === null || price <= 0) return null;
        var listPrice = toNumber(raw.listPrice);
        return {
            id: id,
            name: String(raw.name || id),
            brand: raw.brand || '',
            licence: raw.licence || null,
            department: raw.department || '',
            category: raw.category || '',
            categoryPath: raw.categoryPath || raw.category || '',
            price: price,
            /* Only a genuinely higher previous price survives, so nothing can
               advertise a discount that does not exist. */
            listPrice: listPrice !== null && listPrice > price ? listPrice : null,
            ageMinMonths: toNumber(raw.ageMinMonths),
            ageMaxMonths: toNumber(raw.ageMaxMonths),
            ageDisplay: raw.ageDisplay || '',
            ageBracket: raw.ageBracket || null,
            image: raw.image || null,
            url: 'product.html?id=' + encodeURIComponent(id)
        };
    }

    function load(url) {
        return window.fetch(url, { cache: 'no-store' })
            .then(function (response) {
                if (!response.ok) throw new Error('the catalogue could not be loaded');
                return response.json();
            })
            .then(function (data) {
                products = [];
                byId = {};
                var list = (data && data.products) || [];
                for (var i = 0; i < list.length; i += 1) {
                    var product = normalise(list[i]);
                    if (!product) continue;
                    products.push(product);
                    byId[product.id] = product;
                }
                departments = [];
                categories = [];
                for (var j = 0; j < products.length; j += 1) {
                    var d = products[j].department;
                    var c = products[j].category;
                    if (d && departments.indexOf(d) === -1) departments.push(d);
                    if (c && categories.indexOf(c) === -1) categories.push(c);
                }
                return products;
            });
    }

    function all() { return products.slice(); }
    function get(id) { return byId[String(id)] || null; }
    function inDepartment(name) {
        return products.filter(function (p) { return p.department === name; });
    }
    function inCategory(name) {
        return products.filter(function (p) { return p.category === name; });
    }

    function agesOverlap(a, b) {
        if (a.ageMinMonths === null || b.ageMinMonths === null) return false;
        var aMax = a.ageMaxMonths === null ? 216 : a.ageMaxMonths;
        var bMax = b.ageMaxMonths === null ? 216 : b.ageMaxMonths;
        return a.ageMinMonths <= bMax && aMax >= b.ageMinMonths;
    }

    /**
     * The closest thing to `product` from `pool`, with the reason it was chosen.
     * The reason is returned because the storefront shows it: an unexplained
     * substitution looks like the shop ran out and shrugged.
     */
    function similarTo(product, pool, limit) {
        if (!product) return [];
        var candidates = (pool || products).filter(function (p) { return p.id !== product.id; });
        var scored = candidates.map(function (p) {
            var sameLicence = !!(p.licence && product.licence && p.licence === product.licence);
            var sameAge = agesOverlap(p, product);
            var sameCategory = !!(p.department && p.department === product.department &&
                                  p.category === product.category);
            var sameDepartment = !!(p.department && p.department === product.department);
            var nearPrice = Math.abs(p.price - product.price) <= product.price * 0.30;
            var reason = sameLicence ? 'same_licence'
                : (sameAge && sameCategory) ? 'same_age_and_shelf'
                : sameCategory ? 'same_shelf'
                : 'nearby_price';
            return {
                product: p,
                reason: reason,
                rank: [
                    sameLicence ? 0 : 1,
                    sameAge ? 0 : 1,
                    sameCategory ? 0 : (sameDepartment ? 1 : 2),
                    nearPrice ? 0 : 1,
                    Math.abs(p.price - product.price)
                ]
            };
        });
        scored.sort(function (a, b) {
            for (var i = 0; i < a.rank.length; i += 1) {
                if (a.rank[i] !== b.rank[i]) return a.rank[i] - b.rank[i];
            }
            return a.product.id < b.product.id ? -1 : 1;
        });
        return scored.slice(0, limit || 4);
    }

    function search(term) {
        var needle = String(term || '').trim().toLowerCase();
        if (!needle) return [];
        return products.filter(function (p) {
            return p.name.toLowerCase().indexOf(needle) !== -1 ||
                   String(p.brand).toLowerCase().indexOf(needle) !== -1 ||
                   String(p.licence || '').toLowerCase().indexOf(needle) !== -1 ||
                   p.categoryPath.toLowerCase().indexOf(needle) !== -1;
        });
    }

    window.Catalog = {
        load: load,
        all: all,
        get: get,
        departments: function () { return departments.slice(); },
        categories: function () { return categories.slice(); },
        inDepartment: inDepartment,
        inCategory: inCategory,
        similarTo: similarTo,
        search: search,
        effectivePrice: function (p) { return p ? p.price : null; }
    };
})(window);
