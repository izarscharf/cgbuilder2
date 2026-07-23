import { el, clear } from './dom.js';
import { beadMass } from '../model/masses.js';

// Renders the bead list: per bead a remove button, name/type/charge inputs,
// and the list of member atoms (with a shared-atom marker). Clicking a bead
// (outside its inputs) selects it as the current bead.
export function renderBeadPanel(controller) {
    const list = document.getElementById('bead-list');
    clear(list);
    for (const bead of controller.collection.beads) {
        list.appendChild(beadItem(controller, bead));
    }
}

function beadItem(controller, bead) {
    const { collection } = controller;

    const removeBtn = el('button', {
        class: 'remove', text: 'X',
        onclick: () => removeBead(controller, bead),
    });

    const nameInput = el('input', {
        type: 'text', value: bead.name || '', class: 'bead-name',
        oninput: (e) => { bead.name = e.target.value; controller.syncOutputs(); },
    });

    const typeInput = el('input', {
        type: 'text', value: bead.type, class: 'bead-type', title: 'Martini bead type',
        oninput: (e) => { bead.type = e.target.value; controller.syncOutputs(); },
    });

    const chargeInput = el('input', {
        type: 'number', step: '0.1', value: String(bead.charge), class: 'bead-charge',
        title: 'charge',
        oninput: (e) => {
            const v = parseFloat(e.target.value);
            bead.charge = Number.isNaN(v) ? 0 : v;
            controller.syncOutputs();
        },
    });

    const isVsite = controller.topology.vsites.some((v) => v.target === bead.id);
    const mass = isVsite ? 0 : (controller.masses.get(bead.id) ?? beadMass(bead));
    const massTag = el('span', {
        class: 'bead-mass',
        title: 'auto-computed mass: member atoms + spread of unassigned neighbours',
        text: 'm ' + mass.toFixed(2),
    });

    const header = el('div', { class: 'bead-header' }, [
        removeBtn, nameInput,
        el('label', { class: 'field' }, ['type ', typeInput]),
        el('label', { class: 'field' }, ['q ', chargeInput]),
        massTag,
    ]);

    const atomList = el('ul', { class: 'atom-list' });
    for (const atom of bead.atoms) {
        const li = el('li', { text: atom.atomname });
        if (collection.countBeadsForAtom(atom) > 1) {
            li.appendChild(el('abbr',
                { title: 'This atom is shared between multiple beads.', text: ' 🔗' }));
        }
        atomList.appendChild(li);
    }

    const item = el('li', {
        class: 'bead-view',
        onclick: (e) => {
            const tag = e.target.tagName;
            if (tag === 'INPUT' || tag === 'BUTTON' || tag === 'SELECT') {
                return;
            }
            collection.selectBead(collection.beads.indexOf(bead));
            controller.refresh();
        },
    }, [header, atomList]);

    if (bead === collection.currentBead) {
        item.classList.add('selected-bead');
    }
    return item;
}

function removeBead(controller, bead) {
    const c = controller.collection;
    const idx = c.beads.indexOf(bead);
    const wasCurrent = (c.currentBead === bead);
    c.removeBead(idx);
    if (c.beads.length === 0) {
        c.newBead();
    }
    if (wasCurrent) {
        c.selectBead(0);
    }
    controller.topology.pruneMissing(new Set(c.beads.map((b) => b.id)));
    controller.refresh();
}
