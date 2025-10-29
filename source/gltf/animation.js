import { GltfObject } from "./gltf_object.js";
import { objectsFromJsons } from "./utils.js";
import { gltfAnimationChannel, InterpolationPath } from "./channel.js";
import { gltfAnimationSampler } from "./animation_sampler.js";
import { gltfInterpolator } from "./interpolator.js";
import { AnimatableProperty } from "./animatable_property.js";
import { JsonPointer } from "json-ptr";

class gltfAnimation extends GltfObject {
    static animatedProperties = [];
    constructor() {
        super();
        this.channels = [];
        this.samplers = [];
        this.name = "";

        // For KHR_interactivity
        this.createdTimestamp = undefined; // Time in seconds after graph creation when the animation was created. Computed via animation timer.
        this.startTime = 0;
        this.stopTime = undefined;
        this.endTime = Infinity;
        this.speed = 1.0;
        this.endCallback = undefined; // Callback to call when the animation ends.
        this.stopCallback = undefined; // Callback to call when the animation stops.

        // not gltf
        this.interpolators = [];
        this.maxTime = NaN;
        this.minTime = NaN;
        this.disjointAnimations = [];

        this.errors = [];
    }

    fromJson(jsonAnimation) {
        super.fromJson(jsonAnimation);

        this.channels = objectsFromJsons(jsonAnimation.channels, gltfAnimationChannel);
        this.samplers = objectsFromJsons(jsonAnimation.samplers, gltfAnimationSampler);
        this.name = jsonAnimation.name;

        if (this.channels === undefined) {
            console.error("No channel data found for skin");
            return;
        }

        for (let i = 0; i < this.channels.length; ++i) {
            this.interpolators.push(new gltfInterpolator());
        }
    }

    reset() {
        this.createdTimestamp = undefined;
        this.startTime = 0;
        this.stopTime = undefined;
        this.endTime = Infinity;
        this.speed = 1.0;
        this.endCallback = undefined;
        this.stopCallback = undefined;
    }

    computeMinMaxTime(gltf) {
        if (isNaN(this.maxTime) || isNaN(this.minTime)) {
            this.maxTime = -Infinity;
            this.minTime = Infinity;
            for (let i = 0; i < this.channels.length; ++i) {
                const channel = this.channels[i];
                const sampler = this.samplers[channel.sampler];
                const input = gltf.accessors[sampler.input];
                if (
                    input.max === undefined ||
                    input.min === undefined ||
                    input.max.length !== 1 ||
                    input.min.length !== 1
                ) {
                    console.error("Invalid input accessor for animation channel:", channel);
                    this.minTime = undefined;
                    this.maxTime = undefined;
                    return;
                }
                const max = input.max[0];
                const min = input.min[0];
                if (max > this.maxTime) {
                    this.maxTime = max;
                }
                if (min < this.minTime) {
                    this.minTime = min;
                }
            }
        }
        if (this.minTime > this.maxTime || this.minTime < 0 || this.maxTime < 0) {
            console.error("Invalid min/max time for animation with index:", this.gltfObjectIndex);
            this.minTime = undefined;
            this.maxTime = undefined;
        }
    }

    // advance the animation, if totalTime is undefined, the animation is deactivated
    advance(gltf, totalTime) {
        if (this.channels === undefined) {
            return;
        }

        this.computeMinMaxTime(gltf);

        if (this.maxTime === undefined || this.minTime === undefined) {
            return;
        }

        let stopAnimation = false;
        let endAnimation = false;
        let elapsedTime = totalTime;
        let reverse = false;

        // createdTimestamp is only used for KHR_interactivity
        if (this.createdTimestamp !== undefined) {
            elapsedTime = totalTime - this.createdTimestamp;
            elapsedTime *= this.speed;
            if (this.startTime > this.endTime) {
                elapsedTime *= -1;
                reverse = true;
            }
            elapsedTime += this.startTime;
            if (this.startTime === this.endTime) {
                elapsedTime = this.startTime;
                endAnimation = true;
            } else if (this.stopTime !== undefined) {
                if (
                    (this.startTime < this.endTime &&
                        elapsedTime >= this.stopTime &&
                        this.stopTime >= this.startTime &&
                        this.stopTime < this.endTime) ||
                    (this.startTime > this.endTime &&
                        elapsedTime <= this.stopTime &&
                        this.stopTime <= this.startTime &&
                        this.stopTime > this.endTime)
                ) {
                    elapsedTime = this.stopTime;
                    stopAnimation = true;
                }
            } else if (
                (this.startTime < this.endTime && elapsedTime >= this.endTime) ||
                (this.startTime > this.endTime && elapsedTime <= this.endTime)
            ) {
                elapsedTime = this.endTime;
                endAnimation = true;
            }
        }

        for (let i = 0; i < this.interpolators.length; ++i) {
            const channel = this.channels[i];
            const sampler = this.samplers[channel.sampler];
            const interpolator = this.interpolators[i];

            let property = null;
            switch (channel.target.path) {
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
                let jsonPointer = JsonPointer.create(property);
                let parentObject = jsonPointer.parent(gltf);
                if (parentObject === undefined) {
                    if (!this.errors.includes(property)) {
                        console.warn(`Cannot find property ${property}`);
                        this.errors.push(property);
                    }
                    continue;
                }
                let back = jsonPointer.path.at(-1);
                let animatedArrayElement = undefined;
                if (Array.isArray(parentObject)) {
                    animatedArrayElement = Number(back);
                    jsonPointer = JsonPointer.create(jsonPointer.path.slice(0, -1));
                    parentObject = jsonPointer.parent(gltf);
                    back = jsonPointer.path.at(-1);
                }
                let animatedProperty = undefined;
                if (
                    parentObject.animatedPropertyObjects &&
                    back in parentObject.animatedPropertyObjects
                ) {
                    animatedProperty = parentObject.animatedPropertyObjects[back];
                }
                if (
                    animatedProperty === undefined ||
                    !(animatedProperty instanceof AnimatableProperty)
                ) {
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

                let interpolant = interpolator.interpolate(
                    gltf,
                    channel,
                    sampler,
                    elapsedTime,
                    stride,
                    this.maxTime,
                    reverse
                );
                if (interpolant === undefined) {
                    animatedProperty.rest();
                    continue;
                }
                if (typeof animatedProperty.value() === "boolean") {
                    interpolant = interpolant[0] !== 0;
                }
                // The interpolator will always return a `Float32Array`, even if the animated value is a scalar.
                // For the renderer it's not a problem because uploading a single-element array is the same as uploading a scalar to a uniform.
                // However, it becomes a problem if we use the animated value for further computation and assume is stays a scalar.
                // Thus we explicitly convert the animated value back to a scalar if the interpolant is a single-element array and the rest value is not an array itself.
                if (animatedArrayElement !== undefined) {
                    const array = animatedProperty.value();
                    if (interpolant.length == 1) {
                        array[animatedArrayElement] = interpolant[0];
                    } else {
                        array[animatedArrayElement] = interpolant;
                    }
                    animatedProperty.animate(array);
                } else {
                    if (interpolant.length == 1 && !Array.isArray(animatedProperty.restValue)) {
                        animatedProperty.animate(interpolant[0]);
                    } else {
                        animatedProperty.animate(interpolant);
                    }
                }
            }
        }

        if (stopAnimation) {
            this.createdTimestamp = undefined;
            this.stopCallback?.();
            this.reset();
            return;
        }
        if (endAnimation) {
            this.createdTimestamp = undefined;
            this.endCallback?.();
            this.reset();
        }
    }
}

export { gltfAnimation };
