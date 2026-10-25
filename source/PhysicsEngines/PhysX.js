import PhysX from "physx-js-webidl";
// The import is needed for rollup to include the wasm file in the build output
// eslint-disable-next-line no-unused-vars
import PhysXBinaryFile from "physx-js-webidl/physx-js-webidl.wasm";
import { gltfPhysicsMaterial } from "../gltf/rigid_bodies";
import {
    createBoxVertexData,
    createCapsuleVertexData,
    createCylinderVertexData
} from "../geometry_generator";
import { vec3, mat4, quat, mat3 } from "gl-matrix";
import { PhysicsInterface } from "./PhysicsInterface";
import { PhysicsUtils } from "../gltf/physics_utils";

class NvidiaPhysicsInterface extends PhysicsInterface {
    /**
     * Creates a new NvidiaPhysicsInterface instance, initializing all internal
     * state maps, debug flags, and placeholders for the PhysX engine objects.
     */
    constructor() {
        super();
        this.PhysX = undefined;
        this.physics = undefined;
        this.defaultMaterial = undefined;
        this.tolerances = undefined;

        this.reset = false;

        // Needs to be reset for each scene
        this.scene = undefined;
        this.nodeToActor = new Map();
        this.nodeToMotion = new Map();
        this.nodeToSimplifiedJoints = new Map();
        this.shapeToNode = new Map();
        this.filterData = [];
        this.physXFilterData = [];
        this.physXMaterials = [];

        // Need for memory management
        this.convexMeshes = [];
        this.triangleMeshes = [];

        // Debug
        this.debugColliders = false;
        this.debugJoints = false;
        this.debugStateChanged = true;

        this.MAX_FLOAT = 3.4028234663852885981170418348452e38;
    }

    //region General

    /**
     * Asynchronously loads and initializes the PhysX WebAssembly module, creating the
     * PhysX foundation, tolerances scale, physics object, and a default physics material.
     *
     * @async
     * @returns {Promise<object>} The initialized PhysX module instance.
     */
    async initializeEngine() {
        this.PhysX = await PhysX({ locateFile: () => "./libs/physx-js-webidl.wasm" });
        const version = this.PhysX.PHYSICS_VERSION;
        console.log(
            "PhysX loaded! Version: " +
                ((version >> 24) & 0xff) +
                "." +
                ((version >> 16) & 0xff) +
                "." +
                ((version >> 8) & 0xff)
        );

        const allocator = new this.PhysX.PxDefaultAllocator();
        const errorCb = new this.PhysX.PxDefaultErrorCallback();
        const foundation = this.PhysX.CreateFoundation(version, allocator, errorCb);
        console.log("Created PxFoundation");

        this.tolerances = new this.PhysX.PxTolerancesScale();
        this.tolerances.speed = 9.81;
        this.physics = this.PhysX.CreatePhysics(version, foundation, this.tolerances);
        this.defaultMaterial = this.createPhysXMaterial(new gltfPhysicsMaterial());
        console.log("Created PxPhysics");
        return this.PhysX;
    }

    /**
     * Applies the current debug visualization flags to the active PhysX scene.
     * Enables or disables rendering of collision shapes, joint frames, joint limits,
     * actor axes, and world axes based on {@link debugColliders} and {@link debugJoints}.
     * Does nothing if there is no active scene or if the state has not changed.
     */
    changeDebugVisualization() {
        if (!this.scene || !this.debugStateChanged) {
            return;
        }
        this.debugStateChanged = false;
        this.scene.setVisualizationParameter(
            this.PhysX.eSCALE,
            this.debugColliders || this.debugJoints ? 1 : 0
        );
        this.scene.setVisualizationParameter(
            this.PhysX.eWORLD_AXES,
            this.debugColliders || this.debugJoints ? 1 : 0
        );
        this.scene.setVisualizationParameter(
            this.PhysX.eACTOR_AXES,
            this.debugColliders || this.debugJoints ? 1 : 0
        );
        this.scene.setVisualizationParameter(
            this.PhysX.eCOLLISION_SHAPES,
            this.debugColliders ? 1 : 0
        );
        this.scene.setVisualizationParameter(
            this.PhysX.eJOINT_LOCAL_FRAMES,
            this.debugJoints ? 1 : 0
        );
        this.scene.setVisualizationParameter(this.PhysX.eJOINT_LIMITS, this.debugJoints ? 1 : 0);
        for (const joints of this.nodeToSimplifiedJoints.values()) {
            for (const joint of joints) {
                joint.setConstraintFlag(
                    this.PhysX.PxConstraintFlagEnum.eVISUALIZATION,
                    this.debugJoints
                );
            }
        }
        for (const shapePtr of this.shapeToNode.keys()) {
            const shape = this.PhysX.wrapPointer(shapePtr, this.PhysX.PxShape);
            shape.setFlag(this.PhysX.PxShapeFlagEnum.eVISUALIZATION, this.debugColliders);
        }
    }

    /**
     * Sets up the PhysX scene and populates it with actors and joints derived from the
     * provided glTF node lists. Creates collision filters, physics materials, and the
     * PhysX scene descriptor before adding static, kinematic, dynamic, trigger, and
     * joint actors.
     *
     * @param {object} state - The current viewer state, containing the glTF asset and controllers.
     * @param {Array<object>} staticActors - Nodes to be created as static rigid body actors.
     * @param {Array<object>} kinematicActors - Nodes to be created as kinematic rigid body actors.
     * @param {Array<object>} dynamicActors - Nodes to be created as dynamic rigid body actors.
     * @param {Array<object>} jointNodes - Nodes carrying joint definitions.
     * @param {Array<object>} triggerNodes - Nodes designated as trigger volumes.
     * @param {Array<object>} independentTriggerNodes - Trigger nodes not already covered by another actor.
     * @param {Map<number, object>} nodeToMotion - Mapping from node index to motion data.
     * @param {boolean} _hasRuntimeAnimationTargets - Unused; reserved for future use.
     * @param {number} _staticMeshColliderCount - Unused; reserved for future use.
     * @param {number} _dynamicMeshColliderCount - Unused; reserved for future use.
     */
    initializeSimulation(
        state,
        staticActors,
        kinematicActors,
        dynamicActors,
        jointNodes,
        triggerNodes,
        independentTriggerNodes,
        nodeToMotion,
        _hasRuntimeAnimationTargets,
        _staticMeshColliderCount,
        _dynamicMeshColliderCount
    ) {
        if (!this.PhysX) {
            return;
        }
        this.nodeToMotion = nodeToMotion;
        this.generateSimpleShapes(state.gltf);
        this.computeFilterData(state.gltf);
        for (let i = 0; i < this.filterData.length; i++) {
            const physXFilterData = this.createPhysXCollisionFilter(i);
            this.physXFilterData.push(physXFilterData);
        }

        const materials = state.gltf.extensions?.KHR_physics_rigid_bodies?.physicsMaterials;
        if (materials !== undefined) {
            for (const gltfMaterial of materials) {
                const physxMaterial = this.createPhysXMaterial(gltfMaterial);
                this.physXMaterials.push(physxMaterial);
            }
        }

        const tmpVec = new this.PhysX.PxVec3(0, -9.81, 0);
        const sceneDesc = new this.PhysX.PxSceneDesc(this.tolerances);
        sceneDesc.set_gravity(tmpVec);
        sceneDesc.set_cpuDispatcher(this.PhysX.DefaultCpuDispatcherCreate(0));
        sceneDesc.set_filterShader(this.PhysX.DefaultFilterShader());
        const sceneFlags = new this.PhysX.PxSceneFlags(
            this.PhysX.PxSceneFlagEnum.eENABLE_CCD | this.PhysX.PxSceneFlagEnum.eENABLE_PCM
        );
        sceneDesc.flags = sceneFlags;

        this.scene = this.physics.createScene(sceneDesc);
        let triggerCallback = undefined;

        if (triggerNodes.length > 0) {
            console.log("Enabling trigger report callback");
            triggerCallback = new this.PhysX.PxSimulationEventCallbackImpl();
            triggerCallback.onTrigger = (pairs, count) => {
                for (const compoundTrigger of state.physicsController.compoundTriggerNodes.values()) {
                    compoundTrigger.added.clear();
                    compoundTrigger.removed.clear();
                }
                console.log("Trigger callback called with", count, "pairs");
                for (let i = 0; i < count; i++) {
                    const pair = this.PhysX.NativeArrayHelpers.prototype.getTriggerPairAt(pairs, i);
                    const triggerShape = pair.triggerShape;
                    const otherShape = pair.otherShape;
                    const triggerNodeIndex = this.shapeToNode.get(triggerShape.ptr);
                    const otherNodeIndex = this.shapeToNode.get(otherShape.ptr);
                    if (pair.status === this.PhysX.PxPairFlagEnum.eNOTIFY_TOUCH_FOUND) {
                        state.graphController.rigidBodyTriggerEntered(
                            triggerNodeIndex,
                            otherNodeIndex,
                            nodeToMotion.get(otherNodeIndex)
                        );
                    } else if (pair.status === this.PhysX.PxPairFlagEnum.eNOTIFY_TOUCH_LOST) {
                        state.graphController.rigidBodyTriggerExited(
                            triggerNodeIndex,
                            otherNodeIndex,
                            nodeToMotion.get(otherNodeIndex)
                        );
                    }
                    const compoundTriggers =
                        state.physicsController.triggerToCompound.get(triggerNodeIndex);
                    if (compoundTriggers !== undefined) {
                        for (const compoundTriggerIndex of compoundTriggers) {
                            const compoundTriggerInfo =
                                state.physicsController.compoundTriggerNodes.get(
                                    compoundTriggerIndex
                                );
                            if (pair.status === this.PhysX.PxPairFlagEnum.eNOTIFY_TOUCH_FOUND) {
                                compoundTriggerInfo.added.add(otherNodeIndex);
                            } else if (
                                pair.status === this.PhysX.PxPairFlagEnum.eNOTIFY_TOUCH_LOST
                            ) {
                                compoundTriggerInfo.removed.add(otherNodeIndex);
                            }
                        }
                    }
                }

                for (const [
                    idx,
                    compoundTrigger
                ] of state.physicsController.compoundTriggerNodes.entries()) {
                    for (const addedNodeIndex of compoundTrigger.added) {
                        if (!compoundTrigger.previous.has(addedNodeIndex)) {
                            compoundTrigger.previous.set(addedNodeIndex, 1);
                            state.graphController.rigidBodyTriggerEntered(
                                idx,
                                addedNodeIndex,
                                nodeToMotion.get(addedNodeIndex)
                            );
                        } else {
                            const currentCount = compoundTrigger.previous.get(addedNodeIndex);
                            compoundTrigger.previous.set(addedNodeIndex, currentCount + 1);
                        }
                    }
                    for (const removedNodeIndex of compoundTrigger.removed) {
                        const currentCount = compoundTrigger.previous.get(removedNodeIndex);
                        if (currentCount > 1) {
                            compoundTrigger.previous.set(removedNodeIndex, currentCount - 1);
                        } else {
                            compoundTrigger.previous.delete(removedNodeIndex);
                            state.graphController.rigidBodyTriggerExited(
                                idx,
                                removedNodeIndex,
                                nodeToMotion.get(removedNodeIndex)
                            );
                        }
                    }
                }
            };

            // All callbacks need to be defined
            triggerCallback.onConstraintBreak = (_constraints, _count) => {};
            triggerCallback.onWake = (_actors, _count) => {};
            triggerCallback.onSleep = (_actors, _count) => {};
            triggerCallback.onContact = (_pairHeaders, _pairs, _count) => {};
            sceneDesc.simulationEventCallback = triggerCallback;
        }

        this.scene = this.physics.createScene(sceneDesc);

        console.log("Created scene");
        const shapeFlags = new this.PhysX.PxShapeFlags(
            this.PhysX.PxShapeFlagEnum.eSCENE_QUERY_SHAPE |
                this.PhysX.PxShapeFlagEnum.eSIMULATION_SHAPE
        );

        const triggerFlags = new this.PhysX.PxShapeFlags(this.PhysX.PxShapeFlagEnum.eTRIGGER_SHAPE);

        for (const node of staticActors) {
            this.createActor(state.gltf, node, shapeFlags, triggerFlags, "static");
        }
        for (const node of kinematicActors) {
            this.createActor(state.gltf, node, shapeFlags, triggerFlags, "kinematic");
        }
        for (const node of dynamicActors) {
            this.createActor(state.gltf, node, shapeFlags, triggerFlags, "dynamic", true);
        }
        for (const node of independentTriggerNodes) {
            if (
                this.nodeToActor.has(node.gltfObjectIndex) ||
                this.nodeToMotion.has(node.gltfObjectIndex)
            ) {
                continue;
            }
            this.createActor(state.gltf, node, shapeFlags, triggerFlags, "trigger", true);
        }
        for (const node of jointNodes) {
            this.createJoint(state.gltf, node);
        }

        this.PhysX.destroy(tmpVec);
        this.PhysX.destroy(sceneDesc);
        this.PhysX.destroy(shapeFlags);
        this.PhysX.destroy(triggerFlags);

        this.debugStateChanged = true;
        this.changeDebugVisualization();
    }

