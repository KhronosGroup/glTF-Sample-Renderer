import { InterpolationModes } from "./animation_sampler.js";
import { InterpolationPath } from "./channel.js";
import { clamp, jsToGlSlice } from "./utils.js";
import { quat, glMatrix } from "gl-matrix";

class gltfInterpolator {
    constructor() {
        this.prevKey = 0;
        this.prevT = 0.0;
        this.prevRequestedT = 0.0;
    }

    slerpQuat(q1, q2, t) {
        if (q1 instanceof Float64Array || q2 instanceof Float64Array) {
            glMatrix.setMatrixArrayType(Float64Array);
        }
        const qn1 = quat.create();
        const qn2 = quat.create();

        quat.normalize(qn1, q1);
        quat.normalize(qn2, q2);

        const quatResult = quat.create();

        quat.slerp(quatResult, qn1, qn2, t);
        quat.normalize(quatResult, quatResult);

        glMatrix.setMatrixArrayType(Float32Array);

        return quatResult;
    }

    step(prevKey, output, stride) {
        if (output instanceof Float64Array) {
            glMatrix.setMatrixArrayType(Float64Array);
        }
        const result = new glMatrix.ARRAY_TYPE(stride);

        for (let i = 0; i < stride; ++i) {
            result[i] = output[prevKey * stride + i];
        }
        glMatrix.setMatrixArrayType(Float32Array);
        return result;
    }

    linear(prevKey, nextKey, output, t, stride) {
        if (output instanceof Float64Array) {
            glMatrix.setMatrixArrayType(Float64Array);
        }
        const result = new glMatrix.ARRAY_TYPE(stride);

        for (let i = 0; i < stride; ++i) {
            result[i] = output[prevKey * stride + i] * (1 - t) + output[nextKey * stride + i] * t;
        }
        glMatrix.setMatrixArrayType(Float32Array);
        return result;
    }

    cubicSpline(prevKey, nextKey, output, keyDelta, t, stride) {
        // stride: Count of components (4 in a quaternion).
        // Scale by 3, because each output entry consist of two tangents and one data-point.
        const prevIndex = prevKey * stride * 3;
        const nextIndex = nextKey * stride * 3;
        const A = 0;
        const V = 1 * stride;
        const B = 2 * stride;

        if (output instanceof Float64Array) {
            glMatrix.setMatrixArrayType(Float64Array);
        }
        const result = new glMatrix.ARRAY_TYPE(stride);
        const tSq = t ** 2;
        const tCub = t ** 3;

        // We assume that the components in output are laid out like this: in-tangent, point, out-tangent.
        // https://github.com/KhronosGroup/glTF/tree/master/specification/2.0#appendix-c-spline-interpolation
        for (let i = 0; i < stride; ++i) {
            const v0 = output[prevIndex + i + V];
            const a = keyDelta * output[nextIndex + i + A];
            const b = keyDelta * output[prevIndex + i + B];
            const v1 = output[nextIndex + i + V];

            result[i] =
                (2 * tCub - 3 * tSq + 1) * v0 +
                (tCub - 2 * tSq + t) * b +
                (-2 * tCub + 3 * tSq) * v1 +
                (tCub - tSq) * a;
        }

        glMatrix.setMatrixArrayType(Float32Array);

        return result;
    }

    resetKey() {
        this.prevKey = 0;
    }

    interpolate(gltf, channel, sampler, t, stride, maxTime, reverse) {
        if (t === undefined) {
            return undefined;
        }

        const input = gltf.accessors[sampler.input].getNormalizedDeinterlacedView(gltf);
        const output = gltf.accessors[sampler.output].getNormalizedDeinterlacedView(gltf);

        this.prevRequestedT = t;

        if (output.length === stride) {
            // no interpolation for single keyFrame animations
            if (output instanceof Float64Array) {
                glMatrix.setMatrixArrayType(Float64Array);
            }
            const result = jsToGlSlice(output, 0, stride);
            glMatrix.setMatrixArrayType(Float32Array);
            return result;
        }

        // Wrap t around, so the animation loops.
        // Make sure that t is never earlier than the first keyframe and never later then the last keyframe.
        const isNegative = t < 0;
        const isZero = t === 0;
        t = t % maxTime;
        if (isNegative || (t === 0 && !isZero)) {
            t += maxTime;
        }
        t = clamp(t, input[0], input[input.length - 1]);

        if (this.prevT > t && !reverse) {
            this.prevKey = 0;
        }

        if (reverse && this.prevT < t) {
            this.prevKey = input.length - 1;
        }

        this.prevT = t;

        // Find next keyframe: min{ t of input | t > prevKey }
        let nextKey = null;
        // We need to search backwards for reversed animations
        if (reverse) {
            for (let i = this.prevKey; i >= 0; --i) {
                if (t >= input[i]) {
                    nextKey = i;
                    break;
                }
            }
            this.prevKey = clamp(nextKey + 1, nextKey, input.length - 1);
        } else {
            for (let i = this.prevKey; i < input.length; ++i) {
                if (t <= input[i]) {
                    nextKey = clamp(i, 1, input.length - 1);
                    break;
                }
            }
            this.prevKey = clamp(nextKey - 1, 0, nextKey);
        }

        const keyDelta = Math.abs(input[nextKey] - input[this.prevKey]);

        // Normalize t: [t0, t1] -> [0, 1]
        const tn = Math.abs(t - input[this.prevKey]) / keyDelta;

        if (channel.target.path === InterpolationPath.ROTATION) {
            if (InterpolationModes.CUBICSPLINE === sampler.interpolation) {
                // GLTF requires cubic spline interpolation for quaternions.
                // https://github.com/KhronosGroup/glTF/issues/1386
                const result = this.cubicSpline(this.prevKey, nextKey, output, keyDelta, tn, 4);
                quat.normalize(result, result);
                return result;
            } else if (sampler.interpolation === InterpolationModes.LINEAR) {
                const q0 = this.getQuat(output, this.prevKey);
                const q1 = this.getQuat(output, nextKey);
                return this.slerpQuat(q0, q1, tn);
            } else if (sampler.interpolation === InterpolationModes.STEP) {
                return this.getQuat(output, this.prevKey);
            }
        }

        switch (sampler.interpolation) {
            case InterpolationModes.STEP:
                return this.step(this.prevKey, output, stride);
            case InterpolationModes.CUBICSPLINE:
                return this.cubicSpline(this.prevKey, nextKey, output, keyDelta, tn, stride);
            default:
                return this.linear(this.prevKey, nextKey, output, tn, stride);
        }
    }

    getQuat(output, index) {
        const x = output[4 * index];
        const y = output[4 * index + 1];
        const z = output[4 * index + 2];
        const w = output[4 * index + 3];
        if (output instanceof Float64Array) {
            return new Float64Array([x, y, z, w]);
        }
        return quat.fromValues(x, y, z, w);
    }
}

export { gltfInterpolator };
