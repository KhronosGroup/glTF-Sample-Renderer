import { getAnimatedIndices, getMorphedNodeIndices } from "../gltf/gltf_utils";
import PhysX from "physx-js-webidl";
// The import is needed for rollup to include the wasm file in the build output
// eslint-disable-next-line no-unused-vars
import PhysXBinaryFile from "physx-js-webidl/physx-js-webidl.wasm";
import { gltfPhysicsMaterial } from "../gltf/rigid_bodies";
import { createCapsuleVertexData, createCylinderVertexData } from "../geometry_generator";
import { vec3, mat4, quat } from "gl-matrix";

class PhysicsController {
    constructor() {
        this.engine = undefined;
        this.staticActors = [];
        this.kinematicActors = [];
        this.dynamicActors = [];
        this.morphedColliders = [];
        this.skinnedColliders = [];
        this.hasRuntimeAnimationTargets = false;
        this.morphWeights = new Map();
        this.playing = false;
        this.enabled = false;
        this.simulationStepTime = 1 / 60;
        this.timeAccumulator = 0;
        this.skipFrames = 2; // Skip the first two simulation frames to allow engine to initialize

        //TODO different scaled primitive colliders might need to be uniquely created
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
        //TODO reset previous scene
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
        let meshColliderCount = 0;
        const animatedNodeIndices = result.animatedIndices;
        this.hasRuntimeAnimationTargets = result.runtimeChanges;
        const gatherRigidBodies = (nodeIndices, currentRigidBody) => {
            let parentRigidBody = currentRigidBody;
            for (const nodeIndex of nodeIndices) {
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
                        meshColliderCount++;
                        const colliderNodeIndex = rigidBody.collider.geometry.node;
                        const colliderNode = state.gltf.nodes[colliderNodeIndex];
                        if (colliderNode.skin !== undefined) {
                            this.skinnedColliders.push(colliderNode);
                        }
                        if (morphedNodeIndices.has(colliderNodeIndex)) {
                            this.morphedColliders.push(colliderNode);
                        }
                    }
                }
                gatherRigidBodies(node.children, parentRigidBody);
            }
        };
        gatherRigidBodies(scene.nodes, undefined);
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
            this.hasRuntimeAnimationTargets,
            meshColliderCount
        );
    }

    resetScene() {
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
        if (
            this.playing &&
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
            if (node.worldTransformUpdated) {
                node.physicsTransform = node.worldTransform;
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
    initializeSimulation(state, staticActors, kinematicActors, dynamicActors) {}
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
                this.simpleShapes.push(
                    this.generateBox(
                        shape.box.size[0],
                        shape.box.size[1],
                        shape.box.size[2],
                        scale,
                        scaleAxis
                    )
                );
                break;
            case "capsule":
                this.simpleShapes.push(
                    this.generateCapsule(
                        shape.capsule.height,
                        shape.capsule.radiusTop,
                        shape.capsule.radiusBottom,
                        scale,
                        scaleAxis
                    )
                );
                break;
            case "cylinder":
                this.simpleShapes.push(
                    this.generateCylinder(
                        shape.cylinder.height,
                        shape.cylinder.radiusTop,
                        shape.cylinder.radiusBottom,
                        scale,
                        scaleAxis
                    )
                );
                break;
            case "sphere":
                this.simpleShapes.push(this.generateSphere(shape.sphere.radius, scale, scaleAxis));
                break;
            case "plane":
                this.simpleShapes.push(
                    this.generatePlane(
                        shape.plane.width,
                        shape.plane.height,
                        shape.plane.doubleSided,
                        scale,
                        scaleAxis
                    )
                );
                break;
        }
    }

    generateSimpleShapes(gltf) {
        this.simpleShapes = [];
        if (gltf?.extensions?.KHR_implicit_shapes === undefined) {
            return;
        }
        for (const shape of gltf.extensions.KHR_implicit_shapes.shapes) {
            this.generateSimpleShape(shape);
        }
    }
}

class NvidiaPhysicsInterface extends PhysicsInterface {
    constructor() {
        super();
        this.PhysX = undefined;
        this.physics = undefined;
        this.scene = undefined;
        this.nodeToActor = new Map();
        this.defaultMaterial = new gltfPhysicsMaterial();
        this.tolerances = undefined;
        this.filterData = [];
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
        this.physics = this.PhysX.CreatePhysics(version, foundation, this.tolerances);
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
        if (quat.equals(scaleAxis, quat.create()) === false) {
            //TODO scale with rotation
        }
        const geometry = new this.PhysX.PxBoxGeometry(
            (x / 2) * scale[0],
            (y / 2) * scale[1],
            (z / 2) * scale[2]
        );
        return geometry;
    }

