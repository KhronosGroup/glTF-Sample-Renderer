import { getAnimatedIndices, getMorphedNodeIndices } from "../gltf/gltf_utils";
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

class PhysicsUtils {
    static calculateScaleAndAxis(node, referencingNode = undefined) {
        const referencedNodeIndex =
            referencingNode?.extensions?.KHR_physics_rigid_bodies?.collider?.geometry?.node;
        const scaleFactor = vec3.clone(node.scale);
        let scaleRotation = quat.create();

        let currentNode =
            node.gltfObjectIndex === referencedNodeIndex ? referencingNode : node.parentNode;
        const currentRotation = quat.clone(node.rotation);

        while (currentNode !== undefined) {
            if (vec3.equals(currentNode.scale, vec3.fromValues(1, 1, 1)) === false) {
                const localScale = currentNode.scale;
                vec3.transformQuat(localScale, currentNode.scale, scaleRotation);
                vec3.multiply(scaleFactor, scaleFactor, localScale);
                scaleRotation = quat.clone(currentRotation);
            }
            const nextRotation = quat.clone(currentNode.rotation);
            quat.multiply(currentRotation, currentRotation, nextRotation);
            currentNode =
                currentNode.gltfObjectIndex === referencedNodeIndex
                    ? referencingNode
                    : currentNode.parentNode;
        }
        return { scale: scaleFactor, scaleAxis: scaleRotation };
    }

    static recurseCollider(
        gltf,
        node,
        collider,
        actorNode,
        worldTransform,
        referencingNode,
        customFunction,
        args = []
    ) {
        // Do not add other motion bodies' shapes to this actor
        if (node.extensions?.KHR_physics_rigid_bodies?.motion !== undefined) {
            return;
        }

        const computedWorldTransform = mat4.create();
        mat4.multiply(computedWorldTransform, worldTransform, node.getLocalTransform());

        const materialIndex =
            node.extensions?.KHR_physics_rigid_bodies?.collider?.physicsMaterial ??
            collider?.physicsMaterial;

        const filterIndex =
            node.extensions?.KHR_physics_rigid_bodies?.collider?.collisionFilter ??
            collider?.collisionFilter;

        const isConvexHull =
            node.extensions?.KHR_physics_rigid_bodies?.collider?.geometry?.convexHull ??
            collider?.geometry?.convexHull;

        const referenceCollider = {
            geometry: { convexHull: isConvexHull },
            physicsMaterial: materialIndex,
            collisionFilter: filterIndex
        };

        // If current node is not a reference to a collider search this node and its children to find colliders
        if (
            referencingNode === undefined &&
            node.extensions?.KHR_physics_rigid_bodies?.collider?.geometry?.shape === undefined
        ) {
            if (node.extensions?.KHR_physics_rigid_bodies?.collider?.geometry?.node !== undefined) {
                const colliderNodeIndex =
                    node.extensions.KHR_physics_rigid_bodies.collider.geometry.node;
                const colliderNode = gltf.nodes[colliderNodeIndex];
                this.recurseCollider(
                    gltf,
                    colliderNode,
                    referenceCollider,
                    actorNode,
                    computedWorldTransform,
                    node,
                    customFunction,
                    args
                );
            }

            for (const childIndex of node.children) {
                const childNode = gltf.nodes[childIndex];
                this.recurseCollider(
                    gltf,
                    childNode,
                    undefined,
                    actorNode,
                    computedWorldTransform,
                    undefined,
                    customFunction,
                    args
                );
            }
            return;
        }

        customFunction(
            gltf,
            node,
            referenceCollider,
            actorNode,
            computedWorldTransform,
            referencingNode,
            ...args
        );

        for (const childIndex of node.children) {
            const childNode = gltf.nodes[childIndex];
            this.recurseCollider(
                gltf,
                childNode,
                collider,
                actorNode,
                computedWorldTransform,
                referencingNode,
                customFunction,
                args
            );
        }
    }
}

class PhysicsController {
    constructor() {
        this.engine = undefined;
        this.staticActors = [];
        this.kinematicActors = [];
        this.dynamicActors = [];
        this.jointNodes = [];
        this.morphedColliders = [];
        this.skinnedColliders = [];
        this.hasRuntimeAnimationTargets = false;
        this.morphWeights = new Map();

        this.playing = false;
        this.enabled = true;
        this.simulationStepTime = 1 / 60;
        this.timeAccumulator = 0;
        this.pauseTime = undefined;
        this.skipFrames = 2; // Skip the first two simulation frames to allow engine to initialize

        //TODO PxShape needs to be recreated if collisionFilter differs
        //TODO Cache geometries for faster computation
        // PxShape has localTransform which applies to all actors using the shape
        // setGlobalPos can move static actors in a non physically accurate way and dynamic actors in a physically accurate way
        // otherwise use kinematic actors for physically accurate movement of static actors

        // MORPH: Call PxShape::setGeometry on each shape which references the mesh, to ensure that internal data structures are updated to reflect the new geometry.

        // Which scale affects the collider geometry?

        // Different primitive modes?
    }

    calculateMorphColliders(gltf) {
        for (const node of this.morphedColliders) {
            const mesh = gltf.meshes[node.mesh];
            let morphWeights = node.weights ?? mesh.weights;
            if (morphWeights === undefined) {
                continue;
            }
            morphWeights = morphWeights.slice();
            const oldMorphWeights = this.morphWeights.get(node.gltfObjectIndex);

            // Check if morph weights have changed
            if (
                oldMorphWeights !== undefined &&
                oldMorphWeights.length === morphWeights.length &&
                oldMorphWeights.every((value, index) => value === morphWeights[index])
            ) {
                continue;
            }

            this.morphWeights.set(node.gltfObjectIndex, morphWeights);

            const vertices = new Float32Array();

            for (const primitive of mesh.primitives) {
                const positionAccessor = gltf.accessors[primitive.attributes.POSITION];
                const positionData = positionAccessor.getNormalizedDeinterlacedView(gltf);
                const morphData = [];
                for (let i = 0; i < morphWeights.length; i++) {
                    const morphAccessor = gltf.accessors[primitive.targets[i].POSITION];
                    morphData.push(morphAccessor.getNormalizedDeinterlacedView(gltf));
                }

                // Calculate morphed vertex positions on CPU
                for (let i = 0; i < positionData.length; i++) {
                    let position = positionData[i];
                    for (let j = 0; j < morphWeights.length; j++) {
                        const morphValue = morphData[j];
                        position += morphValue[i] * morphWeights[j];
                    }
                    vertices.push(position);
                }
            }

            this.engine.updateMorphedColliderGeometry(node, vertices);
        }
    }

