import { Shape, Vector3 } from 'ngl';
import { elasticPairs } from '../model/elastic.js';

// Owns the 3D scene: the ball+stick highlight of the current bead's atoms,
// atom-name labels, and the coarse-grained sphere overlay. Atom picking
// toggles atoms into the current bead and notifies the controller via onChange.
export class Visualization {
    constructor(stage, collection, topology) {
        this.stage = stage;
        this.collection = collection;
        this.topology = topology;
        this.atomRep = null;        // base all-atom ball+stick
        this.representation = null; // highlighted atoms of the current bead
        this.aaLabels = null;
        this.aaLabelsWanted = true;
        this.shapeComp = null;
        this.showCG = false;        // overlay CG spheres opaque on top of atoms
        this.cgOnly = false;        // hide atoms, show only CG beads + labels
        this.vsHighlight = new Set(); // bead ids to draw red (interactive VS build)
        this.connComp = null;         // connectivity overlay (bonds/angles/…)
        this.show = { bonds: false, constraints: false, elastic: false, angles: false, dihedrals: false, vsites: false, vsEdges: false };
        this.onChange = () => {};   // set by the controller
        this.onBeadClick = null;    // set by the controller; (beadId) => void
    }

    get currentBead() {
        return this.collection.currentBead;
    }

    attach(component) {
        this.atomRep = component.addRepresentation("ball+stick");
        this.representation = component.addRepresentation("ball+stick", {
            sele: "not all",
            radiusScale: 1.6,
            color: "#f4b642",
            opacity: 0.6,
        });
        this.aaLabels = component.addRepresentation("label", {
            labelType: "atomname",
        });
    }

    selectionString(bead) {
        if (bead.atoms.length > 0) {
            let sel = "@";
            for (let i = 0; i < bead.atoms.length; i++) {
                if (sel !== '@') {
                    sel = sel + ',';
                }
                sel = sel + bead.atoms[i].index;
            }
            return sel;
        }
        return "not all";
    }

    refreshSelection() {
        this.representation.setSelection(this.selectionString(this.currentBead));
        this.drawCG();
        this.drawConnectivity();
    }

    // Toggle 3D display of a connectivity type ('bonds'|'constraints'|'elastic'|
    // 'angles'|'dihedrals'). Returns the new state.
    setShow(type, value) {
        this.show[type] = value;
        this.drawConnectivity();
        return value;
    }

    onClick(pickingProxy) {
        // Bead sphere clicked (CG-only view): its name encodes the bead id.
        // Restricted to CG-only so faded spheres never hijack atom mapping.
        if (pickingProxy && pickingProxy.sphere && this.cgOnly && this.onBeadClick) {
            const id = parseInt(pickingProxy.sphere.name, 10);
            if (!Number.isNaN(id)) {
                this.onBeadClick(id);
                return;
            }
        }
        // Atom clicked: toggle it into the current bead.
        if (pickingProxy && pickingProxy.atom) {
            this.currentBead.toggleAtom(pickingProxy.atom);
            this.refreshSelection();
            this.onChange();
        }
    }

    // Returns the new visibility so the caller can update the button label.
    toggleAALabels() {
        this.aaLabelsWanted = !this.aaLabelsWanted;
        this.aaLabels.setVisibility(this.aaLabelsWanted && !this.cgOnly);
        return this.aaLabelsWanted;
    }

    toggleCG() {
        this.showCG = !this.showCG;
        this.drawCG();
    }

    // CG-only mode: hide the all-atom view and show just the CG beads, with
    // per-bead name/number labels and VS-constructor beads coloured red.
    setCGOnly(value) {
        this.cgOnly = value;
        this.atomRep.setVisibility(!value);
        this.representation.setVisibility(!value);
        this.aaLabels.setVisibility(!value && this.aaLabelsWanted);
        this.drawCG();
        return value;
    }

    drawCG() {
        let normalColor = [0.58, 0.79, 0.66];
        let selectedColor = [0.25, 0.84, 0.96];
        let constructorColor = [0.90, 0.20, 0.20];
        let labelColor = [1, 1, 1];
        let opacity = (this.showCG || this.cgOnly) ? 1 : 0.2;
        if (this.shapeComp != null) {
            this.stage.removeComponent(this.shapeComp);
        }
        // Beads used as virtual-site constructors, drawn red in CG views.
        let constructors = new Set();
        for (const v of this.topology.vsites) {
            constructors.add(v.i);
            constructors.add(v.j);
            constructors.add(v.k);
        }
        let shape = new Shape("shape");
        this.collection.beads.forEach((bead, i) => {
            if (bead.atoms.length === 0) {
                return;
            }
            let color = normalColor;
            if (bead === this.currentBead) {
                color = selectedColor;
            }
            if (constructors.has(bead.id) || this.vsHighlight.has(bead.id)) {
                color = constructorColor;
            }
            // Name encodes the bead id so picking can map back to the bead.
            shape.addSphere(bead.center, color, 1.12, String(bead.id));
            if (this.cgOnly) {
                shape.addText(bead.center, labelColor, 2.0, `${bead.name}  #${i + 1}`);
            }
        });
        this.shapeComp = this.stage.addComponentFromObject(shape);
        this.shapeComp.addRepresentation("buffer", { opacity: opacity });
    }

