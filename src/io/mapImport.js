// Parse and apply a Martini .map mapping file (the inverse of generateMap).
// Sections: [ molecule ] [ from ] [ to ] [ martini ] [ atoms ]. The [ atoms ]
// serials are 1-based atom numbers in the all-atom structure.

function stripComment(line) {
    const i = line.indexOf(';');
    return i >= 0 ? line.slice(0, i) : line;
}

export function parseMap(text) {
    const res = { molecule: null, from: '', martini: [], atoms: [] };
    let section = null;
    for (const raw of text.split('\n')) {
        const line = stripComment(raw).trim();
        if (!line) { continue; }
        const header = line.match(/^\[\s*(.+?)\s*\]$/);
        if (header) { section = header[1].toLowerCase(); continue; }
        const tok = line.split(/\s+/);
        if (section === 'molecule') {
            if (!res.molecule) { res.molecule = tok[0]; }
        } else if (section === 'from') {
            if (!res.from) { res.from = tok[0]; }
        } else if (section === 'martini') {
            for (const t of tok) { res.martini.push(t); }
        } else if (section === 'atoms') {
            const serial = parseInt(tok[0], 10);
            if (!Number.isNaN(serial) && tok.length >= 3) {
                res.atoms.push({ serial, atomname: tok[1], beads: tok.slice(2) });
            }
        }
    }
    return res;
}

// Rebuild `collection` from a .map, resolving atom serials against `structure`.
// Returns { molecule, from, warnings }.
export function applyMap(text, collection, structure) {
    const parsed = parseMap(text);
    const warnings = [];
    collection.clear();

    const byName = new Map();
    const ensureBead = (name) => {
        if (byName.has(name)) { return byName.get(name); }
        const bead = collection.newBead();
        bead.name = name;
        byName.set(name, bead);
        return bead;
    };
    for (const name of parsed.martini) { ensureBead(name); }

    for (const a of parsed.atoms) {
        const i = a.serial - 1;
        if (i < 0 || i >= structure.atomCount) {
            warnings.push(`atom serial ${a.serial} is out of range for the loaded structure`);
            continue;
        }
        for (const name of a.beads) {
            ensureBead(name).addAtom(structure.getAtomProxy(i));
        }
    }

    if (collection.beads.length === 0) { collection.newBead(); }
    collection.selectBead(0);
    return { molecule: parsed.molecule, from: parsed.from, warnings };
}
