import { GltfObject } from './gltf_object.js';
import { objectsFromJsons } from './utils.js';
import { gltfAnimationChannel, InterpolationPath } from './channel.js';
import { gltfAnimationSampler } from './animation_sampler.js';
import { gltfInterpolator } from './interpolator.js';
import { AnimatableProperty } from './animatable_property.js';
import { JsonPointer } from 'json-ptr';

class gltfAnimation extends GltfObject
{
    static animatedProperties = [];
    constructor()
    {
        super();
        this.channels = [];
        this.samplers = [];
        this.name = '';

        // not gltf
        this.interpolators = [];
        this.maxTime = 0;
        this.disjointAnimations = [];

        this.errors = [];
    }

    fromJson(jsonAnimation)
    {
        super.fromJson(jsonAnimation);

        this.channels = objectsFromJsons(jsonAnimation.channels, gltfAnimationChannel);
        this.samplers = objectsFromJsons(jsonAnimation.samplers, gltfAnimationSampler);
        this.name = jsonAnimation.name;

        if(this.channels === undefined)
        {
            console.error("No channel data found for skin");
            return;
        }

        for(let i = 0; i < this.channels.length; ++i)
        {
            this.interpolators.push(new gltfInterpolator());
        }
    }

    // advance the animation, if totalTime is undefined, the animation is deactivated
    advance(gltf, totalTime)
    {
        if(this.channels === undefined)
        {
            return;
        }

        if(this.maxTime == 0)
        {
            for(let i = 0; i < this.channels.length; ++i)
            {
                const channel = this.channels[i];
                const sampler = this.samplers[channel.sampler];
                const input = gltf.accessors[sampler.input].getDeinterlacedView(gltf);
                const max = input[input.length - 1];
                if(max > this.maxTime)
                {
                    this.maxTime = max;
                }
            }
        }

        for(let i = 0; i < this.interpolators.length; ++i)
        {
            const channel = this.channels[i];
            const sampler = this.samplers[channel.sampler];
            const interpolator = this.interpolators[i];

            let property = null;
            switch(channel.target.path)
            {
            case InterpolationPath.TRANSLATION:
                property = `/nodes/${channel.target.node}/translation`;
                break;
            case InterpolationPath.ROTATION:
                property = `/nodes/${channel.target.node}/rotation`;
                break;
            case InterpolationPath.SCALE:
                property = `/nodes/${channel.target.node}/scale`;
                break;
            case InterpolationPath.WEIGHTS:
                if (gltf.nodes[channel.target.node].weights !== undefined) {
                    property = `/nodes/${channel.target.node}/weights`;
                } else {
                    property = `/meshes/${gltf.nodes[channel.target.node].mesh}/weights`;
                }
                break;
            case InterpolationPath.POINTER:
                property = channel.target.extensions.KHR_animation_pointer.pointer;
                break;
            }

            if (property != null) {
                if (property.startsWith("/extensions/KHR_lights_punctual/")) {
                    const suffix = property.substring("/extensions/KHR_lights_punctual/".length);
                    property = "/" + suffix;
                }
                let jsonPointer = JsonPointer.create(property);
                let parentObject = jsonPointer.parent(gltf);
                let back = jsonPointer.path.at(-1);
                let animatedArrayElement = undefined;
                if (Array.isArray(parentObject)) {
                    animatedArrayElement = Number(back);
                    jsonPointer = JsonPointer.create(jsonPointer.path.slice(0, -1));
                    parentObject = jsonPointer.parent(gltf);
                    back = jsonPointer.path.at(-1);
                }
                let animatedProperty = undefined;
                if (parentObject.animatedPropertyObjects && back in parentObject.animatedPropertyObjects) {
                    animatedProperty = parentObject.animatedPropertyObjects[back];
                }
                if (animatedProperty === undefined || !(animatedProperty instanceof AnimatableProperty)) {
                    if (!this.errors.includes(property)) {
                        console.warn(`Cannot animate ${property}`);
                        this.errors.push(property);
                    }
                    continue;
                }
                if (animatedProperty.restValue === undefined) {
                    continue;
                }

                let stride = animatedProperty.restValue?.length ?? 1;
                if (animatedArrayElement !== undefined) {
                    stride = animatedProperty.restValue[animatedArrayElement]?.length ?? 1;
                }
                
                const interpolant = interpolator.interpolate(gltf, channel, sampler, totalTime, stride, this.maxTime);
                if (interpolant === undefined) {
                    animatedProperty.rest();
                    continue;
                }
                // The interpolator will always return a `Float32Array`, even if the animated value is a scalar.
                // For the renderer it's not a problem because uploading a single-element array is the same as uploading a scalar to a uniform.
                // However, it becomes a problem if we use the animated value for further computation and assume is stays a scalar.
                // Thus we explicitly convert the animated value back to a scalar if the interpolant is a single-element array and the rest value is not an array itself.
                if (animatedArrayElement !== undefined) {
                    const array = animatedProperty.value();
                    if (interpolant.length == 1) {
                        array[animatedArrayElement] = interpolant[0];
                    }
                    else {
                        array[animatedArrayElement] = interpolant;
                    }
                    animatedProperty.animate(array);
                } else {
                    if (interpolant.length == 1 && !Array.isArray(animatedProperty.restValue)) {
                        animatedProperty.animate(interpolant[0]);
                    }
                    else {
                        animatedProperty.animate(interpolant);
                    }
                }
            }
        }
    }
}

export { gltfAnimation };
