/**
 * Line-list geometry for the light and camera debug gizmos.
 *
 * All shapes are produced in the local space of the node that owns them, with
 * the node at the origin and looking down -Z (the glTF camera/light forward
 * direction). They are roughly unit-sized; the renderer scales each gizmo to a
 * constant on-screen size before drawing it.
 */

const CIRCLE_SEGMENTS = 16;
const CONE_SEGMENTS = 12;

function pushLine(out, ax, ay, az, bx, by, bz) {
    out.push(ax, ay, az, bx, by, bz);
}

function pushLineV(out, a, b) {
    out.push(a[0], a[1], a[2], b[0], b[1], b[2]);
}

function pushLoop(out, points) {
    for (let i = 0; i < points.length; ++i) {
        pushLineV(out, points[i], points[(i + 1) % points.length]);
    }
}

// Points of a circle centered at `center`, spanned by the perpendicular axes
// `u` and `v` with the given radius.
function circlePoints(center, u, v, radius, segments) {
    const points = [];
    for (let i = 0; i < segments; ++i) {
        const angle = (i / segments) * Math.PI * 2.0;
        const c = Math.cos(angle) * radius;
        const s = Math.sin(angle) * radius;
        points.push([
            center[0] + u[0] * c + v[0] * s,
            center[1] + u[1] * c + v[1] * s,
            center[2] + u[2] * c + v[2] * s
        ]);
    }
    return points;
}

/**
 * A wireframe camera frustum (perspective) or box (orthographic) looking down
 * -Z, with the camera position at the origin.
 */
export function createCameraGizmoLines(camera) {
    const lines = [];

    let nearZ, farZ, nearHalfX, nearHalfY, farHalfX, farHalfY;

    if (camera?.type === "orthographic") {
        const xmag = camera.orthographic.xmag ?? 1;
        const ymag = camera.orthographic.ymag ?? 1;
        const aspect = xmag / ymag || 1;
        farHalfY = 0.5;
        farHalfX = 0.5 * aspect;
        nearHalfY = farHalfY;
        nearHalfX = farHalfX;
        nearZ = 0.0;
        farZ = -1.0;

        const ntl = [-nearHalfX, nearHalfY, nearZ];
        const ntr = [nearHalfX, nearHalfY, nearZ];
        const nbr = [nearHalfX, -nearHalfY, nearZ];
        const nbl = [-nearHalfX, -nearHalfY, nearZ];

        const ftl = [-farHalfX, farHalfY, farZ];
        const ftr = [farHalfX, farHalfY, farZ];
        const fbr = [farHalfX, -farHalfY, farZ];
        const fbl = [-farHalfX, -farHalfY, farZ];

        pushLoop(lines, [ntl, ntr, nbr, nbl]);
        pushLoop(lines, [ftl, ftr, fbr, fbl]);
        pushLineV(lines, ntl, ftl);
        pushLineV(lines, ntr, ftr);
        pushLineV(lines, nbr, fbr);
        pushLineV(lines, nbl, fbl);
    } else {
        const yfov = camera?.perspective?.yfov ?? Math.PI / 4;
        const aspect = camera?.perspective?.aspectRatio || 1;
        const tanHalf = Math.tan(yfov / 2.0);
        farHalfY = tanHalf;
        farHalfX = tanHalf * aspect;
        nearZ = -0.25;
        farZ = -1.0;
        nearHalfY = farHalfY * Math.abs(nearZ / farZ);
        nearHalfX = farHalfX * Math.abs(nearZ / farZ);

        const ntl = [-nearHalfX, nearHalfY, nearZ];
        const ntr = [nearHalfX, nearHalfY, nearZ];
        const nbr = [nearHalfX, -nearHalfY, nearZ];
        const nbl = [-nearHalfX, -nearHalfY, nearZ];

        const ftl = [-farHalfX, farHalfY, farZ];
        const ftr = [farHalfX, farHalfY, farZ];
        const fbr = [farHalfX, -farHalfY, farZ];
        const fbl = [-farHalfX, -farHalfY, farZ];

        const apex = [0, 0, 0];
        // Frustum edges from the camera position to the far plane.
        pushLineV(lines, apex, ftl);
        pushLineV(lines, apex, ftr);
        pushLineV(lines, apex, fbr);
        pushLineV(lines, apex, fbl);

        pushLoop(lines, [ntl, ntr, nbr, nbl]);
        pushLoop(lines, [ftl, ftr, fbr, fbl]);
    }

    return new Float32Array(lines);
}

