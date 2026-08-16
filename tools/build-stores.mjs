/* ============================================================================
   Build the canonical store list.

       node tools/build-stores.mjs

   Reads   data/stores-source.csv          Ri Happy's own store list
           data/snapshots/store-names.json the pickup names their checkout used
   Writes  data/stores.json

   TWO LISTS DESCRIBE THIS NETWORK AND THEY ARE NOT THE SAME SET.

   Checked rather than assumed, on 16 August 2026: their published store list is
   Ri Happy branded shops. Their checkout, answering "who can hand this over",
   also names PBKIDS partner shops and street shops such as Augusta, Joao
   Cachoeira and Otto Baumgart that the published list does not contain at all.
   So this is not one list in two spellings; roughly a third of the shops that
   actually fulfil orders are absent from the published list.

   Positions therefore come in three tiers, and every store records which tier
   it used so nothing has to be taken on trust:

     1. their published list, when the names match once banner words and
        spacing are stripped ("Shopping Villa Lobos" against "VillaLobos")
     2. OpenStreetMap, for shops only the checkout names, bounds checked
        against the region so a lookup landing in the wrong state is refused
     3. none, left null and reported

   Stock and position are kept strictly separate. A shop only the published list
   names gets a position and carries_stock false, because we have no evidence
   about what it holds and inventing some is the one thing this demo must never
   do. A shop with stock and no position can show a badge but must never carry a
   geofence.
   ========================================================================== */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalise } from './lib/stores-map.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/* Their published names carry the banner and often the word Shopping; the
   checkout drops or reorders both. Matching happens on what is left after the
   noise is stripped, which is the mall or street the shop is actually in. */
