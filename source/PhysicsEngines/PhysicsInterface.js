/* eslint-disable no-unused-vars */
import { quat, vec3 } from "gl-matrix";

class PhysicsInterface {
    constructor() {
        this.simpleShapes = [];
    }

    // Functions to be implemented by physics engine wrappers

    // Start functions from PhysicsController

    async initializeEngine() {}
    initializeSimulation(
        state,
        staticActors,
        kinematicActors,
        dynamicActors,
        jointNodes,
        triggerNodes,
        independentTriggerNodes,
        nodeToMotion,
        hasRuntimeAnimationTargets,
        staticMeshColliderCount,
        dynamicMeshColliderCount
    ) {}
    resetSimulation() {}
    simulateStep(state, deltaTime) {}
    enableDebugColliders(enable) {}
    enableDebugJoints(enable) {}

    applyImpulse(nodeIndex, linearImpulse, angularImpulse) {}
    applyPointImpulse(nodeIndex, impulse, position) {}
    rayCast(rayStart, rayEnd) {}

    updateActorTransform(node) {}
    updatePhysicsJoint(state, jointNode) {}
    updatePhysicsMaterials(gltf) {}
    updateCollider(
        gltf,
        node,
        collider,
        actorNode,
        worldTransform,
        offsetChanged,
        scaleChanged,
        isTrigger
    ) {}
    updateMotion(actorNode) {}

    // End functions from PhysicsController

    generateSimpleShapes(gltf) {
        this.simpleShapes = [];
        for (const shape of gltf?.shapes ?? []) {
            this.simpleShapes.push(this.generateSimpleShape(shape));
        }
    }

    /**
     * Generates a simple physics shape based on the provided gltfShape.
     * The scale and scaleAxis parameters should be used to apply additional scaling to the shape.
     * The reference parameter can be used to update an already existing shape instead of creating a new one,
     * if the physics engine supports it.
     *
     * @param {gltfShape} shape
     * @param {vec3} scale
     * @param {quat} scaleAxis
     * @param {any | undefined} reference
     * @returns
     */
    generateSimpleShape(
        shape,
        scale = vec3.fromValues(1, 1, 1),
        scaleAxis = quat.create(),
        reference = undefined
    ) {
        switch (shape.type) {
            case "box":
                return this.generateBox(
                    shape.box.size[0],
                    shape.box.size[1],
                    shape.box.size[2],
                    scale,
                    scaleAxis,
                    reference
                );
            case "capsule":
                return this.generateCapsule(
                    shape.capsule.height,
                    shape.capsule.radiusTop,
                    shape.capsule.radiusBottom,
                    scale,
                    scaleAxis,
                    reference
                );
            case "cylinder":
                return this.generateCylinder(
                    shape.cylinder.height,
                    shape.cylinder.radiusTop,
                    shape.cylinder.radiusBottom,
                    scale,
                    scaleAxis,
                    reference
                );
            case "sphere":
                return this.generateSphere(shape.sphere.radius, scale, scaleAxis, reference);
            case "plane":
                return this.generatePlane(reference);
        }
    }

    generateBox(x, y, z, scale, scaleAxis, reference) {}
    generateCapsule(height, radiusTop, radiusBottom, scale, scaleAxis, reference) {}
    generateCylinder(height, radiusTop, radiusBottom, scale, scaleAxis, reference) {}
    generateSphere(radius, scale, scaleAxis, reference) {}
    generatePlane(reference) {}
}

export { PhysicsInterface };
