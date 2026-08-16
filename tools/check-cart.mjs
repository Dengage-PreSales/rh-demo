/* ============================================================================
   Does the cart tell the truth as the shop changes? Run before a rehearsal.

     cd web && python3 -m http.server 8199 &
     CHROME_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome \
       node tools/check-cart.mjs

   THE SKU BELOW IS THE WHOLE TEST, so it is pinned and the run fails loudly if
   it is missing. The first version fell back to "any product" when it could not
   find the one it wanted, and quietly picked a toy both shops had. Every
   assertion passed and the scene it existed to check never ran once. A test
   that substitutes its own input is worse than no test, because it reports
   confidence it has not earned.

   100172847 is one of 52 in the catalogue that neither narrative shop can
   supply, so the notice must survive a move between them. Vitoria closes it:
   no shop resolved means no availability claim of any kind, not a claim of
   absence.
   ========================================================================== */
import { chromium } from 'playwright';
const BASE = 'http://localhost:8199';
const browser = await chromium.launch({ ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
const page = await browser.newPage();
const missing = [];
page.on('response', r => { if (r.status() === 404) missing.push(r.url().replace(BASE, '')); });
page.on('pageerror', e => console.log('PAGE ERROR:', e.message));

await page.goto(`${BASE}/?cep=01310-100`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);

// A product neither shop can supply, so the notice must survive the move.
const seeded = await page.evaluate(() => {
    const stuck = '100172847';
    const all = window.Catalog.all ? window.Catalog.all() : [];
    const p = all.find(x => String(x.id) === stuck);
    if (!p) throw new Error('test SKU not in the catalogue: ' + stuck);
    window.Cart.clear();
    window.Cart.add(p);
    return { name: p.name, id: p.id, spState: window.StoreContext.availabilityOf(p.id) };
});
console.log('  seeded:', JSON.stringify(seeded));

await page.click('#cart-button');
await page.waitForTimeout(400);
const inSP = await page.evaluate(() => ({
    notice: !!document.querySelector('#cart-notice-host .notice'),
    stuck: [...document.querySelectorAll('.stuck-list li')].map(li => li.textContent.slice(0, 30)),
    title: (document.querySelector('#cart-notice-host strong') || {}).textContent
}));
console.log('  in Sao Paulo :', JSON.stringify(inSP));

await page.evaluate(() => window.StoreContext.setCep('90010-150'));
await page.waitForTimeout(2500);
const inPOA = await page.evaluate(() => ({
    shop: window.StoreContext.storeName(),
    notice: !!document.querySelector('#cart-notice-host .notice'),
    title: (document.querySelector('#cart-notice-host strong') || {}).textContent,
    note: (document.querySelector('.line-note') || {}).dataset?.state
}));
console.log('  in Porto Alegre:', JSON.stringify(inPOA));

// No shop at all: the drawer must say nothing about availability.
await page.evaluate(() => window.StoreContext.setCep('29010-000'));
await page.waitForTimeout(2500);
const noShop = await page.evaluate(() => ({
    status: window.StoreContext.state().status,
    notice: !!document.querySelector('#cart-notice-host .notice'),
    notes: document.querySelectorAll('.line-note').length
}));
console.log('  no shop        :', JSON.stringify(noShop));

// Their two actions must do what they say.
await page.evaluate(() => window.StoreContext.setCep('01310-100'));
await page.waitForTimeout(2500);
const before = await page.evaluate(() => window.Cart.lines().length);
await page.click('#stuck-remove');
await page.waitForTimeout(400);
const after = await page.evaluate(() => ({ lines: window.Cart.lines().length, notice: !!document.querySelector('#cart-notice-host .notice') }));
console.log('  remove items   :', JSON.stringify({ before, ...after }));

console.log('\n  404s:', missing.length ? missing.join(', ') : '(none)');
await browser.close();
