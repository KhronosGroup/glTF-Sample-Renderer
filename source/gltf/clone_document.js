import { AnimatableProperty } from "./animatable_property.js";

// Instantiating an external asset gives every referencing node its own copy of the child
// document, so transforms, animation playheads, morph weights, poses and visibility are
// independent per instance. GPU resources are not duplicated: the policy below decides
// which arrays are copied and which are shared.
//
// The policy is written out rather than being a generic deep clone on purpose. A generic
// clone silently duplicates uploaded buffers and textures, which looks like it works and
// then costs a multiple of the memory it should.

// Copied element by element: these carry per-instance mutable state.
const CLONED_ARRAYS = ["animations", "cameras", "materials", "meshes", "nodes", "scenes", "skins"];

// The container is copied so a clone can append to it, but the elements are shared: they
// own uploaded buffers, decoded images and GPU texture handles.
//
// `shapes` is shared too, which means an animated shape inside an external asset animates
// every instance together. Sharing is what the per-array policy calls for; revisit if an
// asset ever needs per-instance shape animation.
const SHARED_ARRAYS = [
    "accessors",
    "buffers",
    "bufferViews",
    "externalAssets",
    "files",
    "images",
    "imageBasedLights",
    "samplers",
    "shapes",
    "textures"
];

// Guards a diamond of external assets, where each level multiplies the instance count.
const MAX_INSTANCES = 512;

function cloneValue(value) {
    if (value === null || typeof value !== "object") {
        return value;
    }
    if (ArrayBuffer.isView(value)) {
        return value.slice();
    }
    if (Array.isArray(value)) {
        return value.map(cloneValue);
    }
    if (value instanceof Map || value instanceof Set || value instanceof ArrayBuffer) {
        return value;
    }
    if (value.constructor?.animatedProperties !== undefined) {
        return cloneGltfObject(value);
    }
    // Plain objects such as primitive.attributes hold only indices.
    if (Object.getPrototypeOf(value) === Object.prototype) {
        const copy = {};
        for (const key of Object.keys(value)) {
            copy[key] = cloneValue(value[key]);
        }
        return copy;
    }
    // Anything else is a GPU handle or a decoder, which must stay shared.
    return value;
}

// Rebuilds a glTF object of the same class. Going through the constructor matters: the
// animated properties are instance-level accessors installed there, so an object made with
// Object.create would have none of them.
function cloneGltfObject(object) {
    const copy = new object.constructor();
    for (const key of Object.keys(object)) {
        if (key === "animatedPropertyObjects") {
            continue;
        }
        copy[key] = cloneValue(object[key]);
    }
    for (const [name, property] of Object.entries(object.animatedPropertyObjects)) {
        // Only the rest value carries over. An animated value belongs to the playhead of
        // the instance it was sampled for.
        copy.animatedPropertyObjects[name] = new AnimatableProperty(cloneValue(property.restValue));
    }
    return copy;
}

// Meshes are copied so their morph weights are per-instance, but the primitives inside
// them are shared: a primitive owns uploaded vertex buffers and derived tangents, and
// nothing about it changes per instance.
function cloneMesh(mesh) {
    const primitives = mesh.primitives;
    mesh.primitives = [];
    const copy = cloneGltfObject(mesh);
    mesh.primitives = primitives;
    copy.primitives = primitives.slice();
    return copy;
}

function cloneDocument(template, webGlContext) {
    // Going through the constructor rather than Object.create keeps whatever the document
    // class sets up for itself, such as its animated property bookkeeping and its id.
    const copy = new template.constructor(template.path);
    for (const key of Object.keys(template)) {
        if (key === "documentId" || CLONED_ARRAYS.includes(key) || SHARED_ARRAYS.includes(key)) {
            continue;
        }
        copy[key] = cloneValue(template[key]);
    }
    for (const key of SHARED_ARRAYS) {
        if (template[key] !== undefined) {
            copy[key] = template[key].slice();
        }
    }
    for (const key of CLONED_ARRAYS) {
        if (template[key] === undefined) {
            continue;
        }
        copy[key] =
            key === "meshes" ? template[key].map(cloneMesh) : template[key].map(cloneGltfObject);
    }

    copy.tangentCache = template.tangentCache;
    copy.addNodeMetaInformation();

    // A skin's joint matrices are per-instance, so its joint texture cannot be shared. It
    // is allocated by initGl, which appends to images, samplers and textures: those are the
    // containers copied above, so the append lands in this clone only.
    if (webGlContext !== undefined) {
        for (const skin of copy.skins) {
            skin.initGl(copy, webGlContext);
        }
    }

    return copy;
}

// Gives every node that references an external asset its own clone of the child document,
// recursing so that a child's own external assets are instantiated too. The loader has
// already rejected cycles, so this terminates; the budget guards the remaining blowup,
// which is a diamond multiplying instances at every level.
function instantiateExternalAssets(gltf, webGlContext, budget = { remaining: MAX_INSTANCES }) {
    for (const node of gltf.nodes) {
        if (node.externalAsset === undefined) {
            continue;
        }
        const asset = gltf.externalAssets[node.externalAsset];
        if (asset === undefined) {
            console.warn(
                `Node "${node.name ?? ""}" references external asset ${node.externalAsset}, which does not exist`
            );
            continue;
        }
        if (asset.document === undefined) {
            continue;
        }
        if (budget.remaining <= 0) {
            console.error(`Stopped instantiating external assets after ${MAX_INSTANCES} documents`);
            return;
        }
        budget.remaining--;
        node.externalAssetInstance = cloneDocument(asset.document, webGlContext);
        instantiateExternalAssets(node.externalAssetInstance, webGlContext, budget);
    }
}

export { cloneDocument, instantiateExternalAssets, CLONED_ARRAYS, MAX_INSTANCES, SHARED_ARRAYS };
