import { el, clear, beadSelect, numberField } from './dom.js';
import { distanceNm, angleDeg, dihedralDeg, chooseVsite3 } from '../model/geometry.js';
import { guardVsite, showWarning } from './notify.js';

function nameOf(controller, id) {
    const b = controller.collection.beadById(id);
    return b ? (b.name || '#' + id) : '?';
}

function centerOf(controller, id) {
    return controller.collection.beadById(id).center;
}

function labelWrap(text, node) {
    return el('label', { class: 'field' }, [text + ' ', node]);
}

// Nth bead id if it exists, for sensible default selections.
function defaultId(controller, n) {
    const beads = controller.collection.beads;
    return beads[Math.min(n, beads.length - 1)].id;
}

// Per-panel memory of the selected bead in each dropdown slot, so a rebuild
// (e.g. after clicking "Add") restores the user's choices instead of resetting.
const selMemory = {};

function memoSelect(controller, key, slot, fallbackN) {
    const collection = controller.collection;
    const remembered = (selMemory[key] || [])[slot];
    const selectedId = (remembered != null && collection.beadById(remembered) != null)
        ? remembered
        : defaultId(controller, fallbackN);
    const sel = beadSelect(collection, selectedId);
    if (!selMemory[key]) { selMemory[key] = []; }
    selMemory[key][slot] = +sel.value;
    sel.addEventListener('change', () => { selMemory[key][slot] = +sel.value; });
    return sel;
}

function removeRow(controller, arr, idx) {
    arr.splice(idx, 1);
    controller.refresh();
}

// ---------------- Bonds ----------------
export function renderBondPanel(controller) {
    const { topology } = controller;
    renderTermInteractive(controller, 'bond-interactive', 'bond', 2);
    const builder = document.getElementById('bond-builder');
    clear(builder);
    const s1 = memoSelect(controller, 'bond', 0, 0);
    const s2 = memoSelect(controller, 'bond', 1, 1);
    const add = el('button', {
        text: 'Add bond',
        onclick: () => {
            const i = +s1.value, j = +s2.value;
            if (i === j || !guardVsite(controller, [i, j])) { return; }
            topology.addBond(i, j, distanceNm(centerOf(controller, i), centerOf(controller, j)));
            controller.refresh();
        },
    });
    builder.append(labelWrap('i', s1), labelWrap('j', s2), add);

    const list = document.getElementById('bond-list');
    clear(list);
    topology.bonds.forEach((b, idx) => {
        list.appendChild(el('li', { class: 'term-row' }, [
            el('span', { class: 'term-label', text: `${nameOf(controller, b.i)}—${nameOf(controller, b.j)}` }),
            numberField('len(nm)', b, 'length', 0.001, controller.syncOutputs),
            numberField('fc', b, 'fc', 10, controller.syncOutputs),
            el('button', { class: 'remove', text: 'X', onclick: () => removeRow(controller, topology.bonds, idx) }),
        ]));
    });
}

// ---------------- Constraints ----------------
export function renderConstraintPanel(controller) {
    const { topology } = controller;
    renderTermInteractive(controller, 'constraint-interactive', 'constraint', 2);
    const builder = document.getElementById('constraint-builder');
    clear(builder);
    const s1 = memoSelect(controller, 'constraint', 0, 0);
    const s2 = memoSelect(controller, 'constraint', 1, 1);
    const add = el('button', {
        text: 'Add constraint',
        onclick: () => {
            const i = +s1.value, j = +s2.value;
            if (i === j || !guardVsite(controller, [i, j])) { return; }
            topology.addConstraint(i, j, distanceNm(centerOf(controller, i), centerOf(controller, j)));
            controller.refresh();
        },
    });
    builder.append(labelWrap('i', s1), labelWrap('j', s2), add);

    const list = document.getElementById('constraint-list');
    clear(list);
    topology.constraints.forEach((c, idx) => {
        list.appendChild(el('li', { class: 'term-row' }, [
            el('span', { class: 'term-label', text: `${nameOf(controller, c.i)}—${nameOf(controller, c.j)}` }),
            numberField('len(nm)', c, 'length', 0.001, controller.syncOutputs),
            numberField('fc(flex)', c, 'fc', 10, controller.syncOutputs),
            el('button', { class: 'remove', text: 'X', onclick: () => removeRow(controller, topology.constraints, idx) }),
        ]));
    });
}

