/* ============================================================================
   Pre-render one small answer per shop and per city, published to our own site.

   WHY THIS EXISTS, and it is worth reading before changing it.

   These files are a safety net, and only a safety net. Both the email and the
   storefront read Supabase live. Nothing here is served unless a live call does
   not come back.

   THE REASON THIS FILE ORIGINALLY GAVE WAS WRONG, and it is recorded rather
   than quietly deleted because the mistake shaped the whole design for a day.

   It claimed the Custom API timeout was caused by distance to Tokyo, and that
   Dengage's servers must be further away than this machine. That was inferred
   from measurements taken here and never checked from Dengage's side. Measuring
   it properly from Dengage disproved it twice: a probe against Tokyo answered
   three times out of three, a second project in Mumbai also answered three out
   of three, and the real message endpoint has since answered on both postcodes
   in a single send. The timeouts were load at that moment, not geography.

   So the honest description of these files is the modest one: they cover a call
   that does not come back, they are not a fix for anything structural, and the
   live path is the real path.

   TWO SHAPES, BECAUSE TWO THINGS READ THEM

     store/ and cep/     the rh_email shape. Small, about 2 KB. What a message
                         needs: one shop, one hero, a replacement, three offers.
     storefront/         the rh_offer shape, about 12 KB, which additionally
                         carries the stock map, the store object and the list of
                         serving shops. The page needs all three to draw a shop
                         chip and put a badge on every tile.

   Serving the message shape to the page was the first version of this, and it
   would have been invisible: the page would have reported a successful fallback
   and then drawn no badges at all, because the fields it reads were simply not
   in the file. A fallback that silently removes the feature is worse than one
   that fails loudly.

   WHAT THIS DOES AND DOES NOT CHANGE ABOUT THE CLAIM

   The message is still assembled per recipient at the moment of sending. What
   is a snapshot is the availability behind it, which was already true when the
   endpoint was live, because the availability itself was captured rather than
   read from Ri Happy in real time. So the honest sentence on the day is
   unchanged: the assembly is live, the stock is as fresh as the last capture.
   ========================================================================== */

import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RPC = 'https://raextqlludkagdntyzwn.supabase.co/rest/v1/rpc';
const KEY = 'sb_publishable_HcLAWb6E5Gn_d5vVTjPB_Q_zkjklifK';
const OUT = join(ROOT, 'web', 'offer');

const PAUSE_MS = 120;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function rpc(name, params) {
    const query = Object.entries(params)
        .filter(([, v]) => v !== null && v !== undefined && v !== '')
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
        .join('&');
    const response = await fetch(`${RPC}/${name}?${query}&apikey=${KEY}`, {
        headers: { Accept: 'application/json' }
    });
    if (!response.ok) throw new Error(`${name} returned ${response.status}`);
    return response.json();
}

async function listShops() {
    const response = await fetch(
        `${RPC.replace('/rpc', '')}/rh_store?select=store_id,name,region_code&fulfils_online=eq.true&apikey=${KEY}`,
        { headers: { Accept: 'application/json' } }
    );
    if (!response.ok) throw new Error(`shop list returned ${response.status}`);
    return response.json();
}

async function listCities() {
    const response = await fetch(
        `${RPC.replace('/rpc', '')}/rh_cep_region?select=cep,region_code,label&cep=not.is.null&apikey=${KEY}`,
        { headers: { Accept: 'application/json' } }
    );
    if (!response.ok) throw new Error(`city list returned ${response.status}`);
    return response.json();
}

/* The product a message is about. Chosen from the data rather than picked in
   advance: it is available at the shop a Sao Paulo postcode resolves to and
   absent at the Porto Alegre one, so a single campaign produces both halves of
   the scene. Passing it means every stored answer already carries the hero and,
   where the shop cannot supply it, the replacement. */
const HERO = process.env.RH_HERO || '100184971';

