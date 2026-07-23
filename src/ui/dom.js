// Tiny DOM helpers shared by the builder panels.

export function el(tag, props = {}, children = []) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
        if (k === 'class') {
            node.className = v;
        } else if (k === 'text') {
            node.textContent = v;
        } else if (k.startsWith('on') && typeof v === 'function') {
            node.addEventListener(k.slice(2).toLowerCase(), v);
        } else if (v !== null && v !== undefined) {
            node.setAttribute(k, v);
        }
    }
    for (const child of [].concat(children)) {
        if (child != null) {
            node.appendChild(typeof child === 'string'
                ? document.createTextNode(child) : child);
        }
    }
    return node;
}

export function clear(node) {
    while (node.lastChild) {
        node.removeChild(node.lastChild);
    }
}

// A <select> listing every bead by name, value = bead id.
export function beadSelect(collection, selectedId) {
    const sel = el('select', { class: 'bead-select' });
    for (const bead of collection.beads) {
        const opt = el('option', { value: bead.id, text: bead.name || ('#' + bead.id) });
        if (bead.id === selectedId) {
            opt.selected = true;
        }
        sel.appendChild(opt);
    }
    return sel;
}

// A labelled number input that writes back to obj[key] and calls onChange.
export function numberField(label, obj, key, step, onChange) {
    const input = el('input', {
        type: 'number',
        step: String(step),
        value: String(obj[key]),
        class: 'num',
        oninput: (e) => {
            const v = parseFloat(e.target.value);
            if (!Number.isNaN(v)) {
                obj[key] = v;
                onChange();
            }
        },
    });
    return el('label', { class: 'field' }, [label + ' ', input]);
}