    generateCapsule(height, radiusTop, radiusBottom, scale, scaleAxis) {
        //TODO scale with rotation
        const data = createCapsuleVertexData(radiusTop, radiusBottom, height);
        return this.createConvexMesh(data.vertices, data.indices);
    }

    generateCylinder(height, radiusTop, radiusBottom, scale, scaleAxis) {
        if (
            quat.equals(scaleAxis, quat.create()) === false ||
            radiusTop !== radiusBottom ||
            scale[0] !== scale[2]
        ) {
            //TODO scale with rotation
            const data = createCylinderVertexData(radiusTop, radiusBottom, height);
            return this.createConvexMesh(data.vertices, data.indices);
        }
        height *= scale[1];
        radiusTop *= scale[0];
        radiusBottom *= scale[0];
        const data = createCylinderVertexData(radiusTop, radiusBottom, height);
        return this.createConvexMesh(data.vertices, data.indices);
    }

    generateSphere(radius, scale, scaleAxis) {
        if (
            scale.every((value) => value === scale[0]) === false ||
            quat.equals(scaleAxis, quat.create()) === false
        ) {
            //TODO
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

    createTriangleMesh(
        vertices,
        indices,
        scale = vec3.fromValues(1, 1, 1),
        scaleAxis = quat.create()
    ) {
        const geometry = new this.PhysX.PxTriangleMeshGeometry(vertices, indices, scale, scaleAxis);
        return geometry;
    }

    collectVerticesAndIndicesFromNode(gltf, node) {
        // TODO Handle different primitive modes
        const mesh = gltf.meshes[node.mesh];
        let positionDataArray = [];
        let positionCount = 0;
        let indexDataArray = [];
        let indexCount = 0;
        for (const primitive of mesh.primitives) {
            const positionAccessor = gltf.accessors[primitive.attributes.POSITION];
            positionDataArray.push(positionAccessor.getNormalizedDeinterlacedView(gltf));
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

        const PxScale = new this.PhysX.PxVec3(scale[0], scale[1], scale[2]);
        const PxQuat = new this.PhysX.PxQuat(...scaleAxis);
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

    createShape(
        gltf,
        collider,
        shapeFlags,
        noMeshShape = false,
        scale = vec3.fromValues(1, 1, 1),
        scaleAxis = quat.create()
    ) {
        let geometry = null;
        if (collider?.geometry?.shape !== undefined) {
            if (
                scale[0] !== 1 ||
                scale[1] !== 1 ||
                scale[2] !== 1 ||
                quat.equals(scaleAxis, quat.create()) === false
            ) {
                const simpleShape =
                    gltf.extensions.KHR_implicit_shapes.shapes[collider.geometry.shape];
                geometry = this.generateSimpleShape(simpleShape, scale, scaleAxis);
            } else {
                geometry = this.simpleShapes[collider.geometry.shape];
            }
        } else if (collider?.geometry?.node !== undefined) {
            const node = gltf.nodes[collider.geometry.node];
            if (collider.geometry.convexHull === true || noMeshShape === true) {
                geometry = this.createConvexMeshFromNode(gltf, node, scale, scaleAxis);
            } else {
                geometry = this.createMeshFromNode(gltf, node, scale, scaleAxis);
            }
        }

        const gltfMaterial = collider.physicsMaterial
            ? gltf.extensions.KHR_physics_rigid_bodies.physicsMaterials[collider.physicsMaterial]
            : this.defaultMaterial;

        const physxMaterial = this.physics.createMaterial(
            gltfMaterial.staticFriction,
            gltfMaterial.dynamicFriction,
            gltfMaterial.restitution
        );
        if (gltfMaterial.frictionCombine !== undefined) {
            physxMaterial.setFrictionCombine(this.mapCombineMode(gltfMaterial.frictionCombine));
        }
        if (gltfMaterial.restitutionCombine !== undefined) {
            physxMaterial.setRestitutionCombineMode(
                this.mapCombineMode(gltfMaterial.restitutionCombine)
            );
        }

        const shape = this.physics.createShape(geometry, physxMaterial, true, shapeFlags);

        let word0 = null;
        let word1 = null;
        if (
            collider?.collisionFilter !== undefined &&
            collider.collisionFilter < this.filterData.length - 1
        ) {
            word0 = 1 << collider.collisionFilter;
            word1 = this.filterData[collider.collisionFilter];
        } else {
            // Default filter id is signed bit and all bits set to collide with everything
            word0 = Math.pow(2, 31);
            word1 = Math.pow(2, 32) - 1;
        }

        const additionalFlags = 0;
        const filterData = new this.PhysX.PxFilterData(word0, word1, additionalFlags, 0);

        shape.setSimulationFilterData(filterData);

        return shape;
    }

    createActor(gltf, node, shapeFlags, type, noMeshShapes = false) {
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
                actor.setAngularVelocity(angularVelocity);
                this.PhysX.destroy(angularVelocity);

                const gltfLinearVelocity = motion?.linearVelocity;
                const linearVelocity = new this.PhysX.PxVec3(...gltfLinearVelocity);
                actor.setLinearVelocity(linearVelocity);
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
                    //TODO Apply custom gravity in simulation step
                }
            }
        }

        const recurseShapes = (
            gltf,
            node,
            shapeFlags,
            shapeTransform,
            offsetTransform,
            origin = false
        ) => {
            // Do not add other motion bodies' shapes to this actor
            if (node.extensions?.KHR_physics_rigid_bodies?.motion !== undefined && !origin) {
                return;
            }
            const scalingTransform = mat4.create();
            mat4.fromScaling(scalingTransform, node.scale);
            mat4.multiply(scalingTransform, shapeTransform, scalingTransform);

            const computedOffset = mat4.create();
            mat4.multiply(computedOffset, offsetTransform, node.getLocalTransform());

            if (node.extensions?.KHR_physics_rigid_bodies?.collider !== undefined) {
                const shape = this.createShape(
                    gltf,
                    node.extensions.KHR_physics_rigid_bodies.collider,
                    shapeFlags,
                    noMeshShapes
                    //scalingTransform
                );

                const translation = vec3.create();
                const rotation = quat.create();
                mat4.getTranslation(translation, offsetTransform);
                mat4.getRotation(rotation, offsetTransform);

                const PxPos = new this.PhysX.PxVec3(...translation);
                const PxRotation = new this.PhysX.PxQuat(...rotation);
                const pose = new this.PhysX.PxTransform(PxPos, PxRotation);
                shape.setLocalPose(pose);

                actor.attachShape(shape);
                this.PhysX.destroy(PxPos);
                this.PhysX.destroy(PxRotation);
                this.PhysX.destroy(pose);
            }

            for (const childIndex of node.children) {
                const childNode = gltf.nodes[childIndex];
                recurseShapes(gltf, childNode, shapeFlags, scalingTransform, computedOffset);
            }
        };

        recurseShapes(gltf, node, shapeFlags, worldTransform, mat4.create(), true);

        this.PhysX.destroy(pos);
        this.PhysX.destroy(rotation);
        this.PhysX.destroy(pose);

        this.scene.addActor(actor);
        this.nodeToActor.set(node.gltfObjectIndex, actor);
    }

    initializeSimulation(
        state,
        staticActors,
        kinematicActors,
        dynamicActors,
        hasRuntimeAnimationTargets,
        meshColliderCount
    ) {
        if (!this.PhysX) {
            return;
        }
        if (this.scene) {
            this.stopSimulation();
        }
        this.generateSimpleShapes(state.gltf);
        this.computeFilterData(state.gltf);

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

        for (const node of staticActors) {
            this.createActor(state.gltf, node, shapeFlags, "static");
        }
        for (const node of kinematicActors) {
            this.createActor(state.gltf, node, shapeFlags, "kinematic");
        }
        for (const node of dynamicActors) {
            this.createActor(state.gltf, node, shapeFlags, "dynamic", meshColliderCount > 1);
        }

        this.PhysX.destroy(tmpVec);
        this.PhysX.destroy(sceneDesc);
        this.PhysX.destroy(shapeFlags);
        this.scene.setVisualizationParameter(this.PhysX.eSCALE, 1);
        this.scene.setVisualizationParameter(this.PhysX.eWORLD_AXES, 1);
        this.scene.setVisualizationParameter(this.PhysX.eACTOR_AXES, 1);
        this.scene.setVisualizationParameter(this.PhysX.eCOLLISION_SHAPES, 1);
    }

    applyTransformRecursively(gltf, node, parentTransform) {
        if (node.extensions?.KHR_physics_rigid_bodies?.motion !== undefined) {
            return;
        }
        const localTransform = node.getLocalTransform();
        const globalTransform = mat4.create();
        mat4.multiply(globalTransform, parentTransform, localTransform);
        node.physicsTransform = globalTransform;
        for (const childIndex of node.children) {
            const childNode = gltf.nodes[childIndex];
            this.applyTransformRecursively(gltf, childNode, globalTransform);
        }
    }

    simulateStep(state, deltaTime) {
        if (!this.scene) {
            return;
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
                node.physicsTransform = mat4.fromRotationTranslation(
                    mat4.create(),
                    rotation,
                    position
                );

                for (const childIndex of node.children) {
                    const childNode = state.gltf.nodes[childIndex];
                    this.applyTransformRecursively(state.gltf, childNode, node.physicsTransform);
                }
            }
        }
    }
    resetSimulation() {
        // Implementation specific to Nvidia physics engine
    }
    stopSimulation() {
        // Implementation specific to Nvidia physics engine
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
