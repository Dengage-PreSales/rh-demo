/* ============================================================================
   Saved items, and the sign in their own site requires.

   The gate is the first assertion because it is a real behaviour of their
   storefront rather than a nicety: wishlist-login reads Iniciar sessao, so a
   heart pressed by a signed out visitor opens the sign in dialog and says why.
   ========================================================================== */
import { chromium } from 'playwright';
const BASE = process.env.BASE || 'http://localhost:8199';
const b = await chromium.launch({ ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
const page = await b.newPage();
const sent = [];
await page.exposeFunction('__ev', a => sent.push(a));
await page.addInitScript(() => {
    window.addEventListener('dps:rh-demo:event', e => window.__ev(e.detail.action));
    const push = Array.prototype.push;
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push = function (o) { if (o && o.event) window.__ev(o.event); return push.apply(this, arguments); };
});
page.on('pageerror', e => console.log('  PAGE ERROR:', e.message));

await page.goto(`${BASE}/?cep=01310-100`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);

// Signed out: the heart must send them to sign in, not silently save.
await page.click('.heart');
await page.waitForTimeout(350);
console.log('  signed out :', JSON.stringify(await page.evaluate(() => ({
    dialogOpen: document.getElementById('account-overlay').classList.contains('is-open'),
    reason: (document.getElementById('account-reason') || {}).textContent,
    saved: window.Wishlist.items().length
}))));

await page.fill('#account-email', 'ana.silva@example.com');
await page.click('#account-submit');
await page.waitForTimeout(400);

await page.click('.heart');
await page.waitForTimeout(400);
console.log('  after save :', JSON.stringify(await page.evaluate(() => ({
    saved: window.Wishlist.items().length,
    heartOn: document.querySelector('.heart').getAttribute('aria-pressed'),
    badge: document.getElementById('wishlist-count').textContent
}))));

await page.click('#wishlist-button');
await page.waitForTimeout(400);
console.log('  drawer     :', JSON.stringify(await page.evaluate(() => ({
    open: document.getElementById('wishlist').classList.contains('is-open'),
    lines: document.querySelectorAll('#wishlist-lines .cart-line').length,
    notes: [...document.querySelectorAll('#wishlist-lines .line-note')].map(n => n.dataset.state)
}))));

// A saved item outlives the shop, so the note must follow the shop.
await page.evaluate(() => window.StoreContext.setCep('29010-000'));
await page.waitForTimeout(2300);
console.log('  no shop    :', JSON.stringify(await page.evaluate(() => ({
    lines: document.querySelectorAll('#wishlist-lines .cart-line').length,
    notes: document.querySelectorAll('#wishlist-lines .line-note').length
}))));

await page.evaluate(() => window.StoreContext.setCep('01310-100'));
await page.waitForTimeout(2300);
await page.click('#wishlist-lines .wish-remove');
await page.waitForTimeout(400);
console.log('  removed    :', JSON.stringify(await page.evaluate(() => ({
    saved: window.Wishlist.items().length,
    heartOn: document.querySelector('.heart').getAttribute('aria-pressed')
}))));

const need = ['ec:addToWishlist', 'ec:removeFromWishlist'];
const missing = need.filter(n => !sent.includes(n));
console.log('\n  events:', sent.filter(a => a.includes('Wishlist')).join(', ') || '(none)');
if (missing.length) { console.log('  MISSING:', missing.join(', ')); process.exitCode = 1; }
else console.log('  both wishlist events left the page.');
await b.close();
