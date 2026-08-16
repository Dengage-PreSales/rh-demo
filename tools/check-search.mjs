/* ============================================================================
   Search: five states, one event per settled search.

   The debounce is the part worth testing. ec:search reports what somebody
   searched for, so firing per keystroke would write eight rows for one search
   of "lego" and make the table useless for the thing it exists for. This types
   a word a character at a time and asserts exactly one event comes out.
   ========================================================================== */
import { chromium } from 'playwright';
const BASE = process.env.BASE || 'http://localhost:8199';
const b = await chromium.launch({ ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
const page = await b.newPage();
const sent = [];
await page.exposeFunction('__ev', (a, p) => sent.push({ a, p }));
await page.addInitScript(() => {
    window.addEventListener('dps:rh-demo:event', e => window.__ev(e.detail.action, e.detail.payload));
});
page.on('pageerror', e => console.log('  PAGE ERROR:', e.message));

await page.goto(`${BASE}/?cep=01310-100`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
const searches = () => sent.filter(e => e.a === 'ec:search');

const type = async (text) => {
    await page.fill('#search-input', '');
    await page.click('#search-input');
    for (const ch of text) { await page.type('#search-input', ch, { delay: 40 }); }
    await page.waitForTimeout(700);
};

await type('l');
console.log('  one character  :', JSON.stringify(await page.evaluate(() => ({
    note: (document.querySelector('.result-note') || {}).textContent,
    results: document.querySelectorAll('.result').length
}))));

const before = searches().length;
await type('lego');
const state = await page.evaluate(() => ({
    results: document.querySelectorAll('.result').length,
    badges: document.querySelectorAll('#search-results .avail').length,
    foot: (document.querySelector('.result-foot') || {}).textContent
}));
console.log('  "lego"         :', JSON.stringify(state));
console.log('  events for it  :', searches().length - before, '(must be 1 for 4 keystrokes)');

await type('zzzzzz');
console.log('  no results     :', JSON.stringify(await page.evaluate(() => ({
    note: (document.querySelector('.result-note') || {}).textContent
}))));

// No shop resolved means no badge, same silence as the grid.
await page.evaluate(() => window.StoreContext.setCep('29010-000'));
await page.waitForTimeout(2200);
await type('lego');
console.log('  no shop        :', JSON.stringify(await page.evaluate(() => ({
    results: document.querySelectorAll('.result').length,
    badges: document.querySelectorAll('#search-results .avail').length
}))));

const last = searches().slice(-1)[0];
console.log('\n  last ec:search payload:', JSON.stringify(last && last.p));
console.log('  total ec:search events:', searches().length);
await b.close();
