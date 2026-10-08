import { describe, expect, it } from "vitest";
import { mat4, vec3 } from "gl-matrix";

import { installWebGlConstants } from "../helpers/webgl_constants.js";
import { instantiateExternalAssets } from "../../source/gltf/clone_document.js";
import { glTF } from "../../source/gltf/gltf.js";

installWebGlConstants();

const ALL_EXTENSIONS = {
    KHR_node_visibility: true,
    KHR_node_selectability: true,
    KHR_node_hoverability: true
};

function documentOf(json) {
    const gltf = new glTF("test.gltf");
    gltf.fromJson({ asset: { version: "2.1" }, ...json });
    gltf.addNodeMetaInformation();
    return gltf;
}

// A child whose single root sits one unit along +X.
function child(name = "childRoot") {
    return documentOf({
        scene: 0,
        scenes: [{ nodes: [0] }],
        nodes: [{ name, translation: [1, 0, 0], mesh: 0 }],
        meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }]
    });
}

function parentWith(nodes, childDocument) {
    const gltf = documentOf({
        scene: 0,
        scenes: [{ nodes: nodes.map((_, i) => i) }],
        nodes,
        files: [{ uri: "child.gltf", mimeType: "model/gltf+json" }],
        externalAssets: [{ file: 0 }]
    });
    gltf.externalAssets[0].document = childDocument;
    instantiateExternalAssets(gltf);
    return gltf;
}

function worldPositionOf(node) {
    return Array.from(vec3.transformMat4(vec3.create(), [0, 0, 0], node.worldTransform));
}

function instanceRoot(parent, nodeIndex) {
    return parent.nodes[nodeIndex].externalAssetInstance.nodes[0];
}

describe("gathering across documents", () => {
    it("includes the nodes of an instantiated asset", () => {
        const parent = parentWith([{ name: "slot", externalAsset: 0 }], child());

        const gathered = parent.scenes[0].gatherNodes(parent, ALL_EXTENSIONS);

        expect(gathered.nodes.map((node) => node.name)).toEqual(["slot", "childRoot"]);
    });

    it("gathers one copy per referencing node", () => {
        const parent = parentWith(
            [
                { name: "a", externalAsset: 0 },
                { name: "b", externalAsset: 0 }
            ],
            child()
        );

        const gathered = parent.scenes[0].gatherNodes(parent, ALL_EXTENSIONS);
        const roots = gathered.nodes.filter((node) => node.name === "childRoot");

        expect(roots).toHaveLength(2);
        expect(roots[0]).not.toBe(roots[1]);
    });

    it("tags every gathered node with the document that owns it", () => {
        const parent = parentWith([{ name: "slot", externalAsset: 0 }], child());

        const gathered = parent.scenes[0].gatherNodes(parent, ALL_EXTENSIONS);

        // The renderer resolves mesh and material indices through this.
        expect(gathered.nodes[0].ownerDocument).toBe(parent);
        expect(gathered.nodes[1].ownerDocument).toBe(parent.nodes[0].externalAssetInstance);
    });

    it("hides an instance when the node holding it is hidden", () => {
        const parent = parentWith([{ name: "slot", externalAsset: 0, visible: false }], child());

        const gathered = parent.scenes[0].gatherNodes(parent, ALL_EXTENSIONS);

        expect(gathered.nodes).toHaveLength(0);
    });

    it("descends through a nested instance", () => {
        const parent = parentWith(
            [{ name: "outer", externalAsset: 0 }],
            parentWith([{ name: "inner", externalAsset: 0 }], child())
        );

        const gathered = parent.scenes[0].gatherNodes(parent, ALL_EXTENSIONS);

        expect(gathered.nodes.map((node) => node.name)).toEqual(["outer", "inner", "childRoot"]);
    });

    it("uses the child's default scene rather than its first", () => {
        const twoScenes = documentOf({
            scene: 1,
            scenes: [{ nodes: [0] }, { nodes: [1] }],
            nodes: [{ name: "unused" }, { name: "default" }]
        });
        const parent = parentWith([{ name: "slot", externalAsset: 0 }], twoScenes);

        const gathered = parent.scenes[0].gatherNodes(parent, ALL_EXTENSIONS);

        expect(gathered.nodes.map((node) => node.name)).toEqual(["slot", "default"]);
    });

    it("ignores a child that has no scene to contribute", () => {
        const parent = parentWith(
            [{ name: "slot", externalAsset: 0 }],
            documentOf({ nodes: [{ name: "orphan" }] })
        );

        const gathered = parent.scenes[0].gatherNodes(parent, ALL_EXTENSIONS);

        expect(gathered.nodes.map((node) => node.name)).toEqual(["slot"]);
    });
});

describe("transforms across documents", () => {
    it("places the instance under the transform of the node holding it", () => {
        const parent = parentWith(
            [{ name: "slot", externalAsset: 0, translation: [10, 0, 0] }],
            child()
        );

        parent.scenes[0].applyTransformHierarchy(parent);

        expect(worldPositionOf(instanceRoot(parent, 0))).toEqual([11, 0, 0]);
    });

    it("keeps two instances of one asset apart", () => {
        const parent = parentWith(
            [
                { name: "a", externalAsset: 0, translation: [10, 0, 0] },
                { name: "b", externalAsset: 0, translation: [-10, 0, 0] }
            ],
            child()
        );

        parent.scenes[0].applyTransformHierarchy(parent);

        expect(worldPositionOf(instanceRoot(parent, 0))).toEqual([11, 0, 0]);
        expect(worldPositionOf(instanceRoot(parent, 1))).toEqual([-9, 0, 0]);
    });

    it("composes scale through the boundary", () => {
        const parent = parentWith([{ name: "slot", externalAsset: 0, scale: [2, 2, 2] }], child());

        parent.scenes[0].applyTransformHierarchy(parent);

        expect(worldPositionOf(instanceRoot(parent, 0))).toEqual([2, 0, 0]);
    });

    it("accumulates through nested instances", () => {
        const parent = parentWith(
            [{ name: "outer", externalAsset: 0, translation: [100, 0, 0] }],
            parentWith([{ name: "inner", externalAsset: 0, translation: [10, 0, 0] }], child())
        );

        parent.scenes[0].applyTransformHierarchy(parent);

        const inner = parent.nodes[0].externalAssetInstance.nodes[0];
        expect(worldPositionOf(inner)).toEqual([110, 0, 0]);
        expect(worldPositionOf(inner.externalAssetInstance.nodes[0])).toEqual([111, 0, 0]);
    });

    it("honours a root transform passed in from outside", () => {
        const parent = parentWith([{ name: "slot", externalAsset: 0 }], child());
        const root = mat4.fromTranslation(mat4.create(), [0, 5, 0]);

        parent.scenes[0].applyTransformHierarchy(parent, root);

        expect(worldPositionOf(instanceRoot(parent, 0))).toEqual([1, 5, 0]);
    });

    it("moves one instance without disturbing the other", () => {
        const parent = parentWith(
            [
                { name: "a", externalAsset: 0 },
                { name: "b", externalAsset: 0 }
            ],
            child()
        );

        instanceRoot(parent, 0).translation = [0, 7, 0];
        parent.scenes[0].applyTransformHierarchy(parent);

        expect(worldPositionOf(instanceRoot(parent, 0))).toEqual([0, 7, 0]);
        expect(worldPositionOf(instanceRoot(parent, 1))).toEqual([1, 0, 0]);
    });
});