    calculateSkinnedColliders(gltf) {
        for (const node of this.skinnedColliders) {
            const mesh = gltf.meshes[node.mesh];
            const skin = gltf.skins[node.skin];
            const inverseBindMatricesAccessor = gltf.accessors[skin.inverseBindMatrices];
            const inverseBindMatrices =
                inverseBindMatricesAccessor.getNormalizedDeinterlacedView(gltf);
            const jointNodes = skin.joints.map((jointIndex) => gltf.nodes[jointIndex]);
            //TODO: Implement skinned collider calculation
        }
    }

    async initializeEngine(engine) {
        if (engine === "NvidiaPhysX") {
            this.engine = new NvidiaPhysicsInterface();
            await this.engine.initializeEngine();
        }
    }

    loadScene(state, sceneIndex) {
        this.resetScene();
        if (
            state.gltf.extensionsUsed === undefined ||
            state.gltf.extensionsUsed.includes("KHR_physics_rigid_bodies") === false
        ) {
            return;
        }
        const scene = state.gltf.scenes[sceneIndex];
        if (!scene.nodes) {
            return;
        }
        this.skipFrames = 2;
        const morphedNodeIndices = getMorphedNodeIndices(state.gltf);
        const result = getAnimatedIndices(state.gltf, "/nodes/", [
            "translation",
            "rotation",
            "scale"
        ]);
        let dynamicMeshColliderCount = 0;
        let staticMeshColliderCount = 0;
        const animatedNodeIndices = result.animatedIndices;
        this.hasRuntimeAnimationTargets = result.runtimeChanges;
        const gatherRigidBodies = (nodeIndex, currentRigidBody) => {
            let parentRigidBody = currentRigidBody;
            const node = state.gltf.nodes[nodeIndex];
            const rigidBody = node.extensions?.KHR_physics_rigid_bodies;
            if (rigidBody) {
                if (rigidBody.motion) {
                    if (rigidBody.motion.isKinematic) {
                        this.kinematicActors.push(node);
                    } else {
                        this.dynamicActors.push(node);
                    }
                    parentRigidBody = node;
                } else if (currentRigidBody === undefined) {
                    if (animatedNodeIndices.has(node.gltfObjectIndex)) {
                        this.kinematicActors.push(node);
                    } else {
                        this.staticActors.push(node);
                    }
                }
                if (rigidBody.collider?.geometry?.node !== undefined) {
                    if (!rigidBody.collider.geometry.convexHull) {
                        if (
                            parentRigidBody === undefined ||
                            parentRigidBody.extensions.KHR_physics_rigid_bodies.motion.isKinematic
                        ) {
                            staticMeshColliderCount++;
                        } else {
                            if (
                                currentRigidBody?.gltfObjectIndex !==
                                parentRigidBody.gltfObjectIndex
                            ) {
                                dynamicMeshColliderCount++;
                            }
                        }
                    }
                    const colliderNodeIndex = rigidBody.collider.geometry.node;
                    const colliderNode = state.gltf.nodes[colliderNodeIndex];
                    if (colliderNode.skin !== undefined) {
                        this.skinnedColliders.push(colliderNode);
                    }
                    if (morphedNodeIndices.has(colliderNodeIndex)) {
                        this.morphedColliders.push(colliderNode);
                    }
                }
                if (rigidBody.joint !== undefined) {
                    this.jointNodes.push(node);
                }
            }
            for (const childIndex of node.children) {
                gatherRigidBodies(childIndex, parentRigidBody);
            }
        };

        for (const nodeIndex of scene.nodes) {
            gatherRigidBodies(nodeIndex, undefined);
        }
        if (
            !this.engine ||
            (this.staticActors.length === 0 &&
                this.kinematicActors.length === 0 &&
                this.dynamicActors.length === 0)
        ) {
            return;
        }
        this.engine.initializeSimulation(
            state,
            this.staticActors,
            this.kinematicActors,
            this.dynamicActors,
            this.jointNodes,
            this.hasRuntimeAnimationTargets,
            staticMeshColliderCount,
            dynamicMeshColliderCount
        );
    }

    resetScene() {
        this.staticActors = [];
        this.kinematicActors = [];
        this.dynamicActors = [];
        this.jointNodes = [];
        this.morphedColliders = [];
        this.skinnedColliders = [];
        this.hasRuntimeAnimationTargets = false;
        this.morphWeights.clear();
        this.timeAccumulator = 0;
        if (this.engine) {
            this.engine.resetSimulation();
        }
    }

    stopSimulation() {
        this.playing = false;
        this.enabled = false;
        if (this.engine) {
            this.engine.stopSimulation();
        }
    }

    resumeSimulation() {
        if (this.engine) {
            this.enabled = true;
            this.playing = true;
        }
    }

    pauseSimulation() {
        this.pauseTime = performance.now();
        this.enabled = true;
        this.playing = false;
    }

    simulateStep(state, deltaTime) {
        if (state === undefined) {
            return;
        }
        if (this.skipFrames > 0) {
            this.skipFrames -= 1;
            return;
        }
        this.applyAnimations(state);
        this.timeAccumulator += deltaTime;
        if (this.pauseTime !== undefined) {
            this.timeAccumulator = this.simulationStepTime;
            if (this.playing) {
                this.pauseTime = undefined;
            }
        }
        if (
            this.enabled &&
            this.engine &&
            state &&
            this.timeAccumulator >= this.simulationStepTime
        ) {
            this.engine.simulateStep(state, this.timeAccumulator);
            this.timeAccumulator = 0;
        }
    }