    /**
     * Enables or disables debug visualization of collision shapes.
     *
     * @param {boolean} enable - `true` to show collision shape debug rendering; `false` to hide it.
     */
    enableDebugColliders(enable) {
        this.debugColliders = enable;
        this.debugStateChanged = true;
    }

    /**
     * Enables or disables debug visualization of physics joints.
     *
     * @param {boolean} enable - `true` to show joint debug rendering; `false` to hide it.
     */
    enableDebugJoints(enable) {
        this.debugJoints = enable;
        this.debugStateChanged = true;
    }

    /**
     * Executes a single fixed-duration physics sub-step. Before stepping, applies
     * kinematic targets for nodes with velocity overrides and non-unit gravity factors.
     * After stepping, calls `scene.fetchResults` to commit the simulation results.
     *
     * @param {object} state - The current viewer state.
     * @param {number} deltaTime - The duration of the sub-step in seconds.
     */
    subStepSimulation(state, deltaTime) {
        // eslint-disable-next-line no-unused-vars
        for (const [nodeIndex, { actor, pxShapeMap }] of this.nodeToActor.entries()) {
            const node = state.gltf.nodes[nodeIndex];
            if (node.dirtyTransform) {
                // Node transform is currently animated
                continue;
            }
            const motion = node.extensions?.KHR_physics_rigid_bodies?.motion;
            if (motion && motion.isKinematic) {
                const linearVelocity = motion.computedLinearVelocity ?? motion.linearVelocity;
                const angularVelocity = motion.computedAngularVelocity ?? motion.angularVelocity;
                if (linearVelocity !== undefined || angularVelocity !== undefined) {
                    const worldTransform = node.physicsTransform ?? node.worldTransform;
                    const targetPosition = vec3.create();
                    targetPosition[0] = worldTransform[12];
                    targetPosition[1] = worldTransform[13];
                    targetPosition[2] = worldTransform[14];
                    let nodeRotation = quat.create();
                    if (node.physicsTransform !== undefined) {
                        mat4.getRotation(nodeRotation, worldTransform);
                    } else {
                        nodeRotation = quat.clone(node.worldQuaternion);
                    }
                    if (linearVelocity !== undefined) {
                        const acceleration = vec3.create();
                        vec3.scale(acceleration, linearVelocity, deltaTime);
                        vec3.transformQuat(acceleration, acceleration, nodeRotation);
                        targetPosition[0] += acceleration[0];
                        targetPosition[1] += acceleration[1];
                        targetPosition[2] += acceleration[2];
                    }
                    if (angularVelocity !== undefined) {
                        // Transform angular velocity from local space to world space
                        // by rotating the velocity axes by the current node rotation.
                        const localX = vec3.fromValues(1, 0, 0);
                        const localY = vec3.fromValues(0, 1, 0);
                        const localZ = vec3.fromValues(0, 0, 1);
                        vec3.transformQuat(localX, localX, nodeRotation);
                        vec3.transformQuat(localY, localY, nodeRotation);
                        vec3.transformQuat(localZ, localZ, nodeRotation);

                        const angularAcceleration = quat.create();
                        const qX = quat.create();
                        const qY = quat.create();
                        const qZ = quat.create();
                        quat.setAxisAngle(qX, localX, angularVelocity[0] * deltaTime);
                        quat.setAxisAngle(qY, localY, angularVelocity[1] * deltaTime);
                        quat.setAxisAngle(qZ, localZ, angularVelocity[2] * deltaTime);
                        quat.multiply(angularAcceleration, qX, angularAcceleration);
                        quat.multiply(angularAcceleration, qY, angularAcceleration);
                        quat.multiply(angularAcceleration, qZ, angularAcceleration);

                        quat.multiply(nodeRotation, angularAcceleration, nodeRotation);
                    }
                    const pos = new this.PhysX.PxVec3(...targetPosition);
                    const rot = new this.PhysX.PxQuat(...nodeRotation);
                    const transform = new this.PhysX.PxTransform(pos, rot);

                    actor.setKinematicTarget(transform);
                    this.PhysX.destroy(pos);
                    this.PhysX.destroy(rot);
                    this.PhysX.destroy(transform);

                    const physicsTransform = mat4.create();
                    mat4.fromRotationTranslation(physicsTransform, nodeRotation, targetPosition);

                    const scaledPhysicsTransform = mat4.create();
                    mat4.scale(scaledPhysicsTransform, physicsTransform, node.worldScale);

                    node.physicsTransform = physicsTransform;
                    node.scaledPhysicsTransform = scaledPhysicsTransform;
                }
            } else if (motion && motion.gravityFactor !== 1.0) {
                const force = new this.PhysX.PxVec3(0, -9.81 * motion.gravityFactor, 0);
                actor.addForce(force, this.PhysX.PxForceModeEnum.eACCELERATION);
                this.PhysX.destroy(force);
            }
        }

        this.scene.simulate(deltaTime);
        if (!this.scene.fetchResults(true)) {
            console.warn("PhysX: fetchResults failed");
        }
    }

    /**
     * Advances the physics simulation by one frame. Checks for a pending reset,
     * updates debug visualization, runs {@link subStepSimulation}, then reads back
     * actor poses and propagates them to the corresponding glTF nodes and their children.
     *
     * @param {object} state - The current viewer state.
     * @param {number} deltaTime - The elapsed time since the last frame, in seconds.
     */
    simulateStep(state, deltaTime) {
        if (!this.scene) {
            this.reset = false;
            return;
        }
        if (this.reset === true) {
            this._resetSimulation();
            this.reset = false;
            return;
        }

        this.changeDebugVisualization();

        this.subStepSimulation(state, deltaTime);

        // eslint-disable-next-line no-unused-vars
        for (const [nodeIndex, { actor, pxShapeMap }] of this.nodeToActor.entries()) {
            const node = state.gltf.nodes[nodeIndex];
            const motion = node.extensions?.KHR_physics_rigid_bodies?.motion;
            if (motion && !motion.isKinematic && !node.dirtyTransform) {
                const transform = actor.getGlobalPose();
                const position = vec3.fromValues(transform.p.x, transform.p.y, transform.p.z);
                const rotation = quat.fromValues(
                    transform.q.x,
                    transform.q.y,
                    transform.q.z,
                    transform.q.w
                );

                const physicsTransform = mat4.create();
                mat4.fromRotationTranslation(physicsTransform, rotation, position);

                node.physicsTransform = physicsTransform;

                const rotationBetween = quat.create();

                let parentNode = node;
                while (parentNode.parentNode !== undefined) {
                    parentNode = parentNode.parentNode;
                }

                quat.invert(rotationBetween, node.worldQuaternion);
                quat.multiply(rotationBetween, rotation, rotationBetween);

                const rotMat = mat3.create();
                mat3.fromQuat(rotMat, rotationBetween);

                const scaleRot = mat3.create();
                mat3.fromMat4(scaleRot, node.worldTransform);

                mat3.multiply(scaleRot, rotMat, scaleRot);

                const scaledPhysicsTransform = mat4.create();
                scaledPhysicsTransform[0] = scaleRot[0];
                scaledPhysicsTransform[1] = scaleRot[1];
                scaledPhysicsTransform[2] = scaleRot[2];
                scaledPhysicsTransform[4] = scaleRot[3];
                scaledPhysicsTransform[5] = scaleRot[4];
                scaledPhysicsTransform[6] = scaleRot[5];
                scaledPhysicsTransform[8] = scaleRot[6];
                scaledPhysicsTransform[9] = scaleRot[7];
                scaledPhysicsTransform[10] = scaleRot[8];
                scaledPhysicsTransform[12] = position[0];
                scaledPhysicsTransform[13] = position[1];
                scaledPhysicsTransform[14] = position[2];

                node.scaledPhysicsTransform = scaledPhysicsTransform;
                for (const childIndex of node.children) {
                    const childNode = state.gltf.nodes[childIndex];
                    PhysicsUtils.applyTransformRecursively(
                        state.gltf,
                        childNode,
                        node.scaledPhysicsTransform
                    );
                }
            }
        }
    }

    /**
     * Schedules a simulation reset on the next call to {@link simulateStep}.
     * Triggers {@link _resetSimulation} immediately by calling `simulateStep` with a
     * zero delta time.
     */
    resetSimulation() {
        this.reset = true;
        this.simulateStep({}, 0);
    }

    /**
     * Immediately tears down the current PhysX scene, releasing all actors, shapes,
     * joints, meshes, materials, and filter data. Clears all internal caches so
     * the simulation can be re-initialized from scratch.
     */
    _resetSimulation() {
        const scenePointer = this.scene;
        this.scene = undefined;
        this.filterData = [];
        for (const physXFilterData of this.physXFilterData) {
            this.PhysX.destroy(physXFilterData);
        }
        this.physXFilterData = [];

        for (const material of this.physXMaterials) {
            material.release();
        }
        this.physXMaterials = [];

        for (const shape of this.simpleShapes) {
            shape.destroy?.();
        }
        this.simpleShapes = [];

        for (const convexMesh of this.convexMeshes) {
            convexMesh.release();
        }
        this.convexMeshes = [];

        for (const triangleMesh of this.triangleMeshes) {
            triangleMesh.release();
        }
        this.triangleMeshes = [];

        for (const joints of this.nodeToSimplifiedJoints.values()) {
            for (const joint of joints) {
                joint.release();
            }
        }
        this.nodeToSimplifiedJoints.clear();

        for (const actor of this.nodeToActor.values()) {
            actor.actor.release();
        }

        this.nodeToActor.clear();

        if (scenePointer) {
            scenePointer.release();
        }

        this.shapeToNode.clear();
    }

    /**
     * Retrieves the current debug render-buffer line data from the PhysX scene.
     * Returns an interleaved flat array of `[x0, y0, z0, x1, y1, z1, ...]` for
     * each debug line segment.
     *
     * @returns {number[]} A flat array of line endpoint coordinates, or an empty
     *   array if there is no active scene or debug visualization is disabled.
     */
    getDebugLineData() {
        if (!this.scene || (this.debugColliders === false && this.debugJoints === false)) {
            return [];
        }
        const result = [];
        const rb = this.scene.getRenderBuffer();
        for (let i = 0; i < rb.getNbLines(); i++) {
            const line = this.PhysX.NativeArrayHelpers.prototype.getDebugLineAt(rb.getLines(), i);

            result.push(line.pos0.x);
            result.push(line.pos0.y);
            result.push(line.pos0.z);
            result.push(line.pos1.x);
            result.push(line.pos1.y);
            result.push(line.pos1.z);
        }
        return result;
    }

    /**
     * Applies a linear and an angular impulse to the dynamic actor associated with
     * the given node index.
     *
     * @param {number} nodeIndex - Index of the target glTF node.
     * @param {number[]} linearImpulse - World-space linear impulse as `[x, y, z]`.
     * @param {number[]} angularImpulse - World-space angular impulse as `[x, y, z]`.
     */
    applyImpulse(nodeIndex, linearImpulse, angularImpulse) {
        if (!this.scene) {
            return;
        }
        const motionNode = this.nodeToMotion.get(nodeIndex);
        if (!motionNode) {
            return;
        }
        const actorEntry = this.nodeToActor.get(nodeIndex);
        if (!actorEntry) {
            return;
        }
        const actor = actorEntry.actor;

        const linImpulse = new this.PhysX.PxVec3(...linearImpulse);
        const angImpulse = new this.PhysX.PxVec3(...angularImpulse);
        actor.addForce(linImpulse, this.PhysX.PxForceModeEnum.eIMPULSE);
        actor.addTorque(angImpulse, this.PhysX.PxForceModeEnum.eIMPULSE);
        this.PhysX.destroy(linImpulse);
        this.PhysX.destroy(angImpulse);
    }

    /**
     * Applies a linear impulse at a specific world-space position on the actor
     * associated with the given node index. The off-centre application will also
     * generate a corresponding angular impulse.
     *
     * @param {number} nodeIndex - Index of the target glTF node.
     * @param {number[]} impulse - World-space impulse vector as `[x, y, z]`.
     * @param {number[]} position - World-space point of application as `[x, y, z]`.
     */
    applyPointImpulse(nodeIndex, impulse, position) {
        if (!this.scene) {
            return;
        }
        const motionNode = this.nodeToMotion.get(nodeIndex);
        if (!motionNode) {
            return;
        }
        const actorEntry = this.nodeToActor.get(nodeIndex);
        if (!actorEntry) {
            return;
        }
        const actor = actorEntry.actor;

        const pxImpulse = new this.PhysX.PxVec3(...impulse);
        const pxPosition = new this.PhysX.PxVec3(...position);
        this.PhysX.PxRigidBodyExt.prototype.addForceAtPos(
            actor,
            pxImpulse,
            pxPosition,
            this.PhysX.PxForceModeEnum.eIMPULSE
        );
        this.PhysX.destroy(pxImpulse);
        this.PhysX.destroy(pxPosition);
    }

