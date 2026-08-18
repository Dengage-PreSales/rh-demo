/* ============================================================================
   The App Inbox: the messages Dengage holds for this device, inside the shop.

   This is the one Dengage capability with no panel template behind it. Story,
   popups and the other on-site creatives are drawn by the Visual Editor, so
   the panel builds them and a page only fires a trigger. Nothing draws an
   inbox, so this file is the inbox: without it the demo has no inbox to show,
   whatever is configured in the panel.

   WHAT IS OURS AND WHAT IS DENGAGE'S. Dengage holds the messages, one list per
   device, and records impressions, opens and clicks against them. All of that
   goes through js/dengageEvents.js, the only module allowed to talk to the
   SDK. This file draws the bell, the badge, the drawer and the list, and
   decides what each kind of empty says.

   THE MESSAGE SHAPE IS DECIDED BY THE SERVER, NOT BY US, which is why field
   reading here looks indirect. A message arrives as an object with an smsgId
   and a messageJson carrying the payload that was composed in the panel, and
   the payload is push shaped, so titles and media arrive under the names the
   push side uses. pick() reads a short list of candidate names at both levels
   rather than committing to one spelling and rendering blanks when the server
   uses another. The first raw message is logged once per refresh, so the real
   shape is always one glance away in the console.

   READ STATE IS OURS. The provider reports an open to Dengage but exposes no
   read flag to read back, so unread lives in localStorage under this demo's
   slug, the same namespacing the cart and wishlist use.
   ========================================================================== */
