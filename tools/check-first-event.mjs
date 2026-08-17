/* ============================================================================
   How long until the first event leaves the page?

   Written after a report that events were reaching Dengage far later here than
   in any other implementation. That is measurable rather than arguable, and
   this measures the half we control: the gap between the page starting and the
   first pageView being emitted. It says nothing about how long Dengage then
   takes to store a row, which is a different question with a different answer.

   THE SDK HOSTS ARE REFUSED AND THE REFUSAL IS ASSERTED. CLAUDE.md section 4:
   a comment claiming something cannot happen is enforced by code or deleted.
   A real SDK loading mid measurement would race the recorder and has already
   cost a day once.

     node tools/check-first-event.mjs
   ========================================================================== */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const ROOT = 'web';
const PORT = 8123;
const BUDGET_MS = 400;

const TYPES = {
    '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json',
    '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png',
    '.jpg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2'
};

/* Deliberately unthrottled. The point is the ORDER of the waterfall, not the
   speed of this machine's disk: a page that cannot report anything until two
   hundred kilobytes of catalogue has arrived is slow on a conference room
   network whatever it does here. */
const server = createServer(async (req, res) => {
    try {
        const path = decodeURIComponent(req.url.split('?')[0]);
        const file = join(ROOT, normalize(path === '/' ? '/index.html' : path).replace(/^(\.\.[/\\])+/, ''));
        const body = await readFile(file);
        res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' });
        res.end(body);
    } catch { res.writeHead(404); res.end('not found'); }
});
await new Promise((r) => server.listen(PORT, r));

const browser = await chromium.launch({
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {})
});

async function measure(label, url) {
    const page = await browser.newPage();

    let sdkReached = false;
    await page.route('**://*.dengage.com/**', (route) => { sdkReached = true; route.abort(); });
    await page.route('**://pcdn.dengage.com/**', (route) => { sdkReached = true; route.abort(); });

    /* The emitter announces every call on a window event, before the SDK is
       involved at all, so this is the moment the page decided to report rather
       than the moment a request completed. */
    await page.addInitScript(() => {
        window.__firstEventAt = null;
        window.addEventListener('dps:rh-demo:event', (e) => {
            if (window.__firstEventAt === null) {
                window.__firstEventAt = Math.round(performance.now());
                window.__firstEventAction = e.detail && e.detail.action;
            }
        });
    });

    await page.goto(url, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__firstEventAt !== null, { timeout: 15000 })
        .catch(() => {});

    const at = await page.evaluate(() => window.__firstEventAt);
    const action = await page.evaluate(() => window.__firstEventAction);

    /* The refusal, asserted rather than described. */
    if (sdkReached === false && at !== null) {
        // No SDK request was even attempted, which would mean the head block
        // changed. Worth knowing, because then this measures a different page.
        console.log(`  note: no request to a dengage host was attempted on ${label}`);
    }

    await page.close();
    return { at, action };
}

console.log('Time from page start to the first event being emitted:\n');

const results = [];
for (const [label, url] of [
    ['home', `http://localhost:${PORT}/index.html`],
    ['product', `http://localhost:${PORT}/product.html?id=100184971&cep=90010150`]
]) {
    const r = await measure(label, url);
    results.push([label, r]);
    const shown = r.at === null ? 'never emitted' : `${r.at} ms  (${r.action})`;
    console.log(`  ${label.padEnd(9)} ${shown}`);
}

await browser.close();
server.close();

const slow = results.filter(([, r]) => r.at === null || r.at > BUDGET_MS);
if (slow.length) {
    console.log(`\nOver the ${BUDGET_MS} ms budget: ${slow.map(([l]) => l).join(', ')}`);
    console.log('The first event should not wait on the catalogue or the shop list.');
    process.exitCode = 1;
} else {
    console.log(`\nBoth inside the ${BUDGET_MS} ms budget.`);
}