/** An arrow pointing down -Z with a small origin ring, for directional lights. */
export function createDirectionalLightGizmoLines() {
    const lines = [];

    // Shaft.
    pushLine(lines, 0, 0, 0.5, 0, 0, -0.5);
    // Arrow head.
    pushLine(lines, -0.16, 0, -0.34, 0, 0, -0.5);
    pushLine(lines, 0.16, 0, -0.34, 0, 0, -0.5);
    pushLine(lines, 0, -0.16, -0.34, 0, 0, -0.5);
    pushLine(lines, 0, 0.16, -0.34, 0, 0, -0.5);
    // Origin ring so the light's node position is still visible.
    pushLoop(lines, circlePoints([0, 0, 0], [1, 0, 0], [0, 1, 0], 0.18, CIRCLE_SEGMENTS));

    return new Float32Array(lines);
}

/** Three orthogonal rings forming a wireframe sphere, for point lights. */
export function createPointLightGizmoLines() {
    const lines = [];
    const radius = 0.45;

    pushLoop(lines, circlePoints([0, 0, 0], [1, 0, 0], [0, 1, 0], radius, CIRCLE_SEGMENTS));
    pushLoop(lines, circlePoints([0, 0, 0], [1, 0, 0], [0, 0, 1], radius, CIRCLE_SEGMENTS));
    pushLoop(lines, circlePoints([0, 0, 0], [0, 1, 0], [0, 0, 1], radius, CIRCLE_SEGMENTS));

    return new Float32Array(lines);
}

/** A cone pointing down -Z, for spot lights. Shows both the inner (full-intensity) and outer (falloff) cone angles. */
export function createSpotLightGizmoLines(light) {
    const lines = [];

    const apex = [0, 0, 0];
    const baseZ = -0.8;
    const outerConeAngle = light?.spot?.outerConeAngle ?? Math.PI / 4;
    const innerConeAngle = light?.spot?.innerConeAngle ?? 0;

    let outerRadius = Math.tan(outerConeAngle) * -baseZ;
    let innerRadius = Math.tan(innerConeAngle) * -baseZ;

    // Clamp extreme cone angles so the gizmo stays readable, keeping the
    // inner/outer proportion intact.
    const maxOuterRadius = 2.0;
    if (outerRadius > maxOuterRadius) {
        innerRadius *= maxOuterRadius / outerRadius;
        outerRadius = maxOuterRadius;
    }
    outerRadius = Math.max(outerRadius, 0.05);

    // Outer cone: silhouette edges and base ring (full extent of the light).
    const outerPoints = circlePoints(
        [0, 0, baseZ],
        [1, 0, 0],
        [0, 1, 0],
        outerRadius,
        CONE_SEGMENTS
    );
    for (const point of outerPoints) {
        pushLineV(lines, apex, point);
    }
    pushLoop(lines, outerPoints);

    // Inner cone: base ring marking where full intensity ends (penumbra edge).
    if (innerRadius > 0.0001) {
        pushLoop(
            lines,
            circlePoints([0, 0, baseZ], [1, 0, 0], [0, 1, 0], innerRadius, CONE_SEGMENTS)
        );
    }

    // Center axis.
    pushLineV(lines, apex, [0, 0, baseZ]);

    return new Float32Array(lines);
}

export function createLightGizmoLines(light) {
    switch (light?.type) {
        case "spot":
            return createSpotLightGizmoLines(light);
        case "point":
            return createPointLightGizmoLines();
        case "directional":
        default:
            return createDirectionalLightGizmoLines();
    }
}
