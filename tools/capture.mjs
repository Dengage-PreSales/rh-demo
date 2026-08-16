/* ============================================================================
   Capture: read Ri Happy's public storefront once and write it to disk.

   Run this BEFORE the demo, never during it.

       node tools/capture.mjs                 catalogue and availability
       node tools/capture.mjs --catalogue     catalogue only
       node tools/capture.mjs --availability  availability only

   It writes two timestamped snapshots into data/snapshots/ and prints every
   pickup store name it saw. Those names are the input to data/stores.json,
   which is curated by hand: see tools/lib/stores-map.mjs for why a name is
   never guessed into an id.

   Roughly two hundred requests, paced half a second apart, so a full run takes
   about three minutes. That pacing is deliberate and is explained in
   tools/lib/vtex.mjs.
   ========================================================================== */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { citiesFrom, productById, simulate, regionsFor } from './lib/vtex.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SNAPSHOTS = join(ROOT, 'data', 'snapshots');

/* The roster: which products this demo carries. Read from the committed source
   CSV so the set is stable across runs and reviewable in a diff. */
function roster() {
    const text = readFileSync(join(ROOT, 'data', 'roster-source.csv'), 'utf8');
    const rows = parseCsv(text);
    const head = rows.shift();
    const at = (name) => head.indexOf(name);
    const pid = at('productId');
    const sid = at('skuId');
    if (pid === -1 || sid === -1) throw new Error('roster-source.csv has no productId or skuId column');
    return rows
        .filter((row) => row[pid] && row[sid])
        .map((row) => ({ productId: row[pid].trim(), skuId: row[sid].trim() }));
}

/* A small RFC 4180 reader. The roster carries quoted commas in product names,
   so splitting on commas would silently shift every later column. */