async function main() {
    const shops = await listShops();
    const cities = await listCities();
    console.error(`Pre-rendering ${shops.length} shops and ${cities.length} cities`);

    if (existsSync(OUT)) rmSync(OUT, { recursive: true, force: true });
    mkdirSync(join(OUT, 'store'), { recursive: true });
    mkdirSync(join(OUT, 'cep'), { recursive: true });
    mkdirSync(join(OUT, 'storefront'), { recursive: true });

    let bytes = 0;
    let withSubstitute = 0;

    for (const shop of shops) {
        const answer = await rpc('rh_email', { store_id: shop.store_id, sku: HERO, n: '3' });
        const body = JSON.stringify(answer);
        writeFileSync(join(OUT, 'store', `${shop.store_id}.json`), body);
        bytes += body.length;
        if (answer.substitute) withSubstitute += 1;
        await sleep(PAUSE_MS);
    }
    console.error(`  shops done, ${withSubstitute} of ${shops.length} need a replacement for the hero`);

    for (const city of cities) {
        const answer = await rpc('rh_email', { cep: city.cep, sku: HERO, n: '3' });

        /* Availability has three states and the third is the one that gets
           lost: true and false both mean somebody was asked, null means no
           shop resolved so nobody was. rh_offer used to return false for the
           third, which reads as "we checked and it is not there" about a real
           toy nobody checked. Vitoria and Rio Branco are the two postcodes that
           hit it. Asserting here means a stored answer can never carry the
           claim even if the function regresses. */
        if (answer.resolved !== 'store' && answer.hero &&
            answer.hero.available !== null && answer.hero.available !== undefined) {
            throw new Error(`${city.cep}: no shop resolved, yet it claims availability ` +
                            `is ${answer.hero.available}`);
        }

        const body = JSON.stringify(answer);
        writeFileSync(join(OUT, 'cep', `${city.cep}.json`), body);
        bytes += body.length;
        await sleep(PAUSE_MS);
    }

    /* The page's own shape, one per city. Larger because the page draws more:
       a badge on every tile needs the whole stock map, and the header chip needs
       the store object and the count of shops serving that postcode.

       The three assertions are the point of this loop rather than decoration.
       The first version of these files was written from rh_email and was missing
       all three fields, which the page would have absorbed without complaint by
       rendering nothing. Checking here means that mistake cannot be made twice
       in silence: the build stops instead of publishing a file that looks fine. */
    for (const city of cities) {
        const answer = await rpc('rh_offer', { cep: city.cep, sku: HERO, n: '3' });

        if (!answer.stock) throw new Error(`${city.cep}: no stock map at all, so no tile could show a badge`);
        if (!answer.stores) throw new Error(`${city.cep}: no list of serving shops`);

        if (answer.resolved === 'store') {
            if (!answer.store) throw new Error(`${city.cep}: a shop resolved but the header chip would be blank`);
            if (!answer.stores.length) throw new Error(`${city.cep}: a shop resolved but nothing serves the postcode`);
            if (!Object.keys(answer.stock).length) throw new Error(`${city.cep}: a shop resolved but no tile could show a badge`);
        } else {
            /* Vitoria and Rio Branco land here, and they are not faults. Each has
               exactly one Ri Happy branch and their own checkout never offers it
               as a collection point, so fulfils_online is false and nothing
               serves those postcodes. The page must then say nothing at all
               about availability rather than reading empty as out of stock, so
               the check is that the answer really is empty. An answer that
               resolved no shop but still carried stock would put badges on a
               page with no shop behind them. */
            if (answer.store) throw new Error(`${city.cep}: no shop resolved, yet a shop is named`);
            if (Object.keys(answer.stock).length) throw new Error(`${city.cep}: no shop resolved, yet it claims stock`);
        }

        const body = JSON.stringify(answer);
        writeFileSync(join(OUT, 'storefront', `${city.cep}.json`), body);
        bytes += body.length;
        await sleep(PAUSE_MS);
    }
    console.error(`  page shaped answers done for ${cities.length} cities`);

    /* The same page shaped answer, keyed by shop.

       "Use my location" resolves a shop rather than a postcode, so on a network
       failure it needs a stored answer keyed the same way. There were already
       137 files under store/, but those are the message shape: a shop name and
       no stock map, which is everything an email needs and nothing a storefront
       does. Falling back to one of those left the page believing it had
       resolved a shop while every badge stayed blank, which is a worse outcome
       than an honest failure because it looks like the data is simply empty.

       About 1.5 MB for all 137, against 6.5 MB of product images already in
       the repository. */
    mkdirSync(join(OUT, 'storefront', 'store'), { recursive: true });
    let pageShaped = 0;
    for (const shop of shops) {
        const answer = await rpc('rh_offer', { store_id: shop.store_id, sku: HERO, n: '8' });

        /* A shop we asked for by name must come back named, with a stock map.
           Anything else means the page would render a shop with no badges. */
        if (!answer.store || answer.store.id !== shop.store_id) {
            throw new Error(`${shop.store_id}: asked for this shop and got ` +
                            `${answer.store ? answer.store.id : 'none'}`);
        }
        if (!Object.keys(answer.stock || {}).length) {
            throw new Error(`${shop.store_id}: a shop resolved but no tile could show a badge`);
        }

        const body = JSON.stringify(answer);
        writeFileSync(join(OUT, 'storefront', 'store', `${shop.store_id}.json`), body);
        bytes += body.length;
        pageShaped += 1;
        await sleep(PAUSE_MS);
    }
    console.error(`  page shaped answers done for ${pageShaped} shops`);

    /* A last resort answer for a shop or postcode we hold nothing for. It names
       no shop and makes no availability claim, which is the only honest thing to
       say when we do not know where someone is. */
    const generic = await rpc('rh_email', { cep: '', sku: HERO, n: '3' });
    writeFileSync(join(OUT, 'default.json'), JSON.stringify(generic));

    const total = shops.length + cities.length + 1;
    console.error(`Wrote ${total} files, ${Math.round(bytes / 1024)} KB total, ` +
                  `${Math.round(bytes / total)} bytes each on average`);
}

main().catch((err) => {
    console.error('build-offers failed:', err.message);
    process.exit(1);
});
