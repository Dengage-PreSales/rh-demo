/* ============================================================================
   The navigation, doing what it says.

   Their bar reads: All departments, Gift by age, News, Gift Card, Imported,
   Pick up in store, Exclusive, In-store event, OUTLET.

   FOUR OF THOSE ARE BACKED BY WHAT WE CAPTURED AND FIVE ARE NOT.

     All departments    9 real departments across 200 products
     Gift by age        the age chips, which already worked
     Pick up in store   available at the resolved shop
     Outlet             132 products carrying a genuinely higher was-price

     News, Gift Card, Imported, Exclusive, In-store event: no field in the
     capture supports any of them, and no honest filter can be written.

   The five are removed rather than left pointing at nothing. That follows the
   decision already taken on the coupon field: a control that ignores a click is
   the defect, not the absent one. Nobody on a call counts navigation items and
   everybody notices a click that does nothing.

   Pick up in store is the one worth pointing at during the demo. It is their
   own navigation label, and here it filters the whole grid to what the resolved
   shop can actually hand over, which is Use Case 1 stated as a menu item.
   ========================================================================== */
(function (window, document) {
    'use strict';

    function sf() { return window.Storefront; }
    function el(id) { return document.getElementById(id); }

    function repaint() {
        sf().paintHome();
        if (window.Wishlist) window.Wishlist.paintHearts();
        paintState();
    }

    function paintState() {
        var nav = document.querySelector('.header-nav');
        if (!nav) return;
        var links = nav.querySelectorAll('[data-nav]');
        var department = sf().activeDepartment();
        for (var i = 0; i < links.length; i += 1) {
            var which = links[i].getAttribute('data-nav');
            var on =
                (which === 'pickup' && sf().availableOnly && sf().availableOnly()) ||
                (which === 'outlet' && sf().outletOnly()) ||
                (which === 'departments' && !!department) ||
                (which === 'all' && !department && !sf().outletOnly());
            links[i].setAttribute('aria-current', on ? 'true' : 'false');
        }
        var label = el('nav-departments-label');
        if (label) label.textContent = department || label.getAttribute('data-default') || '';
    }

    /* Built from the catalogue rather than written here, so it cannot name a
       department the capture does not contain. */
    function buildDepartments() {
        var menu = el('nav-departments-menu');
        if (!menu) return;
        var names = window.Catalog.departments();
        menu.innerHTML = names.map(function (name) {
            var n = window.Catalog.inDepartment(name).length;
            return '<button type="button" data-department="' + sf().escapeAttr(name) + '">' +
                sf().escapeText(name) +
                '<span class="dept-count">' + n + '</span></button>';
        }).join('');
    }


    /* THE MENU IS POSITIONED AGAINST THE VIEWPORT, not against the nav, and
       that is the whole fix rather than a refinement.

       .header-nav carries overflow-x: auto so the bar can scroll sideways on a
       phone. An absolutely positioned child of a scroll container is clipped by
       it, so the dropdown opened at full height and was cut down to a two pixel
       sliver under the bar. It looked like a link that did nothing, and the
       check that was supposed to cover it asked the DOM whether the buttons
       existed. They did. Nobody could see them.

       position: fixed escapes the clip, but only if no ancestor carries a
       transform, so the coordinates are measured from the button each time it
       opens rather than written into the stylesheet. */
    function toggleDepartments(button) {
        var menu = el('nav-departments-menu');
        if (!menu) return;
        if (!menu.hidden) { menu.hidden = true; return; }

        var box = button.getBoundingClientRect();
        menu.style.position = 'fixed';
        menu.style.top = Math.round(box.bottom + 6) + 'px';
        menu.style.left = Math.round(box.left) + 'px';
        menu.style.right = 'auto';
        menu.hidden = false;

        /* If it would run off the bottom, let it scroll rather than disappear. */
        var room = window.innerHeight - box.bottom - 24;
        menu.style.maxHeight = Math.max(160, room) + 'px';
        menu.style.overflowY = 'auto';
    }

    function clearFilters() {
        sf().setDepartment(null);
        sf().setOutlet(false);
        sf().setAvailableOnly(false);
    }

    function wire() {
        var nav = document.querySelector('.header-nav');
        if (!nav) return;

        buildDepartments();

        nav.addEventListener('click', function (event) {
            var link = event.target.closest ? event.target.closest('[data-nav]') : null;
            if (!link) return;
            var which = link.getAttribute('data-nav');

            if (which === 'departments') {
                event.preventDefault();
                toggleDepartments(link);
                return;
            }

            /* Gift by age is an anchor to the chips further down the page and
               is the one item here that should keep its default behaviour. An
               earlier version cancelled every click before deciding what to do,
               so this link was cancelled and then handled by nobody: it looked
               dead while every other item worked. Anything not handled below
               keeps its own behaviour rather than being silently swallowed. */
            if (which === 'age') {
                var chips = document.getElementById('age-chips');
                if (chips) {
                    event.preventDefault();
                    chips.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }
                return;
            }

            event.preventDefault();

            if (which === 'all') { clearFilters(); repaint(); return; }

            if (which === 'pickup') {
                /* Only meaningful once a shop is resolved, so it asks for one
                   rather than filtering to nothing and looking broken. */
                if (!window.StoreContext.hasStore()) { sf().openCep(); return; }
                clearFilters();
                sf().setAvailableOnly(true);
                repaint();
                return;
            }

            if (which === 'outlet') {
                clearFilters();
                sf().setOutlet(true);
                repaint();
            }
        });

        var menu = el('nav-departments-menu');
        if (menu) {
            menu.addEventListener('click', function (event) {
                var name = event.target.closest
                    ? event.target.closest('[data-department]')
                    : null;
                if (!name) return;
                clearFilters();
                sf().setDepartment(name.getAttribute('data-department'));
                menu.hidden = true;
                repaint();
            });
        }

        document.addEventListener('click', function (event) {
            var m = el('nav-departments-menu');
            if (!m || m.hidden) return;
            var inside = event.target.closest && event.target.closest('.nav-departments');
            if (!inside) m.hidden = true;
        });

        /* Arriving from the product page, whose links cannot filter a grid that
           is not on screen. They carry the intent in the address instead and
           this applies it once the grid exists. */
        applyFromUrl();

        paintState();
    }

    function applyFromUrl() {
        var filter;
        try {
            filter = new window.URLSearchParams(window.location.search).get('filter');
        } catch (err) { return; }
        if (!filter) return;

        if (filter === 'pickup') {
            /* The shop resolves asynchronously and this runs at wiring time, so
               on arrival there is usually no shop yet. Applying the filter now
               and giving up would silently drop the intent the visitor arrived
               with, which is how a link looks broken without being broken.
               Wait for the resolution instead, once. */
            if (!window.StoreContext.hasStore()) {
                var applied = false;
                window.StoreContext.onChange(function () {
                    if (applied || !window.StoreContext.hasStore()) return;
                    applied = true;
                    clearFilters();
                    sf().setAvailableOnly(true);
                    repaint();
                });
                sf().openCep();
                return;
            }
            clearFilters();
            sf().setAvailableOnly(true);
            repaint();
            return;
        }
        if (filter === 'outlet') {
            clearFilters();
            sf().setOutlet(true);
            repaint();
        }
    }

    window.Nav = { wire: wire, paintState: paintState };
})(window, document);
