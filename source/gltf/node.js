import { mat4, quat, vec3 } from "gl-matrix";
import { jsToGl, jsToGlSlice } from "./utils.js";
import { GltfObject } from "./gltf_object.js";
import { GL } from "../Renderer/webgl.js";

// contain:
// transform
// child indices (reference to scene array of nodes)

class gltfNode extends GltfObject {
    static animatedProperties = ["rotation", "scale", "translation", "weights"];
    static readOnlyAnimatedProperties = ["camera", "children", "mesh", "skin", "weights"];
    static currentPickingColor = 1;
    constructor() {
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
        this.worldQuaternion = quat.create();
        this.worldScale = vec3.create();
        this.inverseWorldTransform = mat4.create();
        this.normalMatrix = mat4.create();
        this.light = undefined;
        this.instanceMatrices = undefined;
        this.instanceWorldTransforms = undefined;
        this.pickingColor = undefined;
        this.parentNode = undefined;
        this.scene = undefined;
        this.physicsTransform = undefined;
        this.scaledPhysicsTransform = undefined;
        this.dirtyTransform = true;
    }

    // eslint-disable-next-line no-unused-vars
    initGl(gltf, webGlContext) {
        if (this.mesh !== undefined) {
            this.pickingColor = gltfNode.currentPickingColor;
            gltfNode.currentPickingColor += 1;
        }
        if (this.extensions?.EXT_mesh_gpu_instancing?.attributes !== undefined) {
            const firstAccessor = Object.values(
                this.extensions?.EXT_mesh_gpu_instancing?.attributes
            )[0];
            const count = gltf.accessors[firstAccessor].count;
            const translationAccessor =
                this.extensions?.EXT_mesh_gpu_instancing?.attributes?.TRANSLATION;
            let translationData = undefined;
            if (translationAccessor !== undefined) {
                if (translationAccessor.componentType === GL.FLOAT) {
                    translationData = gltf.accessors[translationAccessor].getDeinterlacedView(gltf);
                } else {
                    console.warn("EXT_mesh_gpu_instancing translation accessor must be a float");
                }
            }
            const rotationAccessor = this.extensions?.EXT_mesh_gpu_instancing?.attributes?.ROTATION;
            let rotationData = undefined;
            if (rotationAccessor !== undefined) {
                if (
                    rotationAccessor.componentType === GL.FLOAT ||
                    (rotationAccessor.normalized &&
                        (rotationAccessor.componentType === GL.BYTE ||
                            rotationAccessor.componentType === GL.SHORT))
                ) {
                    rotationData =
                        gltf.accessors[rotationAccessor].getNormalizedDeinterlacedView(gltf);
                } else {
                    console.warn(
                        "EXT_mesh_gpu_instancing rotation accessor must be a float, byte normalized, or short normalized"
                    );
                }
            }
            const scaleAccessor = this.extensions?.EXT_mesh_gpu_instancing?.attributes?.SCALE;
            let scaleData = undefined;
            if (scaleAccessor !== undefined) {
                if (scaleAccessor.componentType === GL.FLOAT) {
                    scaleData = gltf.accessors[scaleAccessor].getDeinterlacedView(gltf);
                } else {
                    console.warn("EXT_mesh_gpu_instancing scale accessor must be a float");
                }
            }
            this.instanceMatrices = [];
            for (let i = 0; i < count; i++) {
                const translation = translationData
                    ? jsToGlSlice(translationData, i * 3, 3)
                    : vec3.create();
                const rotation = rotationData ? jsToGlSlice(rotationData, i * 4, 4) : quat.create();
                const scale = scaleData
                    ? jsToGlSlice(scaleData, i * 3, 3)
                    : vec3.fromValues(1, 1, 1);
                this.instanceMatrices.push(
                    mat4.fromRotationTranslationScale(mat4.create(), rotation, translation, scale)
                );
            }
        }
    }

    fromJson(jsonNode) {
        super.fromJson(jsonNode);
        if (jsonNode.matrix !== undefined) {
            this.applyMatrix(jsonNode.matrix);
        }
        if (jsonNode.extensions?.KHR_node_visibility !== undefined) {
            this.extensions.KHR_node_visibility = new KHR_node_visibility();
            this.extensions.KHR_node_visibility.fromJson(jsonNode.extensions.KHR_node_visibility);
        }
        if (jsonNode.extensions?.KHR_node_selectability !== undefined) {
            this.extensions.KHR_node_selectability = new KHR_node_selectability();
            this.extensions.KHR_node_selectability.fromJson(
                jsonNode.extensions.KHR_node_selectability
            );
        }
        if (jsonNode.extensions?.KHR_node_hoverability !== undefined) {
            this.extensions.KHR_node_hoverability = new KHR_node_hoverability();
            this.extensions.KHR_node_hoverability.fromJson(
                jsonNode.extensions.KHR_node_hoverability
            );
        }
        if (jsonNode.extensions?.KHR_physics_rigid_bodies !== undefined) {
            this.extensions.KHR_physics_rigid_bodies = new KHR_physics_rigid_bodies_node();
            this.extensions.KHR_physics_rigid_bodies.fromJson(
                jsonNode.extensions.KHR_physics_rigid_bodies
            );
        }
    }

