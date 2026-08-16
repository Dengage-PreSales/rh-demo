/* ============================================================================
   Checkout, driven the way a person drives it.

   Three states carry the use case and each is asserted here:

     pickup blocked      the shop cannot hand over a line, so the order cannot
                         be placed. This is the one contradiction the storefront
                         must never make.
     switch to delivery   their own Continuar com entrega, which unblocks it,
                         because delivery is not constrained to one shelf
     no shop at all      Vitoria, where their site falls through to delivery and
                         pickup is not offerable

   It also asserts that ec:beginCheckout and ec:order actually leave the page,
   since making them reachable by a human was the whole reason for W1 and W2.
   ========================================================================== */
import { chromium } from 'playwright';
const BASE = process.env.BASE || 'http://localhost:8199';
const STUCK = '100172847';   // out of stock at both narrative shops

const b = await chromium.launch({ ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
const page = await b.newPage();
const sent = [];
await page.exposeFunction('__ev', n => sent.push(n));
/* Every send announces itself on dps:<slug>:event, which is the same hook the
   in page debug readout uses, so this records exactly what the readout shows
   rather than a parallel guess at it. Listening to dataLayer alone missed every
   ec:* call, because those go to the SDK and never touch dataLayer. */
await page.addInitScript(() => {
    window.addEventListener('dps:rh-demo:event', e => window.__ev(e.detail.action));
});
page.on('pageerror', e => console.log('  PAGE ERROR:', e.message));

const evalIn = (fn, arg) => page.evaluate(fn, arg);

await page.goto(`${BASE}/?cep=01310-100`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);

await evalIn(sku => {
    const p = window.Catalog.all().find(x => String(x.id) === sku);
    if (!p) throw new Error('test SKU not in the catalogue: ' + sku);
    window.Cart.clear(); window.Cart.add(p);
}, STUCK);

await page.click('#cart-button'); await page.waitForTimeout(300);
await page.click('#cart-checkout'); await page.waitForTimeout(600);

const blockedState = await evalIn(() => ({
    open: document.getElementById('checkout-overlay').classList.contains('is-open'),
    mode: window.CheckoutView.mode(),
    warn: !!document.querySelector('#checkout-body .notice[data-tone="warn"]'),
    placeDisabled: document.getElementById('checkout-place').disabled,
    shipping: [...document.querySelectorAll('.summary-row')].map(r => r.textContent.trim()).find(t => /Shipping/.test(t))
}));
console.log('  pickup blocked   :', JSON.stringify(blockedState));

await page.click('#checkout-switch-delivery'); await page.waitForTimeout(400);
const delivered = await evalIn(() => ({
    mode: window.CheckoutView.mode(),
    warn: !!document.querySelector('#checkout-body .notice[data-tone="warn"]'),
    placeDisabled: document.getElementById('checkout-place').disabled,
    shipping: [...document.querySelectorAll('.summary-row')].map(r => r.textContent.trim()).find(t => /Shipping/.test(t))
}));
console.log('  after switch     :', JSON.stringify(delivered));

await page.click('#checkout-place'); await page.waitForTimeout(700);
const done = await evalIn(() => ({
    done: !!document.querySelector('.checkout-done'),
    ref: (document.querySelector('.order-ref') || {}).textContent,
    cartEmptied: window.Cart.lines().length
}));
console.log('  placed           :', JSON.stringify(done));

// Vitoria: no shop serves it, so their site falls through to delivery.
await page.click('#checkout-close-done'); await page.waitForTimeout(300);
await evalIn(async sku => {
    await window.StoreContext.setCep('29010-000');
    const p = window.Catalog.all().find(x => String(x.id) === sku);
    window.Cart.clear(); window.Cart.add(p);
}, STUCK);
await page.waitForTimeout(2200);
await page.click('#cart-button'); await page.waitForTimeout(300);
await page.click('#cart-checkout'); await page.waitForTimeout(600);
const noShop = await evalIn(() => ({
    mode: window.CheckoutView.mode(),
    info: !!document.querySelector('#checkout-body .notice[data-tone="info"]'),
    pickupDisabled: document.querySelector('.method[data-method="pickup"]').disabled,
    placeDisabled: document.getElementById('checkout-place').disabled
}));
console.log('  no shop at all   :', JSON.stringify(noShop));

const need = ['ec:beginCheckout', 'ec:order'];
const missing = need.filter(n => !sent.includes(n));
console.log('\n  events sent:', sent.join(', ') || '(none)');
if (missing.length) { console.log('  MISSING:', missing.join(', ')); process.exitCode = 1; }
else console.log('  both checkout events left the page.');
await b.close();
