import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import { installWebGlConstants } from "../helpers/webgl_constants.js";
import { gltfPrimitive } from "../../source/gltf/primitive.js";

installWebGlConstants();

// glTF 2.1 relaxes the glTF 2.0 rule that TEXCOORD_n and COLOR_n must start at 0 and be
// consecutive. The shaders still declare a fixed number of varyings, so the file's set
// indices are mapped onto contiguous shader slots in ascending order.

let warnSpy;
beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
    warnSpy.mockRestore();
});

function primitiveWith(attributes) {
    const primitive = new gltfPrimitive();
    primitive.attributes = attributes;
    primitive.assignIndexedAttributeSlots();
    return primitive;
}

describe("texture coordinate slot assignment", () => {
    it("is the identity for conventional glTF 2.0 attributes", () => {
        const primitive = primitiveWith({ POSITION: 0, TEXCOORD_0: 1, TEXCOORD_1: 2 });

        expect(primitive.mapTexCoord(0)).toBe(0);
        expect(primitive.mapTexCoord(1)).toBe(1);
    });

    it("maps a set that does not start at zero onto the first slot", () => {
        const primitive = primitiveWith({ POSITION: 0, TEXCOORD_5: 1 });

        expect(primitive.mapTexCoord(5)).toBe(0);
    });

    it("compacts non-consecutive sets in ascending order", () => {
        const primitive = primitiveWith({ POSITION: 0, TEXCOORD_1: 1, TEXCOORD_3: 2 });

        expect(primitive.mapTexCoord(1)).toBe(0);
        expect(primitive.mapTexCoord(3)).toBe(1);
    });

    it("assigns slots by index order, not by declaration order", () => {
        const primitive = primitiveWith({ TEXCOORD_7: 1, POSITION: 0, TEXCOORD_2: 2 });

        expect(primitive.mapTexCoord(2)).toBe(0);
        expect(primitive.mapTexCoord(7)).toBe(1);
    });

    it("leaves an undefined texCoord undefined so the uniform stays unset", () => {
        const primitive = primitiveWith({ POSITION: 0, TEXCOORD_0: 1 });

        expect(primitive.mapTexCoord(undefined)).toBeUndefined();
    });

    it("falls back to the first slot and warns once for a set it does not have", () => {
        const primitive = primitiveWith({ POSITION: 0, TEXCOORD_0: 1 });

        expect(primitive.mapTexCoord(2)).toBe(0);
        expect(primitive.mapTexCoord(2)).toBe(0);
        expect(warnSpy).toHaveBeenCalledTimes(1);
    });

    it("carries more than the two sets glTF 2.0 allowed", () => {
        const primitive = primitiveWith({
            POSITION: 0,
            TEXCOORD_0: 1,
            TEXCOORD_2: 2,
            TEXCOORD_4: 3,
            TEXCOORD_6: 4
        });

        expect([0, 2, 4, 6].map((set) => primitive.mapTexCoord(set))).toEqual([0, 1, 2, 3]);
        expect(warnSpy).not.toHaveBeenCalled();
    });

    it("drops sets beyond the shader's slot budget and says so", () => {
        const attributes = { POSITION: 0 };
        for (let set = 0; set <= gltfPrimitive.maxTexCoordSlots; set++) {
            attributes[`TEXCOORD_${set}`] = set + 1;
        }
        const primitive = primitiveWith(attributes);

        expect(primitive.texCoordSlots.size).toBe(gltfPrimitive.maxTexCoordSlots);
        // The set that did not fit falls back rather than shifting the others along.
        expect(primitive.mapTexCoord(gltfPrimitive.maxTexCoordSlots)).toBe(0);
        expect(primitive.mapTexCoord(gltfPrimitive.maxTexCoordSlots - 1)).toBe(
            gltfPrimitive.maxTexCoordSlots - 1
        );
        expect(warnSpy).toHaveBeenCalled();
    });
});

describe("vertex colour slot assignment", () => {
    it("maps the lowest colour set onto the only slot", () => {
        const primitive = primitiveWith({ POSITION: 0, COLOR_2: 1 });

        expect(primitive.colorSlots.get(2)).toBe(0);
    });

    it("keeps only the lowest set when several are present", () => {
        const primitive = primitiveWith({ POSITION: 0, COLOR_1: 1, COLOR_4: 2 });

        expect(primitive.colorSlots.get(1)).toBe(0);
        expect(primitive.colorSlots.has(4)).toBe(false);
        expect(warnSpy).toHaveBeenCalled();
    });
});

describe("primaryTexCoordAttribute", () => {
    // Tangent generation needs the primary set. Under glTF 2.0 that was always
    // TEXCOORD_0, so consumers hardcoded the name; under 2.1 it can be any index.
    it("is TEXCOORD_0 for a conventional primitive", () => {
        const primitive = primitiveWith({ POSITION: 0, TEXCOORD_0: 1, TEXCOORD_1: 2 });

        expect(primitive.primaryTexCoordAttribute()).toBe("TEXCOORD_0");
    });

    it("is the lowest set when the indices do not start at zero", () => {
        const primitive = primitiveWith({ POSITION: 0, TEXCOORD_3: 1, TEXCOORD_7: 2 });

        expect(primitive.primaryTexCoordAttribute()).toBe("TEXCOORD_3");
    });

    it("is undefined when the primitive has no texture coordinates", () => {
        const primitive = primitiveWith({ POSITION: 0, NORMAL: 1 });

        expect(primitive.primaryTexCoordAttribute()).toBeUndefined();
    });
});

describe("shaderAttributeName", () => {
    it("renames indexed semantics to their slot", () => {
        const primitive = primitiveWith({ POSITION: 0, TEXCOORD_3: 1, COLOR_2: 2 });

        expect(primitive.shaderAttributeName("TEXCOORD_3")).toBe("TEXCOORD_0");
        expect(primitive.shaderAttributeName("COLOR_2")).toBe("COLOR_0");
    });

    it("leaves unindexed semantics alone", () => {
        const primitive = primitiveWith({ POSITION: 0, NORMAL: 1 });

        expect(primitive.shaderAttributeName("POSITION")).toBe("POSITION");
        expect(primitive.shaderAttributeName("NORMAL")).toBe("NORMAL");
        expect(primitive.shaderAttributeName("JOINTS_0")).toBe("JOINTS_0");
    });

    it("leaves a semantic the primitive does not carry alone", () => {
        const primitive = primitiveWith({ POSITION: 0, TEXCOORD_0: 1 });

        expect(primitive.shaderAttributeName("TEXCOORD_9")).toBe("TEXCOORD_9");
    });
});