function matchKey(name) {
    return normalise(name)
        .replace(/\b(ri happy|rihappy|pbkids|pb kids)\b/g, ' ')
        .replace(/\bbaby\b/g, ' ')
        .replace(/\bshopping\b/g, ' ')
        .replace(/\bshoppping\b/g, ' ')
        .replace(/\bcenter\b/g, ' ')
        .replace(/\bloja parceira\b/g, ' ')
        .replace(/\bprime offices\b/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function slugOf(region, name) {
    const base = matchKey(name).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);
    return region + '-' + (base || 'store');
}

function bannerOf(name) {
    return /pbkids|pb kids/i.test(name) ? 'PBKIDS' : 'Ri Happy';
}

function mallOf(name) {
    const cleaned = String(name).replace(/\s*-\s*Loja Parceira\s*$/i, '').trim();
    const at = cleaned.search(/shopping/i);
    return at === -1 ? '' : cleaned.slice(at).replace(/\s+/g, ' ').trim();
}

function parseCsv(text) {
    const rows = [];
    let row = [], field = '', quoted = false;
    const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
    for (let i = 0; i < body.length; i += 1) {
        const ch = body[i];
        if (quoted) {
            if (ch === '"' && body[i + 1] === '"') { field += '"'; i += 1; continue; }
            if (ch === '"') { quoted = false; continue; }
            field += ch; continue;
        }
        if (ch === '"') { quoted = true; continue; }
        if (ch === ',') { row.push(field); field = ''; continue; }
        if (ch === '\r') continue;
        if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
        field += ch;
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows.filter((r) => r.length > 1);
}

const UA = 'dengage-presales-rh-demo/1.0 (rfp@dengage.com)';
const GEOCODE_PACE_MS = 1200;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* Roughly how far a region's shops can be from its centre. A lookup outside the
   box is refused rather than kept: a wrong position is worse than a missing one
   because it survives review and then fires a geofence in another city. That is
   not hypothetical, it happened here with a Sao Paulo shop resolving 500 km
   away before this check existed. */
const REGION_BOX = {
    sp:  [-24.3, -22.8, -47.5, -45.9], rj:  [-23.2, -22.4, -44.0, -42.8],
    cps: [-23.3, -22.6, -47.5, -46.7], for: [-4.1,  -3.6,  -38.8, -38.3],
    bh:  [-20.2, -19.6, -44.3, -43.6], ssa: [-13.1, -12.7, -38.6, -38.2],
    cwb: [-25.7, -25.2, -49.5, -49.0], rec: [-8.4,  -7.9,  -35.1, -34.8],
    bsb: [-16.2, -15.5, -48.3, -47.6], poa: [-30.4, -29.8, -51.5, -50.9],
    gyn: [-16.9, -16.4, -49.5, -49.0], nat: [-6.0,  -5.6,  -35.4, -35.1],
    slz: [-2.8,  -2.4,  -44.5, -44.1], mao: [-3.3,  -2.9,  -60.2, -59.8],
    bel: [-1.6,  -1.2,  -48.6, -48.3], fln: [-27.9, -27.3, -48.7, -48.4],
    the: [-5.3,  -4.9,  -42.9, -42.6], mcz: [-9.8,  -9.4,  -35.9, -35.6],
    cgr: [-20.7, -20.3, -54.8, -54.4], cgb: [-15.8, -15.4, -56.2, -55.9],
    vix: [-20.5, -20.1, -40.5, -40.1], rbr: [-10.3, -9.6,  -68.2, -67.5]
};

function insideRegion(lat, lng, region) {
    const box = REGION_BOX[region];
    if (!box) return true;
    return lat >= box[0] && lat <= box[1] && lng >= box[2] && lng <= box[3];
}

async function geocode(query) {
    const url = 'https://nominatim.openstreetmap.org/search?format=json&limit=1&q=' +
                encodeURIComponent(query);
    try {
        const response = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
        if (!response.ok) return null;
        const body = await response.json();
        if (!Array.isArray(body) || !body.length) return null;
        return { lat: Number(body[0].lat), lng: Number(body[0].lon) };
    } catch (err) {
        return null;
    }
}

/* What to ask OpenStreetMap for a shop the published list does not carry. The
   banner and the partner suffix are not part of the place; the city is. */
function geocodeQuery(name, city, state) {
    const place = String(name)
        .replace(/\s*-\s*Loja Parceira\s*$/i, '')
        .replace(/^\s*(RI HAPPY|Ri Happy|PBKIDS|PBKids)\s+/i, '')
        .replace(/\s*-\s*POA\s*$/i, '')
        .replace(/\s+/g, ' ')
        .trim();
    return place + ', ' + city + ', ' + state + ', Brasil';
}

async function main() {
    const cities = JSON.parse(readFileSync(join(ROOT, 'data', 'cities.json'), 'utf8')).cities;
    const cityByName = new Map();
    for (const c of cities) cityByName.set(normalise(c.city), c);

    /* ---------------------------------------------------------------- */
    /* Their published store list                                        */

    const published = [];
    const csvPath = join(ROOT, 'data', 'stores-source.csv');
    if (existsSync(csvPath)) {
        const rows = parseCsv(readFileSync(csvPath, 'utf8'));
        const head = rows.shift().map((h) => h.trim().toLowerCase());
        const col = (name) => head.indexOf(name);
        for (const row of rows) {
            if (!row[col('store_name')]) continue;
            published.push({
                name: row[col('store_name')].trim(),
                city: row[col('city')].trim(),
                state: row[col('state')].trim(),
                address: row[col('address')].trim(),
                lat: Number(row[col('latitude')]),
                lng: Number(row[col('longitude')])
            });
        }
    }

    /* ---------------------------------------------------------------- */
    /* The pickup names their checkout actually used                     */

    const seenPath = join(ROOT, 'data', 'snapshots', 'store-names.json');
    const seen = existsSync(seenPath)
        ? (JSON.parse(readFileSync(seenPath, 'utf8')).stores || [])
        : [];

    const publishedByKey = new Map();
    for (const p of published) {
        const key = matchKey(p.name);
        if (key && !publishedByKey.has(key)) publishedByKey.set(key, p);
    }

    const stores = [];
    const byId = new Map();
    const rankIn = {};
    let matched = 0, stockNoPosition = 0, geocoded = 0, refused = 0;

    /* Shops the checkout named. These are the ones that can carry stock. */
    for (const entry of seen) {
        const name = String(entry.name).replace(/\s+/g, ' ').trim();
        const region = entry.regions[0];
        const city = cities.find((c) => c.code === region);
        if (!city) continue;
        const key = matchKey(name);
        const hit = publishedByKey.get(key) || null;
        if (hit) matched += 1;

        rankIn[region] = (rankIn[region] || 0) + 1;
        const id = slugOf(region, name);
        if (byId.has(id)) continue;

        /* Tier two: a shop their published list does not carry still needs a
           position if it is ever going to hold a geofence. */
        let position = hit ? { lat: hit.lat, lng: hit.lng, source: 'ri happy published store list' } : null;
        if (!position) {
            const found = await geocode(geocodeQuery(name, city.city, city.state));
            await wait(GEOCODE_PACE_MS);
            if (found && insideRegion(found.lat, found.lng, region)) {
                position = { lat: found.lat, lng: found.lng, source: 'openstreetmap' };
                geocoded += 1;
            } else {
                if (found) refused += 1;
                stockNoPosition += 1;
            }
        }
        const store = {
            store_id: id,
            name: name,
            published_name: hit ? hit.name : '',
            region_code: region,
            region_label: city.label,
            city: hit ? hit.city : city.city,
            state: hit ? hit.state : city.state,
            address: hit ? hit.address : '',
            mall: mallOf(name),
            banner: bannerOf(name),
            /* Rank follows how often their checkout offered this shop, which is
               the nearest thing we have to their own fulfilment ordering. It is
               counted, not assigned. */
            rank: rankIn[region],
            seen_count: entry.count,
            carries_stock: true,
            lat: position ? position.lat : null,
            lng: position ? position.lng : null,
            position_source: position ? position.source : 'none, needs an address'
        };
        stores.push(store);
        byId.set(id, store);
    }

    /* Shops only their published list names. Present so the store map is the
       real national network, but explicitly carrying no stock claim. */
    let mapOnly = 0;
    for (const p of published) {
        const key = matchKey(p.name);
        const city = cityByName.get(normalise(p.city));
        const region = city ? city.code : 'other';
        const id = slugOf(region, p.name);
        if (byId.has(id)) continue;
        if (stores.some((s) => s.published_name && matchKey(s.published_name) === key)) continue;
        mapOnly += 1;
        const store = {
            store_id: id,
            name: p.name,
            published_name: p.name,
            region_code: region,
            region_label: city ? city.label : p.city,
            city: p.city,
            state: p.state,
            address: p.address,
            mall: mallOf(p.name),
            banner: bannerOf(p.name),
            rank: 900,
            seen_count: 0,
            /* No availability was ever captured for this shop, so it never
               claims any. It exists on the map and nowhere else. */
            carries_stock: false,
            lat: p.lat,
            lng: p.lng,
            position_source: 'ri happy published store list'
        };
        stores.push(store);
        byId.set(id, store);
    }

    const located = stores.filter((s) => s.lat !== null && s.lng !== null).length;
    writeFileSync(join(ROOT, 'data', 'stores.json'), JSON.stringify({
        note: 'Canonical stores. Names are as Ri Happy checkout returns them where stock was captured, and as their published store list names them otherwise. carries_stock false means this shop is on the map but no availability was ever captured for it, so it makes no availability claim anywhere.',
        source: 'data/stores-source.csv (Ri Happy published list) joined to data/snapshots/store-names.json (their checkout)',
        storeCount: stores.length,
        withStock: stores.filter((s) => s.carries_stock).length,
        located: located,
        stores: stores
    }, null, 2) + '\n');

    const regions = {};
    for (const s of stores) {
        regions[s.region_code] = regions[s.region_code] || { total: 0, stock: 0, located: 0 };
        regions[s.region_code].total += 1;
        if (s.carries_stock) regions[s.region_code].stock += 1;
        if (s.lat !== null) regions[s.region_code].located += 1;
    }

    console.error('Published list      ' + published.length + ' stores');
    console.error('Named by checkout   ' + seen.length + ' stores');
    console.error('  positioned from their published list ' + matched);
    console.error('  positioned from OpenStreetMap        ' + geocoded);
    console.error('  no position at all                   ' + stockNoPosition +
                  (refused ? ' (' + refused + ' lookups refused for landing outside the region)' : ''));
    console.error('Map only            ' + mapOnly + ' stores, no availability claimed');
    console.error('Total               ' + stores.length + ', ' + located + ' with a position\n');
    console.error('By region');
    for (const code of Object.keys(regions).sort()) {
        const r = regions[code];
        console.error('  ' + code.padEnd(7) + 'total ' + String(r.total).padEnd(5) +
                      'with stock ' + String(r.stock).padEnd(5) + 'located ' + r.located);
    }
    const noPosition = stores.filter((s) => s.carries_stock && s.lat === null);
    if (noPosition.length) {
        console.error('\nCarries stock but has no position, so it cannot hold a geofence:');
        for (const s of noPosition) console.error('  [' + s.region_code + '] ' + s.name);
    }
}

main().catch((err) => { console.error('store build failed: ' + err.message); process.exit(1); });