    /**
     * Performs a ray-cast between two world-space points and returns information
     * about the first shape hit.
     *
     * @param {number[]} rayStart - World-space ray origin as `[x, y, z]`.
     * @param {number[]} rayEnd - World-space ray terminus as `[x, y, z]`.
     * @returns {{ hitNodeIndex: number, hitFraction?: number, hitNormal?: Float32Array }}
     *   An object containing the index of the hit node (`-1` on miss), the normalised
     *   hit fraction along the ray, and the surface normal at the hit point.
     */
    rayCast(rayStart, rayEnd) {
        const result = {};
        result.hitNodeIndex = -1;
        if (!this.scene) {
            return result;
        }
        const origin = new this.PhysX.PxVec3(...rayStart);
        const directionVec = vec3.create();
        vec3.subtract(directionVec, rayEnd, rayStart);
        vec3.normalize(directionVec, directionVec);
        const direction = new this.PhysX.PxVec3(...directionVec);
        const maxDistance = vec3.distance(rayStart, rayEnd);

        const hitBuffer = new this.PhysX.PxRaycastBuffer10();
        const hitFlags = new this.PhysX.PxHitFlags(this.PhysX.PxHitFlagEnum.eDEFAULT);

        const queryFilterData = new this.PhysX.PxQueryFilterData();
        queryFilterData.set_flags(
            this.PhysX.PxQueryFlagEnum.eSTATIC | this.PhysX.PxQueryFlagEnum.eDYNAMIC
        );

        const hasHit = this.scene.raycast(
            origin,
            direction,
            maxDistance,
            hitBuffer,
            hitFlags,
            queryFilterData
        );

        this.PhysX.destroy(origin);
        this.PhysX.destroy(direction);
        this.PhysX.destroy(hitFlags);
        this.PhysX.destroy(queryFilterData);

        if (hasHit) {
            const hitCount = hitBuffer.getNbAnyHits();
            if (hitCount > 1) {
                console.warn("Raycast hit multiple objects, only the first hit is returned.");
            }
            const hit = hitBuffer.getAnyHit(0);
            const fraction = hit.distance / maxDistance;
            const hitNormal = vec3.fromValues(hit.normal.x, hit.normal.y, hit.normal.z);
            const hitNodeIndex = this.shapeToNode.get(hit.shape.ptr);
            if (hitNodeIndex === undefined) {
                return result;
            }
            return {
                hitNodeIndex: hitNodeIndex,
                hitFraction: fraction,
                hitNormal: hitNormal
            };
        } else {
            return result;
        }
    }

    //endregion

    //region Updates

    /**
     * Synchronises the PhysX actor pose with the node's current world transform when
     * the node has been flagged as dirty (e.g. by an animation). For kinematic actors
     * `setKinematicTarget` is used; for others `setGlobalPose` is used directly.
     *
     * @param {object} node - The glTF node whose actor transform should be updated.
     */
    updateActorTransform(node) {
        if (node.dirtyTransform) {
            const actor = this.nodeToActor.get(node.gltfObjectIndex)?.actor;
            if (actor === undefined) {
                return;
            }
            const pxPos = new this.PhysX.PxVec3(
                node.worldTransform[12],
                node.worldTransform[13],
                node.worldTransform[14]
            );
            const pxRot = new this.PhysX.PxQuat(...node.worldQuaternion);
            const pxTransform = new this.PhysX.PxTransform(pxPos, pxRot);
            if (node?.extensions?.KHR_physics_rigid_bodies?.motion?.isKinematic) {
                actor.setKinematicTarget(pxTransform);
            } else {
                actor.setGlobalPose(pxTransform);
            }
            this.PhysX.destroy(pxPos);
            this.PhysX.destroy(pxRot);
            this.PhysX.destroy(pxTransform);
        }
    }

    /**
     * Updates the PhysX material parameters (static friction, dynamic friction,
     * restitution) for any glTF physics materials that have been marked dirty.
     *
     * @param {object} gltf - The glTF asset whose `KHR_physics_rigid_bodies` extension
     *   contains the physics materials list.
     */
    updatePhysicMaterials(gltf) {
        const materials = gltf.extensions?.KHR_physics_rigid_bodies?.physicsMaterials;
        if (materials === undefined) {
            return;
        }
        for (let i = 0; i < materials.length; i++) {
            const material = materials[i];
            if (material.isDirty()) {
                const physXMaterial = this.physXMaterials[i];
                physXMaterial.setStaticFriction(material.staticFriction);
                physXMaterial.setDynamicFriction(material.dynamicFriction);
                physXMaterial.setRestitution(material.restitution);
            }
        }
    }

    /**
     * Applies any dirty motion-property changes (kinematic flag, mass, inertia,
     * gravity factor, linear velocity, angular velocity) from the glTF node's motion
     * extension to the corresponding PhysX actor.
     *
     * @param {object} actorNode - The glTF node whose motion properties should be updated.
     */
    updateMotion(actorNode) {
        const motion = actorNode.extensions?.KHR_physics_rigid_bodies?.motion;
        const actor = this.nodeToActor.get(actorNode.gltfObjectIndex).actor;
        if (motion.animatedPropertyObjects.isKinematic.dirty) {
            if (motion.isKinematic) {
                const linearVelocity = actor.getLinearVelocity();
                motion.computedLinearVelocity = [
                    linearVelocity.x,
                    linearVelocity.y,
                    linearVelocity.z
                ];
                const angularVelocity = actor.getAngularVelocity();
                motion.computedAngularVelocity = [
                    angularVelocity.x,
                    angularVelocity.y,
                    angularVelocity.z
                ];
            } else {
                motion.computedLinearVelocity = undefined;
                motion.computedAngularVelocity = undefined;
            }
            actor.setRigidBodyFlag(this.PhysX.PxRigidBodyFlagEnum.eENABLE_CCD, !motion.isKinematic);
            actor.setRigidBodyFlag(this.PhysX.PxRigidBodyFlagEnum.eKINEMATIC, motion.isKinematic);
        }
        if (motion.animatedPropertyObjects.mass.dirty) {
            actor.setMass(motion.mass);
        }
        if (
            motion.animatedPropertyObjects.centerOfMass.dirty ||
            motion.animatedPropertyObjects.inertiaOrientation.dirty ||
            motion.animatedPropertyObjects.inertiaDiagonal.dirty
        ) {
            this.calculateMassAndInertia(motion, actor);
        }
        if (motion.animatedPropertyObjects.gravityFactor.dirty) {
            actor.setActorFlag(
                this.PhysX.PxActorFlagEnum.eDISABLE_GRAVITY,
                motion.gravityFactor !== 1.0
            );
        }
        if (motion.animatedPropertyObjects.linearVelocity.dirty) {
            const pxVelocity = new this.PhysX.PxVec3(...motion.linearVelocity);
            actor.setLinearVelocity(pxVelocity);
            motion.computedLinearVelocity = undefined;
        }
        if (motion.animatedPropertyObjects.angularVelocity.dirty) {
            const pxVelocity = new this.PhysX.PxVec3(...motion.angularVelocity);
            actor.setAngularVelocity(pxVelocity);
            motion.computedAngularVelocity = undefined;
        }
    }

    /**
     * Updates the geometry and/or local pose of a collider shape attached to an actor.
     * Handles scale changes for convex/triangle mesh geometries and recreates simple
     * shapes when their defining properties have changed.
     *
     * @param {object} gltf - The glTF asset.
     * @param {object} node - The node that owns the collider shape.
     * @param {object} collider - The glTF collider descriptor for the node.
     * @param {object} actorNode - The node that owns the PhysX actor.
     * @param {Float32Array} worldTransform - The 4x4 world transform of the collider node.
     * @param {boolean} offsetChanged - `true` if the shape's local pose must be recomputed.
     * @param {boolean} scaleChanged - `true` if the geometry scale must be updated.
     * @param {boolean} isTrigger - `true` if the shape is a trigger volume.
     */
    updateCollider(
        gltf,
        node,
        collider,
        actorNode,
        worldTransform,
        offsetChanged,
        scaleChanged,
        isTrigger
    ) {
        const result = this.nodeToActor.get(actorNode.gltfObjectIndex);
        const actor = result?.actor;
        const currentShape = result?.pxShapeMap.get(node.gltfObjectIndex);

        let currentGeometry = currentShape.getGeometry();
        const currentColliderType = currentGeometry.getType();
        const shapeIndex = collider?.geometry?.shape;
        let scale = vec3.fromValues(1, 1, 1);
        let scaleAxis = quat.create();
        if (shapeIndex !== undefined) {
            // Simple shapes need to be recreated if scale changed
            // If properties changed we also need to recreate the mesh colliders
            const dirty = gltf.shapes[shapeIndex].isDirty();
            if (
                scaleChanged &&
                !dirty &&
                currentColliderType === this.PhysX.PxGeometryTypeEnum.eCONVEXMESH
            ) {
                // Update convex mesh scale
                currentGeometry = this.PhysX.castObject(
                    currentGeometry,
                    this.PhysX.PxConvexMeshGeometry
                );
                const result = PhysicsUtils.calculateScaleAndAxis(node);
                scale = result.scale;
                scaleAxis = result.scaleAxis;
                const pxScale = new this.PhysX.PxVec3(...scale);
                const pxRotation = new this.PhysX.PxQuat(...scaleAxis);
                const meshScale = new this.PhysX.PxMeshScale(pxScale, pxRotation);
                currentGeometry.scale = meshScale;
                this.PhysX.destroy(pxScale);
                this.PhysX.destroy(pxRotation);
            } else if (dirty || scaleChanged) {
                // Recreate simple shape collider
                const newGeometry = this.generateSimpleShape(
                    gltf.shapes[shapeIndex],
                    scale,
                    scaleAxis
                );
                currentGeometry.release?.();
                if (newGeometry.getType() !== currentColliderType) {
                    // We need to recreate the shape
                    let shapeFlags = undefined;
                    if (isTrigger) {
                        shapeFlags = this.PhysX.PxShapeFlagEnum.eTRIGGER_SHAPE;
                    } else {
                        shapeFlags = this.PhysX.PxShapeFlagEnum.eSIMULATION_SHAPE;
                    }
                    if (this.debugColliders) {
                        shapeFlags |= this.PhysX.PxShapeFlagEnum.eVISUALIZATION;
                    }
                    const shape = this.createShapeFromGeometry(
                        newGeometry,
                        undefined,
                        undefined,
                        shapeFlags,
                        collider
                    );
                    result?.pxShapeMap.set(node.gltfObjectIndex, shape);
                    actor.detachShape(currentShape);
                    actor.attachShape(shape);
                    this.PhysX.destroy(currentShape);
                } else {
                    currentShape.setGeometry(newGeometry);
                }
            }
        } else if (collider?.geometry?.mesh !== undefined) {
            if (scaleChanged) {
                if (currentColliderType === this.PhysX.PxGeometryTypeEnum.eCONVEXMESH) {
                    currentGeometry = this.PhysX.castObject(
                        currentGeometry,
                        this.PhysX.PxConvexMeshGeometry
                    );
                } else if (currentColliderType === this.PhysX.PxGeometryTypeEnum.eTRIANGLEMESH) {
                    currentGeometry = this.PhysX.castObject(
                        currentGeometry,
                        this.PhysX.PxTriangleMeshGeometry
                    );
                }
                // apply scale
                const result = PhysicsUtils.calculateScaleAndAxis(node);
                scale = result.scale;
                scaleAxis = result.scaleAxis;
                const pxScale = new this.PhysX.PxVec3(...scale);
                const pxRotation = new this.PhysX.PxQuat(...scaleAxis);
                const meshScale = new this.PhysX.PxMeshScale(pxScale, pxRotation);
                currentGeometry.scale = meshScale;
                this.PhysX.destroy(pxScale);
                this.PhysX.destroy(pxRotation);
            }
        }
        if (offsetChanged) {
            // Calculate offset position
            const translation = vec3.create();
            const shapePosition = vec3.create();
            mat4.getTranslation(shapePosition, actorNode.worldTransform);
            const invertedActorRotation = quat.create();
            quat.invert(invertedActorRotation, actorNode.worldQuaternion);
            const offsetPosition = vec3.create();
            mat4.getTranslation(offsetPosition, worldTransform);
            vec3.subtract(translation, offsetPosition, shapePosition);
            vec3.transformQuat(translation, translation, invertedActorRotation);

            // Calculate offset rotation
            const rotation = quat.create();
            quat.multiply(rotation, invertedActorRotation, node.worldQuaternion);

            const PxPos = new this.PhysX.PxVec3(...translation);
            const PxRotation = new this.PhysX.PxQuat(...rotation);
            const pose = new this.PhysX.PxTransform(PxPos, PxRotation);
            currentShape.setLocalPose(pose);
        }
    }

