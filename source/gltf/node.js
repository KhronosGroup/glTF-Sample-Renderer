import { mat4, quat, vec3 } from 'gl-matrix';
import { jsToGl, jsToGlSlice } from './utils.js';
import { GltfObject } from './gltf_object.js';

// contain:
// transform
// child indices (reference to scene array of nodes)

class gltfNode extends GltfObject
{
    static animatedProperties = [
        "rotation",
        "scale",
        "translation",
        "weights"
    ];
    constructor()
    {
        super();
        this.camera = undefined;
        this.children = [];
        this.matrix = undefined;
        this.rotation = jsToGl([0, 0, 0, 1]);
        this.scale = jsToGl([1, 1, 1]);
        this.translation = jsToGl([0, 0, 0]);
        this.name = undefined;
        this.mesh = undefined;
        this.skin = undefined;
        this.weights = undefined;

        // non gltf
        this.worldTransform = mat4.create();
        this.inverseWorldTransform = mat4.create();
        this.normalMatrix = mat4.create();
        this.light = undefined;
        this.instanceMatrices = undefined;
        this.instanceWorldTransforms = undefined;
    }

    initGl(gltf, webGlContext)
    {
        if (this.extensions?.EXT_mesh_gpu_instancing?.attributes !== undefined) {
            const firstAccessor = Object.values(this.extensions?.EXT_mesh_gpu_instancing?.attributes)[0];
            const count = gltf.accessors[firstAccessor].count;
            const translationAccessor = this.extensions?.EXT_mesh_gpu_instancing?.attributes?.TRANSLATION;
            let translationData = undefined;
            if (translationAccessor !== undefined) {
                translationData = gltf.accessors[translationAccessor].getDeinterlacedView(gltf);
            }
            const rotationAccessor = this.extensions?.EXT_mesh_gpu_instancing?.attributes?.ROTATION;
            let rotationData = undefined;
            if (rotationAccessor !== undefined) {
                rotationData = gltf.accessors[rotationAccessor].getDeinterlacedView(gltf);
            }
            const scaleAccessor = this.extensions?.EXT_mesh_gpu_instancing?.attributes?.SCALE;
            let scaleData = undefined;
            if (scaleAccessor !== undefined) {
                scaleData = gltf.accessors[scaleAccessor].getDeinterlacedView(gltf);
            }
            this.instanceMatrices = [];
            for (let i = 0; i < count; i++) {
                const translation = translationData ? jsToGlSlice(translationData, i * 3, 3) : vec3.create();
                const rotation = rotationData ? jsToGlSlice(rotationData, i * 4, 4) : quat.create();
                const scale = scaleData ? jsToGlSlice(scaleData, i * 3, 3) : vec3.fromValues(1, 1, 1);
                this.instanceMatrices.push(mat4.fromRotationTranslationScale(
                    mat4.create(),
                    rotation,
                    translation,
                    scale
                ));
            }
        }
    }

    fromJson(jsonNode) {
        super.fromJson(jsonNode);
        if (jsonNode.matrix !== undefined) {
            this.applyMatrix(jsonNode.matrix);
        }
    }

    getWeights(gltf)
    {
        if (this.weights !== undefined && this.weights.length > 0) {
            return this.weights;
        }
        else {
            return gltf.meshes[this.mesh].weights;
        }
    }

    applyMatrix(matrixData)
    {
        this.matrix = jsToGl(matrixData);

        mat4.getScaling(this.scale, this.matrix);

        // To extract a correct rotation, the scaling component must be eliminated.
        const mn = mat4.create();
        for(const col of [0, 1, 2])
        {
            mn[col] = this.matrix[col] / this.scale[0];
            mn[col + 4] = this.matrix[col + 4] / this.scale[1];
            mn[col + 8] = this.matrix[col + 8] / this.scale[2];
        }
        mat4.getRotation(this.rotation, mn);
        quat.normalize(this.rotation, this.rotation);

        mat4.getTranslation(this.translation, this.matrix);
    }

    getLocalTransform()
    {
        return mat4.fromRotationTranslationScale(
            mat4.create(),
            this.rotation,
            this.translation,
            this.scale
        );
    }
}

export { gltfNode };
