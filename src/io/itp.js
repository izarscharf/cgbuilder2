import { beadMass } from '../model/masses.js';
import { elasticPairs } from '../model/elastic.js';

// Generate a Martini-style GROMACS .itp from the bead mapping + topology.
// meta = { name, nrexcl }.

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

    // fast_forward groups mappable interactions by a trailing "; A_B[_C[_D]]"
    // comment of the bead names, so it can flag them automatically.
    const nameOf = (id) => {
        const b = collection.beadById(id);
        return b ? (b.name || '#' + id) : '?';
    };
    const ffComment = (...ids) => ' ; ' + ids.map(nameOf).join('_');

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

    // ---- bonds (manual + elastic net + flexible-constraint fallback) ----
    const elastic = elasticPairs(collection, topology);
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
                ].join(' ') + ffComment(b.i, b.j) + '\n';
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
            ].join(' ') + ffComment(a.i, a.j, a.k) + '\n';
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
            ].join(' ') + ffComment(d.i, d.j, d.k, d.l) + '\n';
        }
        out += '\n';
    }

    // ---- virtual sites ----
    if (topology.vsites.length > 0) {
        out += '[ virtual_sites3 ]\n';
        out += '; site    i    j    k func        a        b        c\n';
        for (const v of topology.vsites) {
            const cols = [
                String(idx(v.target)).padStart(6),
                String(idx(v.i)).padStart(4),
                String(idx(v.j)).padStart(4),
                String(idx(v.k)).padStart(4),
                String(v.func).padStart(4),
                num(v.a, 4).padStart(9),
                num(v.b, 4).padStart(9),
            ];
            // funct 4 (3out) carries an extra out-of-plane coefficient c (nm^-1);
            // funct 1 (in-plane) has only a, b.
            if (v.func === 4) { cols.push(num(v.c, 4).padStart(9)); }
            out += cols.join(' ') + '\n';
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
