import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import {
    boundsContain,
    boundsCorners,
    boxGeometry,
    capsuleGeometry,
    cylinderGeometry,
    meshGeometry,
    planeGeometry,
    shapeGeometry,
    shapeGeometryKey,
    sphereGeometry,
    transformedBounds
} from "../../source/Renderer/debug_geometry.js";
import { gltfShape } from "../../source/gltf/shape.js";

function bounds(geometry) {
    return transformedBounds(geometry.positions, undefined);
}

function extent(geometry, axis) {
    const { min, max } = bounds(geometry);
    return [min[axis], max[axis]];
}

// The widest point of a surface of revolution around Y.
function maxRadius(geometry) {
    let result = 0;
    for (let i = 0; i < geometry.positions.length; i += 3) {
        const x = geometry.positions[i];
        const z = geometry.positions[i + 2];
        result = Math.max(result, Math.hypot(x, z));
    }
    return result;
}

// The heights at which the wireframe draws a latitude ring. A ring edge joins two
// vertices at the same height; a meridian edge does not.
function wireframeRingHeights(geometry) {
    const heights = new Set();
    for (let i = 0; i < geometry.lineIndices.length; i += 2) {
        const a = geometry.lineIndices[i] * 3;
        const b = geometry.lineIndices[i + 1] * 3;
        if (Math.abs(geometry.positions[a + 1] - geometry.positions[b + 1]) < 1e-6) {
            heights.add(Number(geometry.positions[a + 1].toFixed(4)));
        }
    }
    return heights;
}

function shapeOf(json) {
    const shape = new gltfShape();
    shape.fromJson(json);
    return shape;
}

describe("box geometry", () => {
    it("spans the requested size centred on the origin", () => {
        const geometry = boxGeometry([2, 4, 6]);

        expect(extent(geometry, 0)).toEqual([-1, 1]);
        expect(extent(geometry, 1)).toEqual([-2, 2]);
        expect(extent(geometry, 2)).toEqual([-3, 3]);
    });

    it("is a closed box with the 12 edges of a cube", () => {
        const geometry = boxGeometry([1, 1, 1]);

        expect(geometry.positions.length / 3).toBe(8);
        expect(geometry.triIndices.length).toBe(36);
        expect(geometry.lineIndices.length).toBe(24);
    });
});

describe("sphere geometry", () => {
    it("keeps every vertex on the sphere", () => {
        const geometry = sphereGeometry(2);

        for (let i = 0; i < geometry.positions.length; i += 3) {
            const radius = Math.hypot(
                geometry.positions[i],
                geometry.positions[i + 1],
                geometry.positions[i + 2]
            );
            expect(radius).toBeCloseTo(2, 5);
        }
    });
    it("draws a ring at the equator", () => {
        // The equator is the silhouette. Sampling rings by stride alone skips it.
        expect(wireframeRingHeights(sphereGeometry(2))).toContain(0);
    });
});

describe("cylinder geometry", () => {
    it("draws a ring at each rim", () => {
        expect(wireframeRingHeights(cylinderGeometry(4, 1, 1))).toEqual(new Set([-2, 2]));
    });

    it("spans the height along Y and the radius around it", () => {
        const geometry = cylinderGeometry(4, 1, 1);

        expect(extent(geometry, 1)).toEqual([-2, 2]);
        expect(maxRadius(geometry)).toBeCloseTo(1, 5);
    });

    it("tapers to a point when the top radius is zero", () => {
        const geometry = cylinderGeometry(2, 1, 0);
        const apex = [];
        for (let i = 0; i < geometry.positions.length; i += 3) {
            if (geometry.positions[i + 1] > 0.9) {
                apex.push(Math.hypot(geometry.positions[i], geometry.positions[i + 2]));
            }
        }

        expect(apex.length).toBeGreaterThan(0);
        expect(Math.max(...apex)).toBeCloseTo(0, 5);
    });
});

