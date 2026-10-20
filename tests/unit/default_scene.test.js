import { describe, expect, it } from "vitest";

import { installWebGlConstants } from "../helpers/webgl_constants.js";
import { glTF } from "../../source/gltf/gltf.js";

installWebGlConstants();

// glTF 2.1 deprecates multiple scenes and lets a file declare none at all. Every pass in
// the renderer starts from a scene, so one is stood up over the node hierarchy's roots.
// glTF 2.0 requires the array and keeps its old behaviour.

function parse(json) {
    const gltf = new glTF("test.gltf");
    gltf.fromJson(json);
    return gltf;
}

describe("an asset that declares no scenes", () => {
    it("gives a 2.1 asset a scene over its root nodes", () => {
        const gltf = parse({
            asset: { version: "2.1" },
            nodes: [{ name: "Root", children: [1] }, { name: "Child" }]
        });

        expect(gltf.scene).toBe(0);
        expect(gltf.scenes).toHaveLength(1);
        expect(gltf.scenes[0].nodes).toEqual([0]);
    });

    it("keeps every root, not just the first", () => {
        const gltf = parse({
            asset: { version: "2.1" },
            nodes: [{ name: "A", children: [2] }, { name: "B" }, { name: "AChild" }]
        });

        expect(gltf.scenes[0].nodes).toEqual([0, 1]);
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
