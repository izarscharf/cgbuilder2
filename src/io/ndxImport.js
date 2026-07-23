// Import a cgbuilder-style GROMACS .ndx file to rebuild a bead mapping onto an
// already-loaded structure. Each `[ name ]` group lists the 1-based atom
// indices belonging to that bead (the inverse of generateNDX in legacy.js).

export function parseNdx(text) {
    const groups = [];
    let current = null;
    for (const rawLine of text.split('\n')) {
        const line = rawLine.trim();
        if (!line || line.startsWith(';') || line.startsWith('#')) {
            continue;
        }
        const header = line.match(/^\[\s*(.+?)\s*\]$/);
        if (header) {
            current = { name: header[1], indices: [] };
            groups.push(current);
            continue;
        }
        if (current) {
            for (const tok of line.split(/\s+/)) {
                const n = parseInt(tok, 10);
                if (!Number.isNaN(n)) {
                    current.indices.push(n);
                }
            }
        }
    }
    return groups;
}

// Rebuild `collection` from the ndx text, resolving atom indices against
// `structure`. Bonded terms in `topology` are pruned (bead ids change, so the
// old mapping's terms no longer apply). Returns the number of beads created.
export function applyNdx(text, collection, topology, structure) {
    const groups = parseNdx(text);
    collection.clear();
    for (const group of groups) {
        const bead = collection.newBead();
        if (group.name) {
            bead.name = group.name;
        }
        for (const idx1 of group.indices) {
            const i = idx1 - 1;
            if (i >= 0 && i < structure.atomCount) {
                bead.addAtom(structure.getAtomProxy(i));
            }
        }
    }
    if (collection.beads.length === 0) {
        collection.newBead();
    }
    collection.selectBead(0);
    topology.pruneMissing(new Set(collection.beads.map((b) => b.id)));
    return groups.length;
}