    // Overlay of the bonded topology between bead centres: cylinders for
    // bonds/constraints/elastic-network, and arcs (with the θ/φ value) for
    // angles/dihedrals. Each type is toggled independently via this.show.
    drawConnectivity() {
        if (this.connComp != null) {
            this.stage.removeComponent(this.connComp);
            this.connComp = null;
        }
        const s = this.show;
        if (!(s.bonds || s.constraints || s.elastic || s.angles || s.dihedrals || s.vsites || s.vsEdges)) {
            return;
        }
        const t = this.topology;
        const center = (id) => {
            const b = this.collection.beadById(id);
            return b ? b.center : null;
        };
        const bondColor = [0.20, 0.50, 0.90];
        const constrColor = [0.95, 0.60, 0.10];
        const enColor = [0.55, 0.55, 0.55];
        const angColor = [0.30, 0.80, 0.45];
        const dihColor = [0.80, 0.35, 0.85];
        const vsLineColor = [0.60, 0.25, 0.85];   // constructor -> virtual site
        const vsEdgeColor = [0.90, 0.30, 0.20];   // rigid frame among constructors
        const en = s.elastic ? elasticPairs(this.collection, t) : [];

        const nothing = !(
            (s.bonds && t.bonds.length) ||
            (s.constraints && t.constraints.length) ||
            (s.angles && t.angles.length) ||
            (s.dihedrals && t.dihedrals.length) ||
            ((s.vsites || s.vsEdges) && t.vsites.length) ||
            en.length);
        if (nothing) { return; }

        const shape = new Shape("connectivity");
        if (s.bonds) {
            for (const b of t.bonds) { addCyl(shape, center(b.i), center(b.j), bondColor, 0.15); }
        }
        if (s.constraints) {
            for (const c of t.constraints) { addCyl(shape, center(c.i), center(c.j), constrColor, 0.15); }
        }
        for (const e of en) { addCyl(shape, center(e.i), center(e.j), enColor, 0.05); }
        if (s.angles) {
            for (const a of t.angles) { drawAngle(shape, center(a.i), center(a.j), center(a.k), a.angle, angColor); }
        }
        if (s.dihedrals) {
            for (const d of t.dihedrals) { drawDihedral(shape, center(d.i), center(d.j), center(d.k), center(d.l), d.angle, dihColor); }
        }
        // Virtual sites: lines from each constructor to the constructed site,
        // and (optionally) the rigid triangle edges among the three constructors.
        if (s.vsites) {
            for (const v of t.vsites) {
                const target = center(v.target);
                for (const cid of [v.i, v.j, v.k]) { addCyl(shape, center(cid), target, vsLineColor, 0.06); }
            }
        }
        if (s.vsEdges) {
            for (const v of t.vsites) {
                addCyl(shape, center(v.i), center(v.j), vsEdgeColor, 0.10);
                addCyl(shape, center(v.j), center(v.k), vsEdgeColor, 0.10);
                addCyl(shape, center(v.k), center(v.i), vsEdgeColor, 0.10);
            }
        }

        this.connComp = this.stage.addComponentFromObject(shape);
        this.connComp.addRepresentation("buffer", {});
    }
}

function addCyl(shape, p, q, color, radius) {
    if (p && q) { shape.addCylinder(p, q, color, radius, ''); }
}

// Draw an arc from direction dirA to dirB around `center`, returning its
// midpoint (for a label). Approximated with short cylinder segments.
function addArc(shape, center, dirA, dirB, radius, color) {
    const a = dirA.clone().normalize();
    const b = dirB.clone().normalize();
    const cos = Math.min(1, Math.max(-1, a.dot(b)));
    const theta = Math.acos(cos);
    const w = b.clone().addScaledVector(a, -a.dot(b));
    if (w.length() < 1e-6) { return null; }
    w.normalize();
    const seg = 20;
    let prev = null;
    let mid = null;
    for (let i = 0; i <= seg; i++) {
        const t = theta * i / seg;
        const p = center.clone()
            .addScaledVector(a, radius * Math.cos(t))
            .addScaledVector(w, radius * Math.sin(t));
        if (prev) { shape.addCylinder(prev, p, color, 0.04, ''); }
        if (i === Math.floor(seg / 2)) { mid = p.clone(); }
        prev = p;
    }
    return mid;
}

function drawAngle(shape, pi, pj, pk, theta, color) {
    if (!pi || !pj || !pk) { return; }
    shape.addCylinder(pi, pj, color, 0.08, '');
    shape.addCylinder(pj, pk, color, 0.08, '');
    const dirA = new Vector3().subVectors(pi, pj);
    const dirB = new Vector3().subVectors(pk, pj);
    const mid = addArc(shape, pj, dirA, dirB, 2.0, color);
    if (mid) { shape.addText(mid, [1, 1, 1], 1.6, theta.toFixed(0) + '°'); }
}

function drawDihedral(shape, pi, pj, pk, pl, phi, color) {
    if (!pi || !pj || !pk || !pl) { return; }
    shape.addCylinder(pi, pj, color, 0.08, '');
    shape.addCylinder(pj, pk, color, 0.08, '');
    shape.addCylinder(pk, pl, color, 0.08, '');
    const axis = new Vector3().subVectors(pk, pj).normalize();
    const mid = new Vector3().addVectors(pj, pk).multiplyScalar(0.5);
    const va = new Vector3().subVectors(pi, pj);
    va.addScaledVector(axis, -va.dot(axis));
    const vb = new Vector3().subVectors(pl, pk);
    vb.addScaledVector(axis, -vb.dot(axis));
    const arcMid = addArc(shape, mid, va, vb, 2.0, color);
    if (arcMid) { shape.addText(arcMid, [1, 1, 1], 1.6, phi.toFixed(0) + '°'); }
}
