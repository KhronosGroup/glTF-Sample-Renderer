import { vec3 } from "gl-matrix";

// Geometry for the debug visualisation of glTF 2.1 shapes.
//
// Everything here is CPU-side and independent of WebGL and of the physics engines, so a
// shape can be drawn whether or not PhysX is loaded. Generators return indexed geometry
// carrying both triangle and line indices, so one buffer set serves the solid and the
// wireframe style.

const SEGMENTS = 32; // subdivisions around the axis of revolution
const RINGS = 8; // subdivisions per quarter-turn of a cap profile
const MERIDIAN_STRIDE = 4; // draw a wireframe meridian every n-th segment
const WIREFRAME_RINGS = 5; // roughly how many latitude rings a wireframe gets

// How far an infinite plane is drawn before it is simply cut off.
const INFINITE_PLANE_EXTENT = 20;
const INFINITE_PLANE_STEP = 2;

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function indexArray(indices, vertexCount) {
    return vertexCount > 65535 ? new Uint32Array(indices) : new Uint16Array(indices);
}

function geometry(positions, triIndices, lineIndices) {
    const vertexCount = positions.length / 3;
    return {
        positions: new Float32Array(positions),
        triIndices: indexArray(triIndices, vertexCount),
        lineIndices: indexArray(lineIndices, vertexCount)
    };
}

// Revolves a profile of [y, radius] pairs around the Y axis. Sphere, cylinder, cone and
// capsule are all the same surface with a different profile.
//
// featureRings names the profile indices that carry the silhouette, such as where a cap
// meets the lateral band. Those always get a wireframe ring; the rest are sampled, which
// on its own would skip the one ring that tells you the shape's actual width.
function revolve(profile, featureRings = [], segments = SEGMENTS) {
    const positions = [];
    const triIndices = [];
    const lineIndices = [];

    for (const [y, radius] of profile) {
        for (let s = 0; s < segments; s++) {
            const angle = (2 * Math.PI * s) / segments;
            positions.push(radius * Math.cos(angle), y, radius * Math.sin(angle));
        }
    }

    const at = (ring, segment) => ring * segments + (segment % segments);

    for (let ring = 0; ring + 1 < profile.length; ring++) {
        for (let s = 0; s < segments; s++) {
            const a = at(ring, s);
            const b = at(ring, s + 1);
            const c = at(ring + 1, s + 1);
            const d = at(ring + 1, s);
            triIndices.push(a, b, c, a, c, d);
        }
    }

    const features = new Set(featureRings);
    const ringStride = Math.max(1, Math.round((profile.length - 1) / WIREFRAME_RINGS));
    for (let ring = 0; ring < profile.length; ring++) {
        if (profile[ring][1] <= 0) {
            continue;
        }
        if (!features.has(ring) && ring % ringStride !== 0) {
            continue;
        }
        for (let s = 0; s < segments; s++) {
            lineIndices.push(at(ring, s), at(ring, s + 1));
        }
    }
    for (let s = 0; s < segments; s += MERIDIAN_STRIDE) {
        for (let ring = 0; ring + 1 < profile.length; ring++) {
            lineIndices.push(at(ring, s), at(ring + 1, s));
        }
    }

    return geometry(positions, triIndices, lineIndices);
}

function sphereGeometry(radius) {
    const profile = [];
    const steps = RINGS * 2;
    for (let i = 0; i <= steps; i++) {
        const t = -Math.PI / 2 + Math.PI * (i / steps);
        profile.push([radius * Math.sin(t), radius * Math.cos(t)]);
    }
    return revolve(profile, [RINGS]);
}

function cylinderGeometry(height, radiusBottom, radiusTop) {
    const y0 = -height / 2;
    const y1 = height / 2;
    // Leading and trailing zero-radius points close the flat end caps.
    return revolve(
        [
            [y0, 0],
            [y0, radiusBottom],
            [y1, radiusTop],
            [y1, 0]
        ],
        [1, 2]
    );
}

