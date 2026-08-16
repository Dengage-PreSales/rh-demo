/* ============================================================================
   Turn the captured snapshots into everything the demo actually reads.

       node tools/build-data.mjs

   Reads   data/snapshots/catalogue.json
           data/snapshots/availability.json
           data/stores.json
   Writes  web/products.json          the storefront catalogue
           supabase/seed/rh_seed.sql  upserts for the rh_ tables
           data/fallback/offer-*.json pre-rendered answers, the standby endpoint

   No network. This step is pure transformation, so it can be re-run on the day
   without depending on anyone being reachable.

   THE RULE RUNNING THROUGH ALL OF IT: a value that was never captured is left
   out rather than filled in. No zero prices, no invented stock counts, no
   guessed franchise. An empty column is a fact about what we know; a defaulted
   one is a claim we cannot support, and this demo's entire argument is about
   telling customers the truth about availability.
   ========================================================================== */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { licenceOf } from './lib/licence.mjs';
import { indexOf, resolve } from './lib/stores-map.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SITE = 'https://dengage-presales.github.io/rh-demo';

const BRACKETS = [
    { id: '0-2',  min: 0,   max: 35 },
    { id: '3-5',  min: 36,  max: 71 },
    { id: '6-8',  min: 72,  max: 107 },
    { id: '9-12', min: 108, max: 155 },
    { id: '13+',  min: 156, max: 10000 }
];

function bracketOf(months) {
    if (months === null || months === undefined) return null;
    for (const b of BRACKETS) if (months >= b.min && months <= b.max) return b.id;
    return '13+';
}

function ageDisplay(min, max) {
    if (min === null || max === null) return '';
    const show = (m) => (m < 24 ? m + 'm' : Math.floor(m / 12) + 'a');
    return show(min) + '-' + show(max);
}

