import { describe, expect, it } from "vitest";

import { installWebGlConstants } from "../helpers/webgl_constants.js";
import { glTF } from "../../source/gltf/gltf.js";

installWebGlConstants();

// `uid` is still an open explainer rather than spec text: it does not appear in the 2.1
// draft, and the explainer is undecided between a separate property and reusing `name`.
// Nothing in the format references a uid, so there is no behaviour to implement yet.
// These pin only that an asset carrying uids survives a round trip, so a 2.1 file is not
// rejected or silently stripped while the design settles.

function documentOf(json) {
    const gltf = new glTF("uid.gltf");
    gltf.fromJson({ asset: { version: "2.1" }, ...json });
    return gltf;
}

describe("unique ids", () => {
    it("keeps a uid on the objects that carry one", () => {
        const gltf = documentOf({
            nodes: [{ name: "Box", uid: "12345" }],
            meshes: [{ uid: "mesh-uid", primitives: [{ attributes: { POSITION: 0 } }] }],
            materials: [{ uid: "mat-uid" }]
        });

        expect(gltf.nodes[0].uid).toBe("12345");
        expect(gltf.meshes[0].uid).toBe("mesh-uid");
        expect(gltf.materials[0].uid).toBe("mat-uid");
    });

    it("leaves name alone, since the two are independent", () => {
        const gltf = documentOf({ nodes: [{ name: "Box", uid: "Crate" }] });

        expect(gltf.nodes[0].name).toBe("Box");
        expect(gltf.nodes[0].uid).toBe("Crate");
    });

    it("does not invent a uid for an object without one", () => {
        const gltf = documentOf({ nodes: [{ name: "Box" }] });

        expect(gltf.nodes[0].uid).toBeUndefined();
    });

    it("loads an asset using uids without complaint", () => {
        expect(() =>
            documentOf({
                scene: 0,
                scenes: [{ uid: "scene-1", nodes: [0] }],
                nodes: [{ uid: "node-1", name: "Root" }]
            })
        ).not.toThrow();
    });
});
