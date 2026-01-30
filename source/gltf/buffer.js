import { getContainingFolder } from "./utils.js";
import { GltfObject } from "./gltf_object.js";
import { hasMeshOptCompression } from "./extension_utils.js";

class gltfBuffer extends GltfObject {
    static animatedProperties = [];
    constructor() {
        super();
        this.uri = undefined;
        this.byteLength = undefined;
        this.name = undefined;

        // non gltf
        this.buffer = undefined; // raw data blob
    }

    load(gltf, additionalFiles = undefined) {
        if (this.buffer !== undefined) {
            console.error("buffer has already been loaded");
            return;
        }

        const self = this;
        return new Promise(function (resolve, reject) {
            if (
                !self.setBufferFromFiles(additionalFiles, resolve) &&
                !self.setBufferFromUri(gltf, resolve, reject)
            ) {
                if (hasMeshOptCompression(self)) {
                    // buffer will be loaded by EXT_meshopt_compression or KHR_meshopt_compression
                    resolve();
                } else {
                    // if buffer has no meshopt compression extension AND no uri or files provided, we have an error
                    console.error("Was not able to resolve buffer with uri '%s'", self.uri);
                    reject("Buffer data missing for '" + self.name + "' in " + gltf.path);
                }
            }
        });
    }

    setBufferFromUri(gltf, resolve, reject) {
        if (this.uri === undefined) {
            return false;
        }
        const parentPath = this.uri.startsWith("data:") ? "" : getContainingFolder(gltf.path);
        fetch(parentPath + this.uri).then((response) => {
            if (!response.ok) {
                reject(
                    `Failed to fetch buffer from ${parentPath + this.uri}: ${response.statusText}`
                );
                return;
            }
            response.arrayBuffer().then((buffer) => {
                this.buffer = buffer;
                resolve();
            });
        });

        return true;
    }

    setBufferFromFiles(files, callback) {
        if (this.uri === undefined || files === undefined) {
            return false;
        }

        const foundFile = files.find(
            (file) => file[1].name === this.uri || file[1].fullPath === this.uri
        );

        if (foundFile === undefined) {
            return false;
        }

        const self = this;
        const reader = new FileReader();
        reader.onloadend = function (event) {
            self.buffer = event.target.result;
            callback();
        };
        reader.readAsArrayBuffer(foundFile[1]);

        return true;
    }
}

export { gltfBuffer };
