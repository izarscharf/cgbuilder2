import OCL from 'openchemlib';
// Vite emits this as a hashed asset and gives us its URL. Relative path is
// used (rather than a bare specifier) so the ?url query resolves cleanly.
import resourcesUrl from '../../node_modules/openchemlib/dist/resources.json?url';

// ConformerGenerator relies on OpenChemLib's static resources (torsion
// database, etc.). Register them once, lazily, from the bundled asset.
let resourcesPromise = null;
function ensureResources() {
    if (!resourcesPromise) {
        resourcesPromise = OCL.Resources.registerFromUrl(resourcesUrl);
    }
    return resourcesPromise;
}

// Turn a SMILES string into a V2000 molfile string with real 3D coordinates,
// using OpenChemLib's self-organizing conformer generator. Rejects on an
// unparseable SMILES or if no collision-free conformer could be built.
export async function smilesToMolfile(smiles) {
    await ensureResources();
    const mol = OCL.Molecule.fromSmiles(smiles); // throws on invalid SMILES
    const generator = new OCL.ConformerGenerator(Date.now() & 0x7fffffff);
    const conformer = generator.getOneConformerAsMolecule(mol);
    if (!conformer) {
        throw new Error('Could not generate a 3D conformer for this molecule.');
    }
    return conformer.toMolfile();
}

// NGL can load an in-memory molfile if we wrap it in a Blob and tell it the
// extension.
export function molfileBlob(molfile) {
    return new Blob([molfile], { type: 'text/plain' });
}
