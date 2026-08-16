/* ============================================================================
   Choose which products this demo carries.

       node tools/build-roster.mjs [--size 200]

   Writes data/roster-source.csv, the stable list every later step reads. It is
   committed so a demo's catalogue is reviewable in a diff rather than whatever
   an API happened to return that morning.

   TWO THINGS ARE BEING BALANCED AT ONCE, and they pull against each other.

   FLAVOUR wants breadth. A toy shop that opens on five pages of Pokemon boosters
   does not read as a toy shop. So the roster is drawn from about forty
   subcategories across their real tree, from baby rattles to skateboards to
   Funko Pop, and every one of those subcategories appears on the storefront.

   SUBSTITUTION wants depth. "This is not in stock nearby, here is a similar one"
   is only convincing when the similar one really is similar: same franchise,
   same age, same shelf. That needs several products sharing a licence, not one
   of everything. So subcategories that cluster by franchise carry more weight.

   Age spread is balanced explicitly rather than hoped for, because their age
   bands are merchandising ranges and taking the top of every category lands
   almost everything in the 4 to 8 bracket.
   ========================================================================== */

import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { productsInCategory, categoryTree } from './lib/vtex.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/* Weight 2 means a subcategory that clusters strongly by franchise or by shelf,
   so it carries the substitution scenes. Weight 1 is there for flavour. Toy
   retail only: their catalogue also sells pet bowls, nappies and smart TVs, and
   a demo that opens on those spends its first minute explaining itself. */
const CATEGORIES = [
    { id: 2095, top: 'BABY',              name: 'BRINQUEDOS PARA BEBES',   weight: 2 },
    { id: 2136, top: 'BABY',              name: 'MINI VEICULOS',           weight: 1 },
    { id: 2093, top: 'BABY',              name: 'MORDEDORES',              weight: 1 },
    { id: 1767, top: 'BRINQUEDOS',        name: 'ARTES',                   weight: 1 },
    { id: 1772, top: 'BRINQUEDOS',        name: 'BRINCADEIRA DE CASINHA',  weight: 1 },
    { id: 1776, top: 'BRINQUEDOS',        name: 'FAZ DE CONTA',            weight: 1 },
    { id: 1786, top: 'BRINQUEDOS',        name: 'PELUCIAS',                weight: 2 },
    { id: 1794, top: 'BRINQUEDOS',        name: 'INSTRUMENTOS MUSICAIS',   weight: 1 },
    { id: 1804, top: 'BRINQUEDOS',        name: 'VEICULOS DE BRINQUEDO',   weight: 2 },
    { id: 1813, top: 'BRINQUEDOS',        name: 'LANCADORES',              weight: 1 },
    { id: 1820, top: 'BRINQUEDOS',        name: 'BLOCOS DE MONTAR',        weight: 3 },
    { id: 1825, top: 'BRINQUEDOS',        name: 'QUEBRA-CABECAS',          weight: 1 },
    { id: 1994, top: 'BRINQUEDOS',        name: 'BRINQUEDOS ELETRONICOS',  weight: 1 },
    { id: 2002, top: 'BRINQUEDOS',        name: 'BRINQUEDOS DE BELEZA',    weight: 1 },
    { id: 1748, top: 'BONECOS E BONECAS', name: 'BONECAS',                 weight: 3 },
    { id: 1755, top: 'BONECOS E BONECAS', name: 'BONECOS',                 weight: 2 },
    { id: 1760, top: 'BONECOS E BONECAS', name: 'ACESSORIOS PARA BONECAS', weight: 1 },
    { id: 2027, top: 'BONECOS E BONECAS', name: 'CASA DE BONECA',          weight: 1 },
    { id: 1656, top: 'JOGOS',             name: 'JOGOS DE ACAO',           weight: 1 },
    { id: 1657, top: 'JOGOS',             name: 'JOGOS DE CARTAS',         weight: 2 },
    { id: 1658, top: 'JOGOS',             name: 'JOGOS CLASSICOS',         weight: 1 },
    { id: 1659, top: 'JOGOS',             name: 'JOGOS EDUCATIVOS',        weight: 1 },
    { id: 1661, top: 'JOGOS',             name: 'JOGOS DE TABULEIRO',      weight: 2 },
    { id: 1730, top: 'COLECIONAVEIS',     name: 'FUNKO POP',               weight: 2 },
    { id: 1731, top: 'COLECIONAVEIS',     name: 'ACTION FIGURE',           weight: 2 },
    { id: 2038, top: 'COLECIONAVEIS',     name: 'CARRINHOS COLECIONAVEIS', weight: 2 },
    { id: 1879, top: 'COLECIONAVEIS',     name: 'MONTAGEM E MODELISMO',    weight: 1 },
    { id: 1843, top: 'FANTASIAS',         name: 'FANTASIA INFANTIL',       weight: 1 },
    { id: 2051, top: 'FANTASIAS',         name: 'SABRE DE LUZ',            weight: 1 },
    { id: 2045, top: 'FANTASIAS',         name: 'MASCARAS',                weight: 1 },
    { id: 782,  top: 'ESPORTES',          name: 'BICICLETAS',              weight: 1 },
    { id: 784,  top: 'ESPORTES',          name: 'SKATES',                  weight: 1 },
    { id: 2074, top: 'ESPORTES',          name: 'PATINETES',               weight: 1 },
    { id: 2073, top: 'ESPORTES',          name: 'PATINS',                  weight: 1 },
    { id: 2061, top: 'ESPORTES',          name: 'BOLAS',                   weight: 1 },
    { id: 2076, top: 'ESPORTES',          name: 'BRINCADEIRAS AO AR LIVRE', weight: 1 },
    { id: 2081, top: 'ESPORTES',          name: 'PRAIA E PISCINA',         weight: 1 },
    { id: 797,  top: 'TECNOLOGIA',        name: 'JOGOS DE VIDEO-GAME',     weight: 1 },
    { id: 1326, top: 'TECNOLOGIA',        name: 'CONTROLES',               weight: 1 },
    { id: 2243, top: 'LIVROS E PAPELARIA', name: 'LIVROS',                 weight: 1 },
    { id: 2249, top: 'LIVROS E PAPELARIA', name: 'ALBUM DE FIGURINHAS',    weight: 1 },
    { id: 2240, top: 'LIVROS E PAPELARIA', name: 'MOCHILAS',               weight: 1 }
];

