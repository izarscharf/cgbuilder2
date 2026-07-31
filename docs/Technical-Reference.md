# CGBuilder2 — Technical Reference

This page documents *how* CGBuilder2 computes each quantity it writes: bead
positions and masses, the geometry of every bonded term, the virtual-site
function selection, the elastic network, exclusions, and the exact format of
every file it reads and writes. It is intended for users who need to trust — or
reproduce — the numbers in the generated topology.

> **Units convention.** NGL supplies atomic coordinates in **Ångström (Å)**.
> Every length written to a `.itp`/`.gro` is converted to **nanometres (nm)** by
> dividing by 10. Angles are in **degrees**. Masses are in **g/mol**. This
> Å→nm split is the single most important thing to keep in mind when reading the
> source: internal geometry is Å, output is nm.

---

## 1. Architecture at a glance

```
index.html            3-column layout: live ITP | 3D viewport | builder tabs
src/
  main.js             controller: owns the model, wires events, rebuilds outputs
  model/
    bead.js           Bead, BeadCollection (atom membership, stable ids, center)
    topology.js       Topology: bonds/constraints/angles/dihedrals/vsites/elastic
    geometry.js       distance / angle / dihedral / vsite function selection
    masses.js         atomic masses, unassigned-atom spread, VS redistribution
    elastic.js        elastic-network pair generator (shared by ITP + 3D view)
  io/
    itp.js            Martini .itp generator
    legacy.js         .ndx / .map / CG .gro / AA .gro generators + download()
    itpParse.js       parse + apply an existing .itp
    mapImport.js      parse + apply a .map (rebuild beads)
    ndxImport.js      parse + apply an .ndx (rebuild mapping)
    project.js        .cgb2proj bundle (structure + ndx + map + itp)
    loaders.js        SMILES -> 3D molfile (OpenChemLib)
  ui/
    viz.js            NGL scene: atom picking, CG spheres, connectivity overlay
    beadPanel.js / bondedPanels.js / elasticPanel.js / itpPanel.js / dom.js / notify.js
```

**Data flow.** Every edit (atom pick, term added, value changed) calls the
controller, which recomputes masses, regenerates all output strings, and redraws
the 3D overlay. Terms reference beads by a **stable `Bead.id`** (a monotonic
counter), never by array position, so removing or reordering beads never
corrupts a bond/angle/vsite reference.

---

## 2. Bead position — centre of geometry

A bead's position is the **centre of geometry (unweighted centroid)** of its
member atoms, in Å ([`bead.js`](../src/model/bead.js), `Bead.center`):

```
center = (1 / N) * Σ  r_atom          (N = number of mapped atoms, in Å)
```

Key points:

- It is **not mass-weighted** — each atom contributes equally. (The internal loop
  adds `1` per atom, so heavy and light atoms count the same.) This matches the
  original CGBuilder convention and the usual Martini centre-of-geometry mapping.
- A bead with **no atoms** has centre `(0,0,0)` and is skipped in the 3D view and
  in most outputs.
- The centre is recomputed on demand from the current atom set, so it always
  reflects the live mapping. All bonded-term reference values (below) are measured
  from these centres.

**Derived per-bead attributes:** `resname` and `resid` are taken from the bead's
**first mapped atom** (`atoms[0].resname` / `atoms[0].resno`); a blank global
Residue field keeps these, a non-blank one overrides every bead. Bead **names**
default to `B0, B1, …` and are freely editable.

---

## 3. Atom → bead mapping

- Clicking an atom in the 3D view toggles it into the **currently selected bead**.
- An atom may belong to **more than one bead** (shown with a 🔗 marker); this is
  intentional for shared-atom mappings. `countBeadsForAtom` reports the
  multiplicity, and mass is split accordingly (§4).
- **New bead** appends an empty bead and makes it current. Beads can be renamed,
  removed, and given a Martini **type** (default `P4`) and **charge** (default 0).

---

## 4. Bead mass — automatic and mass-conserving

Masses are computed in [`masses.js`](../src/model/masses.js) as a
`Map(bead.id → mass)` in three stages. The guiding principle is **total mass
conservation**: every atom's mass ends up on exactly one bead's books.

**Stage 1 — base mass.** Each bead's mass is the sum of the standard atomic
weights of its mapped atoms:

```
mass(bead) = Σ  ELEMENT_MASS[atom.element]
```

The element table covers H–I for common organic/biomolecular elements; an
unknown element contributes 0. If an atom is shared by *k* beads it is fully
counted in each at this stage — see Stage 1b.