// ---------------- Angles ----------------
export function renderAnglePanel(controller) {
    const { topology } = controller;
    renderTermInteractive(controller, 'angle-interactive', 'angle', 3);
    const builder = document.getElementById('angle-builder');
    clear(builder);
    const s1 = memoSelect(controller, 'angle', 0, 0);
    const s2 = memoSelect(controller, 'angle', 1, 1);
    const s3 = memoSelect(controller, 'angle', 2, 2);
    const add = el('button', {
        text: 'Add angle',
        onclick: () => {
            const i = +s1.value, j = +s2.value, k = +s3.value;
            if (i === j || j === k || i === k || !guardVsite(controller, [i, j, k])) { return; }
            const a = angleDeg(centerOf(controller, i), centerOf(controller, j), centerOf(controller, k));
            topology.addAngle(i, j, k, a);
            controller.refresh();
        },
    });
    builder.append(labelWrap('i', s1), labelWrap('j', s2), labelWrap('k', s3), add);

    const list = document.getElementById('angle-list');
    clear(list);
    topology.angles.forEach((a, idx) => {
        list.appendChild(el('li', { class: 'term-row' }, [
            el('span', { class: 'term-label', text: `${nameOf(controller, a.i)}-${nameOf(controller, a.j)}-${nameOf(controller, a.k)}` }),
            numberField('θ(°)', a, 'angle', 1, controller.syncOutputs),
            numberField('fc', a, 'fc', 5, controller.syncOutputs),
            el('button', { class: 'remove', text: 'X', onclick: () => removeRow(controller, topology.angles, idx) }),
        ]));
    });
}

// ---------------- Dihedrals ----------------
export function renderDihedralPanel(controller) {
    const { topology } = controller;
    renderTermInteractive(controller, 'dihedral-interactive', 'dihedral', 4);
    const builder = document.getElementById('dihedral-builder');
    clear(builder);
    const s = [0, 1, 2, 3].map((n) => memoSelect(controller, 'dihedral', n, n));
    const add = el('button', {
        text: 'Add dihedral',
        onclick: () => {
            const [i, j, k, l] = s.map((x) => +x.value);
            if (new Set([i, j, k, l]).size < 4 || !guardVsite(controller, [i, j, k, l])) { return; }
            const a = dihedralDeg(centerOf(controller, i), centerOf(controller, j),
                centerOf(controller, k), centerOf(controller, l));
            topology.addDihedral(i, j, k, l, a);
            controller.refresh();
        },
    });
    builder.append(labelWrap('i', s[0]), labelWrap('j', s[1]),
        labelWrap('k', s[2]), labelWrap('l', s[3]), add);

    const list = document.getElementById('dihedral-list');
    clear(list);
    topology.dihedrals.forEach((d, idx) => {
        list.appendChild(el('li', { class: 'term-row' }, [
            el('span', { class: 'term-label', text: `${nameOf(controller, d.i)}-${nameOf(controller, d.j)}-${nameOf(controller, d.k)}-${nameOf(controller, d.l)}` }),
            numberField('φ(°)', d, 'angle', 1, controller.syncOutputs),
            numberField('fc', d, 'fc', 1, controller.syncOutputs),
            numberField('mult', d, 'mult', 1, controller.syncOutputs),
            el('button', { class: 'remove', text: 'X', onclick: () => removeRow(controller, topology.dihedrals, idx) }),
        ]));
    });
}