const PAGE = 50;
const CANDIDATES_PER_CATEGORY = 30;

/* The age brackets a parent actually shops by. A product usually spans several,
   so it is filed under the bracket its LOWEST band falls in, which is how a
   shelf is organised. */
const BRACKETS = [
    { id: '0-2',  label: 'Baby',       min: 0,   max: 35 },
    { id: '3-5',  label: 'Preschool',  min: 36,  max: 71 },
    { id: '6-8',  label: 'Early years', min: 72,  max: 107 },
    { id: '9-12', label: 'Tween',      min: 108, max: 155 },
    { id: '13+',  label: 'Teen',       min: 156, max: 1000 }
];

function bandToMonths(band) {
    const range = /^(\d+)\s*a\s*(\d+)\s*(meses|anos)/i.exec(band);
    if (range) {
        const low = Number(range[1]);
        const high = Number(range[2]);
        return range[3].toLowerCase() === 'meses' ? [low, high] : [low * 12, high * 12];
    }
    const from = /^A partir de\s*(\d+)/i.exec(band);
    if (from) return [Number(from[1]) * 12, 216];
    return null;
}

function bracketOf(minMonths) {
    if (minMonths === null) return 'unknown';
    for (const bracket of BRACKETS) {
        if (minMonths >= bracket.min && minMonths <= bracket.max) return bracket.id;
    }
    return '13+';
}

