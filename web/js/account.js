/* ============================================================================
   Signing in, and the contact key that makes the whole loop close.

   This is the smallest surface here and the one the demo depends on most. Until
   somebody signs in, everything the storefront reports lands on an anonymous
   device, and the Use Case 1 email has no contact to read a last visit from.
   Signing in is what turns "this browser did something" into "this person did
   something", which is the join the email is built on.

   THEIR FLOW, AND THE ONE STEP THIS COLLAPSES

   Their bundle describes it: loginOptions.title "Escolha uma opcao para
   entrar", then either loginOptions.emailVerification, an access code sent to
   an email address, or loginOptions.emailAndPassword. The header control is
   Entrar, and once in, login.hello "Ola," with login.myAccount and
   login.logoutLabel.

   We follow the access code path and collapse the code step, deliberately.
   There is no mailbox in a demo, so the only way to keep the step would be a
   field that accepts any six digits, and a control that pretends to check
   something it cannot check is worse than one that is honestly absent. The step
   that carries meaning, identifying the person, is the one we keep.

   THE CONTACT KEY IS DERIVED, NOT COUNTED

   DPS-<n>, where n comes from the email address rather than from a counter.
   Signing in twice with the same address has to reach the same contact, or a
   rehearsal quietly creates a second one and the email reads the wrong last
   visit. A counter cannot survive a page reload; a derivation needs nothing
   stored at all.

   The prefix carries no slug on purpose. Storage is namespaced by slug so a
   second demo never adopts this identity, and the prefix is what a purge
   filters on across all demos. See identity.js.
   ========================================================================== */
