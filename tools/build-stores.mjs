/* ============================================================================
   Turn the pickup store names their checkout returned into a store list with
   coordinates, which is what the geofence scene needs.

       node tools/build-stores.mjs

   Reads data/snapshots/store-names.json (written by the capture) and writes
   data/stores.json.

   WHERE THE COORDINATES COME FROM, because this is the one place in the project
   where a made up number would be easy and invisible. They are looked up in
   OpenStreetMap by mall name and city. Anything OpenStreetMap does not know is
   written out with a null position and named in the report, so it can be filled
   in by hand from the team's own store sheet rather than quietly estimated. A
   geofence on a guessed coordinate fires in the wrong car park, and on the day
   that looks like the product is broken.

   Nominatim asks callers to identify themselves and to stay under one request a
   second. Both are honoured below.
   ========================================================================== */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const UA = 'dengage-presales-rh-demo/1.0 (rfp@dengage.com)';
const PACE_MS = 1200;

/* Each region carries the box its stores must fall inside. A lookup that lands
   outside is rejected rather than kept, because a wrong coordinate is worse
   than a missing one: a missing one is reported and fixed, a wrong one passes
   review and then fires a geofence in the wrong city. This is not theoretical.
   "Bourbon SP" first resolved to a town 500 km away and looked perfectly fine
   in the output until the box caught it. */
const REGIONS = {
    sp:  { label: 'Sao Paulo',    city: 'Sao Paulo',    state: 'SP',
           box: { latMin: -24.2, latMax: -22.9, lngMin: -47.4, lngMax: -46.2 } },
    poa: { label: 'Porto Alegre', city: 'Porto Alegre', state: 'RS',
           box: { latMin: -30.4, latMax: -29.8, lngMin: -51.5, lngMax: -50.9 } },
    rb:  { label: 'Rio Branco',   city: 'Rio Branco',   state: 'AC',
           box: { latMin: -10.3, latMax: -9.6,  lngMin: -68.2, lngMax: -67.5 } }
};

/* Places OpenStreetMap could not find from the store name alone, or found in
   the wrong place. Each is a real, checkable location: several of these malls
   sit in neighbouring municipalities rather than in the city their region is
   named after, which is why the plain query missed them. */
const OVERRIDE_QUERY = {
    'Ri Happy Baby Barra Shopping Sul':            'BarraShoppingSul, Porto Alegre, Brasil',
    'Ri Happy Bourbon Shopping Carlos Gomes':      'Bourbon Shopping Country, Porto Alegre, Brasil',
    'PBKIDS SHOPPING GRANJA VIANNA - Loja Parceira': 'Shopping Granja Vianna, Cotia, Sao Paulo, Brasil',
    'PBKIDS IGUATEMI ALPHAVILLE - Loja Parceira':  'Shopping Iguatemi Alphaville, Barueri, Sao Paulo, Brasil',
    'Ri Happy Bourbon SP':                         'Bourbon Shopping Sao Paulo, Pompeia, Sao Paulo, Brasil'
};

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* A store id that stays readable in a deeplink and a geofence name. */
function slugOf(region, name) {
    const base = String(name)
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/\bloja parceira\b/g, '')
        .replace(/\b(ri happy|pbkids)\b/g, '')
        .replace(/\bshopping\b/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 28);
    return region + '-' + (base || 'store');
}

/* What to ask OpenStreetMap. Their store names carry the banner and a partner
   suffix, neither of which is part of the place. Street stores such as Augusta
   and Joao Cachoeira are named after the road rather than a mall, so the query
   falls back to the plain name plus the city and still finds the street. */
function queryFor(name, region) {
    const city = REGIONS[region].city;
    let place = String(name)
        .replace(/\s*-\s*Loja Parceira\s*$/i, '')
        .replace(/^\s*(RI HAPPY|Ri Happy|PBKIDS|PBKids)\s+/i, '')
        .replace(/\s*-\s*POA\s*$/i, '')
        .replace(/\s+/g, ' ')
        .trim();
    if (!/shopping|shoppping/i.test(place) && /^(iguatemi|morumbi|eldorado|ibirapuera|tambore|alphaville)/i.test(place)) {
        place = 'Shopping ' + place;
    }
    return place + ', ' + city + ', Brasil';
}

