import { GltfObject } from "./gltf_object";
import { objectsFromJsons } from "./utils";

class KHR_physics_rigid_bodies extends GltfObject {
    static animatedProperties = [];
    static readonlyAnimatedProperties = ["physicsMaterials", "collisionFilters", "physicsJoints"];
    constructor() {
        super();
        this.physicsMaterials = [];
        this.collisionFilters = [];
        this.physicsJoints = [];
    }
    fromJson(json) {
        super.fromJson(json);
        this.physicsMaterials = objectsFromJsons(json.physicsMaterials, gltfPhysicsMaterial);
        this.collisionFilters = objectsFromJsons(json.collisionFilters, gltfCollisionFilter);
        this.physicsJoints = objectsFromJsons(json.physicsJoints, gltfPhysicsJoint);
    }
}

class gltfPhysicsMaterial extends GltfObject {
    static animatedProperties = ["staticFriction", "dynamicFriction", "restitution"];
    constructor() {
        super();
        this.staticFriction = 0.6;
        this.dynamicFriction = 0.6;
        this.restitution = 0;
        this.frictionCombine = undefined;
        this.restitutionCombine = undefined;
    }
}

class gltfCollisionFilter extends GltfObject {
    static animatedProperties = [];
    constructor() {
        super();
        this.collisionSystems = [];
        this.collideWithSystems = [];
        this.notCollideWithSystems = [];
    }
}

class gltfPhysicsJoint extends GltfObject {
    static animatedProperties = [];
    constructor() {
        super();
        this.limits = [];
        this.drives = [];
    }

    fromJson(json) {
        super.fromJson(json);
        this.limits = objectsFromJsons(json.limits, gltfPhysicsJointLimit);
        this.drives = objectsFromJsons(json.drives, gltfPhysicsJointDrive);
    }
}

class gltfPhysicsJointLimit extends GltfObject {
    static animatedProperties = ["min", "max", "stiffness", "damping"];
    constructor() {
        super();
        this.min = undefined;
        this.max = undefined;
        this.stiffness = undefined;
        this.damping = 0;
        this.linearAxes = undefined;
        this.angularAxes = undefined;
    }
}

class gltfPhysicsJointDrive extends GltfObject {
    static animatedProperties = [
        "maxForce",
        "positionTarget",
        "velocityTarget",
        "stiffness",
        "damping"
    ];
    constructor() {
        super();
        this.type = undefined;
        this.mode = undefined;
        this.axis = undefined;
        this.maxForce = undefined;
        this.positionTarget = undefined;
        this.velocityTarget = undefined;
        this.stiffness = 0;
        this.damping = 0;
    }
}

export {
    KHR_physics_rigid_bodies,
    gltfPhysicsMaterial,
    gltfCollisionFilter,
    gltfPhysicsJoint,
    gltfPhysicsJointLimit,
    gltfPhysicsJointDrive
};