// Interactive term builder for bonds/angles/dihedrals: click `arity` beads in
// the CG view (in order) and the term is added automatically.
function renderTermInteractive(controller, hostId, termType, arity) {
    const host = document.getElementById(hostId);
    clear(host);
    const p = controller.pick;
    if (p.mode === 'term' && p.termType === termType) {
        const picked = p.selected.map((id) => nameOf(controller, id)).join(' - ') || 'none';
        host.append(
            el('p', { class: 'vs-status', text: `Click ${arity} beads in order in the CG view (click again to deselect). Picked: ${picked}` }),
            el('button', { text: 'Stop picking', onclick: () => controller.resetPick() }),
        );
    } else {
        host.append(
            el('button', { text: `Pick ${termType} in 3D`, onclick: () => controller.startTermPick(termType, arity) }),
        );
    }
}

// Interactive VS builder: click beads in the CG view to pick a constructor
// triad, then click beads to virtualize from it.
function renderVsiteInteractive(controller) {
    const host = document.getElementById('vsite-interactive');
    clear(host);
    const p = controller.pick;

    if (p.mode === 'vs-constructors') {
        const chosen = p.selected.map((id) => nameOf(controller, id)).join(', ') || 'none';
        host.append(
            el('p', { class: 'vs-status', text: `Click 3 beads in the CG view (they turn red). Selected: ${chosen}` }),
            el('button', {
                text: 'Select as constructors',
                disabled: p.selected.length === 3 ? null : 'disabled',
                onclick: () => controller.confirmVsConstructors(),
            }),
            el('button', { text: 'Cancel', onclick: () => controller.resetPick() }),
        );
    } else if (p.mode === 'vs-targets') {
        const tri = p.constructors.map((id) => nameOf(controller, id)).join(', ');
        host.append(
            el('p', { class: 'vs-status', text: `Constructors: ${tri} (red). Click beads in the CG view to virtualize them from this triad.` }),
            el('button', { text: 'Select new VS constructors', onclick: () => controller.startVsConstructors() }),
        );
    } else {
        host.append(
            el('p', { class: 'hint', text: 'Interactive: build virtual sites by clicking beads in the CG view.' }),
            el('button', { text: 'Select VS constructors', onclick: () => controller.startVsConstructors() }),
        );
    }
}

// ---------------- Virtual sites ----------------
export function renderVsitePanel(controller) {
    const { topology } = controller;
    renderVsiteInteractive(controller);
    const builder = document.getElementById('vsite-builder');
    clear(builder);
    const target = memoSelect(controller, 'vsite', 0, 0);
    const c1 = memoSelect(controller, 'vsite', 1, 1);
    const c2 = memoSelect(controller, 'vsite', 2, 2);
    const c3 = memoSelect(controller, 'vsite', 3, 3);
    const add = el('button', {
        text: 'Add virtual site',
        onclick: () => {
            const t = +target.value, i = +c1.value, j = +c2.value, k = +c3.value;
            if (new Set([t, i, j, k]).size < 4) { return; }
            const r = chooseVsite3(centerOf(controller, t),
                centerOf(controller, i), centerOf(controller, j), centerOf(controller, k));
            if (r.error) { showWarning(r.error); return; }
            topology.addVsite(t, i, j, k, r.a, r.b, r.func, r.c);
            controller.refresh();
        },
    });
    builder.append(labelWrap('site', target),
        labelWrap('c1', c1), labelWrap('c2', c2), labelWrap('c3', c3), add);

    const list = document.getElementById('vsite-list');
    clear(list);
    topology.vsites.forEach((v, idx) => {
        const row = [
            el('span', { class: 'term-label', text: `${nameOf(controller, v.target)} = f(${nameOf(controller, v.i)},${nameOf(controller, v.j)},${nameOf(controller, v.k)})` }),
            el('span', { class: 'term-func', text: v.func === 4 ? '3out' : 'in-plane' }),
            numberField('a', v, 'a', 0.01, controller.syncOutputs),
            numberField('b', v, 'b', 0.01, controller.syncOutputs),
        ];
        if (v.func === 4) { row.push(numberField('c', v, 'c', 0.01, controller.syncOutputs)); }
        row.push(el('button', { class: 'remove', text: 'X', onclick: () => removeRow(controller, topology.vsites, idx) }));
        list.appendChild(el('li', { class: 'term-row' }, row));
    });
}