    applyAnimations(state) {
        for (const node of state.gltf.nodes) {
            // TODO set worldTransformUpdated in node when transform changes from animations/interactivity
            // Find a good way to specify that the node is animated. Either with a flag or by setting physicsTransform to undefined
            if (node.worldTransformUpdated) {
                node.scaledPhysicsTransform = undefined;
                if (this.engine) {
                    this.engine.updateRigidBodyTransform(node);
                }
            }
            // TODO check if morph target weights and skinning have changed
            // TODO check if collider/physics properties have changed
        }
    }

    getDebugLineData() {
        if (this.engine) {
            return this.engine.getDebugLineData();
        }
        return [];
    }
}

class PhysicsInterface {
    constructor() {
        this.simpleShapes = [];
    }

    async initializeEngine() {}
    initializeSimulation(
        state,
        staticActors,
        kinematicActors,
        dynamicActors,
        jointNodes,
        hasRuntimeAnimationTargets,
        staticMeshColliderCount,
        dynamicMeshColliderCount
    ) {}
    pauseSimulation() {}
    resumeSimulation() {}
    resetSimulation() {}
    stopSimulation() {}

    generateBox(x, y, z, scale, scaleAxis) {}
    generateCapsule(height, radiusTop, radiusBottom, scale, scaleAxis) {}
    generateCylinder(height, radiusTop, radiusBottom, scale, scaleAxis) {}
    generateSphere(radius, scale, scaleAxis) {}
    generatePlane(width, height, doubleSided, scale, scaleAxis) {}

    //TODO Handle non-uniform scale properly (also for parent nodes)
    generateSimpleShape(shape, scale = vec3.fromValues(1, 1, 1), scaleAxis = quat.create()) {
        switch (shape.type) {
            case "box":
                return this.generateBox(
                    shape.box.size[0],
                    shape.box.size[1],
                    shape.box.size[2],
                    scale,
                    scaleAxis
                );
            case "capsule":
                return this.generateCapsule(
                    shape.capsule.height,
                    shape.capsule.radiusTop,
                    shape.capsule.radiusBottom,
                    scale,
                    scaleAxis
                );
            case "cylinder":
                return this.generateCylinder(
                    shape.cylinder.height,
                    shape.cylinder.radiusTop,
                    shape.cylinder.radiusBottom,
                    scale,
                    scaleAxis
                );
            case "sphere":
                return this.generateSphere(shape.sphere.radius, scale, scaleAxis);
            case "plane":
                return this.generatePlane(
                    shape.plane.width,
                    shape.plane.height,
                    shape.plane.doubleSided,
                    scale,
                    scaleAxis
                );
        }
    }

    generateSimpleShapes(gltf) {
        this.simpleShapes = [];
        if (gltf?.extensions?.KHR_implicit_shapes === undefined) {
            return;
        }
        for (const shape of gltf.extensions.KHR_implicit_shapes.shapes) {
            this.simpleShapes.push(this.generateSimpleShape(shape));
        }
    }
}

class NvidiaPhysicsInterface extends PhysicsInterface {
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
        this.nodeToJoint = new Map();
        this.filterData = [];
        this.physXFilterData = [];
        this.physXMaterials = [];

        // Need for memory management
        this.convexMeshes = [];
        this.triangleMeshes = [];

