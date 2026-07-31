// Parse a Martini .itp back into structured data, and apply it to the model.
// This is the inverse of generateITP and powers "Apply to model", "Load .itp",
// and project loading. Indices in the returned data are 1-based ITP numbers.

function stripComment(line) {
    const i = line.indexOf(';');
    return i >= 0 ? line.slice(0, i) : line;
}

const int = (s) => parseInt(s, 10);
const flt = (s) => parseFloat(s);

export function parseItp(text) {
    const res = {
        meta: { name: null, nrexcl: null },
        atoms: [], bonds: [], constraints: [], angles: [], dihedrals: [], vsites: [],
    };
    let section = null;
    let skip = false; // inside a "#ifdef FLEXIBLE" block (the flexible-bond duplicates)

    for (const raw of text.split('\n')) {
        const line = stripComment(raw).trim();
        if (!line) { continue; }

        if (line[0] === '#') {
            const d = line.toLowerCase();
            if (d.startsWith('#ifdef flexible')) { skip = true; }
            else if (d.startsWith('#ifndef flexible')) { skip = false; }
            else if (d.startsWith('#else')) { skip = !skip; }
            else if (d.startsWith('#endif')) { skip = false; }
            continue; // other preprocessor directives are ignored
        }
        if (skip) { continue; }

        const header = line.match(/^\[\s*(.+?)\s*\]$/);
        if (header) { section = header[1].toLowerCase(); continue; }

        const t = line.split(/\s+/);
        switch (section) {
            case 'moleculetype':
                res.meta.name = t[0];
                res.meta.nrexcl = int(t[1]);
                break;
            case 'atoms':
                res.atoms.push({
                    nr: int(t[0]), type: t[1], resnr: int(t[2]), resname: t[3],
                    atomname: t[4], charge: t.length > 6 ? flt(t[6]) : 0,
                    mass: t.length > 7 ? flt(t[7]) : null,
                });
                break;
            case 'bonds':
                res.bonds.push({ i: int(t[0]), j: int(t[1]), func: int(t[2]) || 1, length: flt(t[3]), fc: flt(t[4]) });
                break;
            case 'constraints':
                res.constraints.push({ i: int(t[0]), j: int(t[1]), func: int(t[2]) || 1, length: flt(t[3]) });
                break;
            case 'angles':
                res.angles.push({ i: int(t[0]), j: int(t[1]), k: int(t[2]), func: int(t[3]) || 2, angle: flt(t[4]), fc: flt(t[5]) });
                break;
            case 'dihedrals':
                res.dihedrals.push({
                    i: int(t[0]), j: int(t[1]), k: int(t[2]), l: int(t[3]),
                    func: int(t[4]) || 1, angle: flt(t[5]), fc: flt(t[6]),
                    mult: t.length > 7 ? int(t[7]) : 1,
                });
                break;
            case 'virtual_sites3': {
                const func = int(t[4]) || 1;
                res.vsites.push({ target: int(t[0]), i: int(t[1]), j: int(t[2]), k: int(t[3]), func, a: flt(t[5]), b: flt(t[6]), c: func === 4 ? flt(t[7]) : 0 });
                break;
            }
            default:
                break; // exclusions etc. are derived, not parsed back
        }
    }
    return res;
}

// Apply parsed ITP data to the live model. Bead identity is by ITP order
// (nr N -> collection.beads[N-1]). Bonded terms are rebuilt; the elastic
// generator is turned off (bonds are now explicit). Returns { warnings }.
export function applyItp(parsed, collection, topology, meta) {
    const warnings = [];

    if (parsed.meta.name) { meta.name = parsed.meta.name; }
    if (Number.isFinite(parsed.meta.nrexcl)) { meta.nrexcl = parsed.meta.nrexcl; }

    // Ensure a bead exists for every [atoms] row (create empty beads if the
    // model has none, e.g. loading a bare .itp with no structure/map).
    if (collection.beads.length === 0 && parsed.atoms.length > 0) {
        for (let n = 0; n < parsed.atoms.length; n++) { collection.newBead(); }
    }
    if (parsed.atoms.length === collection.beads.length) {
        const resnames = new Set();
        parsed.atoms.forEach((a, idx) => {
            const bead = collection.beads[idx];
            bead.name = a.atomname;
            if (a.type) { bead.type = a.type; }
            bead.charge = Number.isFinite(a.charge) ? a.charge : 0;
            if (a.resname) { resnames.add(a.resname); }
        });
        if (resnames.size === 1) { meta.resname = [...resnames][0]; }
    } else if (parsed.atoms.length > 0) {
        warnings.push(`[ atoms ] has ${parsed.atoms.length} rows but the model has ${collection.beads.length} beads; bead types/charges not updated.`);
    }

    const beadId = (nr) => {
        const bead = collection.beads[nr - 1];
        return bead ? bead.id : null;
    };
    const mapTerm = (t, keys) => {
        const out = { ...t };
        for (const key of keys) {
            const id = beadId(t[key]);
            if (id === null) { return null; }
            out[key] = id;
        }
        return out;
    };

    let dropped = 0;
    topology.bonds = [];
    topology.constraints = [];
    topology.angles = [];
    topology.dihedrals = [];
    topology.vsites = [];

    for (const b of parsed.bonds) {
        const m = mapTerm(b, ['i', 'j']);
        if (m) { topology.bonds.push({ i: m.i, j: m.j, length: b.length, fc: b.fc, func: b.func }); } else { dropped++; }
    }
    for (const c of parsed.constraints) {
        const m = mapTerm(c, ['i', 'j']);
        if (m) { topology.constraints.push({ i: m.i, j: m.j, length: c.length, fc: 1250, func: c.func }); } else { dropped++; }
    }
    for (const a of parsed.angles) {
        const m = mapTerm(a, ['i', 'j', 'k']);
        if (m) { topology.angles.push({ i: m.i, j: m.j, k: m.k, angle: a.angle, fc: a.fc, func: a.func }); } else { dropped++; }
    }
    for (const d of parsed.dihedrals) {
        const m = mapTerm(d, ['i', 'j', 'k', 'l']);
        if (m) { topology.dihedrals.push({ i: m.i, j: m.j, k: m.k, l: m.l, angle: d.angle, fc: d.fc, mult: d.mult, func: d.func }); } else { dropped++; }
    }
    for (const v of parsed.vsites) {
        const m = mapTerm(v, ['target', 'i', 'j', 'k']);
        if (m) { topology.vsites.push({ target: m.target, i: m.i, j: m.j, k: m.k, a: v.a, b: v.b, c: v.c || 0, func: v.func }); } else { dropped++; }
    }

    topology.elastic.enabled = false; // bonds are explicit after an ITP load
    if (dropped > 0) { warnings.push(`${dropped} term(s) referenced an out-of-range bead and were skipped.`); }
    return { warnings };
}
