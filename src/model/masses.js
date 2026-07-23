// Standard atomic weights (g/mol) for the elements likely to appear in
// organic / biomolecular structures. Used to auto-compute bead masses by
// summing the masses of the atoms mapped into each bead.
const ELEMENT_MASS = {
    H: 1.008, He: 4.003,
    Li: 6.94, Be: 9.012, B: 10.81, C: 12.011, N: 14.007, O: 15.999, F: 18.998, Ne: 20.180,
    Na: 22.990, Mg: 24.305, Al: 26.982, Si: 28.085, P: 30.974, S: 32.06, Cl: 35.45, Ar: 39.948,
    K: 39.098, Ca: 40.078, Fe: 55.845, Co: 58.933, Ni: 58.693, Cu: 63.546, Zn: 65.38,
    Se: 78.971, Br: 79.904, I: 126.904,
};

function elementMass(element) {
    if (!element) { return 0; }
    const key = element[0].toUpperCase() + element.slice(1).toLowerCase();
    return ELEMENT_MASS[key] || 0;
}

// Sum of the atomic masses of a bead's member atoms (g/mol).
export function beadMass(bead) {
    let mass = 0;
    for (const atom of bead.atoms) {
        mass += elementMass(atom.element);
    }
    return mass;
}

// Total mass per bead (Map bead.id -> mass). Two mass-conserving steps:
//   1. Unassigned atoms' mass is spread onto the bead(s) holding their nearest
//      neighbour(s) along the molecular bond graph.
//   2. Each virtual-site bead's mass is redistributed equally to its three
//      constructor beads, then the virtual site is set to 0 (it is massless;
//      its mass must live on the beads that construct it).
// `vsites` is the topology.vsites array [{target, i, j, k}, ...].
export function computeBeadMasses(collection, structure, vsites = []) {
    const excluded = new Set(vsites.map((v) => v.target));
    const totals = new Map();
    for (const bead of collection.beads) {
        totals.set(bead.id, beadMass(bead));
    }

    if (structure) {
        // atom index -> set of bead ids containing it
        const atomBeads = new Map();
        for (const bead of collection.beads) {
            for (const atom of bead.atoms) {
                if (!atomBeads.has(atom.index)) {
                    atomBeads.set(atom.index, new Set());
                }
                atomBeads.get(atom.index).add(bead.id);
            }
        }
        const assigned = new Set(atomBeads.keys());

        const proxy = structure.getAtomProxy();
        for (let i = 0; i < structure.atomCount; i++) {
            if (assigned.has(i)) {
                continue; // assigned atoms already counted in their bead
            }
            const targets = nearestBeads(i, structure, assigned, atomBeads, excluded);
            if (targets.size === 0) {
                continue; // no reachable bead (no bonds / disconnected)
            }
            proxy.index = i;
            const share = elementMass(proxy.element) / targets.size;
            for (const bid of targets) {
                totals.set(bid, totals.get(bid) + share);
            }
        }
    }

    // Redistribute virtual-site mass to its constructors (conserves total mass).
    for (const v of vsites) {
        const m = totals.get(v.target) || 0;
        if (m === 0) {
            continue;
        }
        const share = m / 3;
        for (const c of [v.i, v.j, v.k]) {
            if (totals.has(c)) {
                totals.set(c, totals.get(c) + share);
            }
        }
        totals.set(v.target, 0);
    }
    return totals;
}

// Breadth-first search from `start` along bonds; returns the set of bead ids
// containing the nearest assigned atom(s). Atoms whose beads are all excluded
// are treated as pass-through so the search continues to a real bead.
function nearestBeads(start, structure, assigned, atomBeads, excluded) {
    const visited = new Set([start]);
    let frontier = [start];
    while (frontier.length > 0) {
        const next = [];
        const found = new Set();
        for (const idx of frontier) {
            structure.getAtomProxy(idx).eachBondedAtom((ap) => {
                const n = ap.index;
                if (visited.has(n)) {
                    return;
                }
                visited.add(n);
                if (assigned.has(n)) {
                    let real = false;
                    for (const bid of atomBeads.get(n)) {
                        if (!excluded.has(bid)) {
                            found.add(bid);
                            real = true;
                        }
                    }
                    if (!real) {
                        next.push(n); // only in excluded beads -> pass through
                    }
                } else {
                    next.push(n);
                }
            });
        }
        if (found.size > 0) {
            return found;
        }
        frontier = next;
    }
    return new Set();
}
