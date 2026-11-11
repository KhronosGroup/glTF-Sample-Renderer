/**
 * Line-list geometry for the debug gizmos.
 *
 * Shapes owned by a node (cameras and lights) are produced in that node's local
 * space, with the node at the origin and looking down -Z (the glTF camera/light
 * forward direction), so they can be drawn with the node's world transform.
 * World-space shapes (boxes) are produced directly in world space and drawn
 * with an identity model matrix.
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

// A small wireframe octahedron (diamond) centered at the origin.
function addOctahedron(out, radius) {
    const v = [
        [radius, 0, 0],
        [-radius, 0, 0],
        [0, radius, 0],
        [0, -radius, 0],
        [0, 0, radius],
        [0, 0, -radius]
    ];
    // All vertex pairs except the three opposite pairs.
    const edges = [
        [0, 2],
        [0, 3],
        [0, 4],
        [0, 5],
        [1, 2],
        [1, 3],
        [1, 4],
        [1, 5],
        [2, 4],
        [2, 5],
        [3, 4],
        [3, 5]
    ];
    for (const [a, b] of edges) {
        pushLineV(out, v[a], v[b]);
    }
}

// Falls back when a camera plane is missing or infinite (glTF defaults zfar to Infinity).
function finitePlaneDistance(value, fallback) {
    return Number.isFinite(value) ? value : fallback;
}

/**
 * A wireframe camera frustum (perspective) or box (orthographic) looking down
 * -Z, with the camera position at the origin. The near and far planes reflect
 * the camera's znear/zfar (the far plane is omitted when zfar is infinite).
 */
export function createCameraGizmoLines(camera, fallbackAspect) {
    const lines = [];

    if (camera?.type === "orthographic") {
        const halfX = camera.orthographic.xmag ?? 1;
        const halfY = camera.orthographic.ymag ?? 1;
        const znear = finitePlaneDistance(camera.orthographic.znear, 0.1);
        const zfarRaw = camera.orthographic.zfar;
        const hasFar = Number.isFinite(zfarRaw);
        const zfar = hasFar ? Math.max(zfarRaw, znear) : znear + 1.0;

        const nearZ = -znear;
        const farZ = -zfar;

        const ntl = [-halfX, halfY, nearZ];
        const ntr = [halfX, halfY, nearZ];
        const nbr = [halfX, -halfY, nearZ];
        const nbl = [-halfX, -halfY, nearZ];

        const ftl = [-halfX, halfY, farZ];
        const ftr = [halfX, halfY, farZ];
        const fbr = [halfX, -halfY, farZ];
        const fbl = [-halfX, -halfY, farZ];

        pushLoop(lines, [ntl, ntr, nbr, nbl]);
        if (hasFar) {
            pushLoop(lines, [ftl, ftr, fbr, fbl]);
        }
        pushLineV(lines, ntl, ftl);
        pushLineV(lines, ntr, ftr);
        pushLineV(lines, nbr, fbr);
        pushLineV(lines, nbl, fbl);
    } else {
        const yfov = camera?.perspective?.yfov ?? Math.PI / 4;
        // Match what the renderer projects: the camera's own aspectRatio when
        // defined, otherwise the viewport's aspect ratio.
        const cameraAspect = camera?.perspective?.aspectRatio;
        const frustumAspect = cameraAspect > 0 ? cameraAspect : (fallbackAspect ?? 1);
        const tanHalf = Math.tan(yfov / 2.0);

        const znear = Math.max(finitePlaneDistance(camera.perspective.znear, 0.1), 1e-4);
        const zfarRaw = camera.perspective.zfar;
        const hasFar = Number.isFinite(zfarRaw);
        // Representative depth when the far plane is infinite, just for the silhouette.
        const zfar = hasFar ? Math.max(zfarRaw, znear) : znear * 20.0;

        const nearHalfY = tanHalf * znear;
        const nearHalfX = nearHalfY * frustumAspect;
        const farHalfY = tanHalf * zfar;
        const farHalfX = farHalfY * frustumAspect;

        const nearZ = -znear;
        const farZ = -zfar;

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
        if (hasFar) {
            pushLoop(lines, [ftl, ftr, fbr, fbl]);
        }
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

/** A small marker plus a wireframe sphere at the light's range, for point lights. */
export function createPointLightGizmoLines(light) {
    const lines = [];

    // Center marker.
    addOctahedron(lines, 0.1);

    // Range sphere (falls back to a small marker sphere when the range is
    // undefined or infinite, i.e. <= 0).
    const radius = light?.range > 0 ? light.range : 0.45;
    pushLoop(lines, circlePoints([0, 0, 0], [1, 0, 0], [0, 1, 0], radius, CIRCLE_SEGMENTS));
    pushLoop(lines, circlePoints([0, 0, 0], [1, 0, 0], [0, 0, 1], radius, CIRCLE_SEGMENTS));
    pushLoop(lines, circlePoints([0, 0, 0], [0, 1, 0], [0, 0, 1], radius, CIRCLE_SEGMENTS));

    return new Float32Array(lines);
}

/** A cone pointing down -Z, for spot lights. Shows both the inner (full-intensity) and outer (falloff) cone angles, with the cone length driven by the light's range. */
export function createSpotLightGizmoLines(light) {
    const lines = [];

    const apex = [0, 0, 0];
    const outerConeAngle = light?.spot?.outerConeAngle ?? Math.PI / 4;
    const innerConeAngle = light?.spot?.innerConeAngle ?? 0;

    // The cone reaches the light's range; fall back to a fixed depth when the
    // range is undefined or infinite (<= 0).
    const depth = light?.range > 0 ? light.range : 0.8;
    const baseZ = -depth;

    const tanOuter = Math.tan(outerConeAngle);
    const tanInner = Math.tan(innerConeAngle);
    const outerRadius = Number.isFinite(tanOuter) ? tanOuter * depth : depth;
    const innerRadius = Number.isFinite(tanInner) ? tanInner * depth : 0;

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
            return createPointLightGizmoLines(light);
        case "directional":
        default:
            return createDirectionalLightGizmoLines();
    }
}

/** A small wireframe diamond marking a skeletal joint position. */
export function createJointMarkerLines() {
    const lines = [];
    addOctahedron(lines, 0.1);
    return new Float32Array(lines);
}

/**
 * Appends the twelve edges of an axis-aligned box spanning `min`..`max` to
 * `out` (a plain number array). Used for world-space AABB gizmos.
 */
export function appendBoxLines(out, min, max) {
    const [x0, y0, z0] = min;
    const [x1, y1, z1] = max;
    const corners = [
        [x0, y0, z0],
        [x1, y0, z0],
        [x1, y1, z0],
        [x0, y1, z0],
        [x0, y0, z1],
        [x1, y0, z1],
        [x1, y1, z1],
        [x0, y1, z1]
    ];
    // Bottom face, top face, then vertical edges.
    const edges = [
        [0, 1],
        [1, 2],
        [2, 3],
        [3, 0],
        [4, 5],
        [5, 6],
        [6, 7],
        [7, 4],
        [0, 4],
        [1, 5],
        [2, 6],
        [3, 7]
    ];
    for (const [a, b] of edges) {
        pushLineV(out, corners[a], corners[b]);
    }
}
