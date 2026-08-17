/* ============================================================================
   One unassisted journey, end to end, on LIVE data.

   Every other check in this folder runs against the pre-rendered files, because
   the fallback is what a sandboxed browser can reach. That proves the storefront
   handles a stored answer and proves nothing about a live one. This drives the
   whole journey against the real rh_offer, so a difference between the two
   shapes would surface here rather than on a call.

   Sign in, search, open a product, save it, add to basket, change postcode, see
   what the new shop cannot supply, check out. No dead links, no invented claims.
   ========================================================================== */
import { chromium } from 'playwright';
const BASE = process.env.BASE || 'http://localhost:8200';
const b = await chromium.launch({ ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
const page = await b.newPage();
const sent = [], errors = [];
await page.exposeFunction('__ev', a => sent.push(a));
await page.addInitScript(() => {
    window.addEventListener('dps:rh-demo:event', e => window.__ev(e.detail.action));
    const push = Array.prototype.push;
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push = function (o) { if (o && o.event) window.__ev(o.event); return push.apply(this, arguments); };
});
page.on('pageerror', e => errors.push('page error: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
page.on('requestfailed', r => errors.push('failed: ' + r.url()));
page.on('response', r => { if (r.status() === 404) errors.push('404: ' + r.url()); });
const step = (n, v) => console.log(`  ${n.padEnd(18)} ${JSON.stringify(v)}`);

const sp  = await (await fetch(`${BASE}/api/rh_offer?cep=01310-100&n=8`)).json();
const poa = await (await fetch(`${BASE}/api/rh_offer?cep=90010-150&n=8`)).json();
const FLIP = Object.keys(sp.stock).find(id => sp.stock[id] === 'available' && poa.stock[id] === 'withoutStock');
if (!FLIP) throw new Error('live data has no toy that flips between the two shops');
console.log(`  chosen toy         ${FLIP}: available in Sao Paulo, not in Porto Alegre (from live data)`);

await page.goto(`${BASE}/?cep=01310-100`, { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);

step('served from', await page.evaluate(() => ({
    servedFrom: window.StoreContext.state().servedFrom,
    shop: window.StoreContext.storeName(),
    stock: Object.keys(window.StoreContext.state().stock).length,
    badges: document.querySelectorAll('.card .avail').length
})));

// 1. sign in
await page.click('#account-button'); await page.waitForTimeout(250);
await page.fill('#account-key', 'salil-demo');
await page.click('#account-submit'); await page.waitForTimeout(500);
step('signed in', await page.evaluate(() => window.Account.contactKey()));

// 2. search
await page.click('#search-input');
/* Their catalogue is Portuguese: the toy is Homem-Aranha, not Spider-Man.
   Searching spider correctly finds nothing, which is a note for the demo
   script rather than a defect. */
await page.type('#search-input', 'aranha', { delay: 45 });
await page.waitForTimeout(800);
const hit = await page.evaluate(() => {
    const a = document.querySelector('#search-results .result');
    return a ? { href: a.getAttribute('href'), name: a.querySelector('.result-name').textContent.slice(0, 34) } : null;
});
step('search', hit);
if (!hit) throw new Error('search found nothing for a term the catalogue contains');

// 3. product page, live
await page.goto(`${BASE}/product.html?id=${FLIP}`, { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);
step('product page', await page.evaluate(() => ({
    servedFrom: window.StoreContext.state().servedFrom,
    shop: window.StoreContext.storeName(),
    claim: (document.querySelector('.avail') || {}).textContent
})));

// 4. save it, 5. add to basket
await page.click('.heart'); await page.waitForTimeout(400);
const added = await page.evaluate(() => {
    const btn = document.querySelector('[data-add]');
    if (btn) btn.click();
    return { saved: window.Wishlist.items().length, cart: window.Cart.lines().length };
});
await page.waitForTimeout(400);
step('saved + basket', added);

// 6. change postcode to a shop that cannot supply, on live data
await page.evaluate(() => window.StoreContext.setCep('90010-150'));
await page.waitForTimeout(3000);
await page.click('#cart-button'); await page.waitForTimeout(600);
step('after move', await page.evaluate(() => ({
    servedFrom: window.StoreContext.state().servedFrom,
    shop: window.StoreContext.storeName(),
    notice: !!document.querySelector('#cart-notice-host .notice'),
    stuck: [...document.querySelectorAll('.stuck-list li')].map(l => l.textContent.slice(0, 28))
})));

// 7. check out
await page.click('#cart-checkout'); await page.waitForTimeout(800);
step('checkout', await page.evaluate(() => ({
    mode: window.CheckoutView.mode(),
    blocked: document.getElementById('checkout-place').disabled
})));
if (await page.evaluate(() => document.getElementById('checkout-place').disabled)) {
    await page.click('#checkout-switch-delivery'); await page.waitForTimeout(400);
}
await page.click('#checkout-place'); await page.waitForTimeout(900);
step('placed', await page.evaluate(() => ({
    ref: (document.querySelector('.order-ref') || {}).textContent,
    cart: window.Cart.lines().length
})));

const live = await (await fetch(`${BASE}/__livecount`)).json();
const want = ['pageView','ec:addToCart','ec:beginCheckout','ec:order','ec:search','ec:addToWishlist'];
const missing = want.filter(w => !sent.includes(w));
console.log('\n  live rh_offer calls made by the browser:', live.liveCalls);
console.log('  event types seen:', [...new Set(sent)].join(', '));
console.log(missing.length ? '  MISSING: ' + missing.join(', ') : '  every expected event fired.');
console.log(errors.length ? '\n  JS ERRORS:\n   ' + errors.join('\n   ') : '\n  No JS errors.');
if (missing.length || errors.length) process.exitCode = 1;
await b.close();
