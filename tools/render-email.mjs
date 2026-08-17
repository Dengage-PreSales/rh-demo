/* ============================================================================
   Render the Use Case 1 email against LIVE data, into files you can open.

   This is not the Dengage engine and does not pretend to be. It implements the
   two tag forms the panel uses, {% js %} and {%= value %}, and calls the real
   rh_email endpoint, so what it proves is the template's own logic and the real
   data flowing through it: which branch fires for which contact, and what each
   recipient would actually see.

   What it cannot prove is Dengage's own substitution of $Contact and $from.
   Those need a send. Everything else is exercised here.

     node tools/render-email.mjs
     open out/email-*.html
   ========================================================================== */
import { writeFileSync, mkdirSync } from 'node:fs';

const KEY = 'sb_publishable_HcLAWb6E5Gn_d5vVTjPB_Q_zkjklifK';
const RPC = 'https://raextqlludkagdntyzwn.supabase.co/rest/v1/rpc';
const TEMPLATE = 'panel/email/uc1-store-availability.html';
const OUT = 'out';

/* Transpile the panel's two tag forms into a JS function body. */
function compile(src) {
    let body = 'let __o = "";\n';
    let i = 0;
    while (i < src.length) {
        const open = src.indexOf('{%', i);
        if (open === -1) { body += `__o += ${JSON.stringify(src.slice(i))};\n`; break; }
        body += `__o += ${JSON.stringify(src.slice(i, open))};\n`;
        const close = src.indexOf('%}', open);
        if (close === -1) throw new Error('unclosed {% tag');
        const inner = src.slice(open + 2, close);
        if (inner.startsWith('=')) body += `__o += String(${inner.slice(1)});\n`;
        else body += inner + '\n';
        i = close + 2;
    }
    body += 'return __o;';
    return body;
}

async function rh_email(cep, sku, n) {
    const r = await fetch(`${RPC}/rh_email?cep=${encodeURIComponent(cep)}&sku=${encodeURIComponent(sku)}&n=${n}&apikey=${KEY}`);
    return await r.text();
}

class Blocked extends Error {}

async function render(label, contact, lastVisit) {
    const src = (await import('node:fs')).readFileSync(TEMPLATE, 'utf8');

    /* Pre-resolve the endpoint calls the template will make, because the panel
       engine is synchronous and fetch here is not. */
    const calls = {};
    /* Exactly the extraction the template performs, character for character.
       An earlier version used /cep=(\d+)/ which stops at the dash and produced
       01310, so every pre-fetch missed and every render blocked. The renderer
       was wrong and the template was right, which is the failure mode a
       harness has to be built against. */
    let cepGuess = null;
    if (lastVisit && lastVisit.page_url) {
        const at = String(lastVisit.page_url).indexOf('cep=');
        if (at > -1) {
            const got = String(lastVisit.page_url).substring(at + 4).split('&')[0].replace(/[^0-9]/g, '');
            if (got) cepGuess = got;
        }
    }
    if (!cepGuess && !contact.nearest_store) cepGuess = '01310100';
    const skuGuess = (lastVisit && lastVisit.product_id) || '100184971';
    if (cepGuess) calls[`e|${cepGuess}|${skuGuess}`] = await rh_email(cepGuess, skuGuess, '3');

    const $Contact = contact;
    const $from = () => ({
        where: () => ({ order: () => ({ first: () => lastVisit }) })
    });
    const $CustomApi = {
        rh_email: (cep, sku) => calls[`e|${cep}|${sku}`] || 'null',
        rh_store_offer: () => 'null'
    };
    const $blockSend = () => { throw new Blocked(); };

    try {
        const fn = new Function('$Contact', '$from', '$CustomApi', '$blockSend', compile(src));
        const html = fn($Contact, $from, $CustomApi, $blockSend);
        mkdirSync(OUT, { recursive: true });
        const file = `${OUT}/email-${label}.html`;
        writeFileSync(file, html);
        const shop = /Your store<\/div>\s*<div[^>]*>([^<]+)</.exec(html);
        const branch = html.includes('is not on the shelf') ? 'SUBSTITUTE'
                     : html.includes('Still available') ? 'IN STOCK' : 'no claim';
        const how = /Resolved by: ([^<(]+)/.exec(html);
        console.log(`  ${label.padEnd(14)} ${branch.padEnd(11)} shop: ${(shop ? shop[1] : '?').slice(0, 38).padEnd(40)} via ${how ? how[1].trim() : '?'}`);
        return file;
    } catch (e) {
        if (e instanceof Blocked) { console.log(`  ${label.padEnd(14)} BLOCKED     the send is stopped, which is correct here`); return null; }
        throw e;
    }
}

console.log('Rendering the Use Case 1 email against live data:\n');
await render('sao-paulo',    { contact_key: 'DPS-1', nearest_store: null },
             { page_url: 'https://dengage-presales.github.io/rh-demo/product.html?id=100184971&cep=01310-100', product_id: '100184971' });
await render('porto-alegre', { contact_key: 'DPS-2', nearest_store: null },
             { page_url: 'https://dengage-presales.github.io/rh-demo/product.html?id=100184971&cep=90010-150', product_id: '100184971' });
await render('vitoria',      { contact_key: 'DPS-3', nearest_store: null },
             { page_url: 'https://dengage-presales.github.io/rh-demo/product.html?id=100184971&cep=29010-000', product_id: '100184971' });
await render('new-contact',  { contact_key: 'DPS-4', nearest_store: null }, null);
console.log('\nOpen the files in out/ to see exactly what each contact receives.');
