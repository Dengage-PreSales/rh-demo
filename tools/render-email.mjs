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

/* THE ENVELOPE, ASSERTED RATHER THAN ASSUMED.

   The template shipped for a day with no doctype, no head and no charset: it
   opened on a table. Nothing here caught it, because everything here was
   checking which branch fired and what each contact would read, and all of that
   was correct. A document can be right in every word and still arrive as
   mojibake, so the container gets its own assertions.

   The charset is the one that would actually have shown. Every product name in
   this catalogue is Brazilian Portuguese, so an undeclared charset means a mail
   client guesses at "Veiculo Eletrico" and "Bebes" in front of the people whose
   catalogue it is.

   The comment count is the other half. An HTML comment is invisible in a mail
   client and fully present in View Source, so internal notes in one are sent to
   every recipient. They belong in the script block, which the engine eats. */
function checkEnvelope(label, html) {
    const problems = [];
    if (!/^\s*<!doctype html>/i.test(html)) problems.push('no doctype');
    if (!/<html[^>]*\blang=/i.test(html)) problems.push('no lang on html');
    if (!/<head[\s>]/i.test(html)) problems.push('no head');
    if (!/<meta[^>]+charset=["']?utf-8/i.test(html)) problems.push('no utf-8 charset');
    if (!/<meta[^>]+name=["']viewport/i.test(html)) problems.push('no viewport');
    if (!/<body[\s>]/i.test(html)) problems.push('no body');
    if (!/<\/html>\s*$/i.test(html)) problems.push('html not closed');

    const comments = html.match(/<!--/g);
    if (comments) problems.push(`${comments.length} HTML comment(s) sent to the recipient`);

    if (problems.length) {
        console.error(`\n  ENVELOPE FAILED for ${label}: ${problems.join(', ')}`);
        process.exitCode = 1;
    }
}

async function render(label, contact, lastVisit, templatePath) {
    const src = (await import('node:fs')).readFileSync(templatePath || TEMPLATE, 'utf8');

    /* Pre-resolve the endpoint calls the template will make, because the panel
       engine is synchronous and fetch here is not. */
    const calls = {};
    /* Exactly the extraction the template performs, character for character.
       An earlier version used /cep=(\d+)/ which stops at the dash and produced
       01310, so every pre-fetch missed and every render blocked. The renderer
       was wrong and the template was right, which is the failure mode a
       harness has to be built against. */
    let cepGuess = null;
    /* Path 1 cannot fire without a contact key, so neither can this. The
       harness has to mirror the template's own conditions, not just its
       string handling: modelling only the happy path is how a renderer
       reports BLOCKED for a case that sends perfectly well. */
    if (contact.contact_key && lastVisit && lastVisit.page_url) {
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

    /* THE CHAIN MODELS BOTH SHAPES, because the template now asks for both.
       .first() is reported by the panel to exist and has never yet returned a
       row in a real send, so the template falls back to .take(1).get(). Passing
       breakFirst makes .first() answer nothing here, which is the only way to
       exercise that fallback before a send does. */
    const breakFirst = contact.__breakFirst === true;

    /* TWO TABLES NOW, because the template walks the star schema by hand. The
       key column on page_view_events holds a device id and never a contact key,
       proven by a send on 17 August, so a contact's visits are only reachable
       through master_device.

       The device rows are modelled as the panel presents them, with device_id
       as the id column. contact.__deviceIdField renames it, which is how the
       "device row carries no recognisable id column" branch gets exercised. */
    const devices = contact.contact_key
        ? (contact.__devices || [{ [contact.__deviceIdField || 'device_id']: 'dev-1' }])
        : [];
    const visitsByDevice = contact.__visitsByDevice
        || (lastVisit ? { 'dev-1': lastVisit } : {});

    const $from = (table) => {
        let col = null, val = null;
        const chain = {
            where: (c, _op, v) => { col = c; val = v; return chain; },
            order: () => chain,
            take: () => chain,
            first: () => (breakFirst ? null : rows()[0] || null),
            get: () => rows()
        };
        function rows() {
            if (String(table).indexOf('master_device') > -1) return devices;
            if (col === 'key') {
                const v = visitsByDevice[val];
                return v ? [v] : [];
            }
            return [];
        }
        return chain;
    };
    const $CustomApi = {
        rh_email: (cep, sku) => calls[`e|${cep}|${sku}`] || 'null',
        rh_store_offer: () => 'null'
    };
    const $blockSend = () => { throw new Blocked(); };


    try {
        const fn = new Function('$Contact', '$from', '$CustomApi', '$blockSend', compile(src));
        const html = fn($Contact, $from, $CustomApi, $blockSend);
        if (templatePath) return html.trim();
        mkdirSync(OUT, { recursive: true });
        const file = `${OUT}/email-${label}.html`;
        writeFileSync(file, html);
        const shop = /Your store<\/div>\s*<div[^>]*>([^<]+)</.exec(html);
        const branch = html.includes('is not on the shelf') ? 'SUBSTITUTE'
                     : html.includes('Still available') ? 'IN STOCK' : 'no claim';
        const how = /Resolved by: ([^<(]+)/.exec(html);
        console.log(`  ${label.padEnd(14)} ${branch.padEnd(11)} shop: ${(shop ? shop[1] : '?').slice(0, 38).padEnd(40)} via ${how ? how[1].trim() : '?'}`);
        checkEnvelope(label, html);
        return file;
    } catch (e) {
        if (e instanceof Blocked) {
            if (templatePath) return null;
            console.log(`  ${label.padEnd(14)} BLOCKED     the send is stopped, which is correct here`);
            return null;
        }
        throw e;
    }
}

/* THE GUARD IS TESTED AGAINST KNOWN BAD INPUT, because a guard that has only
   ever seen a passing document proves nothing. Both cases below are real: the
   first is the template exactly as it shipped yesterday, the second is a
   correct envelope with an internal note left in a comment.

     node tools/render-email.mjs --self-test                                  */
if (process.argv.includes('--self-test')) {
    const cases = [
        ['a bare table, as this template shipped', '<table><tr><td>hi</td></tr></table>'],
        ['a good envelope with a leaked comment',
         '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">' +
         '<meta name="viewport" content="width=device-width"></head>' +
         '<body><!-- internal note --></body></html>']
    ];
    let failures = 0;
    for (const [what, html] of cases) {
        process.exitCode = 0;
        checkEnvelope(what, html);
        const caught = process.exitCode === 1;
        console.log(`  ${caught ? 'caught  ' : 'MISSED  '} ${what}`);
        if (!caught) failures += 1;
    }
    process.exitCode = failures ? 1 : 0;
    console.log(failures ? '\nThe guard can fail open. Fix it.' : '\nThe guard catches both.');
} else {

const poaVisit = { page_url: 'https://dengage-presales.github.io/rh-demo/product.html?ck=salil-demo&id=100184971&cep=90010150', product_id: '100184971', event_date: '2026-08-17T19:44:00' };
const capDevices = [];
const capVisits = {};
for (let i = 1; i <= 50; i++) { capDevices.push({ device_id: 'dev-' + i }); }
capVisits['dev-50'] = poaVisit;

/* ONE LIST, TWO PASSES. The body and the Subject field each resolve a shop
   independently at send time, so they are exercised against identical inputs
   here. A case that renders one and not the other is the drift this is for. */
const CASES = [
    ['sao-paulo',    { contact_key: 'DPS-1', nearest_store: null },
     { page_url: 'https://dengage-presales.github.io/rh-demo/product.html?id=100184971&cep=01310-100', product_id: '100184971' }],
    ['porto-alegre', { contact_key: 'DPS-2', nearest_store: null },
     { page_url: 'https://dengage-presales.github.io/rh-demo/product.html?id=100184971&cep=90010-150', product_id: '100184971' }],
    ['vitoria',      { contact_key: 'DPS-3', nearest_store: null },
     { page_url: 'https://dengage-presales.github.io/rh-demo/product.html?id=100184971&cep=29010-000', product_id: '100184971' }],
    ['new-contact',  { contact_key: 'DPS-4', nearest_store: null }, null],
    ['first-broken', { contact_key: 'salil-demo', nearest_store: null, __breakFirst: true },
     { page_url: 'https://dengage-presales.github.io/rh-demo/product.html?ck=salil-demo&id=100184971&cep=90010150', product_id: '100184971' }],
    ['no-contact',   { contact_key: '', nearest_store: null },
     { page_url: 'https://dengage-presales.github.io/rh-demo/product.html?ck=salil-demo&id=100184971&cep=90010150', product_id: '100184971' }],
    ['two-devices',  { contact_key: 'salil-demo', nearest_store: null,
        __devices: [{ device_id: 'dev-1' }, { device_id: 'dev-2' }],
        __visitsByDevice: {
            'dev-1': { page_url: 'https://dengage-presales.github.io/rh-demo/product.html?id=100184971&cep=01310-100', product_id: '100184971', event_date: '2026-08-16T09:00:00' },
            'dev-2': poaVisit
        } }, poaVisit],
    ['no-device',    { contact_key: 'salil-demo', nearest_store: null, __devices: [], __visitsByDevice: {} }, null],
    ['device-cap',   { contact_key: 'salil-demo', nearest_store: null,
        __devices: capDevices, __visitsByDevice: capVisits }, poaVisit]
];

console.log('Rendering the Use Case 1 email against live data:\n');
for (const [label, contact, visit] of CASES) {
    await render(label, contact, visit);
}

console.log('\nOpen the files in out/ to see exactly what each contact receives.');

/* THE SUBJECT IS RENDERED THROUGH THE SAME CASES AND COMPARED TO THE BODY.

   The Subject field runs the template engine, so a personalised subject is
   possible, and it resolves its shop independently of the message. If the two
   ever disagree the inbox names one shop and the email names another, which
   reads as the platform guessing. tools/build-subject.mjs makes drift
   impossible by lifting the body's own block; this proves it on real data
   rather than trusting the lift. */
console.log('\nSubject field, rendered through the same cases:\n');
/* BOTH SUBJECT BUILDS ARE CHECKED, because the panel refused the generated one
   and the compact one is hand written rather than lifted.

   The lifted build cannot drift by construction and is 5.7 KB. The compact
   build is 1.6 KB and CAN drift, so it is held to the same standard here: if it
   ever names a different shop from the message, this fails. That test is the
   only thing making a hand written subject safe to ship. */
const SUBJECTS = [
    ['lifted ', 'panel/email/uc1-subject.txt'],
    ['compact', 'panel/email/uc1-subject-compact.txt']
];
const renderSubject = (label, contact, visit, file) => render(label, contact, visit, file);
let subjectMismatch = 0;
for (const [buildName, file] of SUBJECTS) {
    console.log(`  ${buildName}`);
    for (const [label, contact, visit] of CASES) {
        let bodyShop = null;
        try {
            const html = (await import('node:fs')).readFileSync(`${OUT}/email-${label}.html`, 'utf8');
            const m = /Your store<\/div>\s*<div[^>]*>([^<]+)</.exec(html);
            bodyShop = m ? m[1].trim() : null;
        } catch { bodyShop = null; }

        const subj = await renderSubject(label, contact, visit, file);
        if (subj === null) { console.log(`    ${label.padEnd(14)} (blocked, as the body is)`); continue; }
        console.log(`    ${label.padEnd(14)} ${subj}`);

        /* The subject shortens the shop name, so agreement means the body's
           shop CONTAINS the subject's, not that the strings match. */
        if (bodyShop) {
            const named = subj
                .replace('Still on the shelf at ', '')
                .replace('Not on the shelf at ', '')
                .replace('Not at ', '')
                .replace('What ', '')
                .replace('. This one is.', '')
                .replace(' has today', '')
                .replace(' today', '')
                .trim();
            if (named && named !== 'your store' &&
                !bodyShop.toLowerCase().includes(named.toLowerCase())) {
                console.log(`      MISMATCH: the message says ${bodyShop}`);
                subjectMismatch += 1;
            }
        }
    }
}
if (subjectMismatch) {
    console.log(`\n${subjectMismatch} subject(s) name a different shop from the body.`);
    process.exitCode = 1;
} else {
    console.log('\nEvery subject names the same shop as its message.');
}

}