    /**
     * Propagates dirty joint-property changes (collision flag, limits, drives) from
     * the glTF joint extension to the corresponding PhysX D6 joint constraints.
     *
     * @param {object} state - The current viewer state, providing access to the glTF asset.
     * @param {object} jointNode - The glTF node whose joint properties should be updated.
     */
    updatePhysicsJoint(state, jointNode) {
        const pxJoints = this.nodeToSimplifiedJoints.get(jointNode.gltfObjectIndex);
        if (pxJoints === undefined) {
            return;
        }
        const gltfJoint =
            state.gltf.extensions.KHR_physics_rigid_bodies.physicsJoints[
                jointNode.extensions.KHR_physics_rigid_bodies.joint.joint
            ];

        const connectedNode =
            state.gltf.nodes[jointNode.extensions.KHR_physics_rigid_bodies.joint.connectedNode];

        const simplifiedJoints = gltfJoint.simplifiedPhysicsJoints;
        if (simplifiedJoints.length !== pxJoints.length) {
            console.warn(
                "Number of simplified joints does not match number of PhysX joints. Skipping joint update."
            );
            return;
        }

        const hasJointSpaceChangedA = PhysicsUtils.hasJointSpaceChanged(jointNode);
        const hasJointSpaceChangedB = PhysicsUtils.hasJointSpaceChanged(connectedNode);

        for (let i = 0; i < simplifiedJoints.length; i++) {
            const pxJoint = pxJoints[i];
            const simplifiedJoint = simplifiedJoints[i];
            if (hasJointSpaceChangedA) {
                const resultA = this.computeJointOffsetAndActor(jointNode, simplifiedJoint);
                const pos = new this.PhysX.PxVec3(...resultA.offsetPosition);
                const rot = new this.PhysX.PxQuat(...resultA.offsetRotation);
                const poseA = new this.PhysX.PxTransform(pos, rot);
                pxJoint.setLocalPose(this.PhysX.PxJointActorIndexEnum.eACTOR0, poseA);
                this.PhysX.destroy(poseA);
                this.PhysX.destroy(pos);
                this.PhysX.destroy(rot);
            }
            if (hasJointSpaceChangedB) {
                const resultB = this.computeJointOffsetAndActor(connectedNode, simplifiedJoint);
                const posB = new this.PhysX.PxVec3(...resultB.offsetPosition);
                const rotB = new this.PhysX.PxQuat(...resultB.offsetRotation);
                const poseB = new this.PhysX.PxTransform(posB, rotB);
                pxJoint.setLocalPose(this.PhysX.PxJointActorIndexEnum.eACTOR1, poseB);
                this.PhysX.destroy(poseB);
                this.PhysX.destroy(posB);
                this.PhysX.destroy(rotB);
            }

            if (
                jointNode.extensions.KHR_physics_rigid_bodies.joint.animatedPropertyObjects
                    .enableCollision.dirty
            ) {
                pxJoint.setConstraintFlag(
                    this.PhysX.PxConstraintFlagEnum.eCOLLISION_ENABLED,
                    jointNode.extensions.KHR_physics_rigid_bodies.joint.enableCollision
                );
            }
            for (const limit of simplifiedJoint.limits) {
                if (
                    limit.animatedPropertyObjects.min.dirty ||
                    limit.animatedPropertyObjects.max.dirty ||
                    limit.animatedPropertyObjects.stiffness.dirty ||
                    limit.animatedPropertyObjects.damping.dirty
                ) {
                    this._setLimitValues(pxJoint, simplifiedJoint, limit);
                }
            }

            if (
                simplifiedJoint.twistLimit &&
                (simplifiedJoint.twistLimit.animatedPropertyObjects.min.dirty ||
                    simplifiedJoint.twistLimit.animatedPropertyObjects.max.dirty ||
                    simplifiedJoint.twistLimit.animatedPropertyObjects.stiffness.dirty ||
                    simplifiedJoint.twistLimit.animatedPropertyObjects.damping.dirty)
            ) {
                this._setTwistLimitValues(pxJoint, simplifiedJoint);
            }

            if (
                (simplifiedJoint.swingLimit1 &&
                    (simplifiedJoint.swingLimit1.animatedPropertyObjects.min.dirty ||
                        simplifiedJoint.swingLimit1.animatedPropertyObjects.max.dirty ||
                        simplifiedJoint.swingLimit1.animatedPropertyObjects.stiffness.dirty ||
                        simplifiedJoint.swingLimit1.animatedPropertyObjects.damping.dirty)) ||
                (simplifiedJoint.swingLimit2 &&
                    (simplifiedJoint.swingLimit2.animatedPropertyObjects.min.dirty ||
                        simplifiedJoint.swingLimit2.animatedPropertyObjects.max.dirty ||
                        simplifiedJoint.swingLimit2.animatedPropertyObjects.stiffness.dirty ||
                        simplifiedJoint.swingLimit2.animatedPropertyObjects.damping.dirty))
            ) {
                this._setSwingLimitValues(pxJoint, simplifiedJoint);
            }

            let positionTargetDirty = false;
            let velocityTargetDirty = false;
            const linearVelocityTarget = new this.PhysX.PxVec3(0, 0, 0);
            const angularVelocityTarget = new this.PhysX.PxVec3(0, 0, 0);
            pxJoint.getDriveVelocity(linearVelocityTarget, angularVelocityTarget);
            for (const drive of simplifiedJoint.drives) {
                if (
                    drive.animatedPropertyObjects.stiffness.dirty ||
                    drive.animatedPropertyObjects.damping.dirty ||
                    drive.animatedPropertyObjects.maxForce.dirty
                ) {
                    this._setDriveValues(pxJoint, simplifiedJoint, drive);
                }
                if (drive.animatedPropertyObjects.velocityTarget.dirty) {
                    this._getDriveVelocityTarget(
                        simplifiedJoint,
                        drive,
                        linearVelocityTarget,
                        angularVelocityTarget
                    );
                    velocityTargetDirty = true;
                }
                if (drive.animatedPropertyObjects.positionTarget.dirty) {
                    positionTargetDirty = true;
                }
            }

            if (positionTargetDirty) {
                this._setDrivePositionTarget(pxJoint, simplifiedJoint);
            }
            if (velocityTargetDirty) {
                pxJoint.setDriveVelocity(linearVelocityTarget, angularVelocityTarget);
            }
        }
    }

    //endregion

    //region Geometry

    /**
     * Creates or updates a PhysX box geometry with the given dimensions and scale.
     * If a non-uniform scale with a non-identity axis quaternion is detected the box
     * is approximated as a convex mesh instead.
     *
     * @param {number} x - Full extent along the X axis (before scaling).
     * @param {number} y - Full extent along the Y axis (before scaling).
     * @param {number} z - Full extent along the Z axis (before scaling).
     * @param {number[]} scale - Per-axis scale factors as `[sx, sy, sz]`.
     * @param {quat} scaleAxis - Quaternion describing the orientation of the scale axes.
     * @param {object} [reference] - An existing PhysX geometry object to update in-place.
     *   If supplied and the type matches, the geometry is mutated rather than re-created.
     * @returns {object|undefined} A new `PxBoxGeometry` (or `PxConvexMeshGeometry`),
     *   or `undefined` when the reference geometry was updated in-place.
     */
    // Either create a box or update an existing one. Returns only newly created geometry
    generateBox(x, y, z, scale, scaleAxis, reference) {
        let referenceType = undefined;
        if (reference !== undefined) {
            referenceType = reference.getType();
        }
        if (
            scale.every((value) => value === scale[0]) === false &&
            quat.equals(scaleAxis, quat.create()) === false
        ) {
            const data = createBoxVertexData(x, y, z);
            return this.createConvexPxMesh(data.vertices, scale, scaleAxis);
        }
        let geometry = undefined;
        if (referenceType === this.PhysX.PxGeometryTypeEnum.eBOX) {
            const halfExtents = new this.PhysX.PxVec3(
                (x / 2) * scale[0],
                (y / 2) * scale[1],
                (z / 2) * scale[2]
            );
            reference.halfExtents = halfExtents;
            this.PhysX.destroy(halfExtents);
        } else {
            geometry = new this.PhysX.PxBoxGeometry(
                (x / 2) * scale[0],
                (y / 2) * scale[1],
                (z / 2) * scale[2]
            );
        }

        return geometry;
    }

    /**
     * Creates a PhysX convex mesh geometry approximating a capsule shape.
     *
     * @param {number} height - The height of the cylindrical mid-section.
     * @param {number} radiusTop - Radius of the top hemisphere.
     * @param {number} radiusBottom - Radius of the bottom hemisphere.
     * @param {number[]} scale - Per-axis scale factors as `[sx, sy, sz]`.
     * @param {quat} scaleAxis - Quaternion describing the orientation of the scale axes.
     * @param {object} _reference - Unused; reserved for API consistency.
     * @returns {object} The created `PxConvexMeshGeometry`.
     */
    generateCapsule(height, radiusTop, radiusBottom, scale, scaleAxis, _reference) {
        const data = createCapsuleVertexData(radiusTop, radiusBottom, height);
        return this.createConvexPxMesh(data.vertices, scale, scaleAxis);
    }

    /**
     * Creates a PhysX convex mesh geometry approximating a cylinder shape.
     * Falls back to a scaled convex hull representation when non-uniform scaling
     * or different top/bottom radii are detected.
     *
     * @param {number} height - The height of the cylinder.
     * @param {number} radiusTop - Radius of the top face.
     * @param {number} radiusBottom - Radius of the bottom face.
     * @param {number[]} scale - Per-axis scale factors as `[sx, sy, sz]`.
     * @param {quat} scaleAxis - Quaternion describing the orientation of the scale axes.
     * @param {object} _reference - Unused; reserved for API consistency.
     * @returns {object} The created `PxConvexMeshGeometry`.
     */
    generateCylinder(height, radiusTop, radiusBottom, scale, scaleAxis, _reference) {
        if (
            (quat.equals(scaleAxis, quat.create()) === false &&
                scale.every((value) => value === scale[0]) === false) ||
            radiusTop !== radiusBottom ||
            scale[0] !== scale[2]
        ) {
            const data = createCylinderVertexData(radiusTop, radiusBottom, height);
            return this.createConvexPxMesh(data.vertices, scale, scaleAxis);
        }
        height *= scale[1];
        radiusTop *= scale[0];
        radiusBottom *= scale[0];
        const data = createCylinderVertexData(radiusTop, radiusBottom, height);
        return this.createConvexPxMesh(data.vertices);
    }

    /**
     * Creates or updates a PhysX sphere geometry. If a non-uniform scale is detected
     * the sphere is approximated as a convex mesh instead.
     *
     * @param {number} radius - The radius of the sphere before scaling.
     * @param {number[]} scale - Per-axis scale factors as `[sx, sy, sz]`.
     * @param {quat} scaleAxis - Quaternion describing the orientation of the scale axes.
     * @param {object} [reference] - An existing PhysX geometry object to update in-place.
     * @returns {object|undefined} A new `PxSphereGeometry` (or `PxConvexMeshGeometry`),
     *   or `undefined` when the reference geometry was updated in-place.
     */
    generateSphere(radius, scale, scaleAxis, reference) {
        let referenceType = undefined;
        if (reference !== undefined) {
            referenceType = reference.getType();
        }
        if (scale.every((value) => value === scale[0]) === false) {
            const data = createCapsuleVertexData(radius, radius, 0);
            return this.createConvexPxMesh(data.vertices, scale, scaleAxis);
        } else {
            radius *= scale[0];
        }
        if (referenceType === this.PhysX.PxGeometryTypeEnum.eSPHERE) {
            reference.radius = radius;
            return undefined;
        }
        const geometry = new this.PhysX.PxSphereGeometry(radius);
        return geometry;
    }

    /**
     * Creates a PhysX infinite plane geometry.
     *
     * @param {object} [reference] - An existing PhysX geometry object. If supplied,
     *   no new geometry is created because plane geometry has no mutable properties.
     * @returns {object|undefined} A new `PxPlaneGeometry`, or `undefined` if a
     *   reference was provided.
     */
    generatePlane(reference) {
        if (reference !== undefined) {
            // Nothing to update
            return undefined;
        }
        const geometry = new this.PhysX.PxPlaneGeometry();
        return geometry;
    }

