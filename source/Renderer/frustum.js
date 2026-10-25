// Frustum extraction and testing for culling against node bounding volumes.
//
// Planes come straight out of the view-projection matrix (Gribb/Hartmann): a point is
// inside the frustum when it is on the positive side of all six. Normals are left
// unnormalised because only the sign of the result matters here.

// gl-matrix stores column-major, so m[column * 4 + row].
function frustumPlanes(viewProjection) {
    const m = viewProjection;
    const plane = (i, sign) => [
        m[3] + sign * m[i],
        m[7] + sign * m[i + 4],
        m[11] + sign * m[i + 8],
        m[15] + sign * m[i + 12]
    ];
    return [
        plane(0, 1), // left
        plane(0, -1), // right
        plane(1, 1), // bottom
        plane(1, -1), // top
        plane(2, 1), // near
        plane(2, -1) // far
    ];
}

// Whether a box lies entirely outside the frustum, testing the corner furthest along each
// plane normal. False means "keep it", which covers both intersecting and inside: this is
// a rejection test, not an exact containment test.
function aabbOutsideFrustum(planes, min, max) {
    for (const [a, b, c, d] of planes) {
        const x = a >= 0 ? max[0] : min[0];
        const y = b >= 0 ? max[1] : min[1];
        const z = c >= 0 ? max[2] : min[2];
        if (a * x + b * y + c * z + d < 0) {
            return true;
        }
    }
    return false;
}

export { aabbOutsideFrustum, frustumPlanes };
