// A single shared warning banner in the builder pane.

let timer = null;

export function showWarning(msg) {
    const el = document.getElementById('builder-warning');
    if (!el) { return; }
    el.textContent = '⚠ ' + msg;
    el.style.display = 'block';
    if (timer) { clearTimeout(timer); }
    timer = setTimeout(clearWarning, 6000);
}

export function clearWarning() {
    const el = document.getElementById('builder-warning');
    if (el) {
        el.textContent = '';
        el.style.display = 'none';
    }
}

// Returns true if none of the bead ids are virtual sites; otherwise warns and
// returns false. Virtual sites may only appear as vsite constructors, never as
// members of a bond / constraint / angle / dihedral / elastic network.
export function guardVsite(controller, ids) {
    const bad = controller.topology.vsiteConflicts(ids);
    if (bad.length === 0) { return true; }
    const names = bad.map((id) => {
        const b = controller.collection.beadById(id);
        return b ? b.name : '#' + id;
    }).join(', ');
    showWarning(`${names} is a virtual site — only its constructor beads can carry bonds, angles, dihedrals or constraints.`);
    return false;
}