    /**
     * Cooks a PhysX convex mesh from the provided vertex data and wraps it in a
     * `PxConvexMeshGeometry` with the given scale and scale-axis rotation.
     * The resulting `PxConvexMesh` is tracked in {@link convexMeshes} for later cleanup.
     *
     * @param {Float32Array} vertices - Flat array of vertex positions `[x, y, z, ...]`.
     * @param {number[]} [scale] - Per-axis scale factors; defaults to `[1, 1, 1]`.
     * @param {quat} [scaleAxis] - Quaternion for scale-axis rotation; defaults to identity.
     * @returns {object} The created `PxConvexMeshGeometry`.
     */
    createConvexPxMesh(vertices, scale = vec3.fromValues(1, 1, 1), scaleAxis = quat.create()) {
        const malloc = (f, q) => {
            const nDataBytes = f.length * f.BYTES_PER_ELEMENT;
            if (q === undefined) q = this.PhysX._webidl_malloc(nDataBytes);
            let dataHeap = new Uint8Array(this.PhysX.HEAPU8.buffer, q, nDataBytes);
            dataHeap.set(new Uint8Array(f.buffer));
            return q;
        };
        const des = new this.PhysX.PxConvexMeshDesc();
        des.points.stride = vertices.BYTES_PER_ELEMENT * 3;
        des.points.count = vertices.length / 3;
        des.points.data = malloc(vertices);

        let flag = 0;
        flag |= this.PhysX.PxConvexFlagEnum.eCOMPUTE_CONVEX;
        flag |= this.PhysX.PxConvexFlagEnum.eSHIFT_VERTICES;
        //flag |= this.PhysX.PxConvexFlagEnum.eDISABLE_MESH_VALIDATION;
        const pxflags = new this.PhysX.PxConvexFlags(flag);
        des.flags = pxflags;
        const cookingParams = new this.PhysX.PxCookingParams(this.tolerances);
        cookingParams.planeTolerance = 0.0007; //Default
        const tri = this.PhysX.CreateConvexMesh(cookingParams, des);
        this.convexMeshes.push(tri);

        const PxScale = new this.PhysX.PxVec3(scale[0], scale[1], scale[2]);
        const PxQuat = new this.PhysX.PxQuat(...scaleAxis);
        const ms = new this.PhysX.PxMeshScale(PxScale, PxQuat);
        const f = new this.PhysX.PxConvexMeshGeometryFlags();
        const geometry = new this.PhysX.PxConvexMeshGeometry(tri, ms, f);
        this.PhysX.destroy(PxScale);
        this.PhysX.destroy(PxQuat);
        this.PhysX.destroy(ms);
        this.PhysX.destroy(pxflags);
        this.PhysX.destroy(cookingParams);
        this.PhysX.destroy(des);
        return geometry;
    }

    /**
     * Extracts and flattens vertex position and (optionally) index data from all
     * primitives of a glTF mesh. Morph targets are applied on the CPU using the
     * mesh's current weights. Triangle-strip and triangle-fan primitives are
     * converted to indexed triangles automatically.
     *
     * @param {object} gltf - The glTF asset.
     * @param {object} mesh - The glTF mesh to collect data from.
     * @param {boolean} [computeIndices=true] - Whether to collect index data in
     *   addition to vertex positions.
     * @returns {{ vertices: Float32Array, indices: Uint32Array }} The collected
     *   geometry data.
     */
    collectVerticesAndIndicesFromMesh(gltf, mesh, computeIndices = true) {
        let positionDataArray = [];
        let positionCount = 0;
        let indexDataArray = [];
        let indexCount = 0;

        for (const primitive of mesh.primitives) {
            const positionAccessor = gltf.accessors[primitive.attributes.POSITION];
            const positionData = positionAccessor.getNormalizedDeinterlacedView(gltf);

            if (primitive.targets !== undefined) {
                let morphWeights = mesh.weights;
                if (morphWeights !== undefined) {
                    // Calculate morphed vertex positions on CPU
                    const morphPositionData = [];
                    for (const target of primitive.targets) {
                        if (target.POSITION !== undefined) {
                            const morphAccessor = gltf.accessors[target.POSITION];
                            morphPositionData.push(
                                morphAccessor.getNormalizedDeinterlacedView(gltf)
                            );
                        } else {
                            morphPositionData.push(undefined);
                        }
                    }
                    for (let i = 0; i < positionData.length / 3; i++) {
                        for (let j = 0; j < morphWeights.length; j++) {
                            const morphData = morphPositionData[j];
                            if (morphWeights[j] === 0 || morphData === undefined) {
                                continue;
                            }
                            positionData[i * 3] += morphData[i * 3] * morphWeights[j];
                            positionData[i * 3 + 1] += morphData[i * 3 + 1] * morphWeights[j];
                            positionData[i * 3 + 2] += morphData[i * 3 + 2] * morphWeights[j];
                        }
                    }
                }
            }

            positionDataArray.push(positionData);
            positionCount += positionAccessor.count;
            if (computeIndices) {
                let indexData = undefined;
                if (primitive.indices !== undefined) {
                    const indexAccessor = gltf.accessors[primitive.indices];
                    indexData = indexAccessor.getNormalizedDeinterlacedView(gltf);
                } else {
                    const array = Array.from(Array(positionAccessor.count).keys());
                    indexData = new Uint32Array(array);
                }
                if (primitive.mode === 5) {
                    indexData = PhysicsUtils.convertTriangleStripToTriangles(indexData);
                } else if (primitive.mode === 6) {
                    indexData = PhysicsUtils.convertTriangleFanToTriangles(indexData);
                } else if (primitive.mode !== undefined && primitive.mode !== 4) {
                    console.warn(
                        "Unsupported primitive mode for physics mesh collider creation: " +
                            primitive.mode
                    );
                }
                indexDataArray.push(indexData);
                indexCount += indexData.length;
            }
        }

        const positionData = new Float32Array(positionCount * 3);
        const indexData = new Uint32Array(indexCount);
        let offset = 0;
        for (const positionChunk of positionDataArray) {
            positionData.set(positionChunk, offset);
            offset += positionChunk.length;
        }
        offset = 0;
        for (const indexChunk of indexDataArray) {
            indexData.set(indexChunk, offset);
            offset += indexChunk.length;
        }
        return { vertices: positionData, indices: indexData };
    }

    /**
     * Creates a PhysX convex hull mesh geometry from the vertex data of a glTF mesh.
     *
     * @param {object} gltf - The glTF asset.
     * @param {object} mesh - The glTF mesh to build the convex hull from.
     * @param {number[]} [scale] - Per-axis scale factors; defaults to `[1, 1, 1]`.
     * @param {quat} [scaleAxis] - Quaternion for scale-axis rotation; defaults to identity.
     * @returns {object} The created `PxConvexMeshGeometry`.
     */
    createConvexMesh(gltf, mesh, scale = vec3.fromValues(1, 1, 1), scaleAxis = quat.create()) {
        const result = this.collectVerticesAndIndicesFromMesh(gltf, mesh, false);
        return this.createConvexPxMesh(result.vertices, scale, scaleAxis);
    }

    /**
     * Cooks a PhysX triangle mesh from the vertex and index data of a glTF mesh.
     * The resulting `PxTriangleMesh` is tracked in {@link triangleMeshes} for later cleanup.
     *
     * @param {object} gltf - The glTF asset.
     * @param {object} mesh - The glTF mesh to build the triangle mesh from.
     * @param {number[]} [scale] - Per-axis scale factors; defaults to `[1, 1, 1]`.
     * @param {quat} [scaleAxis] - Quaternion for scale-axis rotation; defaults to identity.
     * @returns {object} The created `PxTriangleMeshGeometry`.
     */
    createPxMesh(gltf, mesh, scale = vec3.fromValues(1, 1, 1), scaleAxis = quat.create()) {
        const { vertices, indices } = this.collectVerticesAndIndicesFromMesh(gltf, mesh, true);
        const malloc = (f, q) => {
            const nDataBytes = f.length * f.BYTES_PER_ELEMENT;
            if (q === undefined) q = this.PhysX._webidl_malloc(nDataBytes);
            let dataHeap = new Uint8Array(this.PhysX.HEAPU8.buffer, q, nDataBytes);
            dataHeap.set(new Uint8Array(f.buffer));
            return q;
        };
        const des = new this.PhysX.PxTriangleMeshDesc();
        des.points.stride = vertices.BYTES_PER_ELEMENT * 3;
        des.points.count = vertices.length / 3;
        des.points.data = malloc(vertices);

        des.triangles.stride = indices.BYTES_PER_ELEMENT * 3;
        des.triangles.count = indices.length / 3;
        des.triangles.data = malloc(indices);

        const cookingParams = new this.PhysX.PxCookingParams(this.tolerances);
        const tri = this.PhysX.CreateTriangleMesh(cookingParams, des);
        this.triangleMeshes.push(tri);

        const PxScale = new this.PhysX.PxVec3(1, 1, 1);
        const PxQuat = new this.PhysX.PxQuat(0, 0, 0, 1);

        if (scale !== undefined) {
            PxScale.x = scale[0];
            PxScale.y = scale[1];
            PxScale.z = scale[2];
        }
        if (scaleAxis !== undefined) {
            PxQuat.x = scaleAxis[0];
            PxQuat.y = scaleAxis[1];
            PxQuat.z = scaleAxis[2];
            PxQuat.w = scaleAxis[3];
        }
        const ms = new this.PhysX.PxMeshScale(PxScale, PxQuat);
        const f = new this.PhysX.PxMeshGeometryFlags();
        const geometry = new this.PhysX.PxTriangleMeshGeometry(tri, ms, f);
        this.PhysX.destroy(PxScale);
        this.PhysX.destroy(PxQuat);
        this.PhysX.destroy(ms);
        this.PhysX.destroy(cookingParams);
        this.PhysX.destroy(des);
        return geometry;
    }

    /**
     * Determines whether two collision filters should generate contacts with each other.
     * `filterB`'s include/exclude system lists are checked against `filterA`'s
     * collision systems.
     *
     * @param {object} filterA - The first collision filter descriptor.
     * @param {object} filterB - The second collision filter descriptor whose rules are evaluated.
     * @returns {boolean} `true` if the two filters should produce collision events.
     */
    collidesWith(filterA, filterB) {
        if (filterB.collideWithSystems.length > 0) {
            for (const system of filterB.collideWithSystems) {
                if (filterA.collisionSystems.includes(system)) {
                    return true;
                }
            }
            return false;
        } else if (filterB.notCollideWithSystems.length > 0) {
            for (const system of filterB.notCollideWithSystems) {
                if (filterA.collisionSystems.includes(system)) {
                    return false;
                }
            }
            return true;
        }
        return true;
    }

    //endregion

    //region Shapes

    /**
     * Pre-computes a bit-mask collision matrix for all collision filters defined in
     * the glTF `KHR_physics_rigid_bodies` extension. Each entry `filterData[i]` is a
     * bitmask of filter indices that filter `i` should collide with. Index 31 is
     * reserved as the default filter (collides with everything). A maximum of 31
     * user-defined filters are supported.
     *
     * @param {object} gltf - The glTF asset containing the collision filter definitions.
     */
    computeFilterData(gltf) {
        // Default filter is sign bit
        const filters = gltf.extensions?.KHR_physics_rigid_bodies?.collisionFilters;
        this.filterData = new Array(32).fill(0);
        this.filterData[31] = Math.pow(2, 32) - 1; // Default filter with all bits set
        let filterCount = filters?.length ?? 0;
        if (filterCount > 31) {
            filterCount = 31;
            console.warn(
                "PhysX supports a maximum of 31 collision filters. Additional filters will be ignored."
            );
        }

        for (let i = 0; i < filterCount; i++) {
            let bitMask = 0;
            for (let j = 0; j < filterCount; j++) {
                if (
                    this.collidesWith(filters[i], filters[j]) &&
                    this.collidesWith(filters[j], filters[i])
                ) {
                    bitMask |= 1 << j;
                }
            }
            this.filterData[i] = bitMask;
        }
    }

    /**
     * Creates a new PhysX material from a glTF physics material descriptor.
     * Returns the default material when `undefined` is passed.
     *
     * @param {object|undefined} gltfPhysicsMaterial - The glTF physics material
     *   (from `KHR_physics_rigid_bodies`), or `undefined` to use the default material.
     * @returns {object} The created (or default) `PxMaterial`.
     */
    createPhysXMaterial(gltfPhysicsMaterial) {
        if (gltfPhysicsMaterial === undefined) {
            return this.defaultMaterial;
        }

        const physxMaterial = this.physics.createMaterial(
            gltfPhysicsMaterial.staticFriction,
            gltfPhysicsMaterial.dynamicFriction,
            gltfPhysicsMaterial.restitution
        );
        if (gltfPhysicsMaterial.frictionCombine !== undefined) {
            physxMaterial.setFrictionCombineMode(
                this.mapCombineMode(gltfPhysicsMaterial.frictionCombine)
            );
        }
        if (gltfPhysicsMaterial.restitutionCombine !== undefined) {
            physxMaterial.setRestitutionCombineMode(
                this.mapCombineMode(gltfPhysicsMaterial.restitutionCombine)
            );
        }
        return physxMaterial;
    }

