/* ============================================================================
   The readout must not break what it watches.

   watchTransport wraps window.fetch. It forwarded whatever receiver the caller
   had, which for strict mode code is undefined, and calling window.fetch with
   an undefined receiver throws Illegal invocation before any request is made.
   The Dengage SDK is strict mode code, so its fetch calls died the moment the
   readout was open, which was every test we ran. The probe page carries no
   debug.js and wrote its session immediately.

   This calls fetch exactly the way strict mode code does, with no receiver,
   and fails if it throws.
   ========================================================================== */
import { chromium } from 'playwright';
const BASE = process.env.BASE || 'http://localhost:8199';
const b = await chromium.launch({ ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
const page = await b.newPage();
page.on('pageerror', e => console.log('  PAGE ERROR:', e.message));

await page.goto(`${BASE}/?debug=1`, { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);

console.log('  readout active   :', await page.evaluate(() => !!document.getElementById('dps-debug')));

const result = await page.evaluate(async () => {
    'use strict';
    const out = {};
    /* A dengage host, so it takes the watched branch, and a bare call with no
       receiver, which is what the SDK does. Reaching the network is not the
       point: throwing before the request is. */
    const bare = window.fetch;
    try {
        await bare('https://push.dengage.com/api/onsite/getMessages');
        out.dengageHost = 'called without throwing';
    } catch (err) {
        out.dengageHost = /Illegal invocation/i.test(String(err))
            ? 'THREW Illegal invocation'
            : 'network error, which is fine here: ' + String(err).slice(0, 40);
    }
    try {
        await bare('/products.json');
        out.ownHost = 'called without throwing';
    } catch (err) {
        out.ownHost = /Illegal invocation/i.test(String(err))
            ? 'THREW Illegal invocation'
            : 'network error, which is fine here';
    }
    return out;
});

console.log('  dengage host     :', result.dengageHost);
console.log('  our own host     :', result.ownHost);

const broken = /Illegal invocation/.test(result.dengageHost + result.ownHost);
console.log(broken
    ? '\n  FAILED: the readout breaks fetch for the SDK.'
    : '\n  fetch survives a bare call, so the readout does not break the SDK.');
if (broken) process.exitCode = 1;
await b.close();
