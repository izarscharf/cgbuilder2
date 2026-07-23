// Bonded terms and virtual sites. Beads are referenced by their stable id
// (Bead.id), never by array position, so re-ordering/removal stays consistent.

export const DEFAULTS = {
    bondFc: 1250,
    angleFc: 25,
    dihedralFc: 10,
    dihedralMult: 1,
    elastic: { enabled: false, cutoff: 0.9, strength: 500, decay: 0 },
};

export class Topology {
    constructor() {
        this.bonds = [];       // {i, j, length, fc, func:1}
        this.constraints = []; // {i, j, length, fc, func:1} (fc used for the FLEXIBLE bond)
        this.angles = [];      // {i, j, k, angle, fc, func:2}
        this.dihedrals = [];   // {i, j, k, l, angle, fc, mult, func:1}
        this.vsites = [];      // {target, i, j, k, a, b, func:1}
        this.elastic = { ...DEFAULTS.elastic };
    }

    addBond(i, j, length) {
        this.bonds.push({ i, j, length, fc: DEFAULTS.bondFc, func: 1 });
    }

    addConstraint(i, j, length) {
        this.constraints.push({ i, j, length, fc: DEFAULTS.bondFc, func: 1 });
    }

    addAngle(i, j, k, angle) {
        this.angles.push({ i, j, k, angle, fc: DEFAULTS.angleFc, func: 2 });
    }

    addDihedral(i, j, k, l, angle) {
        this.dihedrals.push({
            i, j, k, l, angle,
            fc: DEFAULTS.dihedralFc,
            mult: DEFAULTS.dihedralMult,
            func: 1,
        });
    }

    addVsite(target, i, j, k, a, b) {
        this.vsites.push({ target, i, j, k, a, b, func: 1 });
    }

    // Drop any term that references a bead id no longer present.
    pruneMissing(existingIds) {
        const has = (id) => existingIds.has(id);
        this.bonds = this.bonds.filter((t) => has(t.i) && has(t.j));
        this.constraints = this.constraints.filter((t) => has(t.i) && has(t.j));
        this.angles = this.angles.filter((t) => has(t.i) && has(t.j) && has(t.k));
        this.dihedrals = this.dihedrals.filter(
            (t) => has(t.i) && has(t.j) && has(t.k) && has(t.l));
        this.vsites = this.vsites.filter(
            (t) => has(t.target) && has(t.i) && has(t.j) && has(t.k));
    }
}