    /**
     * Creates a `PxFilterData` object encoding the collision filter bit-masks for a
     * given filter index, along with CCD contact detection flags.
     *
     * @param {number|undefined} collisionFilter - Index into the pre-computed filter
     *   table, or `undefined` to apply the default filter (collides with everything).
     * @param {number} [additionalFlags=0] - Extra `PxPairFlag` bits to OR into word2.
     * @returns {object} The created `PxFilterData`.
     */
    createPhysXCollisionFilter(collisionFilter, additionalFlags = 0) {
        let word0 = null;
        let word1 = null;
        if (collisionFilter !== undefined && collisionFilter < this.filterData.length - 1) {
            word0 = 1 << collisionFilter;
            word1 = this.filterData[collisionFilter];
        } else {
            // Default filter id is signed bit and all bits set to collide with everything
            word0 = Math.pow(2, 31);
            word1 = Math.pow(2, 32) - 1;
        }

        additionalFlags |= this.PhysX.PxPairFlagEnum.eDETECT_DISCRETE_CONTACT;
        additionalFlags |= this.PhysX.PxPairFlagEnum.eDETECT_CCD_CONTACT;

        return new this.PhysX.PxFilterData(word0, word1, additionalFlags, 0);
    }

    /**
     * Creates a PhysX shape from an existing geometry object, assigning the correct
     * material and collision filter data. Material and filter data are resolved from
     * the glTF collider descriptor when not provided explicitly.
     *
     * @param {object} geometry - The PhysX geometry to attach to the shape.
     * @param {object|undefined} physXMaterial - The `PxMaterial` to use, or `undefined`
     *   to derive it from `glTFCollider`.
     * @param {object|undefined} physXFilterData - The `PxFilterData` to use, or `undefined`
     *   to derive it from `glTFCollider`.
     * @param {object} shapeFlags - `PxShapeFlags` controlling the shape's role
     *   (simulation, scene-query, trigger, etc.).
     * @param {object} glTFCollider - The glTF collider descriptor used to resolve
     *   material and filter data when the explicit arguments are `undefined`.
     * @returns {object} The created `PxShape`.
     */
    createShapeFromGeometry(geometry, physXMaterial, physXFilterData, shapeFlags, glTFCollider) {
        if (physXMaterial === undefined) {
            if (glTFCollider?.physicsMaterial !== undefined) {
                physXMaterial = this.physXMaterials[glTFCollider.physicsMaterial];
            } else {
                physXMaterial = this.defaultMaterial;
            }
        }
        const shape = this.physics.createShape(geometry, physXMaterial, true, shapeFlags);

        if (physXFilterData === undefined) {
            physXFilterData =
                this.physXFilterData[
                    glTFCollider?.collisionFilter ?? this.physXFilterData.length - 1
                ];
        }

        shape.setSimulationFilterData(physXFilterData);

        return shape;
    }

    /**
     * Creates a PhysX shape for a given glTF node and collider descriptor.
     * Resolves the geometry from either an implicit shape index or a glTF mesh,
     * then delegates to {@link createShapeFromGeometry} and records the
     * shape-to-node mapping.
     *
     * @param {object} gltf - The glTF asset.
     * @param {object} node - The glTF node the shape belongs to.
     * @param {object} collider - The glTF collider descriptor.
     * @param {object} shapeFlags - `PxShapeFlags` for the new shape.
     * @param {object|undefined} physXMaterial - Override material, or `undefined`.
     * @param {object|undefined} physXFilterData - Override filter data, or `undefined`.
     * @param {boolean} convexHull - `true` to force a convex-hull mesh for mesh colliders.
     * @param {number[]} [scale] - Per-axis scale factors; defaults to `[1, 1, 1]`.
     * @param {quat} [scaleAxis] - Quaternion for scale-axis rotation; defaults to identity.
     * @returns {object|undefined} The created `PxShape`, or `undefined` if no
     *   geometry could be resolved.
     */
    createShape(
        gltf,
        node,
        collider,
        shapeFlags,
        physXMaterial,
        physXFilterData,
        convexHull,
        scale = vec3.fromValues(1, 1, 1),
        scaleAxis = quat.create()
    ) {
        let geometry = undefined;
        if (collider?.geometry?.shape !== undefined) {
            if (scale[0] !== 1 || scale[1] !== 1 || scale[2] !== 1) {
                const simpleShape = gltf.shapes[collider.geometry.shape];
                geometry = this.generateSimpleShape(simpleShape, scale, scaleAxis);
            } else {
                geometry = this.simpleShapes[collider.geometry.shape];
            }
        } else if (collider?.geometry?.mesh !== undefined) {
            const mesh = gltf.meshes[collider.geometry.mesh];
            if (convexHull === true) {
                geometry = this.createConvexMesh(gltf, mesh, scale, scaleAxis);
            } else {
                geometry = this.createPxMesh(gltf, mesh, scale, scaleAxis);
            }
        }

        if (geometry === undefined) {
            return undefined;
        }

        const shape = this.createShapeFromGeometry(
            geometry,
            physXMaterial,
            physXFilterData,
            shapeFlags,
            collider
        );

        this.shapeToNode.set(shape.ptr, node.gltfObjectIndex);
        return shape;
    }

    /**
     * Maps a glTF material friction/restitution combine mode string to the
     * corresponding PhysX `PxCombineModeEnum` value.
     *
     * @param {string} mode - One of `'average'`, `'minimum'`, `'maximum'`, or `'multiply'`.
     * @returns {number} The matching `PxCombineModeEnum` constant.
     */
    mapCombineMode(mode) {
        switch (mode) {
            case "average":
                return this.PhysX.PxCombineModeEnum.eAVERAGE;
            case "minimum":
                return this.PhysX.PxCombineModeEnum.eMIN;
            case "maximum":
                return this.PhysX.PxCombineModeEnum.eMAX;
            case "multiply":
                return this.PhysX.PxCombineModeEnum.eMULTIPLY;
        }
    }

    //endregion

    //region Actors

    /**
     * Creates a PhysX rigid body actor for a glTF node, attaches all collider and
     * trigger shapes (including those from child nodes), configures mass/inertia
     * and initial velocities, then adds the actor to the active scene.
     *
     * @param {object} gltf - The glTF asset.
     * @param {object} node - The root node of the actor.
     * @param {object} shapeFlags - `PxShapeFlags` used for simulation/query shapes.
     * @param {object} triggerFlags - `PxShapeFlags` used for trigger shapes.
     * @param {'static'|'kinematic'|'dynamic'|'trigger'} type - Actor type.
     * @param {boolean} [noMeshShapes=false] - When `true`, mesh colliders are
     *   treated as convex hulls rather than exact triangle meshes.
     */
    createActor(gltf, node, shapeFlags, triggerFlags, type, noMeshShapes = false) {
        const worldTransform = node.worldTransform;
        const translation = vec3.create();
        mat4.getTranslation(translation, worldTransform);
        const pos = new this.PhysX.PxVec3(...translation);
        const rotation = new this.PhysX.PxQuat(...node.worldQuaternion);
        const pose = new this.PhysX.PxTransform(pos, rotation);
        let actor = null;
        const pxShapeMap = new Map();
        if (type === "static" || type === "trigger") {
            actor = this.physics.createRigidStatic(pose);
        } else {
            actor = this.physics.createRigidDynamic(pose);
            if (type === "kinematic") {
                actor.setRigidBodyFlag(this.PhysX.PxRigidBodyFlagEnum.eKINEMATIC, true);
            }
            actor.setRigidBodyFlag(
                this.PhysX.PxRigidBodyFlagEnum.eENABLE_CCD,
                type !== "kinematic"
            );
            const motion = node.extensions?.KHR_physics_rigid_bodies?.motion;
            if (motion) {
                const gltfAngularVelocity = motion?.angularVelocity;
                const angularVelocity = new this.PhysX.PxVec3(...gltfAngularVelocity);
                actor.setAngularVelocity(angularVelocity, true);
                this.PhysX.destroy(angularVelocity);

                const gltfLinearVelocity = motion?.linearVelocity;
                const linearVelocity = new this.PhysX.PxVec3(...gltfLinearVelocity);
                actor.setLinearVelocity(linearVelocity, true);
                this.PhysX.destroy(linearVelocity);

                if (motion.mass !== undefined) {
                    actor.setMass(motion.mass);
                }

                this.calculateMassAndInertia(motion, actor);

                if (motion.gravityFactor !== 1.0) {
                    actor.setActorFlag(this.PhysX.PxActorFlagEnum.eDISABLE_GRAVITY, true);
                }
            }
        }

        const createAndAddShape = (
            gltf,
            node,
            collider,
            actorNode,
            worldTransform,
            offsetChanged,
            scaleChanged,
            isTrigger,
            noMeshShapes,
            shapeFlags,
            triggerFlags
        ) => {
            // Calculate offset position
            const translation = vec3.create();
            const shapePosition = vec3.create();
            mat4.getTranslation(shapePosition, actorNode.worldTransform);
            const invertedActorRotation = quat.create();
            quat.invert(invertedActorRotation, actorNode.worldQuaternion);
            const offsetPosition = vec3.create();
            mat4.getTranslation(offsetPosition, worldTransform);
            vec3.subtract(translation, offsetPosition, shapePosition);
            vec3.transformQuat(translation, translation, invertedActorRotation);

            // Calculate offset rotation
            const rotation = quat.create();
            quat.multiply(rotation, invertedActorRotation, node.worldQuaternion);

            // Calculate scale and scaleAxis
            const { scale, scaleAxis } = PhysicsUtils.calculateScaleAndAxis(node);

            const materialIndex = collider?.physicsMaterial;
            const material =
                materialIndex !== undefined
                    ? this.physXMaterials[materialIndex]
                    : this.defaultMaterial;

            const physXFilterData =
                collider?.collisionFilter !== undefined
                    ? this.physXFilterData[collider.collisionFilter]
                    : this.physXFilterData[this.physXFilterData.length - 1];

            const shape = this.createShape(
                gltf,
                node,
                collider,
                isTrigger ? triggerFlags : shapeFlags,
                material,
                physXFilterData,
                noMeshShapes || collider?.geometry?.convexHull === true,
                scale,
                scaleAxis
            );

            if (shape !== undefined) {
                const PxPos = new this.PhysX.PxVec3(...translation);
                const PxRotation = new this.PhysX.PxQuat(...rotation);
                const pose = new this.PhysX.PxTransform(PxPos, PxRotation);
                shape.setLocalPose(pose);

                actor.attachShape(shape);
                pxShapeMap.set(node.gltfObjectIndex, shape);
                this.PhysX.destroy(PxPos);
                this.PhysX.destroy(PxRotation);
                this.PhysX.destroy(pose);
            }
        };

        // If a node contains trigger and collider combine them

        let collider = undefined;
        if (type !== "trigger") {
            collider = node.extensions?.KHR_physics_rigid_bodies?.collider;
            createAndAddShape(
                gltf,
                node,
                collider,
                node,
                worldTransform,
                undefined,
                undefined,
                false,
                noMeshShapes,
                shapeFlags,
                triggerFlags
            );
            collider = node.extensions?.KHR_physics_rigid_bodies?.trigger;
            if (collider !== undefined) {
                createAndAddShape(
                    gltf,
                    node,
                    collider,
                    node,
                    worldTransform,
                    undefined,
                    undefined,
                    true,
                    true,
                    shapeFlags,
                    triggerFlags
                );
            }
        } else {
            collider = node.extensions?.KHR_physics_rigid_bodies?.trigger;
            createAndAddShape(
                gltf,
                node,
                collider,
                node,
                worldTransform,
                undefined,
                undefined,
                true,
                true,
                shapeFlags,
                triggerFlags
            );
        }

        if (type !== "trigger") {
            for (const childIndex of node.children) {
                const childNode = gltf.nodes[childIndex];
                PhysicsUtils.recurseCollider(
                    gltf,
                    childNode,
                    undefined,
                    node,
                    node.dirtyScale,
                    node.dirtyScale,
                    createAndAddShape,
                    [noMeshShapes, shapeFlags, triggerFlags]
                );
            }
        }

        this.PhysX.destroy(pos);
        this.PhysX.destroy(rotation);
        this.PhysX.destroy(pose);

        this.scene.addActor(actor);

        this.nodeToActor.set(node.gltfObjectIndex, { actor, pxShapeMap: pxShapeMap });
    }

    /**
     * Walks up the node hierarchy to find the nearest ancestor that owns a PhysX
     * actor, then computes the local offset (position and rotation) of the given
     * node relative to that actor's frame. Used to determine joint attachment frames.
     *
     * @param {object} node - The joint attachment node.
     * @param {object} referencedJoint - The simplified joint descriptor, which may
     *   supply a local rotation override.
     * @returns {{ actor: object|undefined, offsetPosition: vec3, offsetRotation: quat }}
     *   The resolved actor (or `undefined` for world-relative), offset position,
     *   and offset rotation.
     */
    computeJointOffsetAndActor(node, referencedJoint) {
        let currentNode = node;
        while (currentNode !== undefined) {
            if (this.nodeToActor.has(currentNode.gltfObjectIndex)) {
                break;
            }
            currentNode = currentNode.parentNode;
        }

        const nodeWorldRot = node.worldQuaternion;
        const localPhysXRot = referencedJoint?.localRotation;
        if (localPhysXRot !== undefined) {
            quat.multiply(nodeWorldRot, node.worldQuaternion, localPhysXRot);
        }

        if (currentNode === undefined) {
            const pos = vec3.create();
            mat4.getTranslation(pos, node.worldTransform);

            return { actor: undefined, offsetPosition: pos, offsetRotation: nodeWorldRot };
        }
        const actor = this.nodeToActor.get(currentNode.gltfObjectIndex)?.actor;
        const inverseActorRotation = quat.create();
        quat.invert(inverseActorRotation, currentNode.worldQuaternion);
        const offsetRotation = quat.create();
        quat.multiply(offsetRotation, inverseActorRotation, nodeWorldRot);

        const actorPosition = vec3.create();
        mat4.getTranslation(actorPosition, currentNode.worldTransform);
        const nodePosition = vec3.create();
        mat4.getTranslation(nodePosition, node.worldTransform);
        const offsetPosition = vec3.create();
        vec3.subtract(offsetPosition, nodePosition, actorPosition);
        vec3.transformQuat(offsetPosition, offsetPosition, inverseActorRotation);

        return { actor: actor, offsetPosition: offsetPosition, offsetRotation: offsetRotation };
    }

