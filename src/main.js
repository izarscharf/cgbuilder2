import { Stage } from 'ngl';
import { BeadCollection } from './model/bead.js';
import { Topology } from './model/topology.js';
import { Visualization } from './ui/viz.js';
import { renderBeadPanel } from './ui/beadPanel.js';
import {
    renderBondPanel, renderConstraintPanel, renderAnglePanel, renderDihedralPanel, renderVsitePanel,
} from './ui/bondedPanels.js';
import { renderElasticPanel } from './ui/elasticPanel.js';
import { updateItpPanel } from './ui/itpPanel.js';
import { generateITP } from './io/itp.js';
import { guardVsite } from './ui/notify.js';
import { computeBeadMasses } from './model/masses.js';
import { vsite3Params, distanceNm, angleDeg, dihedralDeg } from './model/geometry.js';
import { generateNDX, generateMap, generateGRO, generateAAGro, download } from './io/legacy.js';
import { smilesToMolfile, molfileBlob } from './io/loaders.js';
import { applyNdx } from './io/ndxImport.js';
import { applyMap } from './io/mapImport.js';
import { parseItp, applyItp } from './io/itpParse.js';
import { buildProject, parseProject } from './io/project.js';
import { showWarning } from './ui/notify.js';

// The single active model/view, rebuilt each time a molecule is loaded.
let controller = null;

function makeController(component, stage) {
    const collection = new BeadCollection();
    const topology = new Topology();
    const viz = new Visualization(stage, collection, topology);
    viz.attach(component);

    // Prefill the residue-name field from the loaded structure.
    if (component.structure.atomCount > 0) {
        document.getElementById('mol-resname').value =
            component.structure.getAtomProxy(0).resname || 'MOL';
    }

    const ctrl = {
        collection,
        topology,
        viz,
        structure: component.structure, // used for index lookup + bond-graph mass spread
        masses: new Map(),              // bead.id -> total mass (incl. spread of unassigned atoms)
        itpDirty: false,                // true while the user is editing the ITP text
        // Interactive click-to-pick state, shared by all builders (driven by
        // clicks on bead spheres in the CG view).
        //   mode: 'idle' | 'vs-constructors' | 'vs-targets' | 'term'
        pick: { mode: 'idle', selected: [], constructors: null, termType: null, arity: 0 },
        recomputeMasses() {
            this.masses = computeBeadMasses(this.collection, this.structure, this.topology.vsites);
        },
        // --- Virtual sites: pick 3 constructors, then click targets ---
        startVsConstructors() {
            this.pick = { mode: 'vs-constructors', selected: [], constructors: null, termType: null, arity: 3 };
            this.viz.vsHighlight = new Set();
            enterCGOnly(this.viz);
            this.refresh();
        },
        confirmVsConstructors() {
            if (this.pick.mode !== 'vs-constructors' || this.pick.selected.length !== 3) { return; }
            this.pick.constructors = [...this.pick.selected];
            this.pick.mode = 'vs-targets';
            this.pick.selected = [];
            this.viz.vsHighlight = new Set(this.pick.constructors);
            this.refresh();
        },
        // --- Bonds/angles/dihedrals: click `arity` beads in order to add a term ---
        startTermPick(termType, arity) {
            this.pick = { mode: 'term', selected: [], constructors: null, termType, arity };
            this.viz.vsHighlight = new Set();
            enterCGOnly(this.viz);
            this.refresh();
        },
        resetPick() {
            this.pick = { mode: 'idle', selected: [], constructors: null, termType: null, arity: 0 };
            this.viz.vsHighlight = new Set();
            this.refresh();
        },
        // A bead sphere was clicked in the CG view.
        onBeadClick(id) {
            const p = this.pick;
            const center = (x) => this.collection.beadById(x).center;
            if (p.mode === 'vs-constructors') {
                const at = p.selected.indexOf(id);
                if (at >= 0) { p.selected.splice(at, 1); }
                else if (p.selected.length < 3) { p.selected.push(id); }
                this.viz.vsHighlight = new Set(p.selected);
                this.refresh();
            } else if (p.mode === 'vs-targets') {
                if (p.constructors.includes(id)) { return; }        // can't virtualize a constructor
                if (this.topology.vsites.some((v) => v.target === id)) { return; } // already a vsite
                const [i, j, k] = p.constructors;
                const { a, b } = vsite3Params(center(id), center(i), center(j), center(k));
                this.topology.addVsite(id, i, j, k, a, b);
                this.refresh();
            } else if (p.mode === 'term') {
                if (this.topology.isVsiteTarget(id)) {
                    guardVsite(this, [id]);   // warn: vsites can't carry bonded terms
                    return;
                }
                const at = p.selected.indexOf(id);
                if (at >= 0) { p.selected.splice(at, 1); }        // click again to deselect
                else { p.selected.push(id); }
                if (p.selected.length === p.arity) {
                    addTerm(this.topology, p.termType, p.selected, center);
                    p.selected = [];                              // ready for the next term
                }
                this.viz.vsHighlight = new Set(p.selected);
                this.refresh();
            }
            // idle: bead clicks do nothing
        },
        meta: {
            name: document.getElementById('mol-name').value || 'MOL',
            resname: document.getElementById('mol-resname').value,
            nrexcl: parseInt(document.getElementById('mol-nrexcl').value, 10) || 1,
            mapFrom: document.getElementById('map-from').value,
        },
        // Value edits: refresh outputs + 3D without rebuilding panels (keeps focus).
        syncOutputs() {
            this.recomputeMasses();
            viz.refreshSelection();
            updateItpPanel(this);
            updateLegacyOutputs(this);
        },
        // Structural changes: rebuild every panel, then sync outputs.
        refresh() {
            this.recomputeMasses();
            renderBeadPanel(this);
            renderBondPanel(this);
            renderConstraintPanel(this);
            renderAnglePanel(this);
            renderDihedralPanel(this);
            renderVsitePanel(this);
            renderElasticPanel(this);
            this.syncOutputs();
        },
    };

    viz.onChange = () => ctrl.refresh(); // atom picked -> bead atom lists change
    viz.onBeadClick = (id) => ctrl.onBeadClick(id); // bead sphere picked in CG view
    stage.signals.clicked.add((pp) => viz.onClick(pp));
    return ctrl;
}

