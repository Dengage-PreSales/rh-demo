/* ============================================================================
   The SDK setup must stay identical in shape to the showcase demo.

   The showcase writes sessions correctly on the same account, the same app
   guid and the same origin. This demo did not, and the cause was a clever
   rewrite here: a poll that waited for the real SDK instead of using the stub
   queue, built on a wrong reading of the minified bundle. It changed when
   initialize runs, and the SDK sets up its visitor and session from what is
   waiting when it boots.

   So this asserts the shape rather than the behaviour, because the behaviour
   lives on Dengage's servers where no test here can see it:

     the stub exists and collects into window.dengage.q
     the loader is appended
     initialize is called in the same synchronous block
     nothing defers or buffers it
   ========================================================================== */
import { readFileSync } from 'node:fs';

let bad = 0;
for (const page of ['web/index.html', 'web/product.html']) {
    const src = readFileSync(page, 'utf8');
    const head = src.split('</head>')[0];

    const checks = {
        'stub collects into window.dengage.q': /window\.dengage\.q\s*=\s*window\.dengage\.q\s*\|\|\s*\[\]/.test(head),
        'loader appended':                     /dengage_sdk_loader\.js/.test(head),
        'initialize called in the head':       /dengage\('initialize'/.test(head),
        'no polling for the SDK':              !/__dnStub|dps:sdk-ready/.test(head),
    };
    /* The events module must not reintroduce a buffer in front of the queue. */
    const events = readFileSync('web/js/dengageEvents.js', 'utf8');
    checks['events are not buffered'] = !/whenReady|__dnReady/.test(events);

    console.log(`  ${page}`);
    for (const [name, ok] of Object.entries(checks)) {
        console.log(`    ${ok ? 'ok  ' : 'FAIL'}  ${name}`);
        if (!ok) bad++;
    }
}
/* Initialize must come after the loader is appended, as it does on the showcase. */
const head = readFileSync('web/index.html', 'utf8').split('</head>')[0];
const order = head.indexOf('dengage_sdk_loader.js') < head.indexOf("dengage('initialize'");
console.log(`  ${order ? 'ok  ' : 'FAIL'}  loader is appended before initialize is called`);
if (!order) bad++;

console.log(bad ? `\n  ${bad} problems` : '\n  Setup matches the showcase.');
if (bad) process.exitCode = 1;
