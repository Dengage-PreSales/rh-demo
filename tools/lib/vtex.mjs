/* ============================================================================
   The three Ri Happy storefront endpoints this demo reads, and nothing else.

   These are the public endpoints their own website calls on every page load and
   every postcode check. We read them ONCE, before the demo, and commit the
   result. Nothing at demo time ever touches rihappy.com.br: the storefront, the
   email and the push all read our own copy. That is a deliberate design choice
   rather than a limitation, and the reason is in docs/architecture.md.

   PACING IS NOT OPTIONAL. Every call is spaced, because a capture run makes
   roughly two hundred requests against a live retailer's production checkout
   engine. A page load makes a handful. Spacing keeps this closer to browsing
   than to load testing, which is the only honest way to read somebody else's
   system.
   ========================================================================== */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const HOST = 'https://www.rihappy.com.br';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
           '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const PACE_MS = 500;
const TIMEOUT_MS = 30000;
const RETRIES = 3;

/* The postcodes to capture, read from data/cities.json so the list is reviewable
   in one place rather than buried in code. */
export function citiesFrom(root) {
    const path = join(root, 'data', 'cities.json');
    const doc = JSON.parse(readFileSync(path, 'utf8'));
    return doc.cities.map((c) => ({
        cep: c.cep,
        digits: c.cep.replace(/[^0-9]/g, ''),
        region: c.code,
        label: c.label,
        city: c.city,
        state: c.state
    }));
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** One request, paced, retried on transport failure and on 5xx only. */
async function request(url, init, attempt) {
    const tries = attempt || 1;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
        const response = await fetch(url, Object.assign({
            headers: Object.assign({ 'User-Agent': UA, Accept: 'application/json' },
                                   (init && init.headers) || {}),
            signal: controller.signal
        }, init || {}));
        clearTimeout(timer);
        if (response.status >= 500 && tries < RETRIES) {
            await wait(PACE_MS * tries * 2);
            return request(url, init, tries + 1);
        }
        return response;
    } catch (err) {
        clearTimeout(timer);
        if (tries < RETRIES) {
            await wait(PACE_MS * tries * 2);
            return request(url, init, tries + 1);
        }
        throw err;
    }
}

/** Catalogue rows for one product id. Returns [] when the id is withdrawn. */
export async function productById(productId) {
    const url = HOST + '/api/catalog_system/pub/products/search?fq=productId:' +
                encodeURIComponent(productId);
    const response = await request(url);
    await wait(PACE_MS);
    if (!response.ok) return [];
    const body = await response.json().catch(() => []);
    return Array.isArray(body) ? body : [];
}

/**
 * Products in one category, used to build the roster the first time.
 *
 * `path` is the chain of category ids from the top down, for example
 * [1766, 1820] for BRINQUEDOS then BLOCOS DE MONTAR. A leaf id on its own
 * returns nothing at all rather than an error, which is the quiet kind of
 * failure that reads as "this category is empty", so the whole path is required.
 */
export async function productsInCategory(path, from, to) {
    const chain = Array.isArray(path) ? path : [path];
    const filter = 'C:/' + chain.join('/') + '/';
    const url = HOST + '/api/catalog_system/pub/products/search?fq=' +
                encodeURIComponent(filter) + '&_from=' + from + '&_to=' + to;
    const response = await request(url);
    await wait(PACE_MS);
    if (!response.ok) return [];
    const body = await response.json().catch(() => []);
    return Array.isArray(body) ? body : [];
}

/** Their category tree, three levels deep. Used to resolve subcategory paths. */
export async function categoryTree() {
    const response = await request(HOST + '/api/catalog_system/pub/category/tree/3');
    await wait(PACE_MS);
    if (!response.ok) throw new Error('category tree unavailable: ' + response.status);
    const body = await response.json().catch(() => []);
    return Array.isArray(body) ? body : [];
}

/**
 * Which sellers serve a postcode. This is Ri Happy's own store resolution, and
 * reading it rather than reimplementing it is the whole point: their fulfilment
 * rules stay theirs.
 */
export async function regionsFor(cep) {
    const url = HOST + '/api/checkout/pub/regions?country=BRA&postalCode=' +
                encodeURIComponent(cep);
    const response = await request(url);
    await wait(PACE_MS);
    if (!response.ok) return { id: '', sellers: [] };
    const body = await response.json().catch(() => []);
    const first = Array.isArray(body) && body.length ? body[0] : {};
    return { id: first.id || '', sellers: Array.isArray(first.sellers) ? first.sellers : [] };
}

/**
 * Whether one SKU can reach one postcode, and from which named stores.
 *
 * This is a cart simulation, the same call their product page makes when a
 * shopper checks delivery. It creates nothing and orders nothing.
 *
 * The shape of the answer is the single most important fact in this project:
 * availability comes back as a STATE plus a list of NAMED PICKUP STORES, never
 * as a unit count. So nothing downstream may ever show a count, because we were
 * never told one. See CLAUDE.md rule 5 in the factory repository, which this
 * project follows voluntarily.
 */
export async function simulate(skuId, cep) {
    const url = HOST + '/api/checkout/pub/orderForms/simulation?sc=1';
    const response = await request(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            items: [{ id: String(skuId), quantity: 1, seller: '1' }],
            postalCode: cep,
            country: 'BRA'
        })
    });
    await wait(PACE_MS);
    if (!response.ok) {
        return { state: 'unknown', price: null, pickupStores: [], fastest: '', channels: [] };
    }
    const body = await response.json().catch(() => null);
    if (!body) {
        return { state: 'unknown', price: null, pickupStores: [], fastest: '', channels: [] };
    }

    const items = Array.isArray(body.items) ? body.items : [];
    const item = items.length ? items[0] : null;
    const availability = item && item.availability ? String(item.availability) : 'none';

    /* The simulation reports price in cents. A price is only ever carried through
       when the call actually returned one, never defaulted to zero, because a
       zero price reads as free and that is the exact trap rule 5 describes. */
    const cents = item && typeof item.price === 'number' ? item.price : null;
    const price = cents === null ? null : Math.round(cents) / 100;

    const stores = [];
    const channels = [];
    const estimates = [];
    const logistics = Array.isArray(body.logisticsInfo) ? body.logisticsInfo : [];
    for (const leg of logistics) {
        const slas = Array.isArray(leg.slas) ? leg.slas : [];
        for (const sla of slas) {
            const channel = sla.deliveryChannel || '';
            if (channel && channels.indexOf(channel) === -1) channels.push(channel);
            if (channel !== 'pickup-in-point') continue;
            const info = sla.pickupStoreInfo || {};
            const name = info.friendlyName || sla.name || '';
            if (name && stores.indexOf(name) === -1) stores.push(name);
            if (sla.shippingEstimate) estimates.push(sla.shippingEstimate);
        }
    }

    return {
        state: availability === 'available' ? 'available' : 'withoutStock',
        rawState: availability,
        price: price,
        pickupStores: stores,
        fastest: estimates.length ? estimates.slice().sort()[0] : '',
        channels: channels
    };
}
