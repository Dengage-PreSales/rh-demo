/* ============================================================================
   The App Inbox, checked against a stubbed message provider.

   No live account serves messages on demand, so the provider is stubbed with
   the shape the server actually uses: smsgId plus a messageJson payload. The
   stub is installed BEFORE the page's own scripts run, which works because the
   head snippet keeps an existing window.dengage rather than replacing it, and
   the real SDK loader is refused at the network layer so it cannot race the
   stub mid-check. That refusal is asserted by the outcome: if the real SDK
   loaded, the provider would return no fixture messages and every assertion
   below would fail loudly rather than pass weakly.

   What this proves: the bell counts unread, the drawer renders the list,
   impressions are reported once per message, an open marks read and reports,
   a dismissal hides locally WITHOUT reporting a delete (the shared-account
   rule), and an inbox that has not answered yet says so instead of claiming
   to be empty.
   ========================================================================== */
import { chromium } from 'playwright';
const BASE = process.env.BASE || 'http://localhost:8199';
const b = await chromium.launch({ ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
const page = await b.newPage();

let failures = 0;
function check(name, ok, detail) {
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  ' + detail : ''}`);
    if (!ok) failures += 1;
}

await page.route('**://*.dengage.com/**', (route) => route.abort());

await page.addInitScript((base) => {
    window.__inboxCalls = { impressions: [], opens: [], clicks: [], deletes: [] };
    const provider = {
        getMessages: () => Promise.resolve([
            {
                smsgId: 'm-1',
                messageJson: {
                    title: 'Your saved toy is back',
                    message: 'Collect it today from your store.',
                    mediaUrl: base + '/img/products/100184971.webp',
                    targetUrl: base + '/product.html?id=100184971',
                    sendDate: new Date(Date.now() - 5 * 60000).toISOString()
                }
            },
            /* Snake case on purpose: the parser must read the server's other
               spelling, not just the one the first fixture uses. */
            {
                smsg_id: 'm-2',
                message_json: {
                    messageTitle: 'Weekend collection hours',
                    body: 'Your store opens at 10 on Sunday.',
                    sentDate: new Date(Date.now() - 26 * 3600000).toISOString()
                }
            },
            {
                smsgId: 'm-3',
                messageJson: {
                    title: 'A message to dismiss',
                    message: 'This one exists to be dismissed by the check.',
                    sendDate: new Date(Date.now() - 60000).toISOString()
                }
            }
        ]),
        onImpression: (id) => window.__inboxCalls.impressions.push(id),
        onOpen: (id) => window.__inboxCalls.opens.push(id),
        onClick: (id, btn) => window.__inboxCalls.clicks.push(id + ':' + btn),
        onDelete: (id) => window.__inboxCalls.deletes.push(id)
    };
    window.dengage = function (action, a, cb) {
        if (action === 'InboxMessageProvider') return provider;
        if (typeof a === 'function') { a(''); return; }
        if (typeof cb === 'function') { cb(''); return; }
    };
}, BASE);
page.on('pageerror', (e) => { console.log('  PAGE ERROR:', e.message); failures += 1; });

console.log('The App Inbox, against a stubbed provider:\n');
/* The postcode gate opens over everything on a fresh visit, exactly as their
   real storefront gates on a CEP, so the check arrives with one already in the
   address the way every other check here does. */
await page.goto(`${BASE}/?cep=01310-100`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1800);

const badge = await page.evaluate(() => {
    const el = document.getElementById('inbox-badge');
    return { text: el && el.textContent, hidden: el ? el.hidden : null };
});
check('bell badge counts unread', badge.text === '3' && badge.hidden === false, JSON.stringify(badge));

await page.click('#inbox-button');
await page.waitForTimeout(600);

const drawer = await page.evaluate(() => ({
    open: document.getElementById('inbox').classList.contains('is-open'),
    items: document.querySelectorAll('#inbox-body .inbox-item').length,
    titles: [...document.querySelectorAll('#inbox-body .inbox-item h3')].map((h) => h.textContent.trim()),
    withMedia: document.getElementById('inbox-body').classList.contains('with-media'),
    unreadLabel: (document.getElementById('inbox-count') || {}).textContent
}));
check('drawer opens with all three messages', drawer.open && drawer.items === 3, JSON.stringify(drawer.titles));
check('snake_case message parsed', drawer.titles.some((t) => t.includes('Weekend collection hours')));
check('media column reserved for the mixed list', drawer.withMedia === true);
check('drawer repeats the unread count', /3/.test(drawer.unreadLabel || ''), drawer.unreadLabel);

const impressions = await page.evaluate(() => window.__inboxCalls.impressions.slice().sort());
check('impressions reported once per message', JSON.stringify(impressions) === JSON.stringify(['m-1', 'm-2', 'm-3']), JSON.stringify(impressions));

/* Open the first message. The affordance is a real link opening a new tab, so
   the click is observed through the popup it spawns and the report it sends. */
const [popup] = await Promise.all([
    page.waitForEvent('popup', { timeout: 5000 }).catch(() => null),
    page.click('[data-inbox-open="m-1"]')
]);
await page.waitForTimeout(400);
if (popup) await popup.close();
const afterOpen = await page.evaluate(() => ({
    opens: window.__inboxCalls.opens,
    badge: document.getElementById('inbox-badge').textContent,
    readStored: (JSON.parse(localStorage.getItem('dps:rh-demo:inbox-read') || '[]')).includes('m-1')
}));
check('open is reported and marks read', afterOpen.opens.length === 1 && afterOpen.opens[0] === 'm-1' && afterOpen.readStored, JSON.stringify(afterOpen));
check('badge drops to the remaining unread', afterOpen.badge === '2', afterOpen.badge);

await page.click('[data-inbox-dismiss="m-3"]');
await page.waitForTimeout(300);
const afterDismiss = await page.evaluate(() => ({
    items: document.querySelectorAll('#inbox-body .inbox-item').length,
    deletes: window.__inboxCalls.deletes,
    hiddenStored: (JSON.parse(localStorage.getItem('dps:rh-demo:inbox-hidden') || '[]')).includes('m-3')
}));
check('dismiss hides the message locally', afterDismiss.items === 2 && afterDismiss.hiddenStored, JSON.stringify(afterDismiss));
check('dismiss does NOT report a delete to the shared account', afterDismiss.deletes.length === 0, JSON.stringify(afterDismiss.deletes));

/* Honesty of the empty state: with no provider answer, the inbox must say it
   is still checking, never that there are no messages. The head snippet's own
   queue stub stands in for a not-yet-loaded SDK. */
const quiet = await b.newPage();
await quiet.route('**://*.dengage.com/**', (route) => route.abort());
await quiet.goto(`${BASE}/?cep=01310-100`, { waitUntil: 'networkidle' });
await quiet.click('#inbox-button');
await quiet.waitForTimeout(600);
const emptyText = await quiet.evaluate(() => (document.getElementById('inbox-body') || {}).textContent || '');
check('an unanswered inbox says it is checking, not empty',
    emptyText.includes('Checking') && !emptyText.includes('Nothing here yet'), JSON.stringify(emptyText.trim().slice(0, 60)));
await quiet.close();

await b.close();
if (failures) { console.log(`\n${failures} check(s) failed.`); process.exit(1); }
console.log('\nAll inbox checks pass.');
