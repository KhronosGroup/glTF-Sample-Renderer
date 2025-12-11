import { AnimatableProperty } from "./animatable_property";
import { initGlForMembers, fromKeys } from "./utils";

// base class for all gltf objects
class GltfObject {
    constructor(animatedProperties = undefined) {
        this.extensions = undefined;
        this.extras = undefined;
        this.gltfObjectIndex = undefined;
        this.animatedPropertyObjects = {};
        if (animatedProperties !== undefined) {
            this.constructor.animatedProperties = animatedProperties;
        }
        if (this.constructor.animatedProperties === undefined) {
            throw new Error("animatedProperties is not defined for " + this.constructor.name);
        }
        for (const prop of this.constructor.animatedProperties) {
            this.animatedPropertyObjects[prop] = new AnimatableProperty(undefined);
            Object.defineProperty(this, prop, {
                get: function () {
                    return this.animatedPropertyObjects[prop].value();
                },
                set: function (value) {
                    this.animatedPropertyObjects[prop].restAt(value);
                }
            });
        }
    }

    static animatedProperties = undefined;
    static readOnlyAnimatedProperties = []; // If an array property is defined here, the length can be queried

    fromJson(json) {
        fromKeys(this, json);
    }

    initGl(gltf, webGlContext) {
        initGlForMembers(this, gltf, webGlContext);
    }

    isDirty() {
        for (const prop in this.animatedPropertyObjects) {
            if (this.animatedPropertyObjects[prop].dirty) {
                return true;
            }
        }
        return false;
    }

    resetDirtyFlags() {
        for (const prop in this.animatedPropertyObjects) {
            this.animatedPropertyObjects[prop].dirty = false;
        }
    }
}

export { GltfObject };
