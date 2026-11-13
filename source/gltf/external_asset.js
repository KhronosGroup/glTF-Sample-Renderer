import { GltfObject } from "./gltf_object.js";

// A glTF asset referenced by this one, instantiated by any node through
// `node.externalAsset`. The indirection through `files` exists so several nodes can
// share one file, and so future extensions can attach per-reference customisation.
class gltfExternalAsset extends GltfObject {
    static animatedProperties = [];
    constructor() {
        super();
        this.file = undefined;
        this.name = undefined;

        // non gltf: the loaded child document, populated when external assets land
        this.document = undefined;
    }

    fromJson(json) {
        super.fromJson(json);

        if (this.file === undefined) {
            console.warn(`External asset "${this.name ?? ""}" is missing its required file index`);
        }
    }

    // The child document uploads itself when it is loaded. The default walk over members
    // would descend into it and call its initGl with a document where a GL context
    // belongs, so this stops at the document boundary.
    // eslint-disable-next-line no-unused-vars
    initGl(gltf, webGlContext) {}
}

export { gltfExternalAsset };
