import { el, clear, numberField } from './dom.js';

// Elastic network controls: enable toggle + cutoff / strength / decay.
// The bonds themselves are generated on the fly in generateITP; here we only
// edit the parameters, so value edits call syncOutputs (no panel rebuild).
export function renderElasticPanel(controller) {
    const host = document.getElementById('elastic-controls');
    clear(host);
    const e = controller.topology.elastic;

    const toggle = el('input', {
        type: 'checkbox',
        onchange: (ev) => { e.enabled = ev.target.checked; controller.syncOutputs(); },
    });
    toggle.checked = e.enabled;

    host.append(
        el('label', { class: 'field' }, [toggle, ' Enable elastic network']),
        numberField('cutoff (nm)', e, 'cutoff', 0.05, controller.syncOutputs),
        numberField('strength (fc)', e, 'strength', 50, controller.syncOutputs),
        numberField('decay (nm, 0 = constant)', e, 'decay', 0.1, controller.syncOutputs),
        el('p', { class: 'hint', text: 'Adds func-6 bonds between every bead pair within the cutoff. With decay > 0, fc = strength · exp(−dist/decay). Virtual-site beads are excluded.' }),
    );
}
