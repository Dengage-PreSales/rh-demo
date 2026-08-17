/* ============================================================================
   Does the postcode reach the row Dengage stores?

   page_view_events records page_url and nothing else that can carry a
   postcode, so if the address bar does not have it, the message that reads
   this row later cannot know which shop was serving the visitor. Typing a
   postcode into the gate does not change the address on its own, which is how
   this was missed: every badge on screen was correct while the stored row knew
   nothing.

   Asserts the realistic path a person takes, not the one that happens to work:
   arrive with no postcode, type one in, then click a product.
   ========================================================================== */
import { chromium } from 'playwright';
const BASE = process.env.BASE || 'http://localhost:8200';
const b = await chromium.launch({ ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
const page = await b.newPage();
const views = [];
await page.exposeFunction('__pv', u => views.push(u));
/* Our pageView payload carries no page_url. The SDK adds it, reading the
   address bar at the moment of the call, which is exactly why the timing of
   the stamp matters. So record the address as the call goes out: that is the
   value the SDK will store. An earlier version read payload.page_url, got
   undefined every time, and reported a failure that was its own. */
await page.addInitScript(() => {
    window.addEventListener('dps:rh-demo:event', e => {
        if (e.detail.action === 'pageView') window.__pv(window.location.href);
    });
});
page.on('pageerror', e => console.log('  PAGE ERROR:', e.message));

// Arrive with NO postcode, the way a real visitor does.
await page.goto(`${BASE}/?ck=salil-demo`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
console.log('  1. arrived      ', views[0]);
console.log('     has cep?     ', /cep=/.test(views[0] || '') ? 'yes' : 'no  (expected: the gate has not been used yet)');

// Type it into the gate, as a person does.
/* On a first visit with no remembered shop the storefront opens the gate by
   itself, which is what their own site does. Only click the chip if it is not
   already open, or the click lands on a chip the overlay is covering. */
if (!(await page.evaluate(() => document.getElementById('cep-overlay').classList.contains('is-open')))) {
    await page.click('#store-chip');
    await page.waitForTimeout(300);
}
await page.fill('#cep-input', '01310-100');
await page.click('#cep-submit');
/* The gate closes itself once a shop resolves, so wait for that rather than a
   fixed pause. An earlier version guessed at 2.5 seconds and then failed on the
   overlay intercepting the next click, which read as a broken storefront when
   it was a broken wait. */
await page.waitForFunction(() => !document.getElementById('cep-overlay').classList.contains('is-open'), null, { timeout: 20000 });
await page.waitForTimeout(1200);
const addr = page.url();
console.log('  2. after typing ', addr);
console.log('     address now carries the postcode:', /cep=01310-?100/.test(addr) ? 'YES' : 'NO');

// Click a product, which is what actually records the next view.
await page.click('.card .card-media');
await page.waitForLoadState('networkidle');
await page.waitForTimeout(2000);
console.log('  3. product view ', views[1]);
const ok = /cep=/.test(views[1] || '');
console.log('     has cep?     ', ok ? 'YES, the stored row can be read back' : 'NO');

console.log('\n  page views recorded:', views.length);
if (!ok) { console.log('  FAILED: the postcode never reached a stored page view.'); process.exitCode = 1; }
else console.log('  The email can resolve a shop from this contact.');
await b.close();
