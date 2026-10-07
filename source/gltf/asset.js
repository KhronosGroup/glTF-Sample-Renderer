import { GltfObject } from "./gltf_object";
import { SUPPORTED_GLTF_VERSION, parseVersionString, versionAtLeast } from "./gltf_version.js";

class gltfAsset extends GltfObject {
    static animatedProperties = [];
    constructor() {
        super();
        this.copyright = undefined;
        this.generator = undefined;
        this.version = undefined;
        this.minVersion = undefined;
        this.thumbnail = undefined;

        // non gltf
        this.majorVersion = 2;
        this.minorVersion = 0;
    }

    fromJson(json) {
        super.fromJson(json);

        const version = parseVersionString(this.version);
        if (version === undefined) {
            console.warn(`Invalid or missing asset version "${this.version}", assuming 2.0`);
        } else {
            this.majorVersion = version.major;
            this.minorVersion = version.minor;
        }

        if (this.minVersion !== undefined) {
            const minVersion = parseVersionString(this.minVersion);
            if (minVersion === undefined) {
                console.warn(`Invalid asset minVersion "${this.minVersion}", ignoring it`);
            } else if (
                !versionAtLeast(SUPPORTED_GLTF_VERSION, minVersion.major, minVersion.minor)
            ) {
                throw new Error(
                    `Asset requires glTF ${this.minVersion}, but this renderer supports up to ` +
                        `${SUPPORTED_GLTF_VERSION.major}.${SUPPORTED_GLTF_VERSION.minor}`
                );
            }
        }
    }

    isAtLeast(major, minor) {
        return versionAtLeast({ major: this.majorVersion, minor: this.minorVersion }, major, minor);
    }
}

export { gltfAsset as gltfAsset };
