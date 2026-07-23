import { distanceNm } from '../model/geometry.js';
import { beadMass } from '../model/masses.js';

// Generate a Martini-style GROMACS .itp from the bead mapping + topology.
// meta = { name, nrexcl }.

function pairKey(a, b) {
    return a < b ? a + '-' + b : b + '-' + a;
}

function num(x, decimals) {
    return Number(x).toFixed(decimals);
}

export function generateITP(collection, topology, meta, masses) {
    const beads = collection.beads;
    if (beads.length === 0) {
        return '; No beads defined yet.';
    }

    // Stable bead id -> 1-based ITP index (matches [atoms] ordering).
    const nr = new Map();
    beads.forEach((b, idx) => nr.set(b.id, idx + 1));
    const idx = (id) => nr.get(id);

    const name = (meta.name || 'MOL').trim() || 'MOL';
    const nrexcl = Number.isFinite(meta.nrexcl) ? meta.nrexcl : 1;
    // Global residue-name override; blank keeps each bead's structure resname.
    const resnameOverride = (meta.resname || '').trim();

    let out = '';
    out += '[ moleculetype ]\n';
    out += '; name  nrexcl\n';
    out += `${name}  ${nrexcl}\n\n`;

    // Set of bead ids that are virtual sites: excluded from the elastic net
    // and given mass 0 (their mass is carried by the constructing beads).
    const vsiteTargets = new Set(topology.vsites.map((v) => v.target));

    // ---- atoms ----
    out += '[ atoms ]\n';
    out += ';  nr  type  resnr  residue  atom  cgnr  charge     mass\n';
    beads.forEach((bead, i) => {
        const resnr = bead.resid > 0 ? bead.resid : 1;
        const total = masses ? masses.get(bead.id) : beadMass(bead);
        const mass = vsiteTargets.has(bead.id) ? 0 : total;
        out += [
            String(i + 1).padStart(4),
            (bead.type || 'P4').padEnd(6),
            String(resnr).padStart(5),
            (resnameOverride || bead.resname).padEnd(6),
            (bead.name || '').padEnd(6),
            String(i + 1).padStart(4),
            num(bead.charge || 0, 3).padStart(8),
            num(mass, 3).padStart(9),
        ].join(' ') + '\n';
    });
    out += '\n';
    // Manual-bond pairs, so the elastic net does not duplicate them.
    const bondedPairs = new Set(topology.bonds.map((b) => pairKey(b.i, b.j)));

    // ---- bonds (manual + elastic net + flexible-constraint fallback) ----
    const elastic = generateElastic(beads, topology, vsiteTargets, bondedPairs);
    const constraints = topology.constraints;
    if (topology.bonds.length > 0 || elastic.length > 0 || constraints.length > 0) {
        out += '[ bonds ]\n';
        if (topology.bonds.length > 0) {
            out += ';   i    j func   length     fc\n';
            for (const b of topology.bonds) {
                out += [
                    String(idx(b.i)).padStart(4),
                    String(idx(b.j)).padStart(4),
                    String(b.func).padStart(4),
                    num(b.length, 4).padStart(9),
                    num(b.fc, 1).padStart(9),
                ].join(' ') + '\n';
            }
        }
        if (elastic.length > 0) {
            out += '; elastic network\n';
            for (const e of elastic) {
                out += [
                    String(idx(e.i)).padStart(4),
                    String(idx(e.j)).padStart(4),
                    '   6',
                    num(e.length, 4).padStart(9),
                    num(e.fc, 1).padStart(9),
                ].join(' ') + '\n';
            }
        }
        if (constraints.length > 0) {
            // Constraints become flexible bonds when the model is built with -DFLEXIBLE.
            out += '; constraints as flexible bonds\n';
            out += '#ifdef FLEXIBLE\n';
            for (const c of constraints) {
                out += [
                    String(idx(c.i)).padStart(4),
                    String(idx(c.j)).padStart(4),
                    String(c.func).padStart(4),
                    num(c.length, 4).padStart(9),
                    num(c.fc, 1).padStart(9),
                ].join(' ') + '\n';
            }
            out += '#endif\n';
        }
        out += '\n';
    }

    // ---- constraints (rigid by default, disabled when -DFLEXIBLE) ----
    if (constraints.length > 0) {
        out += '[ constraints ]\n';
        out += '#ifndef FLEXIBLE\n';
        out += ';   i    j func   length\n';
        for (const c of constraints) {
            out += [
                String(idx(c.i)).padStart(4),
                String(idx(c.j)).padStart(4),
                String(c.func).padStart(4),
                num(c.length, 4).padStart(9),
            ].join(' ') + '\n';
        }
        out += '#endif\n\n';
    }

    // ---- angles ----
    if (topology.angles.length > 0) {
        out += '[ angles ]\n';
        out += ';   i    j    k func    angle     fc\n';
        for (const a of topology.angles) {
            out += [
                String(idx(a.i)).padStart(4),
                String(idx(a.j)).padStart(4),
                String(idx(a.k)).padStart(4),
                String(a.func).padStart(4),
                num(a.angle, 2).padStart(9),
                num(a.fc, 1).padStart(9),
            ].join(' ') + '\n';
        }
        out += '\n';
    }

    // ---- dihedrals ----
    if (topology.dihedrals.length > 0) {
        out += '[ dihedrals ]\n';
        out += ';   i    j    k    l func    angle     fc mult\n';
        for (const d of topology.dihedrals) {
            out += [
                String(idx(d.i)).padStart(4),
                String(idx(d.j)).padStart(4),
                String(idx(d.k)).padStart(4),
                String(idx(d.l)).padStart(4),
                String(d.func).padStart(4),
                num(d.angle, 2).padStart(9),
                num(d.fc, 1).padStart(9),
                String(d.mult).padStart(4),
            ].join(' ') + '\n';
        }
        out += '\n';
    }

    // ---- virtual sites ----
    if (topology.vsites.length > 0) {
        out += '[ virtual_sites3 ]\n';
        out += '; site    i    j    k func        a        b\n';
        for (const v of topology.vsites) {
            out += [
                String(idx(v.target)).padStart(6),
                String(idx(v.i)).padStart(4),
                String(idx(v.j)).padStart(4),
                String(idx(v.k)).padStart(4),
                String(v.func).padStart(4),
                num(v.a, 4).padStart(9),
                num(v.b, 4).padStart(9),
            ].join(' ') + '\n';
        }
        out += '\n';

        // ---- exclusions: keep each vsite from interacting with its builders ----
        out += generateExclusions(topology.vsites, idx);
    }

    return out;
}

