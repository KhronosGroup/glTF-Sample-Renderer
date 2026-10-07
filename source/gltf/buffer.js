import { GltfObject } from "./gltf_object.js";
import { hasMeshOptCompression } from "./extension_utils.js";
import { ResourceLoaderUtils } from "../ResourceLoader/loader_utils.js";

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

    load(gltf, additionalFiles = undefined, allowResourceAbsolutePath = true) {
        if (this.buffer !== undefined) {
            console.error("buffer has already been loaded");
            return;
        }

        const self = this;
        return new Promise(function (resolve, reject) {
            if (
                !self.setBufferFromFiles(gltf, additionalFiles, resolve) &&
                !self.setBufferFromUri(gltf, resolve, reject, allowResourceAbsolutePath)
            ) {
                if (hasMeshOptCompression(self)) {
                    // buffer will be loaded by EXT_meshopt_compression or KHR_meshopt_compression
                    resolve();
                } else {
                    // if buffer has no meshopt compression extension AND no uri or files provided, we have an error
                    reject("Buffer data missing for '" + self.name + "' in " + gltf.path);
                }
            }
        });
    }

    setBufferFromUri(gltf, resolve, reject, allowResourceAbsolutePath) {
        if (this.uri === undefined) {
            return false;
        }
        if (!allowResourceAbsolutePath && ResourceLoaderUtils.isAbsoluteUrl(this.uri)) {
            reject("Absolute URLs are not allowed for security reasons: " + this.uri);
            return true; // we return true, because the buffer has a uri, but we reject the loading due to security reasons
        }
        const parentPath = this.uri.startsWith("data:")
            ? ""
            : ResourceLoaderUtils.getContainingFolder(gltf.path ?? "");
        fetch(parentPath + this.uri)
            .then((response) => {
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
            })
            .catch((error) => {
                reject(`Error fetching buffer from ${parentPath + this.uri}: ${error}`);
            });

        return true;
    }

    setBufferFromFiles(gltf, files, callback) {
        if (this.uri === undefined || files === undefined) {
            return false;
        }
        let actualPath = this.uri;
        if (!ResourceLoaderUtils.isAbsoluteUrl(this.uri)) {
            const parentPath = ResourceLoaderUtils.getContainingFolder(gltf.path ?? "");
            actualPath = ResourceLoaderUtils.cleanRelativePath(parentPath + this.uri);
        }

        const foundFile = files.find((file) => {
            if (file[0] == actualPath) {
                return true;
            }
        });

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
