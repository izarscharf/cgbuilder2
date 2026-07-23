import { generateITP } from '../io/itp.js';

// Re-render the left-hand live ITP preview from the current model state.
export function updateItpPanel(controller) {
    document.getElementById('itp-output').textContent =
        generateITP(controller.collection, controller.topology, controller.meta, controller.masses);
}