    /**
     * Configures the mass, inertia tensor, and center-of-mass pose of a PhysX
     * rigid body actor from the `KHR_physics_rigid_bodies` motion properties.
     * Falls back to automatic mass/inertia estimation via `PxRigidBodyExt` when
     * no explicit values are provided.
     *
     * @param {object} motion - The glTF motion extension object containing mass,
     *   inertiaDiagonal, inertiaOrientation, and centerOfMass properties.
     * @param {object} actor - The PhysX `PxRigidDynamic` actor to configure.
     */
    calculateMassAndInertia(motion, actor) {
        const pos = new this.PhysX.PxVec3(0, 0, 0);
        if (motion.centerOfMass !== undefined) {
            pos.x = motion.centerOfMass[0];
            pos.y = motion.centerOfMass[1];
            pos.z = motion.centerOfMass[2];
        }
        const rot = new this.PhysX.PxQuat(this.PhysX.PxIDENTITYEnum.PxIdentity);
        if (motion.inertiaDiagonal !== undefined) {
            let inertia = undefined;
            if (
                motion.inertiaOrientation !== undefined &&
                !quat.exactEquals(motion.inertiaOrientation, quat.create())
            ) {
                const intertiaRotMat = mat3.create();

                const inertiaDiagonalMat = mat3.create();
                inertiaDiagonalMat[0] = motion.inertiaDiagonal[0];
                inertiaDiagonalMat[4] = motion.inertiaDiagonal[1];
                inertiaDiagonalMat[8] = motion.inertiaDiagonal[2];

                if (
                    quat.length(motion.inertiaOrientation) > 1.0e-5 ||
                    quat.length(motion.inertiaOrientation) < 1.0e-5
                ) {
                    mat3.identity(intertiaRotMat);
                    console.warn(
                        "PhysX: Invalid inertia orientation quaternion, ignoring rotation"
                    );
                } else {
                    mat3.fromQuat(intertiaRotMat, motion.inertiaOrientation);
                }

                const inertiaTensor = mat3.create();
                mat3.multiply(inertiaTensor, intertiaRotMat, inertiaDiagonalMat);

                const col0 = new this.PhysX.PxVec3(
                    inertiaTensor[0],
                    inertiaTensor[1],
                    inertiaTensor[2]
                );
                const col1 = new this.PhysX.PxVec3(
                    inertiaTensor[3],
                    inertiaTensor[4],
                    inertiaTensor[5]
                );
                const col2 = new this.PhysX.PxVec3(
                    inertiaTensor[6],
                    inertiaTensor[7],
                    inertiaTensor[8]
                );
                const pxInertiaTensor = new this.PhysX.PxMat33(col0, col1, col2);
                inertia = this.PhysX.PxMassProperties.prototype.getMassSpaceInertia(
                    pxInertiaTensor,
                    rot
                );
                this.PhysX.destroy(col0);
                this.PhysX.destroy(col1);
                this.PhysX.destroy(col2);
                this.PhysX.destroy(pxInertiaTensor);
                actor.setMassSpaceInertiaTensor(inertia);
            } else {
                inertia = new this.PhysX.PxVec3(...motion.inertiaDiagonal);
                actor.setMassSpaceInertiaTensor(inertia);
                this.PhysX.destroy(inertia);
            }
        } else {
            if (motion.mass === undefined) {
                this.PhysX.PxRigidBodyExt.prototype.updateMassAndInertia(actor, 1.0, pos);
            } else {
                this.PhysX.PxRigidBodyExt.prototype.setMassAndUpdateInertia(
                    actor,
                    motion.mass,
                    pos
                );
            }
        }

        const pose = new this.PhysX.PxTransform(pos, rot);
        actor.setCMassLocalPose(pose);
        this.PhysX.destroy(pos);
        this.PhysX.destroy(rot);
        this.PhysX.destroy(pose);
    }

    //endregion

    //region Joints

    /**
     * Converts a zero-based axis index and a motion type to the corresponding
     * PhysX `PxD6AxisEnum` value.
     *
     * @param {0|1|2} axisIndex - The axis index (0 = X/Twist, 1 = Y/Swing1, 2 = Z/Swing2).
     * @param {'linear'|'angular'} type - Whether to interpret the index as a linear
     *   or angular axis.
     * @returns {number|null} The matching `PxD6AxisEnum` constant, or `null` if the
     *   combination is not recognised.
     */
    convertAxisIndexToEnum(axisIndex, type) {
        if (type === "linear") {
            switch (axisIndex) {
                case 0:
                    return this.PhysX.PxD6AxisEnum.eX;
                case 1:
                    return this.PhysX.PxD6AxisEnum.eY;
                case 2:
                    return this.PhysX.PxD6AxisEnum.eZ;
            }
        } else if (type === "angular") {
            switch (axisIndex) {
                case 0:
                    return this.PhysX.PxD6AxisEnum.eTWIST;
                case 1:
                    return this.PhysX.PxD6AxisEnum.eSWING1;
                case 2:
                    return this.PhysX.PxD6AxisEnum.eSWING2;
            }
        }
        return null;
    }

    /**
     * Converts a zero-based axis index to the corresponding PhysX D6 angular drive
     * enum value.
     *
     * @param {0|1|2} axisIndex - The axis index (0 = Twist, 1 = Swing1, 2 = Swing2).
     * @returns {number|null} The matching `PxD6DriveEnum` constant (or a raw integer
     *   for axes not yet exposed by the bindings), or `null` if not recognised.
     */
    convertAxisIndexToAngularDriveEnum(axisIndex) {
        switch (axisIndex) {
            case 0:
                return this.PhysX.PxD6DriveEnum.eTWIST;
            case 1:
                return 6; // Currently not exposed via bindings
            case 2:
                return 7; // Currently not exposed via bindings
        }
        return null;
    }

    /**
     * Checks whether the two swing limits of a simplified joint are symmetric,
     * which determines whether a cone limit or a pyramid limit should be used in PhysX.
     *
     * @param {object} joint - The simplified joint descriptor containing optional
     *   `swingLimit1` and `swingLimit2` properties.
     * @returns {boolean} `true` if both limits are symmetric (centred around zero),
     *   allowing a cone limit; `false` if a pyramid limit is required.
     */
    validateSwingLimits(joint) {
        // Check if swing limits are symmetric (cone) or asymmetric (pyramid)
        if (joint.swingLimit1 && joint.swingLimit2) {
            const limit1 = joint.swingLimit1;
            const limit2 = joint.swingLimit2;

            const isSymmetric1 =
                Math.abs(limit1.min + limit1.max) < 1e-6 || limit1.min === undefined; // Centered around 0
            const isSymmetric2 =
                Math.abs(limit2.min + limit2.max) < 1e-6 || limit2.min === undefined;

            // Return if this is a cone limit (symmetric and same range) vs pyramid limit
            return isSymmetric1 && isSymmetric2;
        }
        return false;
    }

    /**
     * Creates the PhysX `PxD6Joint` constraints for a glTF joint node. Each simplified
     * physics joint defined on the referenced glTF joint is converted to one PhysX joint,
     * and the results are stored in {@link nodeToSimplifiedJoints}.
     *
     * @param {object} gltf - The glTF asset.
     * @param {object} node - The glTF node carrying the `KHR_physics_rigid_bodies.joint`
     *   extension data.
     */
    createJoint(gltf, node) {
        const joint = node.extensions?.KHR_physics_rigid_bodies?.joint;
        const referencedJoint =
            gltf.extensions?.KHR_physics_rigid_bodies?.physicsJoints[joint.joint];

        if (referencedJoint === undefined) {
            console.error("Referenced joint not found:", joint.joint);
            return;
        }
        const simplifiedJoints = [];
        for (const simplifiedJoint of referencedJoint.simplifiedPhysicsJoints) {
            const physxJoint = this.createSimplifiedJoint(gltf, node, joint, simplifiedJoint);
            simplifiedJoints.push(physxJoint);
        }
        this.nodeToSimplifiedJoints.set(node.gltfObjectIndex, simplifiedJoints);
    }

    /**
     * Applies the motion and limit parameters for a single simplified-joint limit to
     * a PhysX D6 joint. Handles linear pair limits, distance limits (3-axis linear
     * constraint), and angular axis locks.
     *
     * @param {object} physxJoint - The PhysX `PxD6Joint` to configure.
     * @param {object} simplifiedJoint - The simplified joint descriptor supplying
     *   axis-mapping helpers.
     * @param {object} limit - The individual limit descriptor (with `linearAxes`,
     *   `angularAxes`, `min`, `max`, `stiffness`, `damping`).
     */
    _setLimitValues(physxJoint, simplifiedJoint, limit) {
        const lock = limit.min === 0 && limit.max === 0;
        const spring = new this.PhysX.PxSpring(limit.stiffness ?? 0, limit.damping);
        const isDistanceLimit =
            limit.linearAxes &&
            limit.linearAxes.length === 3 &&
            (limit.min === undefined || limit.min === 0) &&
            limit.max !== 0;
        if (limit.linearAxes && limit.linearAxes.length > 0 && !isDistanceLimit) {
            const linearLimitPair = new this.PhysX.PxJointLinearLimitPair(
                limit.min ?? -this.MAX_FLOAT,
                limit.max ?? this.MAX_FLOAT,
                spring
            );
            for (const axis of limit.linearAxes) {
                const result = simplifiedJoint.getRotatedAxisAndSign(axis);
                const physxAxis = this.convertAxisIndexToEnum(result.axis, "linear");
                physxJoint.setMotion(
                    physxAxis,
                    lock ? this.PhysX.PxD6MotionEnum.eLOCKED : this.PhysX.PxD6MotionEnum.eLIMITED
                );
                if (!lock) {
                    physxJoint.setLinearLimit(physxAxis, linearLimitPair);
                }
            }
            this.PhysX.destroy(linearLimitPair);
        }
        if (isDistanceLimit) {
            const linearLimit = new this.PhysX.PxJointLinearLimit(
                limit.max ?? this.MAX_FLOAT,
                spring
            );
            physxJoint.setMotion(this.PhysX.PxD6AxisEnum.eX, this.PhysX.PxD6MotionEnum.eLIMITED);
            physxJoint.setMotion(this.PhysX.PxD6AxisEnum.eY, this.PhysX.PxD6MotionEnum.eLIMITED);
            physxJoint.setMotion(this.PhysX.PxD6AxisEnum.eZ, this.PhysX.PxD6MotionEnum.eLIMITED);
            physxJoint.setDistanceLimit(linearLimit);
            this.PhysX.destroy(linearLimit);
        }
        if (limit.angularAxes && limit.angularAxes.length > 0) {
            for (const axis of limit.angularAxes) {
                const result = simplifiedJoint.getRotatedAxisAndSign(axis);
                const physxAxis = this.convertAxisIndexToEnum(result.axis, "angular");
                physxJoint.setMotion(
                    physxAxis,
                    lock ? this.PhysX.PxD6MotionEnum.eLOCKED : this.PhysX.PxD6MotionEnum.eLIMITED
                );
            }
        }
        this.PhysX.destroy(spring);
    }

    /**
     * Applies the twist-limit angular range from a simplified joint to a PhysX D6
     * joint. Does nothing if the simplified joint has no twist limit defined.
     *
     * @param {object} physxJoint - The PhysX `PxD6Joint` to configure.
     * @param {object} simplifiedJoint - The simplified joint descriptor containing
     *   the optional `twistLimit` property.
     */
    _setTwistLimitValues(physxJoint, simplifiedJoint) {
        if (simplifiedJoint.twistLimit !== undefined) {
            if (!(simplifiedJoint.twistLimit.min === 0 && simplifiedJoint.twistLimit.max === 0)) {
                const limitPair = new this.PhysX.PxJointAngularLimitPair(
                    simplifiedJoint.twistLimit.min ?? -Math.PI,
                    simplifiedJoint.twistLimit.max ?? Math.PI,
                    new this.PhysX.PxSpring(
                        simplifiedJoint.twistLimit.stiffness ?? 0,
                        simplifiedJoint.twistLimit.damping
                    )
                );
                physxJoint.setTwistLimit(limitPair);
                this.PhysX.destroy(limitPair);
            }
        }
    }

