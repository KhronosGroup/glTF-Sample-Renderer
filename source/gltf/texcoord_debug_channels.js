import { instantiatedDocuments } from "./clone_document.js";

// glTF 2.1 lets a primitive number its texture coordinate sets freely, so the debug
// channels for them cannot be a fixed list the way the other ones are. The label carries
// the set index the file uses rather than the slot the renderer packs it into: an asset
// defining only TEXCOORD_5 offers "Texture Coordinates 5", which is the name its author
// would recognise.
//
// This lives apart from GltfState so it can be tested without pulling in the physics
// engine, which cannot be imported outside a browser.

const TEXCOORD_DEBUG_PREFIX = "Texture Coordinates ";

/**
 * The debug channel name for one texture coordinate set.
 * @param {number} setIndex The TEXCOORD_n index used in the file.
 * @returns {string}
 */
function textureCoordinateDebugOutput(setIndex) {
    return `${TEXCOORD_DEBUG_PREFIX}${setIndex}`;
}

/**
 * The set index a debug channel name refers to, or undefined if it names anything else.
 * @param {string} debugOutput
 * @returns {number|undefined}
 */
function textureCoordinateDebugSetIndex(debugOutput) {
    if (typeof debugOutput !== "string" || !debugOutput.startsWith(TEXCOORD_DEBUG_PREFIX)) {
        return undefined;
    }
    const setIndex = Number(debugOutput.slice(TEXCOORD_DEBUG_PREFIX.length));
    return Number.isInteger(setIndex) ? setIndex : undefined;
}

/**
 * The texture coordinate debug channels an asset can offer, in ascending set order and
 * including every document instantiated below it.
 *
 * Read from the slots assigned at load rather than from the attributes, so a set dropped
 * for exceeding the renderer's budget gets no channel: offering one would promise a view
 * the shaders cannot produce.
 *
 * @param {object} gltf
 * @returns {string[]}
 */
function textureCoordinateDebugOutputs(gltf) {
    if (gltf === undefined) {
        return [];
    }
    const sets = new Set();
    for (const document of [gltf, ...instantiatedDocuments(gltf)]) {
        for (const mesh of document.meshes ?? []) {
            for (const primitive of mesh.primitives ?? []) {
                for (const setIndex of primitive.texCoordSlots?.keys() ?? []) {
                    sets.add(setIndex);
                }
            }
        }
    }
    return [...sets].sort((a, b) => a - b).map(textureCoordinateDebugOutput);
}

export {
    textureCoordinateDebugOutput,
    textureCoordinateDebugOutputs,
    textureCoordinateDebugSetIndex
};
