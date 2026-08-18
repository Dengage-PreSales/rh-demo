/* ============================================================================
   Generate the Subject field's value FROM the email body, never beside it.

   The Subject field runs the same template engine as the body, proven in the
   panel on 18 August 2026. That makes a personalised subject possible and
   introduces the one failure worth engineering against: the subject resolves a
   shop independently, so if its logic drifts from the body's by a single line,
   the inbox names one shop and the message names another. On a shared screen
   that is worse than a static subject, because it looks like the platform
   guessed.

   So this does not reimplement anything. It lifts the body's own script block
   verbatim and appends the subject it already computes. Drift is impossible by
   construction: change the body and rebuild, and the subject follows.

     node tools/build-subject.mjs
   ========================================================================== */
import { readFileSync, writeFileSync } from 'node:fs';

const BODY = 'panel/email/uc1-store-availability.html';
const OUT = 'panel/email/uc1-subject.txt';

const src = readFileSync(BODY, 'utf8');

const open = src.indexOf('{%');
if (open !== 0) throw new Error('the body no longer opens on its script block');
const close = src.indexOf('%}', open);
if (close === -1) throw new Error('unclosed script block in the body');

const block = src.slice(open + 2, close);
if (!/var\s+subject\s*=/.test(block)) {
    throw new Error('the body block no longer computes a subject');
}

/* THE COMMENTS ARE STRIPPED, AND ONLY FROM THIS COPY.

   The body's block is 16 KB, nearly all of it the notes that explain why each
   line is the way it is. Those belong in the body, where anyone editing it will
   read them. They do not belong pasted into a single line subject input, and a
   field with a length limit would simply refuse them.

   Only comments and blank lines go. Every statement survives, in order, so this
   copy still resolves exactly what the body resolves. */
function stripComments(js) {
    let out = '';
    let i = 0;
    let inStr = null;
    while (i < js.length) {
        const c = js[i];
        const next = js[i + 1];
        if (inStr) {
            out += c;
            if (c === '\\') { out += js[i + 1] ?? ''; i += 2; continue; }
            if (c === inStr) inStr = null;
            i += 1;
            continue;
        }
        if (c === '"' || c === "'") { inStr = c; out += c; i += 1; continue; }
        if (c === '/' && next === '*') {
            const end = js.indexOf('*/', i + 2);
            i = end === -1 ? js.length : end + 2;
            continue;
        }
        if (c === '/' && next === '/') {
            const end = js.indexOf('\n', i);
            i = end === -1 ? js.length : end;
            continue;
        }
        /* A regex literal, which must survive intact: the shop shortener is
           built from them and a slash inside one is not a comment. */
        if (c === '/') {
            let j = i + 1;
            let cls = false;
            while (j < js.length) {
                if (js[j] === '\\') { j += 2; continue; }
                if (js[j] === '[') cls = true;
                else if (js[j] === ']') cls = false;
                else if (js[j] === '/' && !cls) break;
                else if (js[j] === '\n') break;
                j += 1;
            }
            out += js.slice(i, j + 1);
            i = j + 1;
            continue;
        }
        out += c;
        i += 1;
    }
    return out
        .split('\n')
        .map((l) => l.replace(/\s+$/, ''))
        .filter((l) => l.trim() !== '')
        .join('\n');
}

const lean = stripComments(block);
if (!/var\s+subject\s*=/.test(lean)) {
    throw new Error('stripping removed the subject assignment');
}

const subjectOut = '{%\n' + lean + '\n%}{%= subject %}\n';
writeFileSync(OUT, subjectOut);
console.log(`wrote ${OUT}: ${subjectOut.length} characters, lifted from ${BODY}`);

/* The Pre-header field, generated the same way and for the same reason, but
   OPTIONAL. The body already carries a hidden preview line that resolves at no
   extra cost, because the body has resolved the shop by the time it renders.
   Filling the panel field instead spends a second resolution per recipient to
   say the same sentence. Both are here so the choice is informed rather than
   forced. */
const PRE = 'panel/email/uc1-preheader.txt';
const preOut = '{%\n' + lean + '\n%}{%= preview %}\n';
writeFileSync(PRE, preOut);
console.log(`wrote ${PRE}: ${preOut.length} characters`);
