/* ============================================================================
   Signing in, and the one property that matters: the same address must reach
   the same contact every time. A counter would not survive a reload, and a new
   contact per sign in means the Use Case 1 email reads the wrong last visit.
   ========================================================================== */
import { chromium } from 'playwright';
const BASE = process.env.BASE || 'http://localhost:8199';
const b = await chromium.launch({ ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
const page = await b.newPage();
const sent = [];
await page.exposeFunction('__ev', (a) => sent.push(a));
/* Two channels, because the modules use two. Every ec:* call announces itself
   on dps:<slug>:event, while scenario() goes to dataLayer and a window event.
   Watching one and asserting on the other reports zero for something that
   fired, which is exactly what the first version of this did. */
await page.addInitScript(() => {
    window.addEventListener('dps:rh-demo:event', e => window.__ev(e.detail.action));
    const push = Array.prototype.push;
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push = function (o) {
        if (o && o.event) window.__ev(o.event);
        return push.apply(this, arguments);
    };
});
const logs = [];
page.on('console', m => logs.push(m.text()));
page.on('pageerror', e => console.log('  PAGE ERROR:', e.message));

await page.goto(`${BASE}/?cep=01310-100`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1400);

console.log('  before  :', JSON.stringify(await page.evaluate(() => ({
    signedIn: window.Account.isSignedIn(),
    label: document.getElementById('account-label').textContent
}))));

// Their two validation messages.
await page.click('#account-button'); await page.waitForTimeout(250);
await page.click('#account-submit'); await page.waitForTimeout(150);
console.log('  empty   :', JSON.stringify(await page.evaluate(() => document.getElementById('account-error').textContent)));
await page.fill('#account-email', 'notanemail');
await page.click('#account-submit'); await page.waitForTimeout(150);
console.log('  invalid :', JSON.stringify(await page.evaluate(() => document.getElementById('account-error').textContent)));

await page.fill('#account-email', 'ana.silva@example.com');
await page.click('#account-submit'); await page.waitForTimeout(400);
const first = await page.evaluate(() => ({
    signedIn: window.Account.isSignedIn(),
    key: window.Account.contactKey(),
    label: document.getElementById('account-label').textContent
}));
console.log('  signed  :', JSON.stringify(first));

// Same address again, after a reload, must be the same contact.
await page.evaluate(() => window.Account.signOut());
await page.reload({ waitUntil: 'networkidle' }); await page.waitForTimeout(1200);
await page.click('#account-button'); await page.waitForTimeout(200);
await page.fill('#account-email', 'ana.silva@example.com');
await page.click('#account-submit'); await page.waitForTimeout(400);
const again = await page.evaluate(() => window.Account.contactKey());
console.log('  again   :', JSON.stringify({ key: again, stable: again === first.key }));

// A different address must be a different contact.
await page.evaluate(() => window.Account.signOut());
await page.click('#account-button'); await page.waitForTimeout(200);
await page.fill('#account-email', 'bruno@example.com');
await page.click('#account-submit'); await page.waitForTimeout(400);
const other = await page.evaluate(() => window.Account.contactKey());
console.log('  other   :', JSON.stringify({ key: other, differs: other !== first.key }));

console.log('\n  setContactKey seen:', logs.filter(l => l.includes('setContactKey')).length, 'times');
console.log('  scenarios:', sent.filter(a => a === 'rh_signed_in').length, 'rh_signed_in');
await b.close();