function csvCell(value) {
    const text = value === null || value === undefined ? '' : String(value);
    return /[",\n\r]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}

async function main() {
    const args = process.argv.slice(2);
    const sizeAt = args.indexOf('--size');
    const size = sizeAt === -1 ? 200 : Number(args[sizeAt + 1]) || 200;

    console.error('Roster target: ' + size + ' products across ' + CATEGORIES.length +
                  ' subcategories\n');

    /* Resolve each subcategory to its full path from the top of their tree. A
       leaf id queried on its own returns an empty list rather than an error,
       which reads exactly like a genuinely empty shelf, so the path is resolved
       here once and a subcategory that cannot be found is named out loud. */
    const tree = await categoryTree();
    const pathOf = new Map();
    for (const top of tree) {
        for (const child of (top.children || [])) {
            pathOf.set(Number(child.id), [Number(top.id), Number(child.id)]);
        }
    }

    const seen = new Set();
    const buckets = [];

    for (const category of CATEGORIES) {
        const path = pathOf.get(category.id);
        if (!path) {
            process.stderr.write('  ' + (category.top + ' / ' + category.name).padEnd(46) +
                                 'NOT FOUND in their tree, skipped\n');
            continue;
        }
        const picked = [];
        let from = 0;
        while (picked.length < CANDIDATES_PER_CATEGORY && from < 100) {
            const to = from + Math.min(PAGE, CANDIDATES_PER_CATEGORY) - 1;
            const rows = await productsInCategory(path, from, to);
            if (!rows.length) break;
            for (const p of rows) {
                const items = Array.isArray(p.items) ? p.items : [];
                if (!items.length) continue;
                const item = items[0];
                const sellers = Array.isArray(item.sellers) ? item.sellers : [];
                const offer = sellers.length ? (sellers[0].commertialOffer || {}) : {};
                /* No readable price, or no photograph, means it cannot be shown
                   honestly, so it never enters the roster. Omit, never invent. */
                if (typeof offer.Price !== 'number' || !(offer.Price > 0)) continue;
                if (!Array.isArray(item.images) || !item.images.length) continue;
                const key = String(p.productId);
                if (seen.has(key)) continue;
                seen.add(key);

                const raw = Array.isArray(p.Idade) ? p.Idade : (p.Idade ? [p.Idade] : []);
                const bands = raw.map(String).map(bandToMonths).filter(Boolean);
                const ageMin = bands.length ? Math.min(...bands.map((b) => b[0])) : null;

                picked.push({
                    productId: key,
                    skuId: String(item.itemId),
                    name: p.productName || '',
                    brand: p.brand || '',
                    top: category.top,
                    category: category.name,
                    bracket: bracketOf(ageMin),
                    price: offer.Price,
                    weight: category.weight
                });
            }
            from += PAGE;
        }
        buckets.push({ category: category, items: picked });
        process.stderr.write('  ' + (category.top + ' / ' + category.name).padEnd(46) +
                             picked.length + '\n');
    }

    /* Selection runs in weighted rounds. Round one takes the first product from
       every subcategory, so nothing is missing from the shelves; later rounds
       take more from the heavier subcategories, which is where substitution
       needs company. Within that, a bracket that is already well represented
       yields to one that is not, so the age spread comes out of the loop rather
       than out of luck. */
    const roster = [];
    const perBracket = {};
    const cursor = new Map();
    for (const bucket of buckets) cursor.set(bucket.category.id, 0);

    let round = 0;
    while (roster.length < size && round < 40) {
        let addedThisRound = false;
        const order = buckets.slice().sort((a, b) => {
            const aCount = roster.filter((r) => r.category === a.category.name).length;
            const bCount = roster.filter((r) => r.category === b.category.name).length;
            const aShare = aCount / a.category.weight;
            const bShare = bCount / b.category.weight;
            return aShare - bShare;
        });
        for (const bucket of order) {
            if (roster.length >= size) break;
            const at = cursor.get(bucket.category.id);
            if (at >= bucket.items.length) continue;
            /* Prefer the next candidate whose age bracket is currently thinnest,
               searching a short window so the choice stays local to this shelf. */
            let bestIndex = at;
            let bestCount = Infinity;
            for (let i = at; i < Math.min(at + 6, bucket.items.length); i += 1) {
                const count = perBracket[bucket.items[i].bracket] || 0;
                if (count < bestCount) { bestCount = count; bestIndex = i; }
            }
            const chosen = bucket.items.splice(bestIndex, 1)[0];
            roster.push(chosen);
            perBracket[chosen.bracket] = (perBracket[chosen.bracket] || 0) + 1;
            addedThisRound = true;
        }
        if (!addedThisRound) break;
        round += 1;
    }

    mkdirSync(join(ROOT, 'data'), { recursive: true });
    const header = ['productId', 'skuId', 'name', 'brand', 'top', 'category', 'bracket', 'price'];
    const lines = [header.join(',')].concat(
        roster.map((r) => header.map((h) => csvCell(r[h])).join(','))
    );
    writeFileSync(join(ROOT, 'data', 'roster-source.csv'), lines.join('\n') + '\n');

    console.error('\nRoster written: ' + roster.length + ' products\n');

    const byTop = {};
    for (const item of roster) byTop[item.top] = (byTop[item.top] || 0) + 1;
    console.error('By department');
    for (const name of Object.keys(byTop).sort()) {
        console.error('  ' + name.padEnd(22) + byTop[name]);
    }
    console.error('\nBy age bracket');
    for (const bracket of BRACKETS) {
        console.error('  ' + (bracket.id + ' ' + bracket.label).padEnd(22) +
                      (perBracket[bracket.id] || 0));
    }
    if (perBracket.unknown) console.error('  ' + 'no age stated'.padEnd(22) + perBracket.unknown);

    const byBrand = {};
    for (const item of roster) byBrand[item.brand] = (byBrand[item.brand] || 0) + 1;
    const deep = Object.entries(byBrand).filter((e) => e[1] > 2).sort((a, b) => b[1] - a[1]);
    console.error('\nBrands with substitution depth (3 or more)');
    for (const [name, count] of deep.slice(0, 18)) {
        console.error('  ' + String(name).padEnd(22) + count);
    }
}

main().catch((err) => { console.error('roster failed: ' + err.message); process.exit(1); });
