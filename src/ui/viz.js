import { Shape } from 'ngl';

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
}