function parseCsv(text) {
    const rows = [];
    let row = [];
    let field = '';
    let quoted = false;
    const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
    for (let i = 0; i < body.length; i += 1) {
        const ch = body[i];
        if (quoted) {
            if (ch === '"' && body[i + 1] === '"') { field += '"'; i += 1; continue; }
            if (ch === '"') { quoted = false; continue; }
            field += ch;
            continue;
        }
        if (ch === '"') { quoted = true; continue; }
        if (ch === ',') { row.push(field); field = ''; continue; }
        if (ch === '\r') continue;
        if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
        field += ch;
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows.filter((r) => r.length > 1 || (r.length === 1 && r[0] !== ''));
}

function firstSpec(product, key) {
    const value = product[key];
    if (Array.isArray(value)) return value.length ? String(value[0]) : '';
    return value === undefined || value === null ? '' : String(value);
}

function allSpec(product, key) {
    const value = product[key];
    if (Array.isArray(value)) return value.map(String);
    return value === undefined || value === null ? [] : [String(value)];
}

/* Age bands arrive as free text such as "3 a 4 anos" or "A partir de 13 anos".
   Converting to months gives one comparable number, which is what the
   substitution rule needs. Anything unparseable returns null and is skipped,
   never defaulted, because a wrong age band on a toy is a real world mistake. */
function bandToMonths(band) {
    const range = /^(\d+)\s*a\s*(\d+)\s*(meses|anos)/i.exec(band);
    if (range) {
        const low = Number(range[1]);
        const high = Number(range[2]);
        const months = range[3].toLowerCase() === 'meses';
        return months ? [low, high] : [low * 12, high * 12];
    }
    const from = /^A partir de\s*(\d+)/i.exec(band);
    if (from) return [Number(from[1]) * 12, 216];
    return null;
}

/* Licence, derived rather than read: their catalogue has no licence field, but
   the merchandising clusters name the franchise. The allowlist keeps campaign
   names such as "Mais Vendidos" from being mistaken for a licence. */
const LICENCES = [
    'LEGO', 'LEGO Creator', 'Barbie', 'Pokemon', 'Pokémon', 'Disney', 'Marvel',
    'Homem Aranha', 'Hot Wheels', 'Baby Alive', 'Play-Doh', 'Sonic',
    'Fisher-Price', 'Fashion Dolls', 'Mattel', 'Primeira Infancia',
    'Primeira Infância', 'A Casa Magica da Gabby', 'A Casa Mágica da Gabby'
];

function licenceOf(clusters) {
    const found = [];
    for (const raw of clusters) {
        const name = String(raw).replace(/\s*-\s*coleção completa\s*$/i, '')
                                .replace(/\s*-\s*colecao completa\s*$/i, '').trim();
        for (const allowed of LICENCES) {
            if (name.toLowerCase() === allowed.toLowerCase() && found.indexOf(allowed) === -1) {
                found.push(allowed);
            }
        }
    }
    return found;
}

async function captureCatalogue(list) {
    const products = [];
    const missing = [];
    let done = 0;
    for (const entry of list) {
        const rows = await productById(entry.productId);
        done += 1;
        if (!rows.length) {
            missing.push(entry.productId);
            process.stderr.write('  ' + done + '/' + list.length + ' MISSING ' + entry.productId + '\n');
            continue;
        }
        const p = rows[0];
        const items = Array.isArray(p.items) ? p.items : [];
        const item = items.find((i) => String(i.itemId) === entry.skuId) || items[0] || {};
        const sellers = Array.isArray(item.sellers) ? item.sellers : [];
        const offer = sellers.length ? (sellers[0].commertialOffer || {}) : {};
        const images = (Array.isArray(item.images) ? item.images : [])
            .map((i) => i.imageUrl).filter(Boolean);

        const bands = allSpec(p, 'Idade').map(bandToMonths).filter(Boolean);
        const clusters = Object.values(p.productClusters || {}).map(String);
        const path = ((p.categories || [''])[0] || '').replace(/^\/|\/$/g, '');
        const levels = path ? path.split('/') : [];

        products.push({
            productId: String(p.productId),
            skuId: String(item.itemId || entry.skuId),
            ean: item.ean || '',
            name: p.productName || '',
            brand: p.brand || '',
            categoryPath: path,
            cat1: levels[0] || '', cat2: levels[1] || '', cat3: levels[2] || '',
            price: typeof offer.Price === 'number' ? offer.Price : null,
            listPrice: typeof offer.ListPrice === 'number' ? offer.ListPrice : null,
            ageBands: allSpec(p, 'Idade'),
            ageMinMonths: bands.length ? Math.min(...bands.map((b) => b[0])) : null,
            ageMaxMonths: bands.length ? Math.max(...bands.map((b) => b[1])) : null,
            gender: allSpec(p, 'Gênero'),
            licence: licenceOf(clusters),
            clusters: clusters,
            restricaoIdade: firstSpec(p, 'Restrição de Idade:'),
            itensInclusos: firstSpec(p, 'Itens Inclusos:'),
            dimensoes: firstSpec(p, 'Dimensões (AxLxC):'),
            peso: firstSpec(p, 'Peso:'),
            images: images,
            sourceUrl: p.link || ''
        });
        process.stderr.write('  ' + done + '/' + list.length + ' ' +
                             products[products.length - 1].name.slice(0, 58) + '\n');
    }
    return { products, missing };
}

async function captureAvailability(list, CEPS) {
    const regions = [];
    for (const target of CEPS) {
        const found = await regionsFor(target.cep);
        regions.push({
            cep: target.cep, region: target.region, label: target.label,
            regionId: found.id,
            sellerCount: found.sellers.length,
            sellers: found.sellers.map((s) => s.id)
        });
        process.stderr.write('  regions ' + target.cep + ': ' + found.sellers.length + ' sellers\n');
    }

    const rows = [];
    const seenStores = new Map();
    let done = 0;
    const total = list.length * CEPS.length;
    for (const entry of list) {
        for (const target of CEPS) {
            const result = await simulate(entry.skuId, target.cep);
            done += 1;
            rows.push({
                skuId: entry.skuId,
                cep: target.cep,
                region: target.region,
                state: result.state,
                rawState: result.rawState || '',
                price: result.price,
                pickupStores: result.pickupStores,
                fastest: result.fastest,
                channels: result.channels
            });
            for (const name of result.pickupStores) {
                const key = name;
                const seen = seenStores.get(key) || { name: name, regions: [], count: 0 };
                if (seen.regions.indexOf(target.region) === -1) seen.regions.push(target.region);
                seen.count += 1;
                seenStores.set(key, seen);
            }
            if (done % 15 === 0 || done === total) {
                process.stderr.write('  ' + done + '/' + total + ' simulations\n');
            }
        }
    }
    return { regions, rows, stores: Array.from(seenStores.values()) };
}

function stamp() {
    /* The capture time is read from the filesystem rather than invented, so a
       snapshot always says when it was actually taken. */
    return new Date().toISOString().replace(/\.\d+Z$/, 'Z');
}

async function main() {
    const args = process.argv.slice(2);
    const wantCatalogue = args.length === 0 || args.includes('--catalogue');
    const wantAvailability = args.length === 0 || args.includes('--availability');
    mkdirSync(SNAPSHOTS, { recursive: true });

    const list = roster();
    const CEPS = citiesFrom(ROOT);
    console.error('Ri Happy capture: ' + list.length + ' products, ' + CEPS.length + ' postcodes\n');

    if (wantCatalogue) {
        console.error('Catalogue');
        const result = await captureCatalogue(list);
        writeFileSync(join(SNAPSHOTS, 'catalogue.json'), JSON.stringify({
            capturedAt: stamp(),
            source: 'rihappy.com.br catalog_system',
            productCount: result.products.length,
            missing: result.missing,
            products: result.products
        }, null, 2) + '\n');
        console.error('  wrote data/snapshots/catalogue.json (' + result.products.length +
                      ' products, ' + result.missing.length + ' missing)\n');
    }

    if (wantAvailability) {
        console.error('Availability');
        const result = await captureAvailability(list, CEPS);
        writeFileSync(join(SNAPSHOTS, 'availability.json'), JSON.stringify({
            capturedAt: stamp(),
            source: 'rihappy.com.br checkout simulation',
            note: 'State and named pickup stores only. This endpoint reports no unit counts, so nothing downstream shows one.',
            regions: result.regions,
            rowCount: result.rows.length,
            rows: result.rows
        }, null, 2) + '\n');
        writeFileSync(join(SNAPSHOTS, 'store-names.json'), JSON.stringify({
            capturedAt: stamp(),
            note: 'Every pickup store name seen during capture. Input to the curated data/stores.json.',
            stores: result.stores.sort((a, b) => b.count - a.count)
        }, null, 2) + '\n');
        console.error('  wrote data/snapshots/availability.json (' + result.rows.length + ' rows)');
        console.error('  wrote data/snapshots/store-names.json (' + result.stores.length + ' distinct stores)\n');
        console.error('Pickup stores seen:');
        for (const store of result.stores.sort((a, b) => b.count - a.count)) {
            console.error('  [' + store.regions.join(',') + '] ' + store.name + '  (' + store.count + ')');
        }
    }
}

main().catch((err) => { console.error('capture failed: ' + err.message); process.exit(1); });
