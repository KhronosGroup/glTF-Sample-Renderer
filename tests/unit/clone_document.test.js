import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import { installWebGlConstants } from "../helpers/webgl_constants.js";
import {
    cloneDocument,
    instantiateExternalAssets,
    CLONED_ARRAYS,
    MAX_INSTANCES,
    SHARED_ARRAYS
} from "../../source/gltf/clone_document.js";
import { glTF } from "../../source/gltf/gltf.js";

installWebGlConstants();

function documentOf(json) {
    const gltf = new glTF("test.gltf");
    gltf.fromJson({ asset: { version: "2.1" }, ...json });
    gltf.addNodeMetaInformation();
    return gltf;
}

const QUAD = {
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [
        { name: "root", translation: [1, 2, 3], children: [1] },
        { name: "child", mesh: 0 }
    ],
    meshes: [{ weights: [0.25], primitives: [{ attributes: { POSITION: 0 } }] }],
    materials: [{ name: "red" }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: "VEC3" }],
    bufferViews: [{ buffer: 0, byteLength: 36 }],
    buffers: [{ byteLength: 36 }],
    images: [{ uri: "a.png" }],
    samplers: [{}],
    textures: [{ source: 0, sampler: 0 }]
};

describe("clone policy", () => {
    it("gives every per-instance array its own elements", () => {
        const template = documentOf(QUAD);
        const copy = cloneDocument(template);

        for (const key of CLONED_ARRAYS) {
            for (let i = 0; i < template[key].length; i++) {
                expect(copy[key][i], `${key}[${i}] is shared`).not.toBe(template[key][i]);
            }
        }
    });

    it("shares the elements of every resource array", () => {
        const template = documentOf(QUAD);
        const copy = cloneDocument(template);

        for (const key of SHARED_ARRAYS) {
            for (let i = 0; i < template[key].length; i++) {
                expect(copy[key][i], `${key}[${i}] was copied`).toBe(template[key][i]);
            }
        }
    });

    it("still gives shared arrays their own container", () => {
        // A clone may append to these: a skin allocates its joint texture through them,
        // and that must not grow the template or any sibling.
        const template = documentOf(QUAD);
        const copy = cloneDocument(template);

        copy.textures.push({ source: 0 });

        expect(template.textures).toHaveLength(1);
    });

    it("shares primitives, which own the uploaded vertex buffers", () => {
        const template = documentOf(QUAD);
        const copy = cloneDocument(template);

        expect(copy.meshes[0]).not.toBe(template.meshes[0]);
        expect(copy.meshes[0].primitives[0]).toBe(template.meshes[0].primitives[0]);
    });

    it("shares the tangent cache, which is derived from shared accessors", () => {
        const template = documentOf(QUAD);

        expect(cloneDocument(template).tangentCache).toBe(template.tangentCache);
    });

    it("gives each document a distinct id", () => {
        const template = documentOf(QUAD);

        expect(cloneDocument(template).documentId).not.toBe(cloneDocument(template).documentId);
    });
});

describe("per-instance state", () => {
    it("separates node transforms", () => {
        const template = documentOf(QUAD);
        const copy = cloneDocument(template);

        copy.nodes[0].translation = [9, 9, 9];

        expect(Array.from(template.nodes[0].translation)).toEqual([1, 2, 3]);
    });

    it("separates the animatable property objects themselves", () => {
        const template = documentOf(QUAD);
        const copy = cloneDocument(template);

        expect(copy.nodes[0].animatedPropertyObjects.translation).not.toBe(
            template.nodes[0].animatedPropertyObjects.translation
        );
    });

    it("does not carry an animated value into a fresh instance", () => {
        const template = documentOf(QUAD);
        template.nodes[0].animatedPropertyObjects.translation.animate([7, 7, 7]);

        const copy = cloneDocument(template);

        expect(Array.from(copy.nodes[0].translation)).toEqual([1, 2, 3]);
    });

    it("separates morph weights", () => {
        const template = documentOf(QUAD);
        const copy = cloneDocument(template);

        copy.meshes[0].weights[0] = 1;

        expect(template.meshes[0].weights[0]).toBe(0.25);
    });

    it("separates node visibility", () => {
        const template = documentOf(QUAD);
        const copy = cloneDocument(template);

        copy.nodes[1].visible = false;

        expect(template.nodes[1].visible).toBe(true);
    });

    it("rebuilds parent links inside the clone", () => {
        const template = documentOf(QUAD);
        const copy = cloneDocument(template);

        expect(copy.nodes[1].parentNode).toBe(copy.nodes[0]);
        expect(copy.nodes[1].parentNode).not.toBe(template.nodes[0]);
    });

    it("keeps index references valid, since the arrays keep their order", () => {
        const template = documentOf(QUAD);
        const copy = cloneDocument(template);

        expect(copy.nodes[1].mesh).toBe(0);
        expect(copy.meshes[0].primitives[0].attributes.POSITION).toBe(0);
        expect(copy.accessors).toHaveLength(template.accessors.length);
    });
});