/** SQL string literal, or NULL. Never an empty string standing in for unknown. */
function lit(value) {
    if (value === null || value === undefined || value === '') return 'null';
    return "'" + String(value).replace(/'/g, "''") + "'";
}

function num(value) {
    return typeof value === 'number' && isFinite(value) ? String(value) : 'null';
}

function main() {
    const catalogue = JSON.parse(readFileSync(join(ROOT, 'data/snapshots/catalogue.json'), 'utf8'));
    const availability = JSON.parse(readFileSync(join(ROOT, 'data/snapshots/availability.json'), 'utf8'));
    const storeFile = JSON.parse(readFileSync(join(ROOT, 'data/stores.json'), 'utf8'));

    const stores = storeFile.stores;
    const storeIndex = indexOf(stores);
    const storeById = new Map(stores.map((s) => [s.store_id, s]));

    /* ------------------------------------------------------------------ */
    /* Products                                                            */

    const products = [];
    const dropped = [];
    for (const p of catalogue.products) {
        /* A product with no price cannot be shown honestly and a product with no
           picture cannot be shown at all. Both are dropped and counted. */
        if (typeof p.price !== 'number' || !(p.price > 0)) { dropped.push([p.skuId, 'no price']); continue; }
        if (!Array.isArray(p.images) || !p.images.length) { dropped.push([p.skuId, 'no image']); continue; }

        /* A "was" price only survives when it is genuinely higher. Anything else
           would advertise a discount that does not exist. */
        const listPrice = typeof p.listPrice === 'number' && p.listPrice > p.price ? p.listPrice : null;

        products.push({
            sku_id: p.skuId,
            product_id: p.productId,
            name: p.name,
            brand: p.brand || '',
            licence: licenceOf(p.name, p.brand),
            department: p.cat1 || '',
            category: p.cat2 || '',
            category_path: p.categoryPath || '',
            price: Math.round(p.price * 100) / 100,
            list_price: listPrice === null ? null : Math.round(listPrice * 100) / 100,
            age_min_months: p.ageMinMonths,
            age_max_months: p.ageMaxMonths,
            age_display: ageDisplay(p.ageMinMonths, p.ageMaxMonths),
            age_bracket: bracketOf(p.ageMinMonths),
            /* Local paths. The images are downloaded and committed so nothing on
               screen depends on somebody else's CDN during a sales call. */
            image: 'img/products/' + p.skuId + '-0.jpg',
            images: p.images.slice(0, 2).map((_, i) => 'img/products/' + p.skuId + '-' + i + '.jpg'),
            image_count: Math.min(p.images.length, 2),
            source_images: p.images.slice(0, 2),
            source_url: p.sourceUrl || ''
        });
    }

    /* ------------------------------------------------------------------ */
    /* Stock: one row per product per store that actually carries it        */

    const stock = [];
    const unknownNames = new Map();
    const bySku = new Map(products.map((p) => [p.sku_id, p]));
    const regionStores = {};
    for (const s of stores) {
        regionStores[s.region_code] = regionStores[s.region_code] || [];
        regionStores[s.region_code].push(s.store_id);
    }

    for (const row of availability.rows) {
        if (!bySku.has(row.skuId)) continue;
        const inRegion = regionStores[row.region] || [];
        if (row.state === 'available') {
            const mapped = resolve(row.pickupStores, storeIndex);
            for (const name of mapped.unknown) {
                unknownNames.set(name, (unknownNames.get(name) || 0) + 1);
            }
            const carrying = new Set(mapped.ids);
            for (const storeId of inRegion) {
                stock.push({
                    sku_id: row.skuId,
                    store_id: storeId,
                    /* Their checkout named the shops that can hand this over.
                       A shop in the region that was not named does not have it,
                       and that distinction is the whole demo. */
                    state: carrying.has(storeId) ? 'available' : 'withoutStock'
                });
            }
        } else {
            for (const storeId of inRegion) {
                stock.push({ sku_id: row.skuId, store_id: storeId, state: 'withoutStock' });
            }
        }
    }

    /* ------------------------------------------------------------------ */
    /* web/products.json                                                   */

    const departments = [];
    for (const p of products) if (p.department && departments.indexOf(p.department) === -1) departments.push(p.department);

    mkdirSync(join(ROOT, 'web'), { recursive: true });
    writeFileSync(join(ROOT, 'web', 'products.json'), JSON.stringify({
        capturedAt: catalogue.capturedAt,
        productCount: products.length,
        departments: departments,
        products: products.map((p) => ({
            id: p.sku_id,
            name: p.name,
            brand: p.brand,
            licence: p.licence,
            department: p.department,
            category: p.category,
            categoryPath: p.category_path,
            price: p.price,
            listPrice: p.list_price,
            ageMinMonths: p.age_min_months,
            ageMaxMonths: p.age_max_months,
            ageDisplay: p.age_display,
            ageBracket: p.age_bracket,
            image: p.image,
            images: p.images
        }))
    }, null, 2) + '\n');

    /* ------------------------------------------------------------------ */
    /* supabase/seed/rh_seed.sql                                           */

    const sql = [];
    sql.push('-- Generated by tools/build-data.mjs. Do not edit by hand.');
    sql.push('-- Upserts only: a re-run refreshes rows and withdraws nothing.');
    sql.push('-- Captured ' + catalogue.capturedAt + ' from Ri Happy public endpoints.');
    sql.push('');

    sql.push('insert into public.rh_store');
    sql.push('  (store_id, name, region_code, region_label, city, state, mall, lat, lng, rank, banner, is_pickup) values');
    sql.push(stores.map((s) => '  (' + [
        lit(s.store_id), lit(s.name), lit(s.region_code), lit(s.region_label),
        lit(s.city), lit(s.state), lit(s.mall), num(s.lat), num(s.lng),
        String(s.rank), lit(s.banner), 'true'
    ].join(', ') + ')').join(',\n'));
    sql.push('on conflict (store_id) do update set');
    sql.push('  name = excluded.name, region_code = excluded.region_code,');
    sql.push('  region_label = excluded.region_label, city = excluded.city, state = excluded.state,');
    sql.push('  mall = excluded.mall, lat = excluded.lat, lng = excluded.lng,');
    sql.push('  rank = excluded.rank, banner = excluded.banner, updated_at = now();');
    sql.push('');

    sql.push('insert into public.rh_cep_region (cep, prefix, region_code, label) values');
    const cepRows = [
        ['01310100', null, 'sp',  'Sao Paulo'],
        ['90010150', null, 'poa', 'Porto Alegre'],
        ['69900000', null, 'rb',  'Rio Branco'],
        /* Prefixes so a postcode typed live in the room still lands somewhere
           sensible instead of reading as a broken field. */
        [null, '01', 'sp',  'Sao Paulo'],
        [null, '02', 'sp',  'Sao Paulo'],
        [null, '03', 'sp',  'Sao Paulo'],
        [null, '04', 'sp',  'Sao Paulo'],
        [null, '05', 'sp',  'Sao Paulo'],
        [null, '90', 'poa', 'Porto Alegre'],
        [null, '91', 'poa', 'Porto Alegre'],
        [null, '699', 'rb', 'Rio Branco']
    ];
    sql.push(cepRows.map((r) => '  (' + [lit(r[0]), lit(r[1]), lit(r[2]), lit(r[3])].join(', ') + ')').join(',\n'));
    sql.push('on conflict do nothing;');
    sql.push('');

    sql.push('insert into public.rh_product');
    sql.push('  (sku_id, product_id, name, brand, licence, department, category, category_path,');
    sql.push('   price, list_price, age_min_months, age_max_months, age_display, age_bracket,');
    sql.push('   image_url, image_count, page_url, source_url, is_active) values');
    sql.push(products.map((p) => '  (' + [
        lit(p.sku_id), lit(p.product_id), lit(p.name), lit(p.brand), lit(p.licence),
        lit(p.department), lit(p.category), lit(p.category_path),
        num(p.price), num(p.list_price),
        p.age_min_months === null ? 'null' : String(p.age_min_months),
        p.age_max_months === null ? 'null' : String(p.age_max_months),
        lit(p.age_display), lit(p.age_bracket),
        lit(SITE + '/' + p.image), String(p.image_count),
        lit(SITE + '/product.html?id=' + encodeURIComponent(p.sku_id)),
        lit(p.source_url), 'true'
    ].join(', ') + ')').join(',\n'));
    sql.push('on conflict (sku_id) do update set');
    sql.push('  name = excluded.name, brand = excluded.brand, licence = excluded.licence,');
    sql.push('  department = excluded.department, category = excluded.category,');
    sql.push('  category_path = excluded.category_path, price = excluded.price,');
    sql.push('  list_price = excluded.list_price, age_min_months = excluded.age_min_months,');
    sql.push('  age_max_months = excluded.age_max_months, age_display = excluded.age_display,');
    sql.push('  age_bracket = excluded.age_bracket, image_url = excluded.image_url,');
    sql.push('  image_count = excluded.image_count, page_url = excluded.page_url,');
    sql.push('  source_url = excluded.source_url, is_active = true, updated_at = now();');
    sql.push('');

    /* Stock is written as one row per product listing the shops that carry it,
       and Postgres expands that into the pairs. Two hundred lines instead of
       eight thousand four hundred: the same data, but a human can actually read
       the diff and see that a product gained or lost a shop.

       The second statement is the half that is easy to forget. Every product is
       explicitly marked withoutStock at every other shop in the regions we
       captured, rather than left absent. Absent and unavailable look identical
       to a query and mean completely different things: one is "we know it is
       not there", the other is "we never asked". Only the first is safe to show
       a customer. */
    const capturedRegions = Object.keys(regionStores).filter((r) => (regionStores[r] || []).length);
    const carriedBy = new Map();
    for (const row of stock) {
        if (row.state !== 'available') continue;
        const list = carriedBy.get(row.sku_id) || [];
        list.push(row.store_id);
        carriedBy.set(row.sku_id, list);
    }

    sql.push('insert into public.rh_store_stock (sku_id, store_id, state)');
    sql.push('select v.sku_id, unnest(v.store_ids), \'available\' from (values');
    const carriedRows = [];
    for (const [skuId, storeIds] of carriedBy) {
        carriedRows.push('  (' + lit(skuId) + ', array[' +
                         storeIds.map((id) => lit(id)).join(', ') + ']::text[])');
    }
    sql.push(carriedRows.join(',\n'));
    sql.push(') as v(sku_id, store_ids)');
    sql.push('on conflict (sku_id, store_id) do update set');
    sql.push('  state = excluded.state, updated_at = now();');
    sql.push('');

    sql.push('-- Everything else in the captured regions is known to be unavailable.');
    sql.push('insert into public.rh_store_stock (sku_id, store_id, state)');
    sql.push('select p.sku_id, s.store_id, \'withoutStock\'');
    sql.push('from public.rh_product p');
    sql.push('cross join public.rh_store s');
    sql.push('where s.region_code in (' + capturedRegions.map(lit).join(', ') + ')');
    sql.push('on conflict (sku_id, store_id) do nothing;');
    sql.push('');
    sql.push("insert into public.rh_sync_log (source, detail, items) values ('seed', " +
             lit('captured ' + catalogue.capturedAt) + ', ' + String(stock.length) + ');');
    sql.push('');

    mkdirSync(join(ROOT, 'supabase', 'seed'), { recursive: true });
    writeFileSync(join(ROOT, 'supabase', 'seed', 'rh_seed.sql'), sql.join('\n'));

    /* ------------------------------------------------------------------ */
    /* data/stock.json                                                     */
    /*                                                                     */
    /* The same stock information in the shape the database loader reads.  */
    /* Keeping a machine readable copy beside the SQL means a refresh on   */
    /* the morning of a demo is one function call rather than a paste, and */
    /* the SQL file stays as the reviewable record of what changed.        */

    const stockDoc = {
        capturedAt: availability.capturedAt,
        note: 'For each product, the shops that can hand it over. Any other shop in a captured region is known not to have it. No unit counts exist here because their checkout publishes none.',
        regions: capturedRegions,
        carriedBy: Object.fromEntries(carriedBy)
    };
    writeFileSync(join(ROOT, 'data', 'stock.json'), JSON.stringify(stockDoc, null, 2) + '\n');

    /* ------------------------------------------------------------------ */
    /* Report                                                              */

    const withLicence = products.filter((p) => p.licence).length;
    const available = stock.filter((s) => s.state === 'available').length;
    console.error('Products      ' + products.length + ' kept, ' + dropped.length + ' dropped');
    for (const [sku, why] of dropped) console.error('                dropped ' + sku + ': ' + why);
    console.error('Franchise     ' + withLicence + ' of ' + products.length + ' carry one');
    console.error('Stores        ' + stores.length);
    console.error('Stock rows    ' + stock.length + ' (' + available + ' available)');
    if (unknownNames.size) {
        console.error('\nPickup names that matched no store, so their stock was not recorded:');
        for (const [name, count] of unknownNames) console.error('  ' + name + ' (' + count + ')');
    }
    console.error('\nWrote web/products.json and supabase/seed/rh_seed.sql');
}

main();
