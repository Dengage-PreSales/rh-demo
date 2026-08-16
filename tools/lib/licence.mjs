/* ============================================================================
   Which franchise a toy belongs to.

   This is the single most important signal in the whole demo, because it is the
   first rung of the substitution ladder: a child who asked for LEGO wants LEGO,
   and offering them a jigsaw at the same price is how a substitution feature
   loses an argument in front of executives.

   TWO THINGS THIS GETS RIGHT THAT THE OBVIOUS APPROACH GETS WRONG.

   It reads the product NAME, not the merchandising clusters. Clusters looked
   promising because some of them are named after franchises, but they are
   campaign lists first: the LEGO Speed Champions set carries "Blocos de Montar",
   "Mais Vendidos" and "Dia das Criancas 2026" and never once says LEGO. Names
   say it every time, because that is what a shopper searches for.

   It separates FRANCHISE from MANUFACTURER, and only franchise counts. Mattel
   makes Barbie, Hot Wheels, UNO, Polly Pocket and Jurassic World masks. Treating
   Mattel as a licence offers a pack of UNO to somebody who wanted a baby
   teether, which was exactly what the first version of this file did.

   A product with no recognised franchise gets null, and the substitution rule
   falls through to age and shelf. Null is a real answer here. Guessing is not.
   ========================================================================== */

/* Ordered longest first within each entry so "LEGO Creator" is preferred over
   "LEGO". Portuguese and English spellings both appear in their catalogue, and
   the accents vary, so matching is done on a stripped form. */
const FRANCHISES = [
    { name: 'LEGO',              match: ['lego'] },
    { name: 'Barbie',            match: ['barbie'] },
    { name: 'Hot Wheels',        match: ['hot wheels', 'hot whells'] },
    { name: 'Pokemon',           match: ['pokemon'] },
    { name: 'Homem Aranha',      match: ['homem aranha', 'spidey', 'spider man'] },
    { name: 'Marvel',            match: ['marvel', 'avengers', 'vingadores', 'hulk', 'homem de ferro'] },
    { name: 'Star Wars',         match: ['star wars', 'sabre de luz'] },
    { name: 'Harry Potter',      match: ['harry potter'] },
    { name: 'Disney',            match: ['disney', 'frozen', 'minnie', 'mickey', 'stitch', 'encanto'] },
    { name: 'Toy Story',         match: ['toy story'] },
    { name: 'Cars',              match: ['relampago mcqueen', 'carros disney', 'pixar cars'] },
    { name: 'Nerf',              match: ['nerf'] },
    { name: 'Play-Doh',          match: ['play doh', 'playdoh'] },
    { name: 'Baby Alive',        match: ['baby alive'] },
    { name: 'Polly Pocket',      match: ['polly pocket'] },
    { name: 'Patrulha Canina',   match: ['patrulha canina', 'paw patrol'] },
    { name: 'Peppa Pig',         match: ['peppa'] },
    { name: 'Sonic',             match: ['sonic'] },
    { name: 'Furby',             match: ['furby'] },
    { name: 'Jurassic World',    match: ['jurassic'] },
    { name: 'Funko Pop',         match: ['funko'] },
    { name: 'Hello Kitty',       match: ['hello kitty', 'sanrio'] },
    { name: 'UNO',               match: ['uno'] },
    { name: 'Minecraft',         match: ['minecraft'] },
    { name: 'Roblox',            match: ['roblox'] },
    { name: 'Naruto',            match: ['naruto'] },
    { name: 'Gabby Dollhouse',   match: ['casa magica da gabby', "gabby's dollhouse", 'gabbys dollhouse'] },
    { name: 'Sylvanian Families', match: ['sylvanian'] },
    { name: 'Mini Brands',       match: ['mini brands'] },
    { name: 'Batman',            match: ['batman'] },
    { name: 'Super Mario',       match: ['super mario', 'mario bros'] },
    { name: 'Fifa',              match: ['fifa', 'copa do mundo'] },
    { name: 'Maria Clara e JP',  match: ['maria clara'] },
    { name: 'Turma da Monica',   match: ['turma da monica'] },
    { name: 'Galinha Pintadinha', match: ['galinha pintadinha'] },
    { name: 'Luccas Neto',       match: ['luccas neto'] },
    { name: 'Sortimentos Nintendo', match: ['nintendo'] }
];

/** Lowercase, strip accents, collapse punctuation. */
function flatten(text) {
    return String(text || '')
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

/**
 * The franchise a product belongs to, or null.
 *
 * `extra` lets the caller widen the haystack, normally with the brand, so
 * "Sabre de Luz Black Series Ahsoka Tano" still finds Star Wars.
 */
export function licenceOf(name, extra) {
    const hay = flatten(name + ' ' + (extra || ''));
    /* Word boundaries matter: without them "uno" matches "Bruno" and every
       Portuguese word ending in that sound, which put UNO on a dozen unrelated
       toys the first time this ran. */
    for (const franchise of FRANCHISES) {
        for (const needle of franchise.match) {
            const token = flatten(needle);
            const pattern = new RegExp('(^| )' + token.replace(/ /g, ' ') + '( |$)');
            if (pattern.test(hay)) return franchise.name;
        }
    }
    return null;
}

export const FRANCHISE_NAMES = FRANCHISES.map((f) => f.name);
