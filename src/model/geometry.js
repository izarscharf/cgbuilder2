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

// Virtual-site-3 (func 1) construction parameters a, b such that
//   r_target = r_i + a (r_j - r_i) + b (r_k - r_i)
// Solved by least-squares projection of the target onto the i-j-k plane.
export function vsite3Params(target, ri, rj, rk) {
    let u = new Vector3().subVectors(rj, ri);
    let v = new Vector3().subVectors(rk, ri);
    let w = new Vector3().subVectors(target, ri);
    let uu = u.dot(u);
    let uv = u.dot(v);
    let vv = v.dot(v);
    let wu = w.dot(u);
    let wv = w.dot(v);
    let det = uu * vv - uv * uv;
    if (Math.abs(det) < 1e-9) {
        return { a: 0, b: 0 };
    }
    let a = (wu * vv - wv * uv) / det;
    let b = (wv * uu - wu * uv) / det;
    return { a, b };
}