function capsuleGeometry(height, radiusBottom, radiusTop) {
    const y0 = -height / 2;
    const y1 = height / 2;

    // The lateral surface is the common tangent of the two cap spheres, leaving them at
    // angle phi from the equator. Tangency requires height*sin(phi) + (top - bottom) = 0,
    // so a capsule that narrows upward meets both spheres above their equators.
    // Clamping covers the degenerate case of one sphere swallowing the other.
    const phi = height > 0 ? Math.asin(clamp((radiusBottom - radiusTop) / height, -1, 1)) : 0;

    const profile = [];
    const features = [];
    const arc = (centre, radius, from, to) => {
        const angles = [];
        for (let i = 0; i <= RINGS; i++) {
            angles.push(from + (to - from) * (i / RINGS));
        }
        // A cap reaching past its own equator is widest there, so that circle goes into
        // the profile exactly instead of wherever the sampling happens to land.
        if (from < 0 && to > 0) {
            angles.push(0);
            angles.sort((a, b) => a - b);
        }
        for (const t of angles) {
            profile.push([centre + radius * Math.sin(t), radius * Math.cos(t)]);
            if (t === 0) {
                features.push(profile.length - 1);
            }
        }
    };

    arc(y0, radiusBottom, -Math.PI / 2, phi);
    const bottomTangent = profile.length - 1;
    arc(y1, radiusTop, phi, Math.PI / 2);

    // The two tangent rings bound the lateral band.
    features.push(bottomTangent, bottomTangent + 1);
    return revolve(profile, features);
}

function boxGeometry(size) {
    const [x, y, z] = [size[0] / 2, size[1] / 2, size[2] / 2];
    // prettier-ignore
    const positions = [
        -x, -y, -z,  x, -y, -z,  x,  y, -z, -x,  y, -z,
        -x, -y,  z,  x, -y,  z,  x,  y,  z, -x,  y,  z
    ];
    // prettier-ignore
    const triIndices = [
        0, 2, 1, 0, 3, 2, // -Z
        4, 5, 6, 4, 6, 7, // +Z
        0, 1, 5, 0, 5, 4, // -Y
        3, 7, 6, 3, 6, 2, // +Y
        0, 4, 7, 0, 7, 3, // -X
        1, 2, 6, 1, 6, 5  // +X
    ];
    // prettier-ignore
    const lineIndices = [
        0, 1, 1, 2, 2, 3, 3, 0,
        4, 5, 5, 6, 6, 7, 7, 4,
        0, 4, 1, 5, 2, 6, 3, 7
    ];
    return geometry(positions, triIndices, lineIndices);
}

// A plane lies in XZ with its normal along +Y and is one-sided, so the solid form is a
// single quad wound to face +Y. An undefined extent means infinite along that axis: it
// gets a clamped quad plus a grid, and either way a normal arrow shows which side is up.
function planeGeometry(sizeX, sizeZ) {
    const infiniteX = sizeX === undefined;
    const infiniteZ = sizeZ === undefined;
    const x = (infiniteX ? INFINITE_PLANE_EXTENT * 2 : sizeX) / 2;
    const z = (infiniteZ ? INFINITE_PLANE_EXTENT * 2 : sizeZ) / 2;

    const positions = [-x, 0, -z, x, 0, -z, x, 0, z, -x, 0, z];
    const triIndices = [0, 2, 1, 0, 3, 2];
    const lineIndices = [0, 1, 1, 2, 2, 3, 3, 0];

    const gridLine = (ax, ay, az, bx, by, bz) => {
        const base = positions.length / 3;
        positions.push(ax, ay, az, bx, by, bz);
        lineIndices.push(base, base + 1);
    };

    if (infiniteX || infiniteZ) {
        for (let offset = -x; offset <= x; offset += INFINITE_PLANE_STEP) {
            gridLine(offset, 0, -z, offset, 0, z);
        }
        for (let offset = -z; offset <= z; offset += INFINITE_PLANE_STEP) {
            gridLine(-x, 0, offset, x, 0, offset);
        }
    }

    const arrow = Math.max(0.5, Math.min(x, z) * 0.25);
    gridLine(0, 0, 0, 0, arrow, 0);
    gridLine(0, arrow, 0, arrow * 0.25, arrow * 0.75, 0);
    gridLine(0, arrow, 0, -arrow * 0.25, arrow * 0.75, 0);
    gridLine(0, arrow, 0, 0, arrow * 0.75, arrow * 0.25);
    gridLine(0, arrow, 0, 0, arrow * 0.75, -arrow * 0.25);

    return geometry(positions, triIndices, lineIndices);
}

