/* ============================================================================
   Pre-render one small answer per shop and per city, published to our own site.

   WHY THIS EXISTS, and it is worth reading before changing it.

   The panel's Custom API call to Supabase timed out. Measuring showed the cause
   is distance rather than payload: the Supabase project is in Tokyo, and even a
   26 byte function takes 0.8 to 1.4 seconds to answer from here. Dengage's
   servers are further from Tokyo than this machine is. Every Supabase project on
   the account is in Asia Pacific, so there is no nearer database to move to.

   GitHub Pages answers in about 0.2 seconds from its edge network, while serving
   a file forty times larger. That is the same origin the storefront is already
   published on, it costs nothing, and it is reachable from wherever Dengage
   sends from.

   WHAT THIS DOES AND DOES NOT CHANGE ABOUT THE CLAIM

   The message is still assembled per recipient at the moment of sending: Dengage
   fetches this contact's shop while composing for this contact. What is a
   snapshot is the availability behind it, which was already true when the
   endpoint was live, because the availability itself was captured rather than
   read from Ri Happy in real time. So the honest sentence on the day is
   unchanged: the assembly is live, the stock is as fresh as the last capture.

   The storefront keeps talking to Supabase directly, because a browser can
   comfortably wait a second and gains a genuinely live read for the stock flip.
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
        const body = JSON.stringify(answer);
        writeFileSync(join(OUT, 'cep', `${city.cep}.json`), body);
        bytes += body.length;
        await sleep(PAUSE_MS);
    }

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