describe("capsule geometry", () => {
    it("measures height between the cap centres, not overall", () => {
        // height 2 with radius 1 caps reaches 4 from end to end.
        expect(extent(capsuleGeometry(2, 1, 1), 1)[0]).toBeCloseTo(-2, 5);
        expect(extent(capsuleGeometry(2, 1, 1), 1)[1]).toBeCloseTo(2, 5);
    });

    it("reaches each radius at its own end", () => {
        const geometry = capsuleGeometry(2, 1, 0.5);

        expect(extent(geometry, 1)[0]).toBeCloseTo(-2, 5);
        expect(extent(geometry, 1)[1]).toBeCloseTo(1.5, 5);
    });

    it("joins unequal caps along their common tangent", () => {
        // A tapered capsule is not a cylinder with different end caps: the lateral surface
        // leaves each sphere at the tangent angle, so the widest point is below the radius.
        const geometry = capsuleGeometry(2, 1, 0.5);
        const phi = Math.asin((0.5 - 1) / 2);

        expect(maxRadius(geometry)).toBeCloseTo(Math.cos(phi), 4);
        expect(maxRadius(geometry)).toBeLessThan(1);
    });

    it("survives a sphere that swallows the other", () => {
        expect(() => capsuleGeometry(0.1, 5, 0.1)).not.toThrow();
        expect(() => capsuleGeometry(0, 1, 1)).not.toThrow();
    });

    it("draws a ring where each cap meets the lateral band", () => {
        // These two rings are the widest point of each cap and bound the lateral band.
        // Without them the meridians appear to run past the silhouette into nothing.
        const geometry = capsuleGeometry(2, 1, 0.5);
        const phi = Math.asin((0.5 - 1) / 2);
        const heights = wireframeRingHeights(geometry);

        expect(heights).toContain(Number((-1 + Math.sin(phi)).toFixed(4)));
        expect(heights).toContain(Number((1 + 0.5 * Math.sin(phi)).toFixed(4)));
    });

    it("draws a ring at its widest point", () => {
        const geometry = capsuleGeometry(2, 1, 0.5);
        const widest = maxRadius(geometry);
        let found = false;
        for (let i = 0; i < geometry.lineIndices.length; i += 2) {
            const a = geometry.lineIndices[i] * 3;
            const b = geometry.lineIndices[i + 1] * 3;
            const sameHeight =
                Math.abs(geometry.positions[a + 1] - geometry.positions[b + 1]) < 1e-6;
            const radius = Math.hypot(geometry.positions[a], geometry.positions[a + 2]);
            if (sameHeight && Math.abs(radius - widest) < 1e-4) {
                found = true;
            }
        }

        expect(found).toBe(true);
    });
});

describe("plane geometry", () => {
    it("lies flat in XZ at the requested extents", () => {
        const geometry = planeGeometry(4, 6);
        const quad = geometry.positions.slice(0, 12);

        expect([quad[0], quad[3], quad[6], quad[9]].map(Math.abs)).toEqual([2, 2, 2, 2]);
        expect([quad[2], quad[5], quad[8], quad[11]].map(Math.abs)).toEqual([3, 3, 3, 3]);
        expect([quad[1], quad[4], quad[7], quad[10]]).toEqual([0, 0, 0, 0]);
    });

    it("adds a grid only when an extent is infinite", () => {
        const finite = planeGeometry(4, 6);
        const infinite = planeGeometry(undefined, undefined);

        expect(infinite.positions.length).toBeGreaterThan(finite.positions.length);
    });

    it("marks the facing direction with an arrow along +Y", () => {
        const geometry = planeGeometry(4, 6);

        expect(extent(geometry, 1)[1]).toBeGreaterThan(0);
        expect(extent(geometry, 1)[0]).toBe(0);
    });
});

describe("shape geometry defaults", () => {
    // A shape may omit its parameter object entirely. These are the 2.1 schema values,
    // which differ from the draft KHR_implicit_shapes ones a reader might remember.
    it.each([
        ["box", 1, [-0.5, 0.5]],
        ["sphere", 1, [-0.5, 0.5]],
        ["cylinder", 1, [-1, 1]],
        ["capsule", 1, [-1, 1]]
    ])("places an unparameterised %s at its default size", (type, _axis, expected) => {
        const geometry = shapeGeometry({}, shapeOf({ type }));
        const [min, max] = extent(geometry, 1);

        expect(min).toBeCloseTo(expected[0], 5);
        expect(max).toBeCloseTo(expected[1], 5);
    });

    it("matches an explicit shape to its equivalent default", () => {
        const explicit = shapeGeometry({}, shapeOf({ type: "sphere", sphere: { radius: 0.5 } }));
        const implicit = shapeGeometry({}, shapeOf({ type: "sphere" }));

        expect(Array.from(explicit.positions)).toEqual(Array.from(implicit.positions));
    });

    it("returns nothing for a shape it cannot draw", () => {
        expect(shapeGeometry({}, shapeOf({ type: "mesh" }))).toBeUndefined();
    });
});

