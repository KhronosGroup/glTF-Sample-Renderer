import { GltfObject } from "./gltf_object.js";
import { hasMeshOptCompression } from "./extension_utils.js";

class gltfBuffer extends GltfObject {
    static animatedProperties = [];
    constructor() {
        super();
        this.uri = undefined;
        this.byteLength = undefined;
        this.chunk = undefined;
        this.name = undefined;

        // non gltf
        this.buffer = undefined; // raw data blob
    }

    async load(gltf, resolver) {
        if (this.buffer !== undefined) {
            console.error("buffer has already been loaded");
            return;
        }

        if (this.uri === undefined) {
            if (hasMeshOptCompression(this)) {
                // Filled in later by EXT_meshopt_compression or KHR_meshopt_compression.
                return;
            }
            throw new Error(`Buffer data missing for '${this.name}' in ${gltf.path}`);
        }

        const { bytes } = await resolver.resolve(this.uri);
        // Accessors index into this as an ArrayBuffer, so hand over a standalone copy
        // rather than a view that may start partway into a shared buffer.
        this.buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    }
}

export { gltfBuffer };
