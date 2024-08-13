import { AnimatableProperty } from "./animatable_property";
import { initGlForMembers, fromKeys } from "./utils";

// base class for all gltf objects
class GltfObject
{
    constructor()
    {
        this.extensions = undefined;
        this.extras = undefined;
        this.animatedPropertyObjects = {};
        for (const prop of this.constructor.animatedProperties)
        {
            this.animatedPropertyObjects[prop] = new AnimatableProperty(undefined);
            Object.defineProperty(this, prop, {
                get: function() { return this.animatedPropertyObjects[prop].value(); },
                set: function(value) { this.animatedPropertyObjects[prop].restAt(value); }
            });
        }
    }
    
    static animatedProperties = [];

    fromJson(json)
    {
        fromKeys(this, json);
    }

    initGl(gltf, webGlContext)
    {
        initGlForMembers(this, gltf, webGlContext);
    }
}

export { GltfObject };
