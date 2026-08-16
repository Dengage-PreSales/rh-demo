/* ============================================================================
   Does the storefront still show availability when the live call does not come
   back? Run it before a rehearsal, and again before the demo.

   WHY THIS IS A SCRIPT RATHER THAN A NOTE

   The fallback is the one path that is never exercised in normal use, which
   makes it the one most likely to be quietly broken. It already was: it pointed
   at a directory that does not exist, and before that at files carrying the
   message's shape rather than the page's, which would have produced a storefront
   with no shop chip and no badges while reporting a perfectly successful
   fallback. Neither fault was visible from reading the code. Both are obvious
   the moment something loads the page and counts what is on it.

   WHAT IT CHECKS

     the stored answer draws the same shop, the same stock map and the same
       number of badges as a live answer does
     it marks itself as stored, so nothing can claim to be live when it is not
     a postcode no shop serves draws no badges and names no shop, because
       reading nothing as out of stock would be a false claim about real stock

   WHAT IT CANNOT CHECK, and this is the point of the last section

   Whether the live call works. Some environments cannot reach Supabase from a
   browser at all, and in those the live load silently falls back too. If both
   loads are served from the same place, the comparison is between the stored
   answer and itself, which proves nothing about live. So the script tests
   reachability first and refuses to report on the live half when it is absent,
   rather than printing a pass that means less than it appears to.

   Usage, from the repository root:

     cd web && python3 -m http.server 8199 &
     node tools/check-fallback.mjs

   Against the published site instead, which is where the live half can be
   proven:

     BASE=https://dengage-presales.github.io/rh-demo node tools/check-fallback.mjs
   ========================================================================== */

import { chromium } from 'playwright';

const BASE = process.env.BASE || 'http://localhost:8199';
const CHROME = process.env.CHROME_PATH || undefined;

const SERVED = 'https://raextqlludkagdntyzwn.supabase.co/rest/v1/rpc/rh_offer' +
               '?cep=01310100&sku=100184971&n=3';
const KEY = 'sb_publishable_HcLAWb6E5Gn_d5vVTjPB_Q_zkjklifK';

/* What a visitor would actually see, read off the page rather than off the
   state, wherever the page is what matters. */
async function look(page, url) {
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1200);
    return page.evaluate(() => {
        const s = window.StoreContext ? window.StoreContext.state() : {};
        return {
            status: s.status,
            servedFrom: s.servedFrom,
            store: s.store ? s.store.name : null,
            stores: (s.stores || []).length,
            stock: Object.keys(s.stock || {}).length,
            badges: document.querySelectorAll('.avail').length
        };
    });
}

const browser = await chromium.launch(CHROME ? { executablePath: CHROME } : {});
const page = await browser.newPage();
const problems = [];
const notes = [];

/* Can this browser reach the database at all? Everything below is read in the
   light of the answer. */
const reachable = await page.goto(BASE).then(() => page.evaluate(async (args) => {
    try {
        const res = await fetch(args.url, { headers: { apikey: args.key, Accept: 'application/json' } });
        return res.ok;
    } catch (err) { return false; }
}, { url: SERVED, key: KEY }));

const live = await look(page, `${BASE}/?cep=01310-100`);
await page.evaluate(() => window.localStorage.clear());
const stored = await look(page, `${BASE}/?cep=01310-100&offline=1`);
await page.evaluate(() => window.localStorage.clear());
const nowhere = await look(page, `${BASE}/?cep=29010-000`);

console.log('live      ', JSON.stringify(live));
console.log('stored    ', JSON.stringify(stored));
console.log('no shop   ', JSON.stringify(nowhere));
console.log('');

/* These hold whether or not the database is reachable. */
if (!stored.badges) problems.push('the stored answer draws no availability badges at all');
if (!stored.store) problems.push('the stored answer names no shop, so the header chip would be blank');
if (stored.stock !== 200) problems.push(`the stored answer carries ${stored.stock} products, expected the full catalogue`);
if (stored.servedFrom !== 'stored answer') problems.push(`the stored answer does not mark itself, it says "${stored.servedFrom}"`);
if (nowhere.badges) problems.push(`a postcode no shop serves still draws ${nowhere.badges} badges`);
if (nowhere.store) problems.push(`a postcode no shop serves named "${nowhere.store}"`);

/* This one only means something when live is genuinely live. */
if (reachable) {
    if (live.servedFrom !== 'live') problems.push(`the database is reachable, yet the page was served from "${live.servedFrom}"`);
    if (stored.badges !== live.badges) problems.push(`stored draws ${stored.badges} badges, live draws ${live.badges}`);
    if (stored.store !== live.store) problems.push(`stored resolved "${stored.store}", live resolved "${live.store}"`);
} else {
    notes.push('This browser cannot reach the database, so both loads were served from');
    notes.push('the stored answer and the live half of this check proved nothing. The');
    notes.push('fallback itself is still proven. Run it against the published site to');
    notes.push('cover the rest:');
    notes.push('  BASE=https://dengage-presales.github.io/rh-demo node tools/check-fallback.mjs');
}

if (problems.length) {
    console.log('FAILED');
    for (const p of problems) console.log('  ' + p);
} else {
    console.log(reachable
        ? 'Live and stored agree, and a postcode with no shop claims nothing.'
        : 'The fallback is correct. The live half was not covered, see below.');
}
if (notes.length) console.log('\n' + notes.join('\n'));

await browser.close();
process.exit(problems.length ? 1 : 0);
