/* ============================================================================
   Search, as an autocomplete panel under their own search bar.

   Their copy, from the site's own bundle:

     header.search-placeholder        Busque por produtos, marcas...
     header.search-emptyPlaceholder   Nenhum resultado encontrado
     header.search-cancel             Cancelar
     search.searchFor                 Buscar por {term}
     search.search-term-too-short     O termo de busca e muito curto

   All five states are here, including the short-term one, because a search box
   that does nothing for two characters and nothing for zero results looks
   equally broken from the far side of a screen share.

   WHY RESULTS CARRY AVAILABILITY

   Because the grid does, and a result list that dropped the badge would be the
   one surface contradicting the others. It asks Availability like everything
   else, so when no shop is resolved it shows nothing rather than guessing.

   THE EVENT IS DEBOUNCED WITH THE PANEL, DELIBERATELY

   ec:search reports what somebody searched for. Firing it per keystroke would
   write eight rows for one search of "lego" and make the table useless for the
   thing it exists for. It goes once the typing settles, which is also when the
   panel paints, so what the room sees and what Dengage stores are the same
   event.
   ========================================================================== */
(function (window, document) {
    'use strict';

    var MIN_TERM = 2;
    var DEBOUNCE_MS = 300;
    var timer = null;
    var lastReported = '';

    function sf() { return window.Storefront; }
    function t(key, vars) { return sf() ? sf().t(key, vars) : key; }
    function el(id) { return document.getElementById(id); }

    function panel() { return el('search-results'); }

    function closePanel() {
        var p = panel();
        if (p) { p.hidden = true; p.innerHTML = ''; }
    }

    function resultHtml(product) {
        var s = sf();
        var badge = window.Availability ? window.Availability.badgeFor(product.id) : '';
        return '' +
            '<a class="result" href="product.html?id=' + s.escapeAttr(product.id) + '">' +
                '<span class="result-media">' +
                    (product.image
                        ? '<img src="' + s.escapeAttr(product.image) + '" alt="" loading="lazy">'
                        : '') +
                '</span>' +
                '<span class="result-body">' +
                    '<span class="result-name">' + s.escapeText(product.name) + '</span>' +
                    '<span class="result-price">' + s.money(product.price) + '</span>' +
                    badge +
                '</span>' +
            '</a>';
    }

    function paint(term) {
        var p = panel();
        if (!p) return;
        var s = sf();

        if (term.length === 0) { closePanel(); return; }

        if (term.length < MIN_TERM) {
            p.innerHTML = '<div class="result-note">' +
                s.escapeText(t('searchTooShort')) + '</div>';
            p.hidden = false;
            return;
        }

        var hits = window.Catalog.search(term);
        if (!hits.length) {
            p.innerHTML = '<div class="result-note">' +
                s.escapeText(t('searchEmpty')) + '</div>';
            p.hidden = false;
            return;
        }

        /* Capped so the panel stays a panel. The count below says how many
           there really are, so the cap is visible rather than silent. */
        var shown = hits.slice(0, 8);
        p.innerHTML =
            shown.map(resultHtml).join('') +
            '<div class="result-foot">' +
                s.escapeText(t('searchFor', { term: term })) +
                ' <span class="result-count">' +
                    s.escapeText(String(hits.length)) + '</span>' +
            '</div>';
        p.hidden = false;
    }

    /* One event per settled search, not one per keystroke, and never the same
       term twice in a row. */
    function report(term) {
        if (term.length < MIN_TERM) return;
        if (term === lastReported) return;
        lastReported = term;
        if (window.DengageEvents) {
            window.DengageEvents.search(term, window.Catalog.search(term).length);
        }
    }

    function onInput(value) {
        var term = String(value || '').trim();
        window.clearTimeout(timer);
        timer = window.setTimeout(function () {
            paint(term);
            report(term);
        }, DEBOUNCE_MS);
    }

    function wire() {
        var input = el('search-input');
        if (!input) return;

        input.addEventListener('input', function () { onInput(input.value); });
        input.addEventListener('focus', function () {
            if (input.value.trim()) onInput(input.value);
        });

        input.addEventListener('keydown', function (event) {
            if (event.key === 'Escape') { closePanel(); input.blur(); }
            if (event.key === 'Enter') {
                event.preventDefault();
                /* Enter reports immediately rather than waiting out the
                   debounce, because somebody pressing it has finished typing. */
                window.clearTimeout(timer);
                var term = input.value.trim();
                paint(term);
                report(term);
            }
        });

        /* Clicking away closes it, but not a click inside it, or following a
           result would be impossible. */
        document.addEventListener('click', function (event) {
            var p = panel();
            if (!p || p.hidden) return;
            var inside = event.target.closest &&
                (event.target.closest('#search-results') || event.target.closest('.search'));
            if (!inside) closePanel();
        });

        /* Repaint when the shop changes so the badges in an open panel are
           never left describing the previous shop. */
        if (window.StoreContext) {
            window.StoreContext.onChange(function () {
                var p = panel();
                if (p && !p.hidden) paint(input.value.trim());
            });
        }
    }

    window.SearchPanel = { wire: wire, close: closePanel };
})(window, document);