describe("shape geometry key", () => {
    it("changes when a parameter changes", () => {
        const before = shapeGeometryKey(shapeOf({ type: "sphere", sphere: { radius: 1 } }));
        const after = shapeGeometryKey(shapeOf({ type: "sphere", sphere: { radius: 2 } }));

        expect(before).not.toBe(after);
    });

    it("tracks a live edit, so an animated shape rebuilds", () => {
        const shape = shapeOf({ type: "box", box: { size: [1, 1, 1] } });
        const before = shapeGeometryKey(shape);
        shape.box.size = [1, 2, 1];

        expect(shapeGeometryKey(shape)).not.toBe(before);
    });

    it("is stable across reads of an untouched shape", () => {
        const shape = shapeOf({ type: "cylinder", cylinder: { height: 3 } });

        expect(shapeGeometryKey(shape)).toBe(shapeGeometryKey(shape));
    });

    it("separates a convex hull from its source mesh", () => {
        expect(shapeGeometryKey(shapeOf({ type: "mesh", mesh: { mesh: 0 } }))).not.toBe(
            shapeGeometryKey(shapeOf({ type: "convexMesh", convexMesh: { mesh: 0 } }))
        );
    });
});

function stubGltf({ mode = 4, indices = [0, 1, 2], weights = undefined, targets = undefined }) {
    const positions = [0, 0, 0, 1, 0, 0, 0, 1, 0];
    const accessors = [
        { count: 3, getNormalizedDeinterlacedView: () => new Float32Array(positions) },
        {
            count: indices.length,
            getDeinterlacedView: () => new Uint16Array(indices),
            getNormalizedDeinterlacedView: () => new Uint16Array(indices)
        },
        {
            count: 3,
            getNormalizedDeinterlacedView: () => new Float32Array([0, 0, 0, 0, 0, 0, 0, 0, 1])
        }
    ];
    return {
        accessors,
        meshes: [
            {
                weights,
                primitives: [
                    {
                        mode,
                        attributes: { POSITION: 0 },
                        indices: indices === undefined ? undefined : 1,
                        targets
                    }
                ]
            }
        ]
    };
}

describe("mesh geometry", () => {
    let warnings;
    beforeEach(() => {
        warnings = [];
        vi.spyOn(console, "warn").mockImplementation((...args) => warnings.push(args.join(" ")));
    });
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("reads triangles and derives their edges", () => {
        const geometry = meshGeometry(stubGltf({}), 0);

        expect(geometry.positions.length / 3).toBe(3);
        expect(Array.from(geometry.triIndices)).toEqual([0, 1, 2]);
        expect(geometry.lineIndices.length).toBe(6);
    });

    it("emits a shared edge once", () => {
        const geometry = meshGeometry(stubGltf({ indices: [0, 1, 2, 2, 1, 0] }), 0);

        // Two triangles over the same three corners share all three edges.
        expect(geometry.lineIndices.length).toBe(6);
    });

    it("applies load-time morph weights", () => {
        const plain = meshGeometry(stubGltf({}), 0);
        const morphed = meshGeometry(stubGltf({ weights: [1], targets: [{ POSITION: 2 }] }), 0);

        expect(plain.positions[8]).toBe(0);
        expect(morphed.positions[8]).toBe(1);
    });

    it("warns and skips primitives that are not triangles", () => {
        expect(meshGeometry(stubGltf({ mode: 1 }), 0)).toBeUndefined();
        expect(warnings.join()).toMatch(/non-triangle/);
    });

    it("returns nothing for a mesh that does not exist", () => {
        expect(meshGeometry(stubGltf({}), 7)).toBeUndefined();
    });
});

describe("enclosure check", () => {
    it("accepts a volume that contains the geometry", () => {
        const outer = transformedBounds(boxGeometry([4, 4, 4]).positions, undefined);
        const inner = transformedBounds(boxGeometry([2, 2, 2]).positions, undefined);

        expect(boundsContain(outer, inner)).toBe(true);
        expect(boundsContain(inner, outer)).toBe(false);
    });

    it("tolerates a volume that exactly touches the geometry", () => {
        const box = transformedBounds(boxGeometry([2, 2, 2]).positions, undefined);

        expect(boundsContain(box, box)).toBe(true);
    });

    it("round-trips a bounds box through its corners", () => {
        const original = transformedBounds(boxGeometry([2, 4, 6]).positions, undefined);
        const restored = transformedBounds(boundsCorners(original), undefined);

        expect(Array.from(restored.min)).toEqual(Array.from(original.min));
        expect(Array.from(restored.max)).toEqual(Array.from(original.max));
    });
});