describe("instantiation", () => {
    let warnings;
    let errors;
    beforeEach(() => {
        warnings = [];
        errors = [];
        vi.spyOn(console, "warn").mockImplementation((...a) => warnings.push(a.join(" ")));
        vi.spyOn(console, "error").mockImplementation((...a) => errors.push(a.join(" ")));
    });
    afterEach(() => {
        vi.restoreAllMocks();
    });

    function parentOf(child, nodeCount = 1) {
        const nodes = [];
        for (let i = 0; i < nodeCount; i++) {
            nodes.push({ name: `slot${i}`, externalAsset: 0, translation: [i, 0, 0] });
        }
        const parent = documentOf({
            scene: 0,
            scenes: [{ nodes: nodes.map((_, i) => i) }],
            nodes,
            files: [{ uri: "child.gltf", mimeType: "model/gltf+json" }],
            externalAssets: [{ file: 0 }]
        });
        parent.externalAssets[0].document = child;
        return parent;
    }

    it("gives each referencing node its own instance", () => {
        const child = documentOf(QUAD);
        const parent = parentOf(child, 3);

        instantiateExternalAssets(parent);

        const instances = parent.nodes.map((node) => node.externalAssetInstance);
        expect(new Set(instances).size).toBe(3);
        expect(instances.every((instance) => instance !== child)).toBe(true);
    });

    it("lets instances animate independently", () => {
        const parent = parentOf(documentOf(QUAD), 2);
        instantiateExternalAssets(parent);

        parent.nodes[0].externalAssetInstance.nodes[0].translation = [5, 5, 5];

        expect(Array.from(parent.nodes[1].externalAssetInstance.nodes[0].translation)).toEqual([
            1, 2, 3
        ]);
    });

    it("still shares the resources between instances", () => {
        const parent = parentOf(documentOf(QUAD), 2);
        instantiateExternalAssets(parent);

        expect(parent.nodes[0].externalAssetInstance.accessors[0]).toBe(
            parent.nodes[1].externalAssetInstance.accessors[0]
        );
    });

    it("instantiates assets nested inside an instance", () => {
        const grandchild = documentOf(QUAD);
        const child = parentOf(grandchild, 1);
        const parent = parentOf(child, 1);

        instantiateExternalAssets(parent);

        const instance = parent.nodes[0].externalAssetInstance;
        expect(instance.nodes[0].externalAssetInstance).toBeDefined();
        expect(instance.nodes[0].externalAssetInstance).not.toBe(grandchild);
    });

    it("warns about a reference to an asset that does not exist", () => {
        const parent = parentOf(documentOf(QUAD), 1);
        parent.nodes[0].externalAsset = 7;

        instantiateExternalAssets(parent);

        expect(parent.nodes[0].externalAssetInstance).toBeUndefined();
        expect(warnings.join()).toMatch(/does not exist/);
    });

    it("stops before a diamond can multiply instances without bound", () => {
        // Each level references the one below twice, so the instance count doubles per
        // level. The loader rejects cycles; this guards the blowup that is not a cycle.
        let document = documentOf(QUAD);
        for (let level = 0; level < 12; level++) {
            document = parentOf(document, 2);
        }

        instantiateExternalAssets(document);

        expect(errors.join()).toMatch(new RegExp(`${MAX_INSTANCES} documents`));
    });

    it("leaves a document without external assets untouched", () => {
        const plain = documentOf(QUAD);

        instantiateExternalAssets(plain);

        expect(plain.nodes.every((node) => node.externalAssetInstance === undefined)).toBe(true);
    });

    it("does not walk into a child document when uploading the parent", () => {
        // The default member walk would reach the child through externalAssets and call
        // its initGl with a document where a GL context belongs, which blows up deep
        // inside primitive upload rather than anywhere near the cause.
        const child = documentOf(QUAD);
        const parent = parentOf(child, 1);
        let touched = false;
        child.initGl = () => {
            touched = true;
        };

        parent.initGl({ createTexture: () => ({}) });

        expect(touched).toBe(false);
    });
});
