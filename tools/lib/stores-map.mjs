/* ============================================================================
   Turning Ri Happy's pickup store NAMES into stable store IDs.

   Their simulation endpoint answers with names as a human reads them, such as
   "Ri Happy Shopping Villa Lobos" or "PBKIDS IGUATEMI JK - Loja Parceira".
   Everything downstream, the geofence cluster, the push deeplink, the storefront
   badge, needs one stable identifier per store instead, or the same shop appears
   under three spellings and the scenes contradict each other.

   THE RULE THAT MATTERS: a name we do not recognise is reported and dropped, it
   is never guessed into an id. A guessed store puts a toy on a shelf that may not
   hold it, which is the one mistake this whole demo exists to argue against.
   ========================================================================== */

/** Lowercase, strip accents and punctuation, collapse spaces. */
export function normalise(name) {
    return String(name || '')
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/-\s*loja\s+parceira\s*$/, '')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

/**
 * Build a lookup from a curated store list.
 * Every store contributes its canonical name plus any aliases it declares.
 */
export function indexOf(stores) {
    const index = new Map();
    for (const store of stores) {
        const keys = [store.name].concat(store.aliases || []);
        for (const key of keys) {
            const norm = normalise(key);
            if (norm) index.set(norm, store.store_id);
        }
    }
    return index;
}

/**
 * Map a list of VTEX pickup names to canonical ids.
 * Returns the ids it resolved and the names it could not, separately, so the
 * caller can report the unknowns rather than silently losing them.
 */
export function resolve(names, index) {
    const ids = [];
    const unknown = [];
    for (const name of names || []) {
        const id = index.get(normalise(name));
        if (!id) { unknown.push(name); continue; }
        if (ids.indexOf(id) === -1) ids.push(id);
    }
    return { ids, unknown };
}