(function (window, document) {
    'use strict';

    var OPEN = 'is-open';
    var slug = window.DEMO_SLUG || 'rh-demo';
    var KEY = 'dps:' + slug + ':account';

    function sf() { return window.Storefront; }
    function t(key, vars) { return sf() ? sf().t(key, vars) : key; }
    function el(id) { return document.getElementById(id); }

    function read() {
        try {
            var raw = window.localStorage.getItem(KEY);
            return raw ? JSON.parse(raw) : null;
        } catch (err) { return null; }
    }

    function write(account) {
        try {
            if (account) window.localStorage.setItem(KEY, JSON.stringify(account));
            else window.localStorage.removeItem(KEY);
        } catch (err) { /* private browsing */ }
    }

    var account = read();

    /* ------------------------------------------------------------------ */
    /* Identity                                                            */

    /* A small stable number from the address. Not a security device and not
       pretending to be one: it exists so the same person reaches the same
       contact on Tuesday as they did on Monday. */
    function numberFor(email) {
        var normalised = String(email || '').trim().toLowerCase();
        var hash = 0;
        for (var i = 0; i < normalised.length; i += 1) {
            hash = ((hash << 5) - hash) + normalised.charCodeAt(i);
            hash = hash & hash;
        }
        return Math.abs(hash) % 100000;
    }

    function firstNameFrom(email) {
        var local = String(email || '').split('@')[0] || '';
        var word = local.split(/[._-]/)[0] || local;
        if (!word) return '';
        return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    }

    function isSignedIn() { return !!(account && account.contactKey); }
    function contactKey() { return account ? account.contactKey : null; }

    /* ------------------------------------------------------------------ */
    /* The dialog                                                          */

    function open(reason) {
        var overlay = el('account-overlay');
        if (!overlay) return;
        setError('');
        var why = el('account-reason');
        if (why) {
            /* Their wishlist prompts a sign in rather than silently doing
               nothing, so when the heart sends somebody here it says so. */
            why.textContent = reason ? t(reason) : '';
            why.hidden = !reason;
        }
        overlay.classList.add(OPEN);
        var input = el('account-email');
        if (input) { input.value = ''; input.focus(); }
    }

    function close() {
        var overlay = el('account-overlay');
        if (overlay) overlay.classList.remove(OPEN);
    }

    function setError(message) {
        var host = el('account-error');
        if (host) host.textContent = message || '';
    }

    function submit() {
        var input = el('account-email');
        var email = input ? String(input.value || '').trim() : '';

        /* Their two validation messages, both of them. */
        if (!email) { setError(t('loginEmptyField')); return; }
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { setError(t('loginInvalidEmail')); return; }

        signIn(email);
        close();
    }

    function signIn(email) {
        var key = window.DemoIdentity && window.DemoIdentity.mintKey
            ? window.DemoIdentity.mintKey(numberFor(email))
            : 'DPS-' + numberFor(email);

        account = { email: email, name: firstNameFrom(email), contactKey: key };
        write(account);

        /* The call that attaches everything this browser goes on to do to a
           person Dengage can send to. */
        if (window.DengageEvents) {
            window.DengageEvents.setContactKey(key);
            window.DengageEvents.scenario('signed_in');
        }

        paint();
        notify();
    }

    function signOut() {
        account = null;
        write(null);
        paint();
        notify();
        /* No attempt to unset the contact key on the SDK. There is no documented
           call for it, and inventing one would be worse than saying plainly that
           the device stays associated until the browser data is cleared. */
    }

    /* ------------------------------------------------------------------ */
    /* The header control                                                  */

    function paint() {
        var button = el('account-button');
        if (!button) return;
        var label = el('account-label');
        if (label) {
            label.textContent = isSignedIn()
                ? t('loginHello', { name: account.name })
                : t('loginSignIn');
        }
        button.setAttribute('data-signed-in', isSignedIn() ? 'true' : 'false');

        var menu = el('account-menu');
        if (menu) menu.hidden = true;
    }

    var listeners = [];
    function notify() {
        for (var i = 0; i < listeners.length; i += 1) {
            try { listeners[i](account); } catch (err) { /* one view must not stop the rest */ }
        }
    }

    function wire() {
        var button = el('account-button');
        if (button) {
            button.addEventListener('click', function () {
                if (!isSignedIn()) { open(); return; }
                var menu = el('account-menu');
                if (menu) menu.hidden = !menu.hidden;
            });
        }

        var submitButton = el('account-submit');
        if (submitButton) submitButton.addEventListener('click', submit);

        var input = el('account-email');
        if (input) {
            input.addEventListener('keydown', function (event) {
                if (event.key === 'Enter') { event.preventDefault(); submit(); }
            });
        }

        var closeButton = document.querySelector('[data-close-account]');
        if (closeButton) closeButton.addEventListener('click', close);

        var overlay = el('account-overlay');
        if (overlay) {
            overlay.addEventListener('click', function (event) {
                if (event.target === overlay) close();
            });
        }

        var out = el('account-signout');
        if (out) out.addEventListener('click', function () { signOut(); });

        document.addEventListener('keydown', function (event) {
            var o = el('account-overlay');
            if (event.key === 'Escape' && o && o.classList.contains(OPEN)) close();
        });

        /* Close the little menu when clicking elsewhere. */
        document.addEventListener('click', function (event) {
            var menu = el('account-menu');
            if (!menu || menu.hidden) return;
            var inside = event.target.closest && event.target.closest('.account');
            if (!inside) menu.hidden = true;
        });

        /* If a key arrived by ?ck= rather than by signing in, the header should
           still say somebody is here, because that is how a pre-sales person
           demos as an existing contact. */
        if (!isSignedIn() && window.DemoIdentity && window.DemoIdentity.contactKey) {
            account = {
                email: null,
                name: window.DemoIdentity.contactKey,
                contactKey: window.DemoIdentity.contactKey
            };
        }

        paint();
    }

    window.Account = {
        wire: wire,
        open: open,
        close: close,
        signOut: signOut,
        isSignedIn: isSignedIn,
        contactKey: contactKey,
        email: function () { return account ? account.email : null; },
        onChange: function (fn) { listeners.push(fn); return fn; }
    };
})(window, document);
