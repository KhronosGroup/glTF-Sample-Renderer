import { describe, expect, it } from "vitest";

import { installWebGlConstants } from "../helpers/webgl_constants.js";
import { glTF } from "../../source/gltf/gltf.js";

installWebGlConstants();

// A document without a scenes array is a collection of objects, not a scene. It renders
// nothing on its own, and as an external asset it is a leaf that instantiates nothing.
// glTF 2.1 allows omitting the array; glTF 2.0 requires it and keeps its old behaviour.

function parse(json) {
    const gltf = new glTF("test.gltf");
    gltf.fromJson(json);
    return gltf;
}

describe("an asset that declares no scenes", () => {
    it("gives a 2.1 asset no scene", () => {
        const gltf = parse({
            asset: { version: "2.1" },
            nodes: [{ name: "Root", children: [1] }, { name: "Child" }]
        });

        expect(gltf.scene).toBeUndefined();
        expect(gltf.scenes).toEqual([]);
    });

    it("leaves a 2.0 asset without one, as that version requires", () => {
        const gltf = parse({ asset: { version: "2.0" }, nodes: [{ name: "Root" }] });

        expect(gltf.scenes).toEqual([]);
        expect(gltf.scene).toBeUndefined();
    });

    it("does not invent a scene for an asset with no nodes", () => {
        const gltf = parse({ asset: { version: "2.1" } });

        expect(gltf.scenes).toEqual([]);
    });

    it("leaves a declared scene alone", () => {
        const gltf = parse({
            asset: { version: "2.1" },
            scenes: [{ nodes: [1] }],
            nodes: [{ name: "Unreferenced" }, { name: "Shown" }]
        });

        expect(gltf.scenes).toHaveLength(1);
        expect(gltf.scenes[0].nodes).toEqual([1]);
    });
});
