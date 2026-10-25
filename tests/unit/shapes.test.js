import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { mat4 } from "gl-matrix";

import { gltfShape } from "../../source/gltf/shape.js";
import { gltfBoundingVolume } from "../../source/gltf/bounding_volume.js";
import { gltfNode } from "../../source/gltf/node.js";

let warnSpy;
beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
    warnSpy.mockRestore();
});

function shape(json) {
    const value = new gltfShape();
    value.fromJson(json);
    return value;
}

// Defaults follow the glTF 2.1 schema, which differs from the draft KHR_implicit_shapes
// extension the renderer previously implemented.
describe("shape defaults", () => {
    it("defaults a box to a unit cube", () => {
        expect(shape({ type: "box", box: {} }).box.size).toEqual([1, 1, 1]);
    });

    it("defaults a sphere radius to 0.5", () => {
        expect(shape({ type: "sphere", sphere: {} }).sphere.radius).toBe(0.5);
    });

    it("defaults a cylinder to height 2 and radius 0.5", () => {
        const cylinder = shape({ type: "cylinder", cylinder: {} }).cylinder;

        expect(cylinder.height).toBe(2.0);
        expect(cylinder.radiusTop).toBe(0.5);
        expect(cylinder.radiusBottom).toBe(0.5);
    });

    it("defaults a capsule to mid-height 1 and radius 0.5", () => {
        const capsule = shape({ type: "capsule", capsule: {} }).capsule;

        expect(capsule.height).toBe(1.0);
        expect(capsule.radiusTop).toBe(0.5);
        expect(capsule.radiusBottom).toBe(0.5);
    });

    it("leaves plane extents undefined, meaning infinite", () => {
        const plane = shape({ type: "plane", plane: {} }).plane;

        expect(plane.sizeX).toBeUndefined();
        expect(plane.sizeZ).toBeUndefined();
    });

    it("reads explicit values over defaults", () => {
        expect(shape({ type: "sphere", sphere: { radius: 3 } }).sphere.radius).toBe(3);
    });
});

describe("mesh shapes", () => {
    it("parses a generic mesh shape", () => {
        const value = shape({ type: "mesh", mesh: { mesh: 2 } });

        expect(value.mesh.mesh).toBe(2);
        expect(value.parameters()).toBe(value.mesh);
    });

    it("parses a convex mesh shape", () => {
        const value = shape({ type: "convexMesh", convexMesh: { mesh: 1 } });

        expect(value.convexMesh.mesh).toBe(1);
        expect(value.parameters()).toBe(value.convexMesh);
    });
});

describe("shape type handling", () => {
    it("resolves the parameter object matching the type", () => {
        const value = shape({ type: "box", box: { size: [2, 3, 4] } });

        expect(value.parameters().size).toEqual([2, 3, 4]);
    });

    it("accepts a shape with no parameter object, using defaults", () => {
        expect(shape({ type: "box" }).parameters()).toBeUndefined();
        expect(warnSpy).not.toHaveBeenCalled();
    });

    it("warns about a type it does not know", () => {
        shape({ type: "torus" });

        expect(warnSpy).toHaveBeenCalled();
    });
});

// KhronosGroup/glTF#2666 pins the order: the bounding volume's own TRS takes the shape
// into the node's local space, and only then does the node's global transform apply.
describe("bounding volume transform", () => {
    it("defaults to an identity transform", () => {
        const volume = new gltfBoundingVolume();
        volume.fromJson({ shape: 0 });

        expect(Array.from(volume.getLocalTransform())).toEqual(Array.from(mat4.create()));
    });

    it("applies its own TRS before the node's world transform", () => {
        const volume = new gltfBoundingVolume();
        volume.fromJson({ shape: 0, translation: [1, 0, 0] });

        const node = new gltfNode();
        node.worldTransform = mat4.fromScaling(mat4.create(), [2, 2, 2]);

        // Scaling after translating puts the volume at x = 2; the other order gives 1.
        const world = volume.getWorldTransform(node);
        expect(Array.from(world.slice(12, 15))).toEqual([2, 0, 0]);
    });

    it("warns when the required shape index is missing", () => {
        new gltfBoundingVolume().fromJson({});

        expect(warnSpy).toHaveBeenCalled();
    });
});

describe("node bounding volume", () => {
    it("parses a bounding volume off a node", () => {
        const node = new gltfNode();
        node.fromJson({ boundingVolume: { shape: 3, scale: [2, 2, 2] } });

        expect(node.boundingVolume.shape).toBe(3);
        expect(Array.from(node.boundingVolume.scale)).toEqual([2, 2, 2]);
    });

    it("leaves boundingVolume undefined when the node has none", () => {
        const node = new gltfNode();
        node.fromJson({});

        expect(node.boundingVolume).toBeUndefined();
    });
});
