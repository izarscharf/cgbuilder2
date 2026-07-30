// NDX / MAP / GRO generators, ported unchanged from the original main.js.

export function generateNDX(collection) {
    let ndx = "";
    for (const bead of collection.beads) {
        ndx += "[ " + bead.name + " ]\n";
        for (const atom of bead.atoms) {
            ndx += (atom.index + 1) + " ";
        }
        ndx += "\n\n";
    }
    return ndx;
}


export function generateMap(collection, name = 'MOL', from = 'charmm') {
    const molName = (name || 'MOL').trim() || 'MOL';
    const fromFF = (from || '').trim();
    let output = "[ molecule ]\n" + molName + "\n\n";
    output += "[ from ]\n" + fromFF + "\n\n";
    output += "[ to ]\nmartini\n\n[ martini ]\n";
    for (const bead of collection.beads) {
        output += bead.name + " ";
    }
    output += "\n\n";

    // One row per atom (by its real 0-based structure index -> 1-based serial),
    // listing every bead it belongs to. Real serials keep the map re-loadable.
    const byIndex = new Map();
    for (const bead of collection.beads) {
        for (const atom of bead.atoms) {
            if (!byIndex.has(atom.index)) {
                byIndex.set(atom.index, { atomname: atom.atomname, beads: [] });
            }
            byIndex.get(atom.index).beads.push(bead.name);
        }
    }
    output += "[ atoms ]\n";
    for (const idx of [...byIndex.keys()].sort((a, b) => a - b)) {
        const entry = byIndex.get(idx);
        output += (idx + 1) + "\t" + entry.atomname;
        for (const bn of entry.beads) {
            output += "\t" + bn;
        }
        output += "\n";
    }

    return output;
}


export function generateGRO(collection, resnameOverride = '') {
    let resid;
    let resname;
    let atomname;
    let atomid;
    let x;
    let y;
    let z;
    let center;
    let override = (resnameOverride || '').trim();
    let output = "Generated with cgbuilder\n" + collection.beads.length + "\n";
    let counter = 0;
    for (const bead of collection.beads) {
        counter += 1;
        resid = String(bead.resid).padStart(5);
        atomid = String(counter).padStart(5);
        resname = (override || bead.resname).padEnd(5).substring(0, 5);
        atomname = bead.name.padStart(5).substring(0, 5);
        center = bead.center;
        x = (center.x / 10).toFixed(3).padStart(8);
        y = (center.y / 10).toFixed(3).padStart(8);
        z = (center.z / 10).toFixed(3).padStart(8);
        output += resid + resname + atomname + atomid + x + y + z + '\n';
    }
    output += "10 10 10\n";
    return output;
}

// All-atom GRO of the loaded structure (NGL positions are Angstrom -> nm).
export function generateAAGro(structure) {
    let out = 'Generated with cgbuilder (all-atom)\n';
    out += structure.atomCount + '\n';
    let n = 0;
    structure.eachAtom((atom) => {
        n += 1;
        out += String(atom.resno % 100000).padStart(5)
            + atom.resname.padEnd(5).substring(0, 5)
            + atom.atomname.padStart(5).substring(0, 5)
            + String(n % 100000).padStart(5)
            + (atom.x / 10).toFixed(3).padStart(8)
            + (atom.y / 10).toFixed(3).padStart(8)
            + (atom.z / 10).toFixed(3).padStart(8)
            + '\n';
    });
    out += '  10.00000  10.00000  10.00000\n';
    return out;
}

/* Taken from <https://ourcodeworld.com/articles/read/189/how-to-create-a-file-and-generate-a-download-with-javascript-in-the-browser-without-a-server> */
export function download(filename, text) {
    let element = document.createElement('a');
    element.setAttribute('href', 'data:text/plain;charset=utf-8,' + encodeURIComponent(text));
    element.setAttribute('download', filename);
    element.style.display = 'none';
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
}
