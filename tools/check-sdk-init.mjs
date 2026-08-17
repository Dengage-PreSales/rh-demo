/* ============================================================================
   Does initialize actually run, and does nothing go out ahead of it?

   The page used to queue initialize into a stub the SDK never drains, so it
   never ran: no session was started and the contact key was never applied,
   while every later event sailed through and made the wiring look healthy.

   A fake SDK stands in here, appearing on a delay the way the real one does,
   and records the exact order of calls. Two things must hold: initialize is
   called at all, and it is first.
   ========================================================================== */
import { chromium } from 'playwright';
const BASE = process.env.BASE || 'http://localhost:8200';
const b = await chromium.launch({ ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
const page = await b.newPage();
const calls = [];
await page.exposeFunction('__sdk', (a, p) => calls.push({ a, p }));

/* Replaces the real SDK, which this sandbox cannot reach, and lands 900ms late
   so the gap the bug lived in is genuinely exercised rather than skipped. */
await page.addInitScript(() => {
    window.setTimeout(function () {
        window.dengage = function (action, payload) { window.__sdk(action, JSON.stringify(payload || null)); };
    }, 900);
});
page.on('pageerror', e => console.log('  PAGE ERROR:', e.message));

await page.goto(`${BASE}/?ck=salil-demo&cep=01310-100`, { waitUntil: 'networkidle' });
await page.waitForTimeout(4000);

const order = calls.map(c => c.a);
console.log('  call order        :', order.join(' -> ') || '(nothing)');
console.log('  initialize ran    :', order.includes('initialize') ? 'YES' : 'NO');
console.log('  initialize first  :', order[0] === 'initialize' ? 'YES' : 'NO, it was ' + order[0]);
console.log('  initialize payload:', (calls.find(c => c.a === 'initialize') || {}).p);

await page.evaluate(() => window.Account.signIn('salil-demo'));
await page.waitForTimeout(600);
const ck = calls.filter(c => c.a === 'setContactKey');
console.log('  setContactKey     :', ck.length ? 'sent ' + ck[ck.length - 1].p : 'NOT SENT');

const bad = !order.includes('initialize') || order[0] !== 'initialize' || !ck.length;
console.log(bad ? '\n  FAILED' : '\n  Initialize runs first and the contact key follows it.');
if (bad) process.exitCode = 1;
await b.close();
