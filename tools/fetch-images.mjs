/* ============================================================================
   Download the product photographs and commit them.

       node tools/fetch-images.mjs [--force]

   Reads  data/snapshots/catalogue.json
   Writes web/img/products/<sku>.jpg
          data/snapshots/images-manifest.json

   WHY THE PICTURES ARE COPIED RATHER THAN LINKED. A demo that loads images from
   the prospect's own CDN is one cache purge away from showing a grid of broken
   frames in front of their executives, and we would have no warning and no fix
   in the room. Everything on screen is served from our own origin.

   SIZE IS CHOSEN, NOT DEFAULTED. Their CDN will resize on request, so the 500
   pixel variant is asked for rather than the 1000 pixel original: about 50 kB
   against 186 kB, which is the difference between a grid that appears instantly
   on a conference room connection and one that fills in tile by tile while
   somebody is talking. Measured, not assumed: recompressing their 600 pixel
   version locally saved 15 percent for visible quality loss, so their own
   encoder is left to do its job.

   Re-running is cheap. A photograph already on disk with the same source URL is
   left alone, so this can be run again after a catalogue refresh and only the
   products that actually changed are fetched.
   ========================================================================== */

import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'web', 'img', 'products');
const MANIFEST = join(ROOT, 'data', 'snapshots', 'images-manifest.json');

const WIDTH = 500;
const CONCURRENCY = 6;
const TIMEOUT_MS = 30000;
const MAX_BYTES = 4 * 1024 * 1024;
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
           '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

/* Their CDN takes the size in the path, between the asset id and the file name:
   .../arquivos/ids/9542678-500-auto/name.jpg. Anything that does not match that
   shape is fetched as it is rather than rewritten into a guess. */
function sized(url, width) {
    return url.replace(/\/arquivos\/ids\/(\d+)(-[\dauto x-]+)?\//i,
                       '/arquivos/ids/$1-' + width + '-auto/');
}

async function download(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
        const response = await fetch(url, {
            headers: { 'User-Agent': UA, Accept: 'image/jpeg,image/*' },
            signal: controller.signal
        });
        clearTimeout(timer);
        if (!response.ok) return { ok: false, why: 'http ' + response.status };
        const type = response.headers.get('content-type') || '';
        /* A bot wall answers 200 with an HTML page. Writing that to a .jpg gives
           a file that exists, has a sensible size, and renders as nothing. */
        if (!/^image\//i.test(type)) return { ok: false, why: 'not an image, got ' + type };
        const buffer = Buffer.from(await response.arrayBuffer());
        if (!buffer.length) return { ok: false, why: 'empty body' };
        if (buffer.length > MAX_BYTES) return { ok: false, why: 'larger than the limit' };

        /* The extension is decided by what the bytes actually are, not by the
           file name or the content type header. Both lie here: one product is
           served as a PNG called .jpg with an image/jpeg header, and writing
           those bytes to a .jpg would leave a file whose name disagrees with
           its contents for anyone who looks later. */
        const isJpeg = buffer[0] === 0xff && buffer[1] === 0xd8;
        const isPng = buffer[0] === 0x89 && buffer[1] === 0x50 &&
                      buffer[2] === 0x4e && buffer[3] === 0x47;
        if (!isJpeg && !isPng) return { ok: false, why: 'neither jpeg nor png' };
        return { ok: true, buffer: buffer, ext: isJpeg ? 'jpg' : 'png' };
    } catch (err) {
        clearTimeout(timer);
        return { ok: false, why: err.name === 'AbortError' ? 'timed out' : err.message };
    }
}

async function main() {
    const force = process.argv.includes('--force');
    const catalogue = JSON.parse(readFileSync(join(ROOT, 'data/snapshots/catalogue.json'), 'utf8'));
    mkdirSync(OUT, { recursive: true });

    const manifest = existsSync(MANIFEST) && !force
        ? JSON.parse(readFileSync(MANIFEST, 'utf8'))
        : { note: 'Which source photograph each committed file came from, so a re-run only fetches what changed.', images: {} };

    const jobs = [];
    for (const product of catalogue.products) {
        if (!Array.isArray(product.images) || !product.images.length) continue;
        const source = product.images[0];
        const known = manifest.images[product.skuId];
        if (!force && known && known.source === source) {
            const current = join(OUT, product.skuId + '.' + (known.ext || 'jpg'));
            if (existsSync(current) && statSync(current).size > 0) continue;
        }
        jobs.push({ skuId: product.skuId, source: source });
    }

    console.error('Photographs: ' + jobs.length + ' to fetch, ' +
                  (catalogue.products.length - jobs.length) + ' already current\n');
    if (!jobs.length) return;

    let done = 0, ok = 0, bytes = 0;
    const failures = [];

    async function worker() {
        for (;;) {
            const job = jobs.shift();
            if (!job) return;
            const result = await download(sized(job.source, WIDTH));
            done += 1;
            if (result.ok) {
                writeFileSync(join(OUT, job.skuId + '.' + result.ext), result.buffer);
                manifest.images[job.skuId] = {
                    source: job.source, bytes: result.buffer.length, ext: result.ext
                };
                ok += 1;
                bytes += result.buffer.length;
            } else {
                failures.push([job.skuId, result.why]);
            }
            if (done % 25 === 0 || done === jobs.length + failures.length) {
                process.stderr.write('  ' + done + ' fetched, ' + failures.length + ' failed\n');
            }
        }
    }

    await Promise.all(Array.from({ length: CONCURRENCY }, worker));

    mkdirSync(dirname(MANIFEST), { recursive: true });
    writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');

    console.error('\nWrote ' + ok + ' photographs, ' +
                  (bytes / 1048576).toFixed(1) + ' MB total, average ' +
                  (ok ? Math.round(bytes / ok / 1024) : 0) + ' kB');
    if (failures.length) {
        /* A product with no photograph must not reach the storefront, so these
           are named rather than counted. build-data.mjs drops them. */
        console.error('\nNo photograph, so these will be dropped from the catalogue:');
        for (const [sku, why] of failures) console.error('  ' + sku + ': ' + why);
    }
}

main().catch((err) => { console.error('image fetch failed: ' + err.message); process.exit(1); });
