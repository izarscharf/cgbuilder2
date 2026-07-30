import { generateITP } from '../io/itp.js';

// Re-render the left-hand live ITP view from the current model state, unless
// the user is mid-edit (itpDirty) — then their text is left untouched.
export function updateItpPanel(controller) {
    if (controller.itpDirty) { return; }
    document.getElementById('itp-output').value =
        generateITP(controller.collection, controller.topology, controller.meta, controller.masses);
}