// Switch into CG-only view (so bead spheres are clickable) and sync the button.
function enterCGOnly(viz) {
    if (!viz.cgOnly) {
        viz.setCGOnly(true);
        const btn = document.getElementById('cg-only');
        if (btn) { btn.textContent = 'Show atoms'; }
    }
}

// Create a bonded term from an ordered list of picked bead ids, measuring its
// geometry from the current bead centers.
function addTerm(topology, termType, ids, center) {
    if (termType === 'bond') {
        const [i, j] = ids;
        topology.addBond(i, j, distanceNm(center(i), center(j)));
    } else if (termType === 'constraint') {
        const [i, j] = ids;
        topology.addConstraint(i, j, distanceNm(center(i), center(j)));
    } else if (termType === 'angle') {
        const [i, j, k] = ids;
        topology.addAngle(i, j, k, angleDeg(center(i), center(j), center(k)));
    } else if (termType === 'dihedral') {
        const [i, j, k, l] = ids;
        topology.addDihedral(i, j, k, l, dihedralDeg(center(i), center(j), center(k), center(l)));
    }
}

// Push controller.meta back into the header input fields (after Apply / load).
function syncMetaInputs(ctrl) {
    document.getElementById('mol-name').value = ctrl.meta.name || '';
    document.getElementById('mol-resname').value = ctrl.meta.resname || '';
    document.getElementById('mol-nrexcl').value = String(ctrl.meta.nrexcl);
    document.getElementById('map-from').value = ctrl.meta.mapFrom || '';
}

function updateLegacyOutputs(ctrl) {
    document.getElementById('ndx-output').textContent = generateNDX(ctrl.collection);
    document.getElementById('map-output').textContent = generateMap(ctrl.collection, ctrl.meta.name, ctrl.meta.mapFrom);
    document.getElementById('gro-output').textContent = generateGRO(ctrl.collection, ctrl.meta.resname);
}

function loadInput(input, stage, params, after) {
    stage.removeAllComponents();
    stage.signals.clicked.removeAll();
    return stage.loadFile(input, params).then((component) => {
        component.autoView();
        controller = makeController(component, stage);
        enableControls();
        if (after) { after(controller); }
        controller.refresh();
    });
}

// Restore a full session from a .cgb2proj bundle: load the structure, rebuild
// beads from the embedded map, then apply the embedded itp (types + topology).
function loadProject(text, stage) {
    const proj = parseProject(text);
    const blob = new Blob([proj.structure], { type: 'text/plain' });
    return loadInput(blob, stage, { ext: proj.structureExt || 'gro', name: proj.meta.name || 'project' }, (ctrl) => {
        if (proj.map) { applyMap(proj.map, ctrl.collection, ctrl.structure); }
        if (proj.itp) { applyItp(parseItp(proj.itp), ctrl.collection, ctrl.topology, ctrl.meta); }
        if (proj.meta.name != null) { ctrl.meta.name = proj.meta.name; }
        if (proj.meta.resname != null) { ctrl.meta.resname = proj.meta.resname; }
        if (Number.isFinite(proj.meta.nrexcl)) { ctrl.meta.nrexcl = proj.meta.nrexcl; }
        if (proj.meta.mapFrom != null) { ctrl.meta.mapFrom = proj.meta.mapFrom; }
        ctrl.topology.pruneMissing(new Set(ctrl.collection.beads.map((b) => b.id)));
        syncMetaInputs(ctrl);
    }).catch((err) => showWarning('Project load failed: ' + err.message));
}

