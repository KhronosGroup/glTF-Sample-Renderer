import { GltfObject } from "./gltf_object";

class gltfAsset extends GltfObject
{
    static animatedProperties = [];
    constructor()
    {
        super();
        this.copyright = undefined;
        this.generator = undefined;
        this.version = undefined;
        this.minVersion = undefined;
    }
}

export { gltfAsset as gltfAsset };