(function (window, document) {
    'use strict';

    var OPEN = 'is-open';
    var slug = window.DEMO_SLUG || 'rh-demo';
    var READ_KEY = 'dps:' + slug + ':inbox-read';
    var HIDDEN_KEY = 'dps:' + slug + ':inbox-hidden';

    function sf() { return window.Storefront; }
    function t(key, vars) { return sf() ? sf().t(key, vars) : key; }
    function el(id) { return document.getElementById(id); }
    function esc(value) { return sf() ? sf().escapeText(value) : String(value); }
    function escAttr(value) { return sf() ? sf().escapeAttr(value) : String(value); }

    function read(key) {
        try {
            var raw = window.localStorage.getItem(key);
            var parsed = raw ? JSON.parse(raw) : [];
            return Array.isArray(parsed) ? parsed : [];
        } catch (err) { return []; }
    }

    function write(key, value) {
        try { window.localStorage.setItem(key, JSON.stringify(value)); }
        catch (err) { /* private browsing: read state lasts this session only */ }
    }

    var readIds = read(READ_KEY);
    var hiddenIds = read(HIDDEN_KEY);
    var messages = [];
    var state = 'starting';
    var reported = {};

    /* ------------------------------------------------------------------ */
    /* Reading a server shaped message                                     */

    function pick(message, names) {
        var sources = [message, message && message.messageJson, message && message.message_json];
        for (var s = 0; s < sources.length; s += 1) {
            var source = sources[s];
            if (!source || typeof source !== 'object') continue;
            for (var n = 0; n < names.length; n += 1) {
                var value = source[names[n]];
                if (value !== null && value !== undefined && value !== '') return value;
            }
        }
        return null;
    }

    function messageId(message) {
        var id = pick(message, ['smsgId', 'smsg_id', 'messageId', 'id']);
        return id === null ? null : String(id);
    }

    function messageTitle(message) {
        var value = pick(message, ['title', 'messageTitle', 'header', 'subject']);
        return value === null ? null : String(value);
    }

    function messageBody(message) {
        var value = pick(message, ['message', 'body', 'messageBody', 'text', 'content']);
        return value === null ? null : String(value);
    }

    /* Only http and https are followed, for the media and the destination
       alike. A message is authored in the panel and arrives as data, and
       treating whatever it carries as a live URL is how a javascript:
       destination would end up wired to a click. */
    function httpOnly(value) {
        if (value === null) return null;
        var text = String(value);
        return (/^https?:\/\//i).test(text) ? text : null;
    }

    function messageMedia(message) {
        return httpOnly(pick(message, ['mediaUrl', 'media_url', 'media', 'image',
                                       'imageUrl', 'image_url', 'iconUrl', 'icon']));
    }

    function messageUrl(message) {
        return httpOnly(pick(message, ['targetUrl', 'target_url', 'url', 'link', 'deepLink']));
    }

    function messageDate(message) {
        var value = pick(message, ['sendDate', 'sentDate', 'receivedDate', 'createDate',
                                   'sent_time', 'sentTime', 'eventDate', 'date']);
        if (value === null) return null;
        var when = new Date(value);
        return isFinite(when.getTime()) ? when : null;
    }

    /* ------------------------------------------------------------------ */
    /* Rendering                                                           */

    function visible() {
        return messages.filter(function (message) {
            var id = messageId(message);
            return id !== null && hiddenIds.indexOf(id) === -1;
        });
    }

    function unreadCount() {
        return visible().filter(function (message) {
            return readIds.indexOf(messageId(message)) === -1;
        }).length;
    }

    /* Short, and never a numeric date. "8/4" is the fourth of August to half
       the world and the eighth of April to the other half, and an ambiguous
       stamp in a list where every other row is a relative time reads as a
       glitch. Day and short month is unambiguous in any locale. */
    function stamp(when) {
        if (!when) return '';
        var mins = Math.round((Date.now() - when.getTime()) / 60000);
        if (mins < 1) return t('inboxJustNow');
        if (mins < 60) return t('inboxMinutes', { n: mins });
        if (mins < 60 * 24) return t('inboxHours', { n: Math.round(mins / 60) });
        try {
            return when.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
        } catch (err) {
            return t('inboxHours', { n: Math.round(mins / 60) });
        }
    }

    /* The empty state says which kind of empty it is. "No messages" while the
       SDK is still starting is a lie that costs a call: it reads as a broken
       inbox when the truth is that the answer has not arrived yet. */
    function emptyBlock() {
        if (state === 'dry') return '<p class="inbox-empty">' + esc(t('inboxNoSdk')) + '</p>';
        if (state === 'starting') return '<p class="inbox-empty">' + esc(t('inboxStarting')) + '</p>';
        if (state === 'error') return '<p class="inbox-empty">' + esc(t('inboxError')) + '</p>';
        return '<p class="inbox-empty">' + esc(t('inboxEmpty')) + '</p>' +
               '<p class="inbox-empty-hint">' + esc(t('inboxEmptyHint')) + '</p>';
    }

    function messageBlock(message) {
        var id = messageId(message);
        var isRead = readIds.indexOf(id) !== -1;
        var title = messageTitle(message);
        var body = messageBody(message);
        var media = messageMedia(message);
        var url = messageUrl(message);
        var when = messageDate(message);

        var html = '<article class="inbox-item' + (isRead ? ' is-read' : '') +
                   '" data-inbox-id="' + escAttr(id) + '">';

        /* The media column is reserved for the whole list at once, decided in
           render(). Reserving it per message gave a ragged left edge whenever
           only some messages carried an image. */
        html += media
            ? '<div class="inbox-media"><img src="' + escAttr(media) + '" alt="" loading="lazy"></div>'
            : '<div class="inbox-media inbox-media-none"></div>';

        html += '<div class="inbox-text"><div class="inbox-top"><h3>' +
                (isRead ? '' : '<span class="inbox-dot" aria-hidden="true"></span>') +
                esc(title || t('inboxUntitled')) + '</h3>';
        if (when) html += '<span class="inbox-when">' + esc(stamp(when)) + '</span>';
        html += '</div>';
        if (body) html += '<p>' + esc(body) + '</p>';

        html += '<div class="inbox-actions">';
        if (url) {
            /* A new tab, always. The demo is what is being screen shared, so
               following a message's destination in place would replace it with
               whatever the panel put in that field, mid call. */
            html += '<a class="inbox-open" href="' + escAttr(url) +
                    '" target="_blank" rel="noopener" data-inbox-open="' + escAttr(id) + '">' +
                    esc(t('inboxOpen')) + '</a>';
        }
        html += '<button type="button" class="inbox-dismiss" data-inbox-dismiss="' +
                escAttr(id) + '">' + esc(t('inboxDismiss')) + '</button>';
        html += '</div></div></article>';
        return html;
    }

    function render() {
        var body = el('inbox-body');
        var list = visible();
        var n = unreadCount();

        if (body) {
            body.innerHTML = list.length ? list.map(messageBlock).join('') : emptyBlock();
            var anyMedia = list.some(function (message) { return !!messageMedia(message); });
            body.classList.toggle('with-media', anyMedia);
        }

        /* The drawer repeats the count because the bell is behind the open
           drawer while somebody is reading it. */
        var count = el('inbox-count');
        if (count) {
            count.textContent = n ? t('inboxUnread', { n: n }) : '';
            count.hidden = n === 0;
        }

        var badge = el('inbox-badge');
        if (badge) {
            badge.textContent = n;
            badge.hidden = n === 0;
        }

        hideBrokenMedia();

        /* An impression is reported once per message per page, and only while
           the drawer is open. Reporting on fetch would count messages nobody
           saw; reporting on every render would count one message many times. */
        if (isOpen()) reportImpressions(list);
    }

    /* An image URL comes from a panel field, so it can be wrong in ways this
       page does not control. The browser's answer is a broken image icon,
       which on screen reads as the inbox failing rather than as one message
       with a bad link, so the media column is dropped and the message renders
       as text, which is still the message. */
    function hideBrokenMedia() {
        var images = document.querySelectorAll('#inbox-body .inbox-media img');
        Array.prototype.forEach.call(images, function (img) {
            if (img.complete && img.naturalWidth === 0) { drop(img); return; }
            img.addEventListener('error', function () { drop(img); });
        });
        function drop(img) {
            var holder = img.parentNode;
            if (holder && holder.parentNode) holder.parentNode.removeChild(holder);
        }
    }

    function reportImpressions(list) {
        list.forEach(function (message) {
            var id = messageId(message);
            if (!id || reported[id]) return;
            reported[id] = true;
            if (window.DengageEvents) window.DengageEvents.inboxImpression(id);
        });
    }

    /* ------------------------------------------------------------------ */
    /* Refresh                                                             */

    var refreshing = false;

    function refresh() {
        if (refreshing || !window.DengageEvents) return Promise.resolve(state);
        refreshing = true;
        return window.DengageEvents.inboxMessages().then(function (result) {
            refreshing = false;
            state = result.status;
            messages = result.list;
            if (window.console && messages.length) {
                /* One raw message per refresh: the server decides the shape,
                   and this is how to see it on a call instead of guessing from
                   a rendered card. */
                console.log('[inbox] ' + messages.length + ' message(s), first raw:', messages[0]);
            }
            render();
            return state;
        }, function () {
            refreshing = false;
            state = 'error';
            render();
            return state;
        });
    }

    /* The SDK registers the device asynchronously, so the first read usually
       lands before there is a device id to read for. Retry with a widening gap
       and stop as soon as the inbox answers, so the badge is right without
       polling for the life of the page. */
    function settle(tries) {
        tries = tries || 0;
        return refresh().then(function (status) {
            if (status !== 'starting' || tries >= 5) return status;
            return new Promise(function (resolve) {
                window.setTimeout(function () { resolve(settle(tries + 1)); }, 1000 * (tries + 2));
            });
        });
    }

    /* ------------------------------------------------------------------ */
    /* The drawer                                                          */

    function open() {
        var drawer = el('inbox');
        if (!drawer) return;
        drawer.classList.add(OPEN);
        var scrim = el('scrim');
        if (scrim) scrim.classList.add(OPEN);
        document.body.classList.add('has-drawer');
        /* Opening is the moment messages are seen, so it is when impressions
           become true and when a stale list is worth re-reading. */
        refresh();
    }

    function close() {
        var drawer = el('inbox');
        if (drawer) drawer.classList.remove(OPEN);
        var scrim = el('scrim');
        var othersOpen = (window.CartDrawer && window.CartDrawer.isOpen && window.CartDrawer.isOpen()) ||
                         (window.Wishlist && window.Wishlist.isOpen && window.Wishlist.isOpen());
        if (scrim && !othersOpen) scrim.classList.remove(OPEN);
        document.body.classList.remove('has-drawer');
    }

    function isOpen() {
        var drawer = el('inbox');
        return !!(drawer && drawer.classList.contains(OPEN));
    }

    /* ------------------------------------------------------------------ */
    /* Interaction                                                         */

    function markRead(id) {
        if (!id || readIds.indexOf(id) !== -1) return;
        readIds.push(id);
        write(READ_KEY, readIds);
    }

    /* Local by default. A delete against the shared Dengage account is not
       something a demo does on its own: js/dengageEvents.js only reports it
       when demo.config.json opts in. */
    function dismiss(id) {
        if (!id) return;
        if (hiddenIds.indexOf(id) === -1) {
            hiddenIds.push(id);
            write(HIDDEN_KEY, hiddenIds);
        }
        if (window.DengageEvents) window.DengageEvents.inboxDelete(id);
        render();
    }

    function wire() {
        var button = el('inbox-button');
        if (button) {
            button.addEventListener('click', function () {
                if (isOpen()) close(); else open();
            });
        }

        var closeButton = el('inbox-close');
        if (closeButton) closeButton.addEventListener('click', close);

        var refreshButton = el('inbox-refresh');
        if (refreshButton) refreshButton.addEventListener('click', function () { refresh(); });

        document.addEventListener('keydown', function (event) {
            if (event.key === 'Escape' && isOpen()) close();
        });

        var body = el('inbox-body');
        if (body) {
            body.addEventListener('click', function (event) {
                var control = event.target.closest
                    ? event.target.closest('[data-inbox-open],[data-inbox-dismiss]')
                    : null;
                if (!control) return;
                if (control.hasAttribute('data-inbox-dismiss')) {
                    event.preventDefault();
                    dismiss(control.getAttribute('data-inbox-dismiss'));
                    return;
                }
                /* The open affordance is a real link to a real destination, so
                   the report goes out and navigation is left alone. */
                var id = control.getAttribute('data-inbox-open');
                markRead(id);
                if (window.DengageEvents) window.DengageEvents.inboxOpen(id);
                render();
            });
        }

        render();
        settle();
    }

    window.Inbox = {
        wire: wire,
        refresh: refresh,
        open: open,
        close: close,
        isOpen: isOpen,
        unreadCount: unreadCount,
        /* Exposed so tools/check-inbox.mjs can assert the field reading against
           every spelling the server might use, without a live account. */
        parse: {
            id: messageId,
            title: messageTitle,
            body: messageBody,
            media: messageMedia,
            url: messageUrl,
            date: messageDate
        }
    };
})(window, document);
