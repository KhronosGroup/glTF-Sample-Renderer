import { describe, expect, it } from "vitest";
import { mat4, vec3 } from "gl-matrix";

import { installWebGlConstants } from "../helpers/webgl_constants.js";
import { aabbOutsideFrustum, frustumPlanes } from "../../source/Renderer/frustum.js";
import { shapeBounds } from "../../source/Renderer/debug_geometry.js";
import { gltfShape } from "../../source/gltf/shape.js";

installWebGlConstants();

// Looking down -Z from the origin, which is the glTF camera convention.
function viewProjection({ fov = Math.PI / 4, near = 0.1, far = 100 } = {}) {
    const projection = mat4.perspective(mat4.create(), fov, 1, near, far);
    const view = mat4.lookAt(mat4.create(), [0, 0, 0], [0, 0, -1], [0, 1, 0]);
    return mat4.multiply(mat4.create(), projection, view);
}

function boxAt([x, y, z], half = 0.5) {
    return {
        min: vec3.fromValues(x - half, y - half, z - half),
        max: vec3.fromValues(x + half, y + half, z + half)
    };
}

function outside(bounds, options) {
    return aabbOutsideFrustum(frustumPlanes(viewProjection(options)), bounds.min, bounds.max);
}

function shapeOf(json) {
    const shape = new gltfShape();
    shape.fromJson(json);
    return shape;
}

describe("frustum rejection", () => {
    it("keeps a box in front of the camera", () => {
        expect(outside(boxAt([0, 0, -5]))).toBe(false);
    });

    it("rejects a box behind the camera", () => {
        expect(outside(boxAt([0, 0, 5]))).toBe(true);
    });

    it("rejects a box beyond the far plane", () => {
        expect(outside(boxAt([0, 0, -500]))).toBe(true);
    });

    it("rejects a box off to the side", () => {
        expect(outside(boxAt([100, 0, -5]))).toBe(true);
        expect(outside(boxAt([0, 100, -5]))).toBe(true);
    });

    it("keeps a box that only straddles an edge", () => {
        // Rejection must be conservative: partly visible still has to be drawn.
        const straddling = {
            min: vec3.fromValues(-100, -0.5, -5.5),
            max: vec3.fromValues(-1, 0.5, -4.5)
        };

        expect(outside(straddling)).toBe(false);
    });

    it("keeps a box enclosing the camera", () => {
        expect(outside(boxAt([0, 0, 0], 10))).toBe(false);
    });

    it("widens what it keeps as the field of view grows", () => {
        const offToTheSide = boxAt([4, 0, -5]);

        expect(outside(offToTheSide, { fov: Math.PI / 8 })).toBe(true);
        expect(outside(offToTheSide, { fov: (Math.PI * 7) / 8 })).toBe(false);
    });
});

describe("shape bounds", () => {
    it("measures a box", () => {
        const bounds = shapeBounds({}, shapeOf({ type: "box", box: { size: [2, 4, 6] } }));

        expect(Array.from(bounds.min)).toEqual([-1, -2, -3]);
        expect(Array.from(bounds.max)).toEqual([1, 2, 3]);
    });

    it("measures a sphere", () => {
        const bounds = shapeBounds({}, shapeOf({ type: "sphere", sphere: { radius: 3 } }));

        expect(Array.from(bounds.max)).toEqual([3, 3, 3]);
    });

    it("takes the wider end of a tapered cylinder", () => {
        const bounds = shapeBounds(
            {},
            shapeOf({ type: "cylinder", cylinder: { height: 4, radiusBottom: 2, radiusTop: 1 } })
        );

        expect(Array.from(bounds.max)).toEqual([2, 2, 2]);
    });

    it("includes the caps of a capsule", () => {
        // height is between the cap centres, so the extent is height/2 + radius.
        const bounds = shapeBounds(
            {},
            shapeOf({ type: "capsule", capsule: { height: 2, radiusBottom: 1, radiusTop: 0.5 } })
        );

        expect(bounds.min[1]).toBe(-2);
        expect(bounds.max[1]).toBe(1.5);
    });

    it("uses the 2.1 defaults when a shape has no parameters", () => {
        expect(Array.from(shapeBounds({}, shapeOf({ type: "box" })).max)).toEqual([0.5, 0.5, 0.5]);
        expect(shapeBounds({}, shapeOf({ type: "sphere" })).max[0]).toBe(0.5);
    });

    it("refuses to measure an infinite plane", () => {
        // Undefined rather than empty: the caller must read it as "cannot cull".
        expect(shapeBounds({}, shapeOf({ type: "plane" }))).toBeUndefined();
        expect(shapeBounds({}, shapeOf({ type: "plane", plane: { sizeX: 2 } }))).toBeUndefined();
    });

    it("measures a plane with both extents", () => {
        const bounds = shapeBounds({}, shapeOf({ type: "plane", plane: { sizeX: 4, sizeZ: 6 } }));

        expect(Array.from(bounds.max)).toEqual([2, 0, 3]);
    });

    it("measures a mesh shape from its accessor bounds", () => {
        const gltf = {
            meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
            accessors: [{ min: [-1, -2, -3], max: [1, 2, 3] }]
        };

        expect(
            Array.from(shapeBounds(gltf, shapeOf({ type: "mesh", mesh: { mesh: 0 } })).max)
        ).toEqual([1, 2, 3]);
    });

    it("refuses to measure a mesh with no accessor bounds", () => {
        const gltf = {
            meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
            accessors: [{}]
        };

        expect(shapeBounds(gltf, shapeOf({ type: "mesh", mesh: { mesh: 0 } }))).toBeUndefined();
        expect(shapeBounds(gltf, shapeOf({ type: "mesh" }))).toBeUndefined();
    });
});
