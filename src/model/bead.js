import { Vector3 } from 'ngl';

export class Bead {
    constructor(id) {
        this.id = id;
        this._name = null;
        this.type = 'P4';   // Martini bead type (editable)
        this.charge = 0;
        this.atoms = [];
    }

    indexOf(atom) {
        for (let i = 0; i < this.atoms.length; i++) {
            if (this.atoms[i].index === atom.index) {
                return i;
            }
        }
        return -1;
    }

    addAtom(atom) {
        if (!this.isAtomIn(atom)) {
            this.atoms.push(atom);
        }
    }

    removeAtom(atom) {
        let atomIndex = this.indexOf(atom);
        if (atomIndex >= 0) {
            this.atoms.splice(atomIndex, 1);
        }
    }

    toggleAtom(atom) {
        if (this.isAtomIn(atom)) {
            this.removeAtom(atom);
        } else {
            this.addAtom(atom);
        }
    }

    set name(name) {
        this._name = name;
    }

    get name() {
        return this._name;
    }

    get resname() {
        if (this.atoms.length < 1) {
            return 'UNK';
        }
        return this.atoms[0].resname;
    }

    get resid() {
        if (this.atoms.length < 1) {
            return 0;
        }
        return this.atoms[0].resno;
    }

    isAtomIn(atom) {
        return this.indexOf(atom) >= 0;
    }

    // Center of geometry, in Angstrom (NGL native units).
    get center() {
        let mass = 0;
        let position = new Vector3(0, 0, 0);
        for (const atom of this.atoms) {
            mass += 1;
            position.add(atom.positionToVector3());
        }
        if (mass > 0) {
            position.divideScalar(mass);
        }
        return position;
    }
}


export class BeadCollection {
    constructor() {
        this._beads = [];
        this._current = null;
        this._largestIndex = -1;
        this._nextId = 0;
        this.newBead();
    }

    newBead() {
        let bead = new Bead(this._nextId);
        this._nextId += 1;
        this._largestIndex += 1;
        bead.name = 'B' + this._largestIndex;
        this._beads.push(bead);
        this._current = bead;
        return bead;
    }

    removeBead(index) {
        this._beads.splice(index, 1);
    }

    // Drop all beads (e.g. before importing a mapping). Bead names restart at
    // B0, but ids keep incrementing so they never collide with stale refs.
    clear() {
        this._beads = [];
        this._current = null;
        this._largestIndex = -1;
    }

    get currentBead() {
        return this._current;
    }

    get beads() {
        return this._beads;
    }

    beadById(id) {
        return this._beads.find((b) => b.id === id) || null;
    }

    selectBead(index) {
        this._current = this._beads[index];
    }

    countBeadsForAtom(atom) {
        let count = 0;
        for (const bead of this.beads) {
            if (bead.isAtomIn(atom)) {
                count += 1;
            }
        }
        return count;
    }
}