        this.MAX_FLOAT = 3.4028234663852885981170418348452e38;
    }

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

    createCollider(colliderNode) {}

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

    generateBox(x, y, z, scale, scaleAxis) {
        if (
            scale.every((value) => value === scale[0]) === false &&
            quat.equals(scaleAxis, quat.create()) === false
        ) {
            const data = createBoxVertexData(x, y, z);
            return this.createConvexMesh(data.vertices, data.indices, scale, scaleAxis);
        }
        const geometry = new this.PhysX.PxBoxGeometry(
            (x / 2) * scale[0],
            (y / 2) * scale[1],
            (z / 2) * scale[2]
        );
        return geometry;
    }

    generateCapsule(height, radiusTop, radiusBottom, scale, scaleAxis) {
        const data = createCapsuleVertexData(radiusTop, radiusBottom, height);
        return this.createConvexMesh(data.vertices, data.indices, scale, scaleAxis);
    }

    generateCylinder(height, radiusTop, radiusBottom, scale, scaleAxis) {
        if (
            (quat.equals(scaleAxis, quat.create()) === false &&
                scale.every((value) => value === scale[0]) === false) ||
            radiusTop !== radiusBottom ||
            scale[0] !== scale[2]
        ) {
            const data = createCylinderVertexData(radiusTop, radiusBottom, height);
            return this.createConvexMesh(data.vertices, data.indices, scale, scaleAxis);
        }
        height *= scale[1];
        radiusTop *= scale[0];
        radiusBottom *= scale[0];
        const data = createCylinderVertexData(radiusTop, radiusBottom, height);
        return this.createConvexMesh(data.vertices, data.indices);
    }

    generateSphere(radius, scale, scaleAxis) {
        if (scale.every((value) => value === scale[0]) === false) {
            const data = createCapsuleVertexData(radius, radius, 0);
            return this.createConvexMesh(data.vertices, data.indices, scale, scaleAxis);
        } else {
            radius *= scale[0];
        }
        const geometry = new this.PhysX.PxSphereGeometry(radius);
        return geometry;
    }

    generatePlane(width, height, doubleSided, scale, scaleAxis) {
        const geometry = new this.PhysX.PxPlaneGeometry();
        return geometry;
    }

    createConvexMesh(
        vertices,
        indices,
        scale = vec3.fromValues(1, 1, 1),
        scaleAxis = quat.create()
    ) {
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
        flag |= this.PhysX._emscripten_enum_PxConvexFlagEnum_eCOMPUTE_CONVEX();
        flag |= this.PhysX._emscripten_enum_PxConvexFlagEnum_eQUANTIZE_INPUT();
        flag |= this.PhysX._emscripten_enum_PxConvexFlagEnum_eDISABLE_MESH_VALIDATION();
        const pxflags = new this.PhysX.PxConvexFlags(flag);
        des.flags = pxflags;
        const cookingParams = new this.PhysX.PxCookingParams(this.tolerances);
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

    collectVerticesAndIndicesFromNode(gltf, node) {
        // TODO Handle different primitive modes
        const mesh = gltf.meshes[node.mesh];
        let positionDataArray = [];
        let positionCount = 0;
        let indexDataArray = [];
        let indexCount = 0;
        let skinData = undefined;

        if (node.skin !== undefined) {
            const skin = gltf.skins[node.skin];
            if (skin.jointTextureData === undefined) {
                skin.computeJoints(gltf);
            }
            skinData = skin.jointTextureData;
        }

        for (const primitive of mesh.primitives) {
            const positionAccessor = gltf.accessors[primitive.attributes.POSITION];
            const positionData = positionAccessor.getNormalizedDeinterlacedView(gltf);

            if (primitive.targets !== undefined) {
                let morphWeights = node.weights ?? mesh.weights;
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

            if (skinData !== undefined) {
                // Apply skinning on CPU
                const joints0Accessor = gltf.accessors[primitive.attributes.JOINTS_0];
                const weights0Accessor = gltf.accessors[primitive.attributes.WEIGHTS_0];
                const joints0Data = joints0Accessor.getDeinterlacedView(gltf);
                const weights0Data = weights0Accessor.getNormalizedDeinterlacedView(gltf);
                let joints1Data = undefined;
                let weights1Data = undefined;
                if (
                    primitive.attributes.JOINTS_1 !== undefined &&
                    primitive.attributes.WEIGHTS_1 !== undefined
                ) {
                    const joints1Accessor = gltf.accessors[primitive.attributes.JOINTS_1];
                    const weights1Accessor = gltf.accessors[primitive.attributes.WEIGHTS_1];
                    joints1Data = joints1Accessor.getDeinterlacedView(gltf);
                    weights1Data = weights1Accessor.getNormalizedDeinterlacedView(gltf);
                }

                for (let i = 0; i < positionData.length / 3; i++) {
                    let skinnedPosition = vec3.create();
                    const originalPosition = vec3.fromValues(
                        positionData[i * 3],
                        positionData[i * 3 + 1],
                        positionData[i * 3 + 2]
                    );
                    const skinningMatrix = mat4.create();
                    for (let j = 0; j < 4; j++) {
                        const jointIndex = joints0Data[i * 4 + j];
                        const weight = weights0Data[i * 4 + j];
                        const jointMatrix = mat4.create();
                        jointMatrix.set(skinData.slice(jointIndex * 32, jointIndex * 32 + 16));
                        mat4.multiplyScalarAndAdd(
                            skinningMatrix,
                            skinningMatrix,
                            jointMatrix,
                            weight
                        );
                        if (joints1Data !== undefined && weights1Data !== undefined && j >= 4) {
                            const joint1Index = joints1Data[i * 4 + (j - 4)];
                            const weight1 = weights1Data[i * 4 + (j - 4)];
                            const jointMatrix = mat4.create();
                            jointMatrix.set(
                                skinData.slice(joint1Index * 32, joint1Index * 32 + 16)
                            );
                            mat4.multiplyScalarAndAdd(
                                skinningMatrix,
                                skinningMatrix,
                                jointMatrix,
                                weight1
                            );
                        }
                    }
                    vec3.transformMat4(skinnedPosition, originalPosition, skinningMatrix);
                    positionData[i * 3] = skinnedPosition[0];
                    positionData[i * 3 + 1] = skinnedPosition[1];
                    positionData[i * 3 + 2] = skinnedPosition[2];
                }
            }

            positionDataArray.push(positionData);
            positionCount += positionAccessor.count;
            if (primitive.indices !== undefined) {
                const indexAccessor = gltf.accessors[primitive.indices];
                indexDataArray.push(indexAccessor.getNormalizedDeinterlacedView(gltf));
                indexCount += indexAccessor.count;
            } else {
                const array = Array.from(Array(positionAccessor.count).keys());
                indexDataArray.push(new Uint32Array(array));
                indexCount += positionAccessor.count;
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

    createConvexMeshFromNode(
        gltf,
        node,
        scale = vec3.fromValues(1, 1, 1),
        scaleAxis = quat.create()
    ) {
        const { vertices, indices } = this.collectVerticesAndIndicesFromNode(gltf, node);
        return this.createConvexMesh(vertices, indices, scale, scaleAxis);
    }

    createMeshFromNode(gltf, node, scale = vec3.fromValues(1, 1, 1), scaleAxis = quat.create()) {
        const { vertices, indices } = this.collectVerticesAndIndicesFromNode(gltf, node);
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
        // Skins ignore the the transforms of the nodes they are attached to
        if (node.skin === undefined) {
            PxScale.x = scale[0];
            PxScale.y = scale[1];
            PxScale.z = scale[2];
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

    collidesWith(filterA, filterB) {
        if (filterA.collideWithSystems.length > 0) {
            for (const system of filterA.collideWithSystems) {
                if (filterB.collisionSystems.includes(system)) {
                    return true;
                }
            }
            return false;
        } else if (filterA.notCollideWithSystems.length > 0) {
            for (const system of filterA.notCollideWithSystems) {
                if (filterB.collisionSystems.includes(system)) {
                    return false;
                }
                return true;
            }
        }
        return true;
    }

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
                if (this.collidesWith(filters[i], filters[j])) {
                    bitMask |= 1 << j;
                }
            }
            this.filterData[i] = bitMask;
        }
    }

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
            physxMaterial.setFrictionCombine(
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

    createPhysXCollisionFilter(collisionFilter) {
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

        const additionalFlags = 0;
        return new this.PhysX.PxFilterData(word0, word1, additionalFlags, 0);
    }

    createShape(
        gltf,
        node,
        shapeFlags,
        physXMaterial,
        physXFilterData,
        convexHull,
        scale = vec3.fromValues(1, 1, 1),
        scaleAxis = quat.create()
    ) {
        const collider = node.extensions?.KHR_physics_rigid_bodies?.collider;
        let geometry = undefined;
        if (collider?.geometry?.shape !== undefined) {
            if (scale[0] !== 1 || scale[1] !== 1 || scale[2] !== 1) {
                const simpleShape =
                    gltf.extensions.KHR_implicit_shapes.shapes[collider.geometry.shape];
                geometry = this.generateSimpleShape(simpleShape, scale, scaleAxis);
            } else {
                geometry = this.simpleShapes[collider.geometry.shape];
            }
        } else {
            if (node.mesh !== undefined) {
                if (convexHull === true && node.skin === undefined) {
                    geometry = this.createConvexMeshFromNode(gltf, node, scale, scaleAxis);
                } else {
                    geometry = this.createMeshFromNode(gltf, node, scale, scaleAxis);
                }
            }
        }

        if (geometry === undefined) {
            return undefined;
        }

        if (physXMaterial === undefined) {
            if (collider?.physicsMaterial !== undefined) {
                physXMaterial = this.physXMaterials[collider.physicsMaterial];
            } else {
                physXMaterial = this.defaultMaterial;
            }
        }
        const shape = this.physics.createShape(geometry, physXMaterial, true, shapeFlags);

        if (physXFilterData === undefined) {
            physXFilterData =
                this.physXFilterData[collider?.collisionFilter ?? this.physXFilterData.length - 1];
        }

        shape.setSimulationFilterData(physXFilterData);

        return shape;
    }

    createActor(gltf, node, shapeFlags, type, noMeshShapes = false) {
        let parentNode = node;
        while (parentNode.parentNode !== undefined) {
            parentNode = parentNode.parentNode;
        }
        const worldTransform = node.worldTransform;
        const translation = vec3.create();
        mat4.getTranslation(translation, worldTransform);
        const pos = new this.PhysX.PxVec3(...translation);
        const rotation = new this.PhysX.PxQuat(...node.worldQuaternion);
        const pose = new this.PhysX.PxTransform(pos, rotation);
        let actor = null;
        if (type === "static") {
            actor = this.physics.createRigidStatic(pose);
        } else {
            actor = this.physics.createRigidDynamic(pose);
            if (type === "kinematic") {
                actor.setRigidBodyFlag(this.PhysX.PxRigidBodyFlagEnum.eKINEMATIC, true);
            }
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
                if (motion.centerOfMass !== undefined) {
                    const com = new this.PhysX.PxVec3(...motion.centerOfMass);
                    const inertiaRotation = new this.PhysX.PxQuat(
                        this.PhysX.PxIDENTITYEnum.PxIdentity
                    );
                    if (motion.inertiaOrientation !== undefined) {
                        inertiaRotation.x = motion.inertiaOrientation[0];
                        inertiaRotation.y = motion.inertiaOrientation[1];
                        inertiaRotation.z = motion.inertiaOrientation[2];
                        inertiaRotation.w = motion.inertiaOrientation[3];
                    }
                    const comTransform = new this.PhysX.PxTransform(com, inertiaRotation);
                    actor.setCMassLocalPose(comTransform);
                    this.PhysX.destroy(com);
                    this.PhysX.destroy(inertiaRotation);
                    this.PhysX.destroy(comTransform);
                }
                if (motion.inertiaDiagonal !== undefined) {
                    const inertia = new this.PhysX.PxVec3(...motion.inertiaDiagonal);
                    actor.setMassSpaceInertiaTensor(inertia);
                    this.PhysX.destroy(inertia);
                }

                // Let the engine compute mass and inertia if not all parameters are specified
                if (motion.inertiaDiagonal === undefined) {
                    const pose = motion.centerOfMass
                        ? new this.PhysX.PxVec3(...motion.centerOfMass)
                        : new this.PhysX.PxVec3(0, 0, 0);
                    if (motion.mass === undefined) {
                        this.PhysX.PxRigidBodyExt.prototype.updateMassAndInertia(actor, 1.0, pose);
                    } else {
                        this.PhysX.PxRigidBodyExt.prototype.setMassAndUpdateInertia(
                            actor,
                            motion.mass,
                            pose
                        );
                    }
                    this.PhysX.destroy(pose);
                }

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
            referencingNode
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
            const offsetTransform = mat4.create();
            const inverseShapeTransform = mat4.create();
            mat4.invert(inverseShapeTransform, actorNode.worldTransform);
            mat4.multiply(offsetTransform, inverseShapeTransform, worldTransform);
            mat4.getRotation(rotation, offsetTransform);

            // Calculate scale and scaleAxis
            const { scale, scaleAxis } = PhysicsUtils.calculateScaleAndAxis(node, referencingNode);

            const materialIndex = collider?.physicsMaterial;
            const material = materialIndex
                ? this.physXMaterials[materialIndex]
                : this.defaultMaterial;

            const physXFilterData = collider?.collisionFilter
                ? this.physXFilterData[collider.collisionFilter]
                : this.physXFilterData[this.physXFilterData.length - 1];

            const shape = this.createShape(
                gltf,
                node,
                shapeFlags,
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
                this.PhysX.destroy(PxPos);
                this.PhysX.destroy(PxRotation);
                this.PhysX.destroy(pose);
            }
        };

        const collider = node.extensions?.KHR_physics_rigid_bodies?.collider;
        const physxMaterial = collider?.physicsMaterial
            ? this.physXMaterials[collider.physicsMaterial]
            : this.defaultMaterial;
        const physxFilterData =
            this.physXFilterData[collider?.collisionFilter ?? this.physXFilterData.length - 1];

        if (collider?.geometry?.node !== undefined) {
            const colliderNode = gltf.nodes[collider.geometry.node];
            PhysicsUtils.recurseCollider(
                gltf,
                colliderNode,
                node.extensions?.KHR_physics_rigid_bodies?.collider,
                node,
                worldTransform,
                node,
                createAndAddShape
            );
        } else if (collider?.geometry?.shape !== undefined) {
            const { scale, scaleAxis } = PhysicsUtils.calculateScaleAndAxis(node);

            const shape = this.createShape(
                gltf,
                node,
                shapeFlags,
                physxMaterial,
                physxFilterData,
                true,
                scale,
                scaleAxis
            );
            if (shape !== undefined) {
                actor.attachShape(shape);
            }
        }

        for (const childIndex of node.children) {
            const childNode = gltf.nodes[childIndex];
            PhysicsUtils.recurseCollider(
                gltf,
                childNode,
                undefined,
                node,
                worldTransform,
                undefined,
                createAndAddShape
            );
        }

        this.PhysX.destroy(pos);
        this.PhysX.destroy(rotation);
        this.PhysX.destroy(pose);

        this.scene.addActor(actor);
        this.nodeToActor.set(node.gltfObjectIndex, actor);
    }

    computeJointOffsetAndActor(node) {
        let currentNode = node;
        while (currentNode !== undefined) {
            if (this.nodeToActor.has(currentNode.gltfObjectIndex)) {
                break;
            }
            currentNode = currentNode.parentNode;
        }
        if (currentNode === undefined) {
            const pos = vec3.create();
            mat4.getTranslation(pos, node.worldTransform);
            return { actor: undefined, offsetPosition: pos, offsetRotation: node.worldQuaternion };
        }
        const actor = this.nodeToActor.get(currentNode.gltfObjectIndex);
        const inverseActorRotation = quat.create();
        quat.invert(inverseActorRotation, currentNode.worldQuaternion);
        const offsetRotation = quat.create();
        quat.multiply(offsetRotation, inverseActorRotation, node.worldQuaternion);

        const actorPosition = vec3.create();
        mat4.getTranslation(actorPosition, currentNode.worldTransform);
        const nodePosition = vec3.create();
        mat4.getTranslation(nodePosition, node.worldTransform);
        const offsetPosition = vec3.create();
        vec3.subtract(offsetPosition, nodePosition, actorPosition);

        return { actor: actor, offsetPosition: offsetPosition, offsetRotation: offsetRotation };
    }

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

    createJoint(gltf, node) {
        const joint = node.extensions?.KHR_physics_rigid_bodies?.joint;
        const referencedJoint =
            gltf.extensions?.KHR_physics_rigid_bodies?.physicsJoints[joint.joint];

        if (referencedJoint === undefined) {
            console.error("Referenced joint not found:", joint.joint);
            return;
        }

        const resultA = this.computeJointOffsetAndActor(node);
        const resultB = this.computeJointOffsetAndActor(gltf.nodes[joint.connectedNode]);

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

        //TODO toogle debug view
        physxJoint.setConstraintFlag(this.PhysX.PxConstraintFlagEnum.eVISUALIZATION, true);

        this.nodeToJoint.set(node.gltfObjectIndex, physxJoint);

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

        let angularYLimit = undefined;
        let angularZLimit = undefined;

        for (const limit of referencedJoint.limits) {
            const lock = limit.min === 0 && limit.max === 0;
            const spring = new this.PhysX.PxSpring(limit.stiffness ?? 0, limit.damping);
            if (limit.linearAxes && limit.linearAxes.length > 0) {
                const linearLimitPair = new this.PhysX.PxJointLinearLimitPair(
                    limit.min ?? -this.MAX_FLOAT,
                    limit.max ?? this.MAX_FLOAT,
                    spring
                );
                if (limit.linearAxes.includes(0)) {
                    physxJoint.setMotion(
                        this.PhysX.PxD6AxisEnum.eX,
                        lock
                            ? this.PhysX.PxD6MotionEnum.eLOCKED
                            : this.PhysX.PxD6MotionEnum.eLIMITED
                    );
                    physxJoint.setLinearLimit(this.PhysX.PxD6AxisEnum.eX, linearLimitPair);
                }
                if (limit.linearAxes.includes(1)) {
                    physxJoint.setMotion(
                        this.PhysX.PxD6AxisEnum.eY,
                        lock
                            ? this.PhysX.PxD6MotionEnum.eLOCKED
                            : this.PhysX.PxD6MotionEnum.eLIMITED
                    );
                    physxJoint.setLinearLimit(this.PhysX.PxD6AxisEnum.eY, linearLimitPair);
                }
                if (limit.linearAxes.includes(2)) {
                    physxJoint.setMotion(
                        this.PhysX.PxD6AxisEnum.eZ,
                        lock
                            ? this.PhysX.PxD6MotionEnum.eLOCKED
                            : this.PhysX.PxD6MotionEnum.eLIMITED
                    );
                    physxJoint.setLinearLimit(this.PhysX.PxD6AxisEnum.eZ, linearLimitPair);
                }
                this.PhysX.destroy(linearLimitPair);
            }
            if (limit.angularAxes && limit.angularAxes.length > 0) {
                const angularLimitPair = new this.PhysX.PxJointAngularLimitPair(
                    limit.min ?? -Math.PI / 2,
                    limit.max ?? Math.PI / 2,
                    spring
                );
                if (lock) {
                    if (limit.angularAxes.includes(0)) {
                        physxJoint.setMotion(
                            this.PhysX.PxD6AxisEnum.eTWIST,
                            this.PhysX.PxD6MotionEnum.eLOCKED
                        );
                        physxJoint.setTwistLimit(angularLimitPair);
                    }
                    if (limit.angularAxes.includes(1)) {
                        physxJoint.setMotion(
                            this.PhysX.PxD6AxisEnum.eSWING1,
                            this.PhysX.PxD6MotionEnum.eLOCKED
                        );
                        angularYLimit = limit;
                    }
                    if (limit.angularAxes.includes(2)) {
                        physxJoint.setMotion(
                            this.PhysX.PxD6AxisEnum.eSWING2,
                            this.PhysX.PxD6MotionEnum.eLOCKED
                        );
                        angularZLimit = limit;
                    }
                } else if (limit.angularAxes.includes(0)) {
                    physxJoint.setMotion(
                        this.PhysX.PxD6AxisEnum.eTWIST,
                        this.PhysX.PxD6MotionEnum.eLIMITED
                    );
                    physxJoint.setTwistLimit(angularLimitPair);
                } else if (limit.angularAxes.includes(1)) {
                    angularYLimit = limit;
                } else if (limit.angularAxes.includes(2)) {
                    angularZLimit = limit;
                }
                this.PhysX.destroy(angularLimitPair);
            }
            this.PhysX.destroy(spring);
        }

        if (angularYLimit !== undefined && angularZLimit !== undefined) {
            if (
                angularYLimit.stiffness !== angularZLimit.stiffness ||
                angularYLimit.damping !== angularZLimit.damping
            ) {
                console.warn(
                    "PhysX does not support different stiffness/damping for swing limits."
                );
            } else {
                const spring = new this.PhysX.PxSpring(
                    angularYLimit.stiffness ?? 0,
                    angularYLimit.damping
                );
                let yMin = -Math.PI / 2;
                let yMax = Math.PI / 2;
                let zMin = -Math.PI / 2;
                let zMax = Math.PI / 2;
                if (angularYLimit.min !== undefined) {
                    yMin = angularYLimit.min;
                }
                if (angularYLimit.max !== undefined) {
                    yMax = angularYLimit.max;
                }
                if (angularZLimit.min !== undefined) {
                    zMin = angularZLimit.min;
                }
                if (angularZLimit.max !== undefined) {
                    zMax = angularZLimit.max;
                }
                const jointLimitCone = new this.PhysX.PxJointLimitPyramid(
                    yMin,
                    yMax,
                    zMin,
                    zMax,
                    spring
                );
                physxJoint.setPyramidSwingLimit(jointLimitCone);
                this.PhysX.destroy(spring);

                if (yMin !== yMax) {
                    physxJoint.setMotion(
                        this.PhysX.PxD6AxisEnum.eSWING1,
                        this.PhysX.PxD6MotionEnum.eLIMITED
                    );
                }
                if (zMin !== zMax) {
                    physxJoint.setMotion(
                        this.PhysX.PxD6AxisEnum.eSWING2,
                        this.PhysX.PxD6MotionEnum.eLIMITED
                    );
                }
            }
        } else if (angularYLimit !== undefined || angularZLimit !== undefined) {
            const singleLimit = angularYLimit ?? angularZLimit;
            if (singleLimit.min && -1 * singleLimit.min !== singleLimit.max) {
                console.warn(
                    "PhysX requires symmetric limits for swing limits in single axis mode."
                );
            } else {
                const spring = new this.PhysX.PxSpring(
                    singleLimit.stiffness ?? 0,
                    singleLimit.damping
                );
                const maxY = angularYLimit?.max ?? Math.PI / 2;
                const maxZ = angularZLimit?.max ?? Math.PI / 2;
                const jointLimitCone = new this.PhysX.PxJointLimitCone(maxY, maxZ, spring);
                if (angularYLimit !== undefined) {
                    physxJoint.setMotion(
                        this.PhysX.PxD6AxisEnum.eSWING1,
                        this.PhysX.PxD6MotionEnum.eLIMITED
                    );
                }
                if (angularZLimit !== undefined) {
                    physxJoint.setMotion(
                        this.PhysX.PxD6AxisEnum.eSWING2,
                        this.PhysX.PxD6MotionEnum.eLIMITED
                    );
                }
                physxJoint.setSwingLimit(jointLimitCone);
                this.PhysX.destroy(spring);
                this.PhysX.destroy(jointLimitCone);
            }
        }

        const positionTarget = vec3.fromValues(0, 0, 0);
        const angleTarget = quat.create();
        const linearVelocityTarget = vec3.fromValues(0, 0, 0);
        const angularVelocityTarget = vec3.fromValues(0, 0, 0);

        for (const drive of referencedJoint.drives) {
            const physxDrive = new this.PhysX.PxD6JointDrive(
                drive.stiffness,
                drive.damping,
                drive.maxForce ?? this.MAX_FLOAT,
                drive.mode === "acceleration"
            );
            if (drive.type === "linear") {
                const axis = this.convertAxisIndexToEnum(drive.axis, "linear");
                physxJoint.setDrive(axis, physxDrive);
                if (drive.positionTarget !== undefined) {
                    positionTarget[drive.axis] = drive.positionTarget;
                }
                if (drive.velocityTarget !== undefined) {
                    linearVelocityTarget[drive.axis] = drive.velocityTarget;
                }
            } else if (drive.type === "angular") {
                if (drive.positionTarget !== undefined) {
                    // gl-matrix seems to apply rotations clockwise for positive angles, gltf uses counter-clockwise
                    switch (drive.axis) {
                        case 0: {
                            quat.rotateX(angleTarget, angleTarget, -drive.positionTarget);
                            break;
                        }
                        case 1: {
                            quat.rotateY(angleTarget, angleTarget, -drive.positionTarget);
                            break;
                        }
                        case 2: {
                            quat.rotateZ(angleTarget, angleTarget, -drive.positionTarget);
                            break;
                        }
                    }
                }

                if (drive.velocityTarget !== undefined) {
                    angularVelocityTarget[drive.axis] = drive.velocityTarget;
                }

                const axis = this.convertAxisIndexToEnum(drive.axis, "angular");
                physxJoint.setDrive(axis, physxDrive);
            }
            this.PhysX.destroy(physxDrive);
        }

        const posTarget = new this.PhysX.PxVec3(...positionTarget);
        const rotTarget = new this.PhysX.PxQuat(...angleTarget);
        const targetTransform = new this.PhysX.PxTransform(posTarget, rotTarget);
        physxJoint.setDrivePosition(targetTransform);

        const linVel = new this.PhysX.PxVec3(...linearVelocityTarget);
        const angVel = new this.PhysX.PxVec3(...angularVelocityTarget);
        physxJoint.setDriveVelocity(linVel, angVel);

        this.PhysX.destroy(posTarget);
        this.PhysX.destroy(rotTarget);
        this.PhysX.destroy(linVel);
        this.PhysX.destroy(angVel);
        this.PhysX.destroy(targetTransform);

        return physxJoint;
    }

    initializeSimulation(
        state,
        staticActors,
        kinematicActors,
        dynamicActors,
        jointNodes,
        hasRuntimeAnimationTargets,
        staticMeshColliderCount,
        dynamicMeshColliderCount
    ) {
        if (!this.PhysX) {
            return;
        }
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
        this.scene = this.physics.createScene(sceneDesc);
        console.log("Created scene");
        const shapeFlags = new this.PhysX.PxShapeFlags(
            this.PhysX.PxShapeFlagEnum.eSCENE_QUERY_SHAPE |
                this.PhysX.PxShapeFlagEnum.eSIMULATION_SHAPE |
                this.PhysX.PxShapeFlagEnum.eVISUALIZATION
        );

        const alwaysConvexMeshes =
            dynamicMeshColliderCount > 1 ||
            (staticMeshColliderCount > 0 && dynamicMeshColliderCount > 0);

        for (const node of staticActors) {
            this.createActor(state.gltf, node, shapeFlags, "static");
        }
        for (const node of kinematicActors) {
            this.createActor(state.gltf, node, shapeFlags, "kinematic");
        }
        for (const node of dynamicActors) {
            this.createActor(state.gltf, node, shapeFlags, "dynamic", true);
        }
        for (const node of jointNodes) {
            this.createJoint(state.gltf, node);
        }

        this.PhysX.destroy(tmpVec);
        this.PhysX.destroy(sceneDesc);
        this.PhysX.destroy(shapeFlags);
        this.scene.setVisualizationParameter(this.PhysX.eSCALE, 1);
        this.scene.setVisualizationParameter(this.PhysX.eWORLD_AXES, 1);
        this.scene.setVisualizationParameter(this.PhysX.eACTOR_AXES, 1);
        this.scene.setVisualizationParameter(this.PhysX.eCOLLISION_SHAPES, 1);
        this.scene.setVisualizationParameter(this.PhysX.eJOINT_LOCAL_FRAMES, 1);
        this.scene.setVisualizationParameter(this.PhysX.eJOINT_LIMITS, 1);
    }

    applyTransformRecursively(gltf, node, parentTransform) {
        if (node.extensions?.KHR_physics_rigid_bodies?.motion !== undefined) {
            return;
        }
        const localTransform = node.getLocalTransform();
        const globalTransform = mat4.create();
        mat4.multiply(globalTransform, parentTransform, localTransform);
        node.scaledPhysicsTransform = globalTransform;
        for (const childIndex of node.children) {
            const childNode = gltf.nodes[childIndex];
            this.applyTransformRecursively(gltf, childNode, globalTransform);
        }
    }

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

        for (const [nodeIndex, actor] of this.nodeToActor.entries()) {
            const node = state.gltf.nodes[nodeIndex];
            const motion = node.extensions?.KHR_physics_rigid_bodies?.motion;
            // TODO ignore if animated
            if (motion && motion.isKinematic) {
                const worldTransform = node.physicsTransform ?? node.worldTransform;
                const targetPosition = vec3.create();
                const targetRotation = quat.create();
                if (motion.linearVelocity !== undefined) {
                    const linearVelocity = vec3.create();
                    vec3.scale(linearVelocity, motion.linearVelocity, deltaTime);
                    targetPosition[0] = worldTransform[12] + linearVelocity[0];
                    targetPosition[1] = worldTransform[13] + linearVelocity[1];
                    targetPosition[2] = worldTransform[14] + linearVelocity[2];
                }
                if (motion.angularVelocity !== undefined) {
                    // gl-matrix seems to apply rotations clockwise for positive angles, gltf uses counter-clockwise
                    const angularVelocity = quat.create();
                    quat.rotateX(
                        angularVelocity,
                        angularVelocity,
                        -motion.angularVelocity[0] * deltaTime
                    );
                    quat.rotateY(
                        angularVelocity,
                        angularVelocity,
                        -motion.angularVelocity[1] * deltaTime
                    );
                    quat.rotateZ(
                        angularVelocity,
                        angularVelocity,
                        -motion.angularVelocity[2] * deltaTime
                    );
                    let currentRotation = quat.create();
                    if (node.physicsTransform !== undefined) {
                        mat4.getRotation(currentRotation, worldTransform);
                    } else {
                        currentRotation = node.worldQuaternion;
                    }
                    quat.multiply(targetRotation, angularVelocity, currentRotation);
                }
                const pos = new this.PhysX.PxVec3(...targetPosition);
                const rot = new this.PhysX.PxQuat(...targetRotation);
                const transform = new this.PhysX.PxTransform(pos, rot);

                actor.setKinematicTarget(transform);
                this.PhysX.destroy(pos);
                this.PhysX.destroy(rot);
                this.PhysX.destroy(transform);

                const physicsTransform = mat4.create();
                mat4.fromRotationTranslation(physicsTransform, targetRotation, targetPosition);

                const scaledPhysicsTransform = mat4.create();
                mat4.scale(scaledPhysicsTransform, physicsTransform, node.worldScale);

                node.physicsTransform = physicsTransform;
                node.scaledPhysicsTransform = scaledPhysicsTransform;
            } else if (motion && motion.gravityFactor !== 1.0) {
                const force = new this.PhysX.PxVec3(0, -9.81 * motion.gravityFactor, 0);
                actor.addForce(force);
                this.PhysX.destroy(force);
            }
        }

        this.scene.simulate(deltaTime);
        this.scene.fetchResults(true);

        for (const [nodeIndex, actor] of this.nodeToActor.entries()) {
            const node = state.gltf.nodes[nodeIndex];
            const motion = node.extensions?.KHR_physics_rigid_bodies?.motion;
            if (motion && !motion.isKinematic) {
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
                    this.applyTransformRecursively(
                        state.gltf,
                        childNode,
                        node.scaledPhysicsTransform
                    );
                }
            }
        }
    }

    resetSimulation() {
        this.reset = true;
        this.simulateStep({}, 0);
    }

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

        for (const joint of this.nodeToJoint.values()) {
            joint.release();
        }
        this.nodeToJoint.clear();

        for (const actor of this.nodeToActor.values()) {
            actor.release();
        }

        this.nodeToActor.clear();
        if (scenePointer) {
            scenePointer.release();
        }
    }

    getDebugLineData() {
        if (!this.scene) {
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
}

export { PhysicsController };
