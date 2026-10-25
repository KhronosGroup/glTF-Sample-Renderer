import { mat4 } from "gl-matrix";
import { GltfObject } from "./gltf_object.js";
import { jsToGl } from "./utils.js";

// A shape instance attached to a node, which should enclose that node's content.
//
// Per KhronosGroup/glTF#2666 the bounding volume's own TRS is applied first, taking the
// shape from its local space into the node's local space, and only then does the node's
// global transform apply:
//
//     world = node.worldTransform * TRS(translation, rotation, scale)
class gltfBoundingVolume extends GltfObject {
    static animatedProperties = ["translation", "rotation", "scale"];
    static readOnlyAnimatedProperties = ["shape"];
    constructor() {
        super();
        this.shape = undefined;
        this.translation = jsToGl([0, 0, 0]);
        this.rotation = jsToGl([0, 0, 0, 1]);
        this.scale = jsToGl([1, 1, 1]);
    }

    fromJson(json) {
        super.fromJson(json);

        if (this.shape === undefined) {
            console.warn("A bounding volume is missing its required shape index");
        }
        this.translation = jsToGl(json.translation ?? [0, 0, 0]);
        this.rotation = jsToGl(json.rotation ?? [0, 0, 0, 1]);
        this.scale = jsToGl(json.scale ?? [1, 1, 1]);
    }

    getLocalTransform() {
        return mat4.fromRotationTranslationScale(
            mat4.create(),
            this.rotation,
            this.translation,
            this.scale
        );
    }

    getWorldTransform(node) {
        return mat4.multiply(mat4.create(), node.worldTransform, this.getLocalTransform());
    }
}

export { gltfBoundingVolume };