**Stage 1b — unassigned-atom spread.** Atoms present in the structure but **not
mapped to any bead** (typically hydrogens) must not lose their mass. For each
unassigned atom, a **breadth-first search along the molecular bond graph**
(`eachBondedAtom`) finds the nearest *assigned* atom(s); the unassigned atom's
mass is divided equally among the bead(s) that hold those nearest neighbours:

```
share = mass(unassigned atom) / (number of nearest-neighbour beads)
```

- The BFS expands shell by shell and stops at the first shell that reaches a real
  bead, so mass follows the shortest bonded path.
- Virtual-site beads are **excluded** as BFS destinations (they are pass-through),
  so stray mass is never parked on a massless site.
- A truly disconnected atom (no bonds) contributes nothing.

**Stage 2 — virtual-site redistribution.** A virtual site carries no mass of its
own in GROMACS. Whatever mass a VS bead accumulated in Stages 1–1b is split
**equally among its three constructor beads**, and the VS bead is then set to
**0**:

```
each constructor += mass(VS) / 3      ;  mass(VS) := 0
```

This is why the `[atoms]` mass column shows `0.000` for every virtual site, and
why the sum of all bead masses equals the sum of all atomic masses in the
structure (within floating-point error).

---

## 5. Geometry of bonded terms

All reference values are **auto-measured from bead centres** at the moment the
term is created, then remain **editable** per entry. Formulas live in
[`geometry.js`](../src/model/geometry.js).

| Term | Reference value | How it is measured |
|------|-----------------|--------------------|
| **Bond** `i–j` | length (nm) | `‖r_i − r_j‖ / 10` |
| **Angle** `i–j–k` | θ (deg) | angle **at the middle bead `j`** between `j→i` and `j→k` |
| **Dihedral** `i–j–k–l` | φ (deg) | signed torsion about the `j–k` axis, `atan2`-based, range (−180, 180] |

- **Angle vertex is the second index.** For an angle term `i, j, k`, `j` is the
  apex; picking order in the 3D view therefore matters.
- **Dihedral sign** follows the standard IUPAC/GROMACS convention (computed from
  the two plane normals `n₁ = b₁×b₂`, `n₂ = b₂×b₃` and `atan2(m₁·n₂, n₁·n₂)`).

### Default force constants and function types

Set in `Topology.DEFAULTS` ([`topology.js`](../src/model/topology.js)); all are
editable after creation:

| Term | GROMACS `func` | Default force constant | Notes |
|------|:--:|--|--|
| Bond | 1 | `fc = 1250` | harmonic |
| Constraint | 1 | `fc = 1250` (for the FLEXIBLE fallback bond) | see §6 |
| Angle | 2 | `fc = 25` | cosine-based (Martini standard) |
| Dihedral | 1 | `fc = 10`, `mult = 1` | proper dihedral |
| Elastic bond | 6 | `strength = 500` | see §8 |
| Virtual site | 1 or 4 | — | see §7 |

---

## 6. Constraints and the `FLEXIBLE` switch

A constraint fixes a distance rigidly, but rigid constraints can make
minimisation/equilibration fragile. CGBuilder2 therefore emits **both** forms and
lets the GROMACS preprocessor pick one via a define:

- Under `#ifndef FLEXIBLE` → a real `[ constraints ]` entry (`i j 1 length`),
  used by default.
- Under `#ifdef FLEXIBLE` (inside `[ bonds ]`) → a stiff harmonic bond
  (`i j 1 length 1250`), used when the model is built with `-DFLEXIBLE` for a
  soft start.

So one constraint you add produces two lines in the `.itp`, guarded by opposite
preprocessor conditions — you never edit both by hand.

---

## 7. Virtual sites — `virtual_sites3` func 1 vs func 4

This is the part most worth understanding. A **`virtual_sites3`** bead is placed
by a formula built from three constructor beads `i, j, k`, using the frame

```
e1 = r_j − r_i        e2 = r_k − r_i        n = e1 × e2
```

CGBuilder2 supports the two **position-reproducing (linear)** members of the
family and **auto-selects** between them
([`geometry.js`](../src/model/geometry.js), `chooseVsite3`):

| `func` | Name | Formula | Spans | Params |
|:--:|--|--|--|--|
| **1** | in-plane (3) | `r = r_i + a·e1 + b·e2` | the **plane** of `i,j,k` only | `a, b` (dimensionless) |
| **4** | 3out | `r = r_i + a·e1 + b·e2 + c·(e1 × e2)` | **full 3D** | `a, b` (dimensionless), `c` (nm⁻¹) |

