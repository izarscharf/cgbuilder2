import { distanceNm } from './geometry.js';

function pairKey(a, b) {
    return a < b ? a + '-' + b : b + '-' + a;
}

// Elastic-network bond pairs generated from the current beads + parameters:
// every eligible bead pair within the cutoff, skipping manual bonds and
// virtual-site beads. fc decays with distance when decay > 0. Returns
// [{ i, j, length, fc }] with bead ids and length in nm. Shared by the ITP
// generator and the 3D connectivity view so they never disagree.
export function elasticPairs(collection, topology) {
    const el = topology.elastic;
    if (!el.enabled) {
        return [];
    }
    const vsiteTargets = new Set(topology.vsites.map((v) => v.target));
    const bonded = new Set(topology.bonds.map((b) => pairKey(b.i, b.j)));
    const eligible = collection.beads.filter(
        (b) => b.atoms.length > 0 && !vsiteTargets.has(b.id));
    const result = [];
    for (let a = 0; a < eligible.length; a++) {
        for (let b = a + 1; b < eligible.length; b++) {
            const ba = eligible[a];
            const bb = eligible[b];
            if (bonded.has(pairKey(ba.id, bb.id))) {
                continue;
            }
            const d = distanceNm(ba.center, bb.center);
            if (d > el.cutoff) {
                continue;
            }
            const fc = el.decay > 0
                ? el.strength * Math.exp(-d / el.decay)
                : el.strength;
            result.push({ i: ba.id, j: bb.id, length: d, fc });
        }
    }
    return result;
}