// Collects the triangles of every primitive of a mesh into one buffer, in mesh space.
// Morph targets are applied at their load-time weights so the debug shape matches what
// the physics engines build their colliders from.
function meshGeometry(gltf, meshIndex) {
    const mesh = gltf.meshes?.[meshIndex];
    if (mesh === undefined) {
        return undefined;
    }

    const positions = [];
    const triIndices = [];
    const lineIndices = [];
    const edges = new Set();
    let skippedNonTriangles = false;

    for (const primitive of mesh.primitives) {
        // 4 = TRIANGLES. Shapes are surfaces, so points and lines have nothing to show.
        if ((primitive.mode ?? 4) !== 4) {
            skippedNonTriangles = true;
            continue;
        }
        const positionIndex = primitive.attributes?.POSITION;
        if (positionIndex === undefined) {
            continue;
        }
        const accessor = gltf.accessors[positionIndex];
        const data = accessor.getNormalizedDeinterlacedView(gltf);

        const weights = mesh.weights ?? [];
        const targets = [];
        for (let i = 0; i < weights.length; i++) {
            const target = primitive.targets?.[i]?.POSITION;
            if (target !== undefined) {
                targets.push([
                    weights[i],
                    gltf.accessors[target].getNormalizedDeinterlacedView(gltf)
                ]);
            }
        }

        const base = positions.length / 3;
        for (let i = 0; i < accessor.count * 3; i++) {
            let value = data[i];
            for (const [weight, target] of targets) {
                value += weight * target[i];
            }
            positions.push(value);
        }

        const indices =
            primitive.indices !== undefined
                ? gltf.accessors[primitive.indices].getDeinterlacedView(gltf)
                : undefined;
        const count = indices !== undefined ? indices.length : accessor.count;
        for (let i = 0; i + 2 < count; i += 3) {
            const a = base + (indices !== undefined ? indices[i] : i);
            const b = base + (indices !== undefined ? indices[i + 1] : i + 1);
            const c = base + (indices !== undefined ? indices[i + 2] : i + 2);
            triIndices.push(a, b, c);
            for (const [from, to] of [
                [a, b],
                [b, c],
                [c, a]
            ]) {
                const key = from < to ? `${from}_${to}` : `${to}_${from}`;
                if (!edges.has(key)) {
                    edges.add(key);
                    lineIndices.push(from, to);
                }
            }
        }
    }

    if (skippedNonTriangles) {
        console.warn(`Mesh ${meshIndex} is used as a shape but has non-triangle primitives`);
    }
    if (positions.length === 0) {
        return undefined;
    }
    return geometry(positions, triIndices, lineIndices);
}

// Builds the drawable geometry for a shape in its own local space, or undefined when the
// shape cannot be visualised. Convex hulls are drawn as their source mesh for now, which
// over-reports concavity but never misplaces the shape.
function shapeGeometry(gltf, shape) {
    const parameters = shape.parameters();
    switch (shape.type) {
        case "box":
            return boxGeometry(parameters?.size ?? [1, 1, 1]);
        case "sphere":
            return sphereGeometry(parameters?.radius ?? 0.5);
        case "cylinder":
            return cylinderGeometry(
                parameters?.height ?? 2.0,
                parameters?.radiusBottom ?? 0.5,
                parameters?.radiusTop ?? 0.5
            );
        case "capsule":
            return capsuleGeometry(
                parameters?.height ?? 1.0,
                parameters?.radiusBottom ?? 0.5,
                parameters?.radiusTop ?? 0.5
            );
        case "plane":
            return planeGeometry(parameters?.sizeX, parameters?.sizeZ);
        case "mesh":
        case "convexMesh":
            return parameters?.mesh !== undefined ? meshGeometry(gltf, parameters.mesh) : undefined;
        default:
            return undefined;
    }
}