### When is each used?

The tool measures the target site's **perpendicular distance `h` from the
constructor plane** and chooses automatically:

- **`h < 0.02 nm` → func 1.** The site already lies (essentially) in the plane, so
  the in-plane construction reproduces it exactly with only two parameters. `a, b`
  come from a least-squares projection of the site onto `span{e1, e2}`.
- **`h ≥ 0.02 nm` → func 4.** The site is genuinely out of plane; func 1 *cannot*
  represent it. The 3out construction adds the out-of-plane term `c·(e1×e2)` and
  reproduces **any** position exactly. `a, b, c` come from an exact 3×3 solve of
  `[e1 | e2 | n]·[a,b,c]ᵀ = (r_s − r_i)` (Cramer's rule; the system determinant is
  `|n|² > 0` for a non-degenerate triple).

**Why not func 2 (3fd) or 3 (3fad)?** Those impose a *fixed distance/angle that
moves with the constructing beads* — they do **not** reproduce a fixed relative
position. For a site placed at explicit coordinates from an AA→CG mapping, only
the linear family (1 and 4) is correct, so the choice is strictly **1 vs 4**.

### Guards (a virtual site is rejected, with a warning, if…)

1. **Near-collinear constructors** — `|sin∠(e1,e2)| < 0.05`. Three nearly
   collinear beads define no stable plane/frame and the parameters blow up. Fix:
   pick a non-collinear triple that brackets the site.
2. **Failed round-trip** — after solving, the site is reconstructed from the
   chosen formula and compared to the target; if they differ by `> 0.005 nm`, the
   site is rejected as ill-conditioned.

### Units of `c`

Because `e1, e2` are in nm, `n = e1×e2` is in nm², so `c` carries units of
**nm⁻¹** to make `c·n` a length — exactly what GROMACS expects for a 3out site.
Internally the solver converts Å→nm before computing `c` (and `h`, and the
round-trip error), while `a, b` are scale-free ratios and are unaffected.

### Constants (see also §11)

| Constant | Value | Meaning |
|--|--|--|
| `PLANE_TOL` | 0.02 nm | out-of-plane distance below which the site is treated as in-plane (→ func 1) |
| `DEGENERACY_TOL` | 0.05 | `|sin∠(e1,e2)|` below which `i,j,k` are near-collinear (→ reject) |
| `ROUNDTRIP_TOL` | 0.005 nm | max allowed reconstruction error |

### Mass and exclusions

A virtual site is **massless** (§4, Stage 2) and is **excluded** from
non-bonded interactions with each of its three constructors (§9). Virtual sites
may **only** appear as constructors of other sites — the UI warns and blocks any
attempt to put a VS bead into a bond, angle, dihedral, constraint, or the elastic
network.

---

## 8. Elastic network

Generated in [`elastic.js`](../src/model/elastic.js) and shared by both the ITP
writer and the 3D overlay so they can never disagree. When enabled, for **every
eligible bead pair** within the cutoff a GROMACS **func-6** harmonic bond is
written:

```
for each pair (a,b) of beads with atoms, excluding virtual sites:
    skip if the pair already has a manual bond
    d = ‖center_a − center_b‖ / 10           (nm)
    skip if d > cutoff
    fc = (decay > 0) ?  strength · exp(−d / decay)  :  strength
    emit:  a b 6 d fc
```

Parameters (defaults): **cutoff = 0.9 nm**, **strength = 500**, **decay = 0**
(constant `fc`). A positive `decay` makes distant pairs progressively softer.
Manual bonds take precedence (a pair that is already bonded is never duplicated),
and virtual sites are never elastic endpoints.

---

## 9. Exclusions

Non-bonded exclusions are generated automatically for virtual sites: each site is
excluded from its three constructors. Pairs are **de-duplicated** and **grouped by
the lower atom index**, e.g.

```
[ exclusions ]
;  ai   aj ...
   2    5    7        ; atom 2 is excluded from atoms 5 and 7
```

---

## 10. The generated `.itp`

Section order and column meaning ([`itp.js`](../src/io/itp.js)):

