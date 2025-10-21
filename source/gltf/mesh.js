import { gltfPrimitive } from "./primitive.js";
import { objectsFromJsons } from "./utils.js";
import { GltfObject } from "./gltf_object.js";

class gltfMesh extends GltfObject {
    static animatedProperties = ["weights"];
    static readOnlyAnimatedProperties = ["weights", "primitives"];
    constructor()
    {
        super();
        this.primitives = [];
        this.name = undefined;
        this.weights = undefined;
    }

    fromJson(jsonMesh) {
        super.fromJson(jsonMesh);

        if (jsonMesh.name !== undefined) {
            this.name = jsonMesh.name;
        }

        this.primitives = objectsFromJsons(jsonMesh.primitives, gltfPrimitive);
    }
}

export { gltfMesh };