async function geocode(query) {
    const url = 'https://nominatim.openstreetmap.org/search?format=json&limit=1&q=' +
                encodeURIComponent(query);
    try {
        const response = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
        if (!response.ok) return null;
        const body = await response.json();
        if (!Array.isArray(body) || !body.length) return null;
        return {
            lat: Number(body[0].lat),
            lng: Number(body[0].lon),
            matched: body[0].display_name || ''
        };
    } catch (err) {
        return null;
    }
}

/** Is this position actually in the region we think it is. */
function inside(position, region) {
    const box = REGIONS[region].box;
    if (!box) return true;
    return position.lat >= box.latMin && position.lat <= box.latMax &&
           position.lng >= box.lngMin && position.lng <= box.lngMax;
}

function bannerOf(name) {
    return /pbkids/i.test(name) ? 'PBKIDS' : 'Ri Happy';
}

/* The mall a store sits in, for the copy in a push notification. Blank when the
   store is a street address rather than a mall. */
function mallOf(name) {
    const cleaned = String(name).replace(/\s*-\s*Loja Parceira\s*$/i, '').trim();
    const at = cleaned.search(/shopping/i);
    if (at === -1) return '';
    return cleaned.slice(at).replace(/\s+/g, ' ').trim();
}

async function main() {
    const path = join(ROOT, 'data', 'snapshots', 'store-names.json');
    if (!existsSync(path)) {
        console.error('No capture found. Run: node tools/capture.mjs --availability');
        process.exit(1);
    }
    const seen = JSON.parse(readFileSync(path, 'utf8')).stores || [];
    console.error('Building a store list from ' + seen.length + ' names seen during capture\n');

    const stores = [];
    const unlocated = [];
    let rank = {};

    for (const entry of seen) {
        const name = String(entry.name).replace(/\s+/g, ' ').trim();
        const region = entry.regions[0];
        if (!REGIONS[region]) continue;
        rank[region] = (rank[region] || 0) + 1;

        /* An override is tried first when one exists, then the derived query.
           Either way the answer has to land inside the region's box to count. */
        const queries = [];
        if (OVERRIDE_QUERY[name]) queries.push(OVERRIDE_QUERY[name]);
        queries.push(queryFor(name, region));

        let found = null;
        let rejected = '';
        for (const query of queries) {
            const hit = await geocode(query);
            await wait(PACE_MS);
            if (!hit) continue;
            if (!inside(hit, region)) {
                rejected = hit.lat.toFixed(4) + ', ' + hit.lng.toFixed(4) + ' outside ' + region;
                continue;
            }
            found = hit;
            break;
        }

        const store = {
            store_id: slugOf(region, name),
            name: name,
            region_code: region,
            region_label: REGIONS[region].label,
            city: REGIONS[region].city,
            state: REGIONS[region].state,
            mall: mallOf(name),
            banner: bannerOf(name),
            /* Rank follows how often their own checkout offered this store,
               which is the closest thing we have to their fulfilment ordering.
               It is not invented: the capture counted it. */
            rank: rank[region],
            seen_count: entry.count,
            lat: found ? found.lat : null,
            lng: found ? found.lng : null,
            coord_source: found ? 'openstreetmap' : 'not found, needs the team store sheet',
            coord_matched: found ? found.matched : ''
        };
        stores.push(store);
        if (!found) unlocated.push(store.name + (rejected ? '  (rejected ' + rejected + ')' : ''));
        process.stderr.write((found ? '  ok   ' : '  MISS ') + store.store_id.padEnd(30) +
                             (found ? found.lat.toFixed(4) + ', ' + found.lng.toFixed(4)
                                    : (rejected || queries[queries.length - 1])) + '\n');
    }

    writeFileSync(join(ROOT, 'data', 'stores.json'), JSON.stringify({
        note: 'Store names are exactly as Ri Happy checkout returns them. Coordinates are looked up in OpenStreetMap and never estimated: a null position means it must be filled from the team store sheet before that store is used for a geofence.',
        source: 'names from data/snapshots/store-names.json, positions from OpenStreetMap',
        storeCount: stores.length,
        located: stores.length - unlocated.length,
        stores: stores
    }, null, 2) + '\n');

    console.error('\nWrote data/stores.json: ' + stores.length + ' stores, ' +
                  (stores.length - unlocated.length) + ' located');
    if (unlocated.length) {
        console.error('\nNeeds a position before it can carry a geofence:');
        for (const name of unlocated) console.error('  ' + name);
    }
}

main().catch((err) => { console.error('store build failed: ' + err.message); process.exit(1); });
