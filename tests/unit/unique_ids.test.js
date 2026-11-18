import { describe, expect, it } from "vitest";

import { installWebGlConstants } from "../helpers/webgl_constants.js";
import { glTF } from "../../source/gltf/gltf.js";

installWebGlConstants();

// Unique IDs live in the top-level `uniqueIds` object: a map of uid string to a
// `{ pointer }` JSON pointer. The renderer inverts that into a pointer -> uid lookup so
// an object can be labelled with its uid, but it never writes a `uid` back onto the
// object itself.

function documentOf(json) {
    const gltf = new glTF("uid.gltf");
    gltf.fromJson({ asset: { version: "2.1" }, ...json });
    return gltf;
}

describe("unique ids", () => {
    it("inverts uniqueIds into a pointer -> uid lookup", () => {
        const gltf = documentOf({
            uniqueIds: {
                12345: { pointer: "/nodes/0" },
                "mesh-uid": { pointer: "/meshes/0" },
                "mat-uid": { pointer: "/materials/0" }
            },
            nodes: [{ name: "Box" }],
            meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
            materials: [{}]
        });

        expect(gltf.uidAt("/nodes/0")).toBe("12345");
        expect(gltf.uidAt("/meshes/0")).toBe("mesh-uid");
        expect(gltf.uidAt("/materials/0")).toBe("mat-uid");
    });

    it("does not write a uid onto the object the pointer names", () => {
        const gltf = documentOf({
            uniqueIds: { 12345: { pointer: "/nodes/0" } },
            nodes: [{ name: "Box" }]
        });

        expect(gltf.nodes[0].uid).toBeUndefined();
        expect(gltf.uidAt("/nodes/0")).toBe("12345");
    });

    it("returns undefined for a pointer without a uid", () => {
        const gltf = documentOf({ nodes: [{ name: "Box" }] });

        expect(gltf.uidAt("/nodes/0")).toBeUndefined();
    });

    it("loads an asset using uniqueIds without complaint", () => {
        expect(() =>
            documentOf({
                uniqueIds: {
                    "scene-1": { pointer: "/scenes/0" },
                    "node-1": { pointer: "/nodes/0" }
                },
                scene: 0,
                scenes: [{ nodes: [0] }],
                nodes: [{ name: "Root" }]
            })
        ).not.toThrow();
    });
});