// Identifies the geometry a shape currently describes. Animated properties change this,
// which is what drives the rebuild, so it must cover every parameter a generator reads.
function shapeGeometryKey(shape) {
    const parameters = shape.parameters();
    switch (shape.type) {
        case "box":
            return `box:${Array.from(parameters?.size ?? [1, 1, 1]).join(",")}`;
        case "sphere":
            return `sphere:${parameters?.radius ?? 0.5}`;
        case "cylinder":
        case "capsule":
            return `${shape.type}:${parameters?.height}:${parameters?.radiusBottom}:${parameters?.radiusTop}`;
        case "plane":
            return `plane:${parameters?.sizeX}:${parameters?.sizeZ}`;
        case "mesh":
        case "convexMesh":
            return `${shape.type}:${parameters?.mesh}`;
        default:
            return `unsupported:${shape.type}`;
    }
}

const SHAPE_TYPE_COLORS = {
    box: [0.33, 0.73, 1.0],
    sphere: [1.0, 0.76, 0.24],
    cylinder: [0.49, 0.89, 0.46],
    capsule: [0.93, 0.47, 0.84],
    plane: [0.55, 0.6, 1.0],
    mesh: [1.0, 0.52, 0.35],
    convexMesh: [0.36, 0.89, 0.86]
};

const DEPTH_COLORS = [
    [0.4, 0.8, 1.0],
    [0.46, 0.93, 0.6],
    [1.0, 0.86, 0.35],
    [1.0, 0.56, 0.37],
    [0.95, 0.42, 0.62],
    [0.69, 0.53, 1.0]
];

const UNIFORM_COLOR = [0.3, 1.0, 0.45];
const WARNING_COLOR = [1.0, 0.25, 0.2];

function shapeColor(colorMode, shape, depth) {
    if (colorMode === "type") {
        return SHAPE_TYPE_COLORS[shape?.type] ?? UNIFORM_COLOR;
    }
    if (colorMode === "depth") {
        return DEPTH_COLORS[depth % DEPTH_COLORS.length];
    }
    return UNIFORM_COLOR;
}

// Axis-aligned bounds of a position buffer after a transform, used by the enclosure
// diagnostics. Returns undefined for empty input.
function transformedBounds(positions, transform) {
    if (positions.length === 0) {
        return undefined;
    }
    const min = vec3.fromValues(Infinity, Infinity, Infinity);
    const max = vec3.fromValues(-Infinity, -Infinity, -Infinity);
    const point = vec3.create();
    for (let i = 0; i < positions.length; i += 3) {
        vec3.set(point, positions[i], positions[i + 1], positions[i + 2]);
        if (transform !== undefined) {
            vec3.transformMat4(point, point, transform);
        }
        vec3.min(min, min, point);
        vec3.max(max, max, point);
    }
    return { min, max };
}

// The 8 corners of a bounds box as a position buffer, so that a transformed bounding box
// can be re-derived without revisiting the geometry it came from.
function boundsCorners(bounds) {
    if (bounds === undefined) {
        return new Float32Array(0);
    }
    const { min, max } = bounds;
    const corners = [];
    for (const x of [min[0], max[0]]) {
        for (const y of [min[1], max[1]]) {
            for (const z of [min[2], max[2]]) {
                corners.push(x, y, z);
            }
        }
    }
    return new Float32Array(corners);
}

function boundsContain(outer, inner, epsilon = 1e-4) {
    if (outer === undefined || inner === undefined) {
        return true;
    }
    for (let i = 0; i < 3; i++) {
        if (inner.min[i] < outer.min[i] - epsilon || inner.max[i] > outer.max[i] + epsilon) {
            return false;
        }
    }
    return true;
}

export {
    boundsContain,
    boundsCorners,
    boxGeometry,
    capsuleGeometry,
    cylinderGeometry,
    meshGeometry,
    planeGeometry,
    shapeColor,
    shapeGeometry,
    shapeGeometryKey,
    sphereGeometry,
    transformedBounds,
    DEPTH_COLORS,
    SHAPE_TYPE_COLORS,
    UNIFORM_COLOR,
    WARNING_COLOR
};