| Section | Emitted when | Columns |
|--|--|--|
| `[ moleculetype ]` | always | `name  nrexcl` (nrexcl default 1) |
| `[ atoms ]` | always | `nr type resnr residue atom cgnr charge mass` — mass from §4; **0** for virtual sites |
| `[ bonds ]` | any manual bond, elastic pair, or constraint exists | `i j func length fc`; elastic block (func 6) and the `#ifdef FLEXIBLE` constraint-bonds follow |
| `[ constraints ]` | any constraint | wrapped in `#ifndef FLEXIBLE`; `i j func length` |
| `[ angles ]` | any angle | `i j k func angle fc` |
| `[ dihedrals ]` | any dihedral | `i j k l func angle fc mult` |
| `[ virtual_sites3 ]` | any VS | `site i j k func a b [c]` — the `c` column appears **only on func-4 lines** |
| `[ exclusions ]` | any VS | see §9 |

Indices are the **1-based bead order** of `[ atoms ]`. Bonds, angles, and
dihedrals also carry a trailing **fast_forward** comment (§12).

---

## 11. Constants reference

| Constant | Value | Where | Purpose |
|--|--|--|--|
| Bond `fc` | 1250 | `topology.js` | default harmonic bond force constant |
| Angle `fc` | 25 | `topology.js` | default angle force constant |
| Dihedral `fc` / `mult` | 10 / 1 | `topology.js` | default dihedral |
| Elastic cutoff | 0.9 nm | `topology.js` | max pair distance for EN |
| Elastic strength | 500 | `topology.js` | base EN force constant |
| Elastic decay | 0 | `topology.js` | 0 = constant fc; >0 = exponential falloff |
| `nrexcl` | 1 | meta | default exclusion depth |
| `PLANE_TOL` | 0.02 nm | `geometry.js` | in-plane vs 3out threshold |
| `DEGENERACY_TOL` | 0.05 | `geometry.js` | collinear-constructor rejection |
| `ROUNDTRIP_TOL` | 0.005 nm | `geometry.js` | VS reconstruction tolerance |
| GRO box | `10 10 10` nm | `legacy.js` | placeholder (a builder has no simulation box) |

---

## 12. fast_forward interaction comments

Bonds, angles, and dihedrals are annotated with a trailing comment of the bead
**names** joined by underscores, e.g. `1 2 1 0.265 6021 ; CAC1_AMC1`. This lets
the `fast_forward` mapping tool flag each interaction as automatically mappable.
The comment is derived from the current bead names, so renaming beads updates it
on the next regeneration.

---

## 13. Other output files

**CG `.ndx`** ([`legacy.js`](../src/io/legacy.js)) — one index group per bead
(`[ beadname ]`) listing member atom **serials (1-based)**. Re-importable.

**`.map`** — backward-style mapping:

```
[ molecule ]   MOL
[ from ]       <source force field, e.g. charmm>
[ to ]         martini
[ martini ]    <bead names, in order>
[ atoms ]      <serial  atomname  bead[ bead …]>   (one row per mapped atom)
```

Atom serials are the real structure serials (`index+1`), which keeps the map
re-loadable onto the same structure.

**CG `.gro`** — one line per bead at its centre, coordinates in nm
(`center/10`), 5-char fields per GRO fixed-width format, placeholder box
`10 10 10`.

**AA `.gro`** — the loaded all-atom structure re-emitted as a reference (positions
Å→nm), for sanity-checking the mapping against the atomistic coordinates.

---

## 14. Loading, editing, and the project bundle

- **Load `.ndx`** — matches atom serials back to beads to restore a mapping onto
  the current structure.
- **Load `.map`** — rebuilds beads and their atom membership from the `[ atoms ]`
  block.
- **Load `.itp`** — parses all sections, maps `nr → beads[nr−1]`, updates bead
  types/charges/names, and rebuilds the topology (elastic network is turned off,
  since it is a generator rather than stored bonds). The `.itp` textarea is
  **editable**: *Apply to model* parses your edits back into the clickable model;
  *Revert* regenerates the text from the model. Round-trips are byte-stable.
- **Save/Load `.cgb2proj`** — a single self-contained bundle of the all-atom
  structure + `.ndx` + `.map` + `.itp` + meta (molecule/residue names, nrexcl,
  map source). Loading restores the exact session — the one-file way to stop,
  resume, and share a model.

---

## 15. Known limitations

- SMILES geometry is a generated conformer (OpenChemLib); for a specific
  experimental conformation, load a structure file instead.
- The GRO box is a fixed placeholder (`10 10 10 nm`).
- Virtual-site mass is split **equally** among the three constructors (a simple,
  conserving default rather than a geometry-weighted one).
- Bead position is centre of **geometry**, not centre of mass.
