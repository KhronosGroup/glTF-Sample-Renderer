import { GltfObject } from "./gltf_object.js";

// glTF 2.1's unified file reference. Works like `buffers` and `images`, but for any
// media type, so extensions and tools no longer have to re-invent the pattern. A file's
// data lives either at a `uri` or in a `bufferView`, never both.
class gltfFile extends GltfObject {
    static animatedProperties = [];
    constructor() {
        super();
        this.uri = undefined;
        this.bufferView = undefined;
        this.mimeType = undefined;
        this.aliases = [];
        this.name = undefined;
    }

    fromJson(json) {
        super.fromJson(json);

        this.aliases = (json.aliases ?? []).map((jsonAlias) => {
            const alias = new gltfFileAlias();
            alias.fromJson(jsonAlias);
            return alias;
        });

        if (this.mimeType === undefined) {
            console.warn(`File reference "${this.name ?? ""}" is missing its required mimeType`);
        }
        if ((this.uri === undefined) === (this.bufferView === undefined)) {
            console.warn(
                `File reference "${this.name ?? ""}" must define exactly one of uri or bufferView`
            );
        }
    }
}

// Redirects a `uri` found inside a referenced file to a file in this asset's `files`
// array. Matching is on the exact literal string, with no path normalisation, and
// aliases are not inherited by that file's own children.
class gltfFileAlias extends GltfObject {
    static animatedProperties = [];
    constructor() {
        super();
        this.alias = undefined;
        this.file = undefined;
    }
}

export { gltfFile, gltfFileAlias };