    getWeights(gltf) {
        if (this.weights !== undefined && this.weights.length > 0) {
            return this.weights;
        } else {
            return gltf.meshes[this.mesh].weights;
        }
    }

    applyMatrix(matrixData) {
        this.matrix = jsToGl(matrixData);

        mat4.getScaling(this.scale, this.matrix);

        // To extract a correct rotation, the scaling component must be eliminated.
        const mn = mat4.create();
        for (const col of [0, 1, 2]) {
            mn[col] = this.matrix[col] / this.scale[0];
            mn[col + 4] = this.matrix[col + 4] / this.scale[1];
            mn[col + 8] = this.matrix[col + 8] / this.scale[2];
        }
        mat4.getRotation(this.rotation, mn);
        quat.normalize(this.rotation, this.rotation);

        mat4.getTranslation(this.translation, this.matrix);
    }

    getLocalTransform() {
        return mat4.fromRotationTranslationScale(
            mat4.create(),
            this.rotation,
            this.translation,
            this.scale
        );
    }

    getRenderedWorldTransform() {
        return this.scaledPhysicsTransform ?? this.worldTransform;
    }

    isTransformDirty() {
        if (this.dirtyTransform) {
            return true;
        }
        for (const prop of ["rotation", "scale", "translation"]) {
            if (this.animatedPropertyObjects[prop].dirty) {
                return true;
            }
        }
        return false;
    }

    clearTransformDirty() {
        for (const prop of ["rotation", "scale", "translation"]) {
            this.animatedPropertyObjects[prop].dirty = false;
        }
        this.dirtyTransform = false;
    }
}

class KHR_node_visibility extends GltfObject {
    static animatedProperties = ["visible"];
    constructor() {
        super();
        this.visible = true;
    }
}

class KHR_node_selectability extends GltfObject {
    static animatedProperties = ["selectable"];
    constructor() {
        super();
        this.selectable = true;
    }
}

class KHR_node_hoverability extends GltfObject {
    static animatedProperties = ["hoverable"];
    constructor() {
        super();
        this.hoverable = true;
    }
}

class KHR_physics_rigid_bodies_node extends GltfObject {
    static animatedProperties = [];
    constructor() {
        super();
        this.motion = undefined;
        this.collider = undefined;
        this.trigger = undefined;
        this.joint = undefined;
    }
    fromJson(json) {
        super.fromJson(json);

        if (json.motion !== undefined) {
            this.motion = new KHR_physics_rigid_bodies_motion();
            this.motion.fromJson(json.motion);
        }
        if (json.collider !== undefined) {
            this.collider = new KHR_physics_rigid_bodies_collider();
            this.collider.fromJson(json.collider);
        }
        if (json.trigger !== undefined) {
            this.trigger = new KHR_physics_rigid_bodies_trigger();
            this.trigger.fromJson(json.trigger);
        }
        if (json.joint !== undefined) {
            this.joint = new KHR_physics_rigid_bodies_joint();
            this.joint.fromJson(json.joint);
        }
    }
}

class KHR_physics_rigid_bodies_trigger extends GltfObject {
    static animatedProperties = [];
    constructor() {
        super();
        this.geometry = undefined;
        this.nodes = [];
        this.collisionFilter = undefined;
    }
}

class KHR_physics_rigid_bodies_collider extends GltfObject {
    static animatedProperties = [];
    constructor() {
        super();
        this.geometry = undefined;
        this.physicsMaterial = undefined;
        this.collisionFilter = undefined;
    }
    fromJson(json) {
        super.fromJson(json);
        if (json.geometry !== undefined) {
            this.geometry = new KHR_physics_rigid_bodies_geometry();
            this.geometry.fromJson(json.geometry);
        }
    }
}

class KHR_physics_rigid_bodies_geometry extends GltfObject {
    static animatedProperties = [];
    constructor() {
        super();
        this.convexHull = false;
        this.shape = undefined;
        this.node = undefined;
    }
}

class KHR_physics_rigid_bodies_motion extends GltfObject {
    static animatedProperties = [
        "isKinematic",
        "mass",
        "centerOfMass",
        "inertialDiagonal",
        "inertialOrientation",
        "linearVelocity",
        "angularVelocity",
        "gravityFactor"
    ];
    constructor() {
        super();
        this.isKinematic = false;
        this.mass = undefined;
        this.centerOfMass = undefined;
        this.inertialDiagonal = undefined;
        this.inertialOrientation = undefined;
        this.linearVelocity = [0, 0, 0];
        this.angularVelocity = [0, 0, 0];
        this.gravityFactor = 1;
    }
}

class KHR_physics_rigid_bodies_joint extends GltfObject {
    static animatedProperties = ["enableCollision"];
    constructor() {
        super();
        this.connectedNode = undefined;
        this.joint = undefined;
        this.enableCollision = false;
    }
}

export { gltfNode };
