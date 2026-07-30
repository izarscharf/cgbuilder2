// A .cgb2proj project file simply stitches the all-atom structure, ndx, map,
// and itp together with delimiter lines, preceded by a small meta header, so it
// can be parsed back to fully restore a session.

const DELIM = (name) => `@@@CGB2 ${name}@@@`;

export function buildProject(meta, structure, ndx, map, itp) {
    let s = 'CGB2PROJ 1\n';
    s += '[ meta ]\n';
    s += `name ${meta.name || ''}\n`;
    s += `resname ${meta.resname || ''}\n`;
    s += `nrexcl ${meta.nrexcl}\n`;
    s += `mapFrom ${meta.mapFrom || ''}\n`;
    s += 'structureExt gro\n';
    s += DELIM('STRUCTURE') + '\n' + structure + '\n';
    s += DELIM('NDX') + '\n' + ndx + '\n';
    s += DELIM('MAP') + '\n' + map + '\n';
    s += DELIM('ITP') + '\n' + itp + '\n';
    return s;
}

export function parseProject(text) {
    const proj = { meta: {}, structure: '', structureExt: 'gro', ndx: '', map: '', itp: '' };
    const buf = { STRUCTURE: [], NDX: [], MAP: [], ITP: [] };
    let section = 'header';
    for (const line of text.split('\n')) {
        const m = line.match(/^@@@CGB2 (\w+)@@@$/);
        if (m) { section = m[1]; continue; }
        if (section === 'header') {
            const hm = line.match(/^(name|resname|nrexcl|mapFrom|structureExt)\s+?(.*)$/);
            if (hm) {
                const key = hm[1];
                const val = hm[2].trim();
                if (key === 'nrexcl') { proj.meta.nrexcl = parseInt(val, 10); }
                else if (key === 'structureExt') { proj.structureExt = val || 'gro'; }
                else { proj.meta[key] = val; }
            }
            continue;
        }
        if (buf[section]) { buf[section].push(line); }
    }
    proj.structure = buf.STRUCTURE.join('\n');
    proj.ndx = buf.NDX.join('\n');
    proj.map = buf.MAP.join('\n');
    proj.itp = buf.ITP.join('\n');
    return proj;
}
