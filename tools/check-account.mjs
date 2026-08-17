/* ============================================================================
   Signing in links this browser to a contact that already exists.

   The first version of this form asked for an email address and derived a
   DPS-<n> key from it. That is backwards: deriving a key CREATES a contact
   rather than linking to one, so signing in produced a brand new contact with
   no history and the Use Case 1 email had no last visit to read. The loop
   looked wired and resolved nothing.

   So the only thing worth asserting here is that whatever is typed reaches
   setContactKey unchanged.
   ========================================================================== */
import { chromium } from 'playwright';
const BASE = process.env.BASE || 'http://localhost:8199';
const b = await chromium.launch({ ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
const page = await b.newPage();
const sent = [];
await page.exposeFunction('__ev', (a, p) => sent.push({ a, p }));
await page.addInitScript(() => {
    window.addEventListener('dps:rh-demo:event', e => window.__ev(e.detail.action, e.detail.payload));
    const push = Array.prototype.push;
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push = function (o) { if (o && o.event) window.__ev(o.event, null); return push.apply(this, arguments); };
});
page.on('pageerror', e => console.log('  PAGE ERROR:', e.message));

await page.goto(`${BASE}/?cep=01310-100`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1600);

console.log('  before        :', JSON.stringify(await page.evaluate(() => ({
    signedIn: window.Account.isSignedIn(),
    label: document.getElementById('account-label').textContent
}))));

await page.click('#account-button'); await page.waitForTimeout(300);
await page.click('#account-submit'); await page.waitForTimeout(200);
console.log('  empty         :', JSON.stringify(await page.evaluate(() => document.getElementById('account-error').textContent)));

const KEY = 'salil-demo';
await page.fill('#account-key', KEY);
await page.click('#account-submit'); await page.waitForTimeout(700);

const after = await page.evaluate(() => ({
    key: window.Account.contactKey(),
    label: document.getElementById('account-label').textContent,
    identity: window.DemoIdentity.contactKey
}));
console.log('  after sign in :', JSON.stringify(after));

const ck = sent.filter(e => e.a === 'setContactKey');
console.log('  setContactKey :', ck.length ? JSON.stringify(ck[ck.length - 1].p) : 'NOT SENT');

const verbatim = after.key === KEY && after.identity === KEY &&
                 ck.length && ck[ck.length - 1].p.contact_key === KEY;
console.log(verbatim
    ? '\n  The key is used exactly as typed. Nothing was derived or invented.'
    : '\n  FAILED: the key was altered on its way to the SDK.');
if (!verbatim) process.exitCode = 1;
await b.close();