    /**
     * Applies the swing-limit angular ranges from a simplified joint to a PhysX D6
     * joint. Uses a cone limit when both swing axes are symmetric, a pyramid limit
     * when they are asymmetric, and falls back to a single-axis cone when only one
     * swing limit is defined.
     *
     * @param {object} physxJoint - The PhysX `PxD6Joint` to configure.
     * @param {object} simplifiedJoint - The simplified joint descriptor containing
     *   optional `swingLimit1` and/or `swingLimit2` properties.
     */
    _setSwingLimitValues(physxJoint, simplifiedJoint) {
        if (
            simplifiedJoint.swingLimit1 !== undefined &&
            simplifiedJoint.swingLimit2 !== undefined
        ) {
            if (
                simplifiedJoint.swingLimit1.stiffness !== simplifiedJoint.swingLimit2.stiffness ||
                simplifiedJoint.swingLimit1.damping !== simplifiedJoint.swingLimit2.damping
            ) {
                console.warn(
                    "PhysX does not support different stiffness/damping for swing limits."
                );
            } else {
                const spring = new this.PhysX.PxSpring(
                    simplifiedJoint.swingLimit1.stiffness ?? 0,
                    simplifiedJoint.swingLimit1.damping
                );
                let yMin = -Math.PI / 2;
                let yMax = Math.PI / 2;
                let zMin = -Math.PI / 2;
                let zMax = Math.PI / 2;
                if (simplifiedJoint.swingLimit1.min !== undefined) {
                    yMin = simplifiedJoint.swingLimit1.min;
                }
                if (simplifiedJoint.swingLimit1.max !== undefined) {
                    yMax = simplifiedJoint.swingLimit1.max;
                }
                if (simplifiedJoint.swingLimit2.min !== undefined) {
                    zMin = simplifiedJoint.swingLimit2.min;
                }
                if (simplifiedJoint.swingLimit2.max !== undefined) {
                    zMax = simplifiedJoint.swingLimit2.max;
                }

                const isSymmetric = this.validateSwingLimits(simplifiedJoint);
                if (yMin === 0 && yMax === 0 && zMin === 0 && zMax === 0) {
                    // Fixed limit is already set
                } else if (isSymmetric) {
                    const swing1Angle = Math.max(Math.abs(yMin), Math.abs(yMax));
                    const swing2Angle = Math.max(Math.abs(zMin), Math.abs(zMax));
                    const jointLimitCone = new this.PhysX.PxJointLimitCone(
                        swing1Angle,
                        swing2Angle,
                        spring
                    );
                    physxJoint.setSwingLimit(jointLimitCone);
                    this.PhysX.destroy(jointLimitCone);
                } else {
                    const jointLimitCone = new this.PhysX.PxJointLimitPyramid(
                        yMin,
                        yMax,
                        zMin,
                        zMax,
                        spring
                    );
                    physxJoint.setPyramidSwingLimit(jointLimitCone);
                    this.PhysX.destroy(jointLimitCone);
                }
                this.PhysX.destroy(spring);
            }
        } else if (
            simplifiedJoint.swingLimit1 !== undefined ||
            simplifiedJoint.swingLimit2 !== undefined
        ) {
            const singleLimit = simplifiedJoint.swingLimit1 ?? simplifiedJoint.swingLimit2;
            if (singleLimit.min === 0 && singleLimit.max === 0) {
                // Fixed limit is already set
            } else if (singleLimit.min && -1 * singleLimit.min !== singleLimit.max) {
                console.warn(
                    "PhysX requires symmetric limits for swing limits in single axis mode."
                );
            } else {
                const spring = new this.PhysX.PxSpring(
                    singleLimit.stiffness ?? 0,
                    singleLimit.damping
                );
                const maxY = simplifiedJoint.swingLimit1?.max ?? Math.PI;
                const maxZ = simplifiedJoint.swingLimit2?.max ?? Math.PI;
                const jointLimitCone = new this.PhysX.PxJointLimitCone(maxY, maxZ, spring);
                physxJoint.setSwingLimit(jointLimitCone);
                this.PhysX.destroy(spring);
                this.PhysX.destroy(jointLimitCone);
            }
        }
    }

    /**
     * Creates and assigns a `PxD6JointDrive` to the appropriate axis of a PhysX D6
     * joint, configuring its stiffness, damping, maximum force, and drive mode.
     *
     * @param {object} physxJoint - The PhysX `PxD6Joint` to configure.
     * @param {object} simplifiedJoint - The simplified joint descriptor supplying
     *   axis-mapping helpers.
     * @param {object} drive - The drive descriptor with `stiffness`, `damping`,
     *   `maxForce`, `mode`, `type`, and `axis`.
     */
    _setDriveValues(physxJoint, simplifiedJoint, drive) {
        const physxDrive = new this.PhysX.PxD6JointDrive(
            drive.stiffness,
            drive.damping,
            drive.maxForce ?? this.MAX_FLOAT,
            drive.mode === "acceleration"
        );
        const result = simplifiedJoint.getRotatedAxisAndSign(drive.axis);
        if (drive.type === "linear") {
            const axis = this.convertAxisIndexToEnum(result.axis, "linear");
            physxJoint.setDrive(axis, physxDrive);
        } else if (drive.type === "angular") {
            const axis = this.convertAxisIndexToAngularDriveEnum(result.axis);
            physxJoint.setDrive(axis, physxDrive);
        }
        this.PhysX.destroy(physxDrive);
    }

    /**
     * Accumulates the velocity target for a single drive axis into the provided
     * mutable velocity target vectors. Linear and angular axes are handled separately.
     *
     * @param {object} simplifiedJoint - The simplified joint descriptor supplying
     *   axis-mapping helpers.
     * @param {object} drive - The drive descriptor containing `type`, `axis`, and
     *   `velocityTarget`.
     * @param {object} linearVelocityTarget - `PxVec3` accumulator for linear targets;
     *   mutated in place.
     * @param {object} angularVelocityTarget - `PxVec3` accumulator for angular targets;
     *   mutated in place.
     */
    _getDriveVelocityTarget(simplifiedJoint, drive, linearVelocityTarget, angularVelocityTarget) {
        const result = simplifiedJoint.getRotatedAxisAndSign(drive.axis);
        if (drive.type === "linear") {
            if (drive.velocityTarget !== undefined) {
                linearVelocityTarget[result.axis] = drive.velocityTarget * result.sign;
            }
        } else if (drive.type === "angular") {
            if (drive.velocityTarget !== undefined) {
                angularVelocityTarget[result.axis] = drive.velocityTarget * result.sign * -1; // PhysX angular velocity is in opposite direction of rotation
            }
        }
    }

    /**
     * Computes the aggregate position and orientation drive targets from all drives
     * defined on a simplified joint and applies them to the PhysX D6 joint via `setDrivePosition`.
     *
     * @param {object} physxJoint - The PhysX `PxD6Joint` to configure.
     * @param {object} simplifiedJoint - The simplified joint descriptor containing
     *   the `drives` array.
     */
    _setDrivePositionTarget(physxJoint, simplifiedJoint) {
        const positionTarget = vec3.fromValues(0, 0, 0);
        const angleTarget = quat.create();
        for (const drive of simplifiedJoint.drives) {
            const result = simplifiedJoint.getRotatedAxisAndSign(drive.axis);
            if (drive.type === "linear") {
                if (drive.positionTarget !== undefined) {
                    positionTarget[result.axis] = drive.positionTarget * result.sign;
                }
            } else if (drive.type === "angular") {
                if (drive.positionTarget !== undefined) {
                    // gl-matrix seems to apply rotations clockwise for positive angles, gltf uses counter-clockwise
                    switch (result.axis) {
                        case 0: {
                            quat.rotateX(
                                angleTarget,
                                angleTarget,
                                -drive.positionTarget * result.sign
                            );
                            break;
                        }
                        case 1: {
                            quat.rotateY(
                                angleTarget,
                                angleTarget,
                                -drive.positionTarget * result.sign
                            );
                            break;
                        }
                        case 2: {
                            quat.rotateZ(
                                angleTarget,
                                angleTarget,
                                -drive.positionTarget * result.sign
                            );
                            break;
                        }
                    }
                }
            }
        }
        const posTarget = new this.PhysX.PxVec3(...positionTarget);
        const rotTarget = new this.PhysX.PxQuat(...angleTarget);
        const targetTransform = new this.PhysX.PxTransform(posTarget, rotTarget);
        physxJoint.setDrivePosition(targetTransform);
        this.PhysX.destroy(posTarget);
        this.PhysX.destroy(rotTarget);
        this.PhysX.destroy(targetTransform);
    }

    /**
     * Creates a fully configured PhysX `PxD6Joint` for a single simplified joint
     * descriptor. Resolves actor references and frame offsets for both bodies,
     * sets all motion axes to free, then applies limits, drives, and drive targets
     * from the simplified joint data.
     *
     * @param {object} gltf - The glTF asset.
     * @param {object} node - The glTF node that owns the joint.
     * @param {object} joint - The `KHR_physics_rigid_bodies.joint` extension data.
     * @param {object} simplifiedJoint - The simplified joint descriptor to materialise.
     * @returns {object} The created `PxD6Joint`.
     */
    createSimplifiedJoint(gltf, node, joint, simplifiedJoint) {
        const resultA = this.computeJointOffsetAndActor(node, simplifiedJoint);
        const resultB = this.computeJointOffsetAndActor(
            gltf.nodes[joint.connectedNode],
            simplifiedJoint
        );

        const pos = new this.PhysX.PxVec3(...resultA.offsetPosition);
        const rot = new this.PhysX.PxQuat(...resultA.offsetRotation);
        const poseA = new this.PhysX.PxTransform(pos, rot);
        this.PhysX.destroy(pos);
        this.PhysX.destroy(rot);

        const posB = new this.PhysX.PxVec3(...resultB.offsetPosition);
        const rotB = new this.PhysX.PxQuat(...resultB.offsetRotation);
        const poseB = new this.PhysX.PxTransform(posB, rotB);
        this.PhysX.destroy(posB);
        this.PhysX.destroy(rotB);

        const physxJoint = this.PhysX.PxTopLevelFunctions.prototype.D6JointCreate(
            this.physics,
            resultA.actor,
            poseA,
            resultB.actor,
            poseB
        );
        this.PhysX.destroy(poseA);
        this.PhysX.destroy(poseB);

        physxJoint.setAngularDriveConfig(this.PhysX.PxD6AngularDriveConfigEnum.eSWING_TWIST);

        physxJoint.setConstraintFlag(
            this.PhysX.PxConstraintFlagEnum.eVISUALIZATION,
            this.debugJoints
        );

        physxJoint.setConstraintFlag(
            this.PhysX.PxConstraintFlagEnum.eCOLLISION_ENABLED,
            joint.enableCollision
        );

        // Do not restict any axis by default
        physxJoint.setMotion(this.PhysX.PxD6AxisEnum.eX, this.PhysX.PxD6MotionEnum.eFREE);
        physxJoint.setMotion(this.PhysX.PxD6AxisEnum.eY, this.PhysX.PxD6MotionEnum.eFREE);
        physxJoint.setMotion(this.PhysX.PxD6AxisEnum.eZ, this.PhysX.PxD6MotionEnum.eFREE);
        physxJoint.setMotion(this.PhysX.PxD6AxisEnum.eTWIST, this.PhysX.PxD6MotionEnum.eFREE);
        physxJoint.setMotion(this.PhysX.PxD6AxisEnum.eSWING1, this.PhysX.PxD6MotionEnum.eFREE);
        physxJoint.setMotion(this.PhysX.PxD6AxisEnum.eSWING2, this.PhysX.PxD6MotionEnum.eFREE);

        for (const limit of simplifiedJoint.limits) {
            this._setLimitValues(physxJoint, simplifiedJoint, limit);
        }

        this._setTwistLimitValues(physxJoint, simplifiedJoint);
        this._setSwingLimitValues(physxJoint, simplifiedJoint);

        const linearVelocityTarget = vec3.fromValues(0, 0, 0);
        const angularVelocityTarget = vec3.fromValues(0, 0, 0);

        for (const drive of simplifiedJoint.drives) {
            this._setDriveValues(physxJoint, simplifiedJoint, drive);
            this._getDriveVelocityTarget(
                simplifiedJoint,
                drive,
                linearVelocityTarget,
                angularVelocityTarget
            );
        }
        this._setDrivePositionTarget(physxJoint, simplifiedJoint);

        const linVel = new this.PhysX.PxVec3(...linearVelocityTarget);
        const angVel = new this.PhysX.PxVec3(...angularVelocityTarget);
        physxJoint.setDriveVelocity(linVel, angVel);
        this.PhysX.destroy(linVel);
        this.PhysX.destroy(angVel);

        return physxJoint;
    }

    // endregion
}

export { NvidiaPhysicsInterface };
