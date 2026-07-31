import { Vector3 } from 'ngl';

// All inputs are NGL Vector3 in Angstrom. Distances are returned in nm
// (Angstrom / 10) to match GROMACS conventions; angles in degrees.

export function distanceNm(a, b) {
    return a.distanceTo(b) / 10;
}

export function angleDeg(a, b, c) {
    // Angle at vertex b (a-b-c).
    let ba = new Vector3().subVectors(a, b);
    let bc = new Vector3().subVectors(c, b);
    let cos = ba.dot(bc) / (ba.length() * bc.length());
    cos = Math.min(1, Math.max(-1, cos));
    return (Math.acos(cos) * 180) / Math.PI;
}

export function dihedralDeg(a, b, c, d) {
    let b1 = new Vector3().subVectors(b, a);
    let b2 = new Vector3().subVectors(c, b);
    let b3 = new Vector3().subVectors(d, c);
    let n1 = new Vector3().crossVectors(b1, b2);
    let n2 = new Vector3().crossVectors(b2, b3);
    let m1 = new Vector3().crossVectors(n1, b2.clone().normalize());
    let x = n1.dot(n2);
    let y = m1.dot(n2);
    return (Math.atan2(y, x) * 180) / Math.PI;
}

// Tolerances (nm) / thresholds for auto-selecting the vsite3 function type.
const PLANE_TOL = 0.02;       // out-of-plane distance below this -> in-plane (funct 1)
const DEGENERACY_TOL = 0.05;  // |sin(angle(e1,e2))| below this -> i,j,k near-collinear
const ROUNDTRIP_TOL = 0.005;  // reconstruction must match target within this

// Auto-select the GROMACS virtual_sites3 function for a site placed at an
// explicit position (from an AA->CG mapping) built from constructors i,j,k:
//   funct 1 (in-plane): r = ri + a e1 + b e2                 (spans only the plane)
//   funct 4 (3out):     r = ri + a e1 + b e2 + c (e1 x e2)   (spans full 3D)
// with e1 = rj - ri, e2 = rk - ri. Only this linear family reproduces a fixed
// relative position, so the choice is strictly 1 vs 4. Returns {func, a, b, c}
// (c = 0 for funct 1) or {error} for a degenerate/ill-conditioned triple.
//
// Inputs are NGL Vector3 in Angstrom; converted to nm internally so that c is in
// GROMACS units (nm^-1) and the nm tolerances above apply directly. a, b are
// dimensionless ratios and so are unaffected by the unit choice.
export function chooseVsite3(target, ri, rj, rk) {
    const e1 = new Vector3().subVectors(rj, ri).multiplyScalar(0.1); // nm
    const e2 = new Vector3().subVectors(rk, ri).multiplyScalar(0.1);
    const d = new Vector3().subVectors(target, ri).multiplyScalar(0.1);
    const n = new Vector3().crossVectors(e1, e2);                    // nm^2

    // Guard: constructors must not be (near-)collinear, else the plane/frame
    // is undefined and a, b, c blow up.
    const sinIjk = n.length() / (e1.length() * e2.length());
    if (sinIjk < DEGENERACY_TOL) {
        return { error: 'Constructing beads are near-collinear — pick a non-collinear triple that brackets the site.' };
    }

    const h = Math.abs(d.dot(n.clone().normalize())); // out-of-plane distance (nm)

    let params;
    if (h < PLANE_TOL) {
        const { a, b } = solvePlane(e1, e2, d);
        params = { func: 1, a, b, c: 0 };
    } else {
        const { a, b, c } = solve3x3(e1, e2, n, d);
        params = { func: 4, a, b, c };
    }

    // Round-trip check (relative to ri, in nm) to catch ill-conditioning.
    const r = e1.clone().multiplyScalar(params.a).addScaledVector(e2, params.b);
    if (params.func === 4) { r.addScaledVector(n, params.c); }
    if (r.distanceTo(d) > ROUNDTRIP_TOL) {
        return { error: 'Virtual-site reconstruction failed (ill-conditioned triple) — pick a better-spread constructor triple.' };
    }
    return params;
}

// Least-squares projection of w onto span{u, v}: solve the 2x2 normal equations.
function solvePlane(u, v, w) {
    const uu = u.dot(u), uv = u.dot(v), vv = v.dot(v);
    const wu = w.dot(u), wv = w.dot(v);
    const det = uu * vv - uv * uv;
    if (Math.abs(det) < 1e-12) { return { a: 0, b: 0 }; }
    return { a: (wu * vv - wv * uv) / det, b: (wv * uu - wu * uv) / det };
}

// Scalar triple product of three column vectors == det[ a | b | c ].
function det3(a, b, c) {
    return a.dot(new Vector3().crossVectors(b, c));
}

// Exact solve of [e1 | e2 | n] . [a, b, c]^T = d via Cramer's rule. With
// n = e1 x e2 the system determinant is |n|^2 > 0 for a non-degenerate triple.
function solve3x3(e1, e2, n, d) {
    const D = det3(e1, e2, n);
    if (Math.abs(D) < 1e-12) { return { a: 0, b: 0, c: 0 }; }
    return {
        a: det3(d, e2, n) / D,
        b: det3(e1, d, n) / D,
        c: det3(e1, e2, d) / D,
    };
}