function enableControls() {
    for (const b of document.querySelectorAll('.new-bead, .toggle-aa-labels, #toggle-cg, #cg-only, #ndx-select, #map-select, #itp-select')) {
        b.disabled = false;
    }
}

function setupTabs() {
    const buttons = document.querySelectorAll('.tab-btn');
    for (const btn of buttons) {
        btn.addEventListener('click', () => {
            const tab = btn.dataset.tab;
            for (const b of buttons) {
                b.classList.toggle('active', b === btn);
            }
            for (const p of document.querySelectorAll('.tab-panel')) {
                p.classList.toggle('active', p.dataset.tab === tab);
            }
            // Cancel any in-progress bead-picking when leaving its tab.
            if (controller && controller.pick.mode !== 'idle') {
                controller.resetPick();
            }
        });
    }
}

function setupStaticControls(stage) {
    // Molecule file input.
    document.getElementById('mol-select').addEventListener('change', (e) => {
        if (e.target.files[0]) {
            loadInput(e.target.files[0], stage);
        }
    });

    // Read a chosen file as text and hand it to `handler`.
    const onFileText = (id, handler) => {
        document.getElementById(id).addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) { return; }
            const reader = new FileReader();
            reader.onload = () => handler(reader.result);
            reader.readAsText(file);
            e.target.value = ''; // allow re-uploading the same file
        });
    };

    // NDX mapping import (requires a loaded structure to resolve atom indices).
    onFileText('ndx-select', (text) => {
        if (!controller) { return; }
        applyNdx(text, controller.collection, controller.topology, controller.structure);
        controller.refresh();
    });

    // MAP import: rebuild beads from the mapping (layered on a loaded structure).
    onFileText('map-select', (text) => {
        if (!controller) { return; }
        const res = applyMap(text, controller.collection, controller.structure);
        controller.topology.pruneMissing(new Set(controller.collection.beads.map((b) => b.id)));
        if (res.molecule) { controller.meta.name = res.molecule; }
        if (res.from) { controller.meta.mapFrom = res.from; }
        syncMetaInputs(controller);
        controller.refresh();
        if (res.warnings.length) { showWarning(res.warnings.join(' ')); }
    });

    // ITP import: set bead types/charges + rebuild topology from the itp.
    onFileText('itp-select', (text) => {
        if (!controller) { return; }
        const res = applyItp(parseItp(text), controller.collection, controller.topology, controller.meta);
        controller.itpDirty = false;
        syncMetaInputs(controller);
        controller.refresh();
        if (res.warnings.length) { showWarning(res.warnings.join(' ')); }
    });

    // Project bundle: load restores everything; save stitches it together.
    onFileText('proj-select', (text) => loadProject(text, stage));
    document.getElementById('dl-proj').addEventListener('click', () => {
        if (!controller) { return; }
        const name = (controller.meta.name || 'model').trim() || 'model';
        const bundle = buildProject(
            controller.meta,
            generateAAGro(controller.structure),
            generateNDX(controller.collection),
            generateMap(controller.collection, controller.meta.name, controller.meta.mapFrom),
            generateITP(controller.collection, controller.topology, controller.meta, controller.masses));
        download(name + '.cgb2proj', bundle);
    });

    // SMILES input.
    document.getElementById('smiles-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const status = document.getElementById('smiles-status');
        const smiles = document.getElementById('smiles-input').value.trim();
        if (!smiles) { return; }
        status.textContent = 'Generating 3D…';
        try {
            const molfile = await smilesToMolfile(smiles);
            await loadInput(molfileBlob(molfile), stage, { ext: 'mol', name: smiles });
            status.textContent = '';
        } catch (err) {
            status.textContent = 'SMILES error: ' + err.message;
        }
    });

    // New bead.
    for (const b of document.querySelectorAll('.new-bead')) {
        b.addEventListener('click', () => {
            if (!controller) { return; }
            controller.collection.newBead();
            controller.refresh();
        });
    }

    // Toggle atom-name labels.
    for (const b of document.querySelectorAll('.toggle-aa-labels')) {
        b.addEventListener('click', () => {
            if (!controller) { return; }
            const visible = controller.viz.toggleAALabels();
            b.textContent = visible ? 'Hide labels' : 'Show labels';
        });
    }

    // Toggle CG opacity.
    document.getElementById('toggle-cg').addEventListener('click', () => {
        if (controller) { controller.viz.toggleCG(); }
    });

    // CG-only view: hide atoms, show labelled beads (VS constructors in red).
    document.getElementById('cg-only').addEventListener('click', (e) => {
        if (!controller) { return; }
        const on = controller.viz.setCGOnly(!controller.viz.cgOnly);
        e.target.textContent = on ? 'Show atoms' : 'CG only view';
    });

    // Per-type connectivity visibility toggles (one 'show' box per builder tab).
    for (const [id, type] of [
        ['show-bonds', 'bonds'], ['show-constraints', 'constraints'],
        ['show-angles', 'angles'], ['show-dihedrals', 'dihedrals'],
        ['show-elastic', 'elastic'],
        ['show-vsites', 'vsites'], ['show-vs-edges', 'vsEdges'],
    ]) {
        document.getElementById(id).addEventListener('change', (e) => {
            if (controller) { controller.viz.setShow(type, e.target.checked); }
        });
    }

    // moleculetype meta inputs.
    document.getElementById('mol-name').addEventListener('input', (e) => {
        if (!controller) { return; }
        controller.meta.name = e.target.value;
        updateItpPanel(controller);
        updateLegacyOutputs(controller); // .map [ molecule ] uses this name
    });
    document.getElementById('map-from').addEventListener('input', (e) => {
        if (!controller) { return; }
        controller.meta.mapFrom = e.target.value;
        updateLegacyOutputs(controller);
    });
    document.getElementById('mol-resname').addEventListener('input', (e) => {
        if (!controller) { return; }
        controller.meta.resname = e.target.value;
        updateItpPanel(controller);
        updateLegacyOutputs(controller);
    });
    document.getElementById('mol-nrexcl').addEventListener('input', (e) => {
        if (!controller) { return; }
        const v = parseInt(e.target.value, 10);
        controller.meta.nrexcl = Number.isNaN(v) ? 0 : v;
        updateItpPanel(controller);
    });

    // Editable ITP: mark dirty on edit; Apply parses it back into the model.
    const itpStatus = (msg, bad) => {
        const el = document.getElementById('itp-status');
        el.textContent = msg;
        el.style.color = bad ? '#c0392b' : '#2a2';
    };
    document.getElementById('itp-output').addEventListener('input', () => {
        if (!controller) { return; }
        controller.itpDirty = true;
        itpStatus('edited — click Apply to update the model', false);
    });
    document.getElementById('itp-revert').addEventListener('click', () => {
        if (!controller) { return; }
        controller.itpDirty = false;
        updateItpPanel(controller);
        itpStatus('', false);
    });
    document.getElementById('itp-apply').addEventListener('click', () => {
        if (!controller) { return; }
        let parsed;
        try {
            parsed = parseItp(document.getElementById('itp-output').value);
        } catch (err) {
            itpStatus('Parse error: ' + err.message, true);
            return;
        }
        const res = applyItp(parsed, controller.collection, controller.topology, controller.meta);
        controller.itpDirty = false;
        syncMetaInputs(controller);
        controller.refresh();
        if (res.warnings.length) {
            itpStatus('Applied with warnings', true);
            showWarning(res.warnings.join(' '));
        } else {
            itpStatus('Applied ✓', false);
        }
    });

    // Download buttons.
    const dl = (id, fn, ext) => document.getElementById(id).addEventListener('click', () => {
        if (controller) { download('cgbuilder' + ext, fn(controller)); }
    });
    document.getElementById('dl-itp').addEventListener('click', () => {
        if (!controller) { return; }
        const name = (controller.meta.name || 'cgbuilder').trim() || 'cgbuilder';
        download(name + '.itp', generateITP(controller.collection, controller.topology, controller.meta, controller.masses));
    });
    dl('dl-ndx', (c) => generateNDX(c.collection), '.ndx');
    dl('dl-map', (c) => generateMap(c.collection, c.meta.name, c.meta.mapFrom), '.map');
    dl('dl-gro', (c) => generateGRO(c.collection, c.meta.resname), '.gro');
    dl('dl-aa-gro', (c) => generateAAGro(c.structure), '_aa.gro');
    document.getElementById('dl-itp-file').addEventListener('click', () => {
        if (!controller) { return; }
        const name = (controller.meta.name || 'cgbuilder').trim() || 'cgbuilder';
        download(name + '.itp', generateITP(controller.collection, controller.topology, controller.meta, controller.masses));
    });
}

function main() {
    // Prevent the page from scrolling while zooming inside the viewer.
    const stageContainer = document.getElementById('viewport');
    window.addEventListener('wheel', (event) => {
        if (stageContainer.contains(event.target)) {
            event.preventDefault();
        }
    }, { passive: false });

    const stage = new Stage('viewport');
    window.addEventListener('resize', () => stage.handleResize(), false);

    // Left click no longer recenters the view; we use it to pick atoms.
    stage.mouseControls.remove('clickPick-left');

    setupTabs();
    setupStaticControls(stage);
}

window.addEventListener('load', main);