// Aggregated, de-duplicated [ exclusions ]. Each virtual site is excluded from
// its three constructors; pairs are listed once, grouped by the lower index,
// e.g. "   2    5    7" means atom 2 is excluded from atoms 5 and 7.
function generateExclusions(vsites, idx) {
    const excl = new Map(); // owner index -> Set of partner indices (owner < partner)
    const addPair = (a, b) => {
        if (a === b) { return; }
        const lo = Math.min(a, b);
        const hi = Math.max(a, b);
        if (!excl.has(lo)) { excl.set(lo, new Set()); }
        excl.get(lo).add(hi);
    };
    for (const v of vsites) {
        const t = idx(v.target);
        addPair(t, idx(v.i));
        addPair(t, idx(v.j));
        addPair(t, idx(v.k));
    }
    if (excl.size === 0) {
        return '';
    }
    let out = '[ exclusions ]\n';
    out += ';  ai   aj ...\n';
    for (const owner of [...excl.keys()].sort((a, b) => a - b)) {
        const partners = [...excl.get(owner)].sort((a, b) => a - b);
        out += [owner, ...partners].map((n) => String(n).padStart(4)).join(' ') + '\n';
    }
    out += '\n';
    return out;
}


// Build elastic-network bonds (GROMACS func 6) between all bead pairs whose
// centers are within `cutoff` nm. Force constant optionally decays with
// distance: fc = strength * exp(-dist / decay).
function generateElastic(beads, topology, vsiteTargets, bondedPairs) {
    const el = topology.elastic;
    if (!el.enabled) {
        return [];
    }
    const eligible = beads.filter(
        (b) => b.atoms.length > 0 && !vsiteTargets.has(b.id));
    const result = [];
    for (let a = 0; a < eligible.length; a++) {
        for (let b = a + 1; b < eligible.length; b++) {
            const ba = eligible[a];
            const bb = eligible[b];
            if (bondedPairs.has(pairKey(ba.id, bb.id))) {
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
