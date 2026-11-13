import { GltfObject } from "./gltf_object";
import * as interactivity from "@khronosgroup/gltf-interactivity-engine";
import { mat4 } from "gl-matrix";
import { recurseAllAnimatedProperties } from "./gltf_utils";
import { gltfNode } from "./node.js";
import { instantiatedDocuments } from "./clone_document.js";

class gltfGraph extends GltfObject {
    static animatedProperties = [];

    constructor() {
        super();
        this.hasHoverEvent = false;
    }

    fromJson(json) {
        super.fromJson(json);
        for (const declaration of json.declarations) {
            if (declaration.op === "event/onHoverIn" || declaration.op === "event/onHoverOut") {
                this.hasHoverEvent = true;
                break;
            }
        }
    }
}

/**
 * A controller for managing KHR_interactivity graphs in a glTF scene.
 */
class GraphController {
    constructor(fps = 60, debug = true) {
        this.fps = fps;
        this.debug = debug;
        this.graphIndex = undefined;
        this.playing = false;
        this.customEvents = [];
        this.eventBus = new interactivity.DOMEventBus();
        this.engine = new interactivity.BasicBehaveEngine(this.fps, this.eventBus);
        this.decorator = new SampleViewerDecorator(this.engine, this.debug);
        this.eventSubscriptions = new Map();
        // One decorator per instantiated external asset that declares its own graphs.
        // Each runs strictly locally: its own engine, event bus and document, with no
        // shared variables or cross-graph events.
        this.subControllers = [];
    }

    // The decorator that owns the given document, or undefined when no graph runs there.
    decoratorFor(document) {
        if (document === undefined || document === this.state?.gltf) {
            return this.decorator;
        }
        for (const sub of this.subControllers) {
            if (sub.document === document) {
                return sub.decorator;
            }
        }
        return undefined;
    }

    // True when a graph runs in the root document or in any instantiated external
    // asset, so the controller keeps ticking even when the root document declares
    // no interactivity of its own (e.g. a wrapper that only instantiates it).
    hasGraphs() {
        return this.graphIndex !== undefined || this.subControllers.length > 0;
    }

    needsHover() {
        if (!this.hasGraphs() || !this.playing) {
            return false;
        }
        if (
            this.state?.renderingParameters?.enabledExtensions?.KHR_interactivity !== true ||
            this.state?.renderingParameters?.enabledExtensions?.KHR_node_hoverability !== true
        ) {
            return false;
        }
        if (
            this.state?.gltf?.extensions?.KHR_interactivity?.graphs[this.graphIndex]
                ?.hasHoverEvent === true
        ) {
            return true;
        }
        return this.subControllers.some(
            (sub) =>
                sub.document.extensions?.KHR_interactivity?.graphs[sub.graphIndex]
                    ?.hasHoverEvent === true
        );
    }

    receiveSelection(pickingResult) {
        const node = pickingResult?.node;
        if (!this.hasGraphs() || node === undefined) {
            return;
        }
        this.decoratorFor(node.ownerDocument)?.receiveSelection(pickingResult);
    }

    receiveHover(pickingResult) {
        const node = pickingResult?.node;
        if (!this.hasGraphs() || node === undefined) {
            return;
        }
        this.decoratorFor(node.ownerDocument)?.receiveHover(pickingResult);
    }

    rigidBodyTriggerEntered(triggerNode, colliderNode, motionNode) {
        if (!this.hasGraphs() || triggerNode === undefined) {
            return;
        }
        this.decoratorFor(triggerNode.ownerDocument)?.rigidBodyTriggerEntered(
            triggerNode.gltfObjectIndex,
            colliderNode?.gltfObjectIndex ?? -1,
            motionNode?.gltfObjectIndex ?? -1
        );
    }

    rigidBodyTriggerExited(triggerNode, colliderNode, motionNode) {
        if (!this.hasGraphs() || triggerNode === undefined) {
            return;
        }
        this.decoratorFor(triggerNode.ownerDocument)?.rigidBodyTriggerExited(
            triggerNode.gltfObjectIndex,
            colliderNode?.gltfObjectIndex ?? -1,
            motionNode?.gltfObjectIndex ?? -1
        );
    }

    /**
     * Initialize the graph controller with the given state.
     * This needs to be called every time a glTF assets is loaded.
     * @param {GltfState} state - The state of the application.
     */
    initializeGraphs(state) {
        this.decorator.pauseEventQueue();
        this.engine.clearEventList();
        this.engine.clearPointerInterpolation();
        this.engine.clearVariableInterpolation();
        this.engine.clearScheduledDelays();
        this.engine.clearValueEvaluationCache();
        this.state = state;
        this.playing = false;
        this.graphIndex = undefined;
        this.eventBus = new interactivity.DOMEventBus();
        this.engine = new interactivity.BasicBehaveEngine(this.fps, this.eventBus);
        this.decorator = new SampleViewerDecorator(this.engine, this.debug);
        this.decorator.setState(state);
        for (const [eventName, callback] of this.eventSubscriptions) {
            this.decorator.addCustomEventListener(eventName, callback);
        }

        // Spin up a strictly-local decorator for every instantiated external asset that
        // declares its own interactivity graphs.
        this.subControllers = [];
        for (const document of instantiatedDocuments(state.gltf)) {
            if (document.extensions?.KHR_interactivity?.graphs === undefined) {
                continue;
            }
            this.subControllers.push(createSubController(state, document));
        }
    }

    /**
     * Loads the specified graph. Resets the engine. Starts playing if this.playing is true.
     * @param {number} graphIndex
     * @return {Array} An array of custom events defined in the graph.
     */
    loadGraph(graphIndex) {
        this.decorator.resetGraph();
        try {
            this.customEvents = this.decorator.loadGraph(graphIndex);
            this.graphIndex = graphIndex;
        } catch (error) {
            console.error("Error loading graph:", error);
        }
        return this.customEvents;
    }

    /**
     * Stops the graph engine.
     */
    stopGraphEngine() {
        if (!this.hasGraphs()) {
            return;
        }
        this.graphIndex = undefined;
        this.playing = false;
        this.decorator.pauseEventQueue();
        this.decorator.resetGraph();
        for (const sub of this.subControllers) {
            sub.decorator.pauseEventQueue();
            sub.decorator.resetGraph();
        }
    }

    /**
     * Pauses the currently playing graph.
     */
    pauseGraph() {
        if (!this.hasGraphs() || !this.playing) {
            return;
        }
        this.decorator.pauseEventQueue();
        this.playing = false;
        for (const sub of this.subControllers) {
            sub.decorator.pauseEventQueue();
        }
    }

    /**
     * Resumes the currently paused graph.
     */
    resumeGraph() {
        if (!this.hasGraphs() || this.playing) {
            return;
        }
        this.playing = true;
        this.decorator.playEventQueue();
        for (const sub of this.subControllers) {
            sub.decorator.playEventQueue();
        }
    }

    /**
     * Resets the current graph.
     */
    resetGraph() {
        if (!this.hasGraphs()) {
            return;
        }
        if (this.graphIndex !== undefined) {
            this.loadGraph(this.graphIndex);
        }
        for (const sub of this.subControllers) {
            sub.decorator.resetGraph();
            sub.decorator.loadGraph(sub.graphIndex);
        }
    }

    simulateTick() {
        if (!this.hasGraphs()) {
            return;
        }
        this.decorator.executeEventQueueTick();
        for (const sub of this.subControllers) {
            sub.decorator.executeEventQueueTick();
        }
    }

    /**
     * Dispatches an event to the behavior engine.
     * @param {string} eventName
     * @param {*} data
     */
    dispatchEvent(eventName, data) {
        if (this.graphIndex !== undefined) {
            const dataCopy = JSON.parse(JSON.stringify(data));
            this.decorator.dispatchCustomEvent(eventName, dataCopy);
        }
    }

    /**
     * Adds a custom event listener to the decorator.
     * Khronos test assets use test/onStart, test/onFail and test/onSuccess.
     * @param {string} eventName
     * @param {function(CustomEvent)} callback
     */
    addCustomEventListener(eventName, callback) {
        this.eventSubscriptions.set(eventName, callback);
        this.decorator.addCustomEventListener(eventName, callback);
    }

    /**
     * Clears all custom event listeners from the decorator.
     */
    clearCustomEventListeners() {
        this.eventSubscriptions.clear();
        this.decorator.clearCustomEventListeners();
    }
}

class SampleViewerDecorator extends interactivity.ADecorator {
    constructor(behaveEngine, debug = false) {
        super(behaveEngine);
        this.behaveEngine = behaveEngine;
        this.world = undefined;
        this.lastHoverNodeIndex = undefined;
        this.nodeWeightPointers = new Map();
        const resolveJsonPtr = this.behaveEngine.resolveJsonPtr;
        this.behaveEngine.resolveJsonPtr = (path) => {
            if (/^\/nodes\/[^/]+\/weights(?:\/|\.|$)/.test(path)) {
                return this.nodeWeightPointers.get(path);
            }
            return resolveJsonPtr(path);
        };

        if (debug) {
            this.behaveEngine.processNodeStarted = this.processNodeStarted;
            this.behaveEngine.processAddingNodeToQueue = this.processAddingNodeToQueue;
            this.behaveEngine.processExecutingNextNode = this.processExecutingNextNode;
        }
        this.behaveEngine.getWorld = this.getWorld;
        this.behaveEngine.stopAnimation = this.stopAnimation;
        this.behaveEngine.stopAnimationAt = this.stopAnimationAt;
        this.behaveEngine.startAnimation = this.startAnimation;
        this.behaveEngine.getParentNodeIndex = this.getParentNodeIndex;

        this.behaveEngine.applyImpulseToRigidBody = this.applyImpulseToRigidBody;
        this.behaveEngine.applyPointImpulseToRigidBody = this.applyPointImpulseToRigidBody;
        this.behaveEngine.rayCastRigidBodies = this.rayCastRigidBodies;

        this.registerRigidBodyNodes();
    }

    dispatchCustomEvent(eventName, data) {
        // KHR_INTERACTIVITY prefix is used in the interactivity engine
        this.behaveEngine.dispatchCustomEvent(`KHR_INTERACTIVITY:${eventName}`, data);
    }

    addCustomEventListener(eventName, callback) {
        // KHR_INTERACTIVITY prefix is used in the interactivity engine
        this.behaveEngine.addCustomEventListener(`KHR_INTERACTIVITY:${eventName}`, callback);
    }

    convertArrayToMatrix(array, width) {
        const matrix = [];
        for (let i = 0; i < array.length; i += width) {
            matrix.push(array.slice(i, i + width));
        }
        return matrix;
    }

    setState(state) {
        this.resetGraph();
        this.world = state;
        this.behaveEngine.world = state;
        this.registerKnownPointers();
    }

    receiveSelection(pickingResult) {
        if (pickingResult.node) {
            this.select(
                pickingResult.node?.gltfObjectIndex,
                pickingResult.controller,
                pickingResult.position,
                pickingResult.rayOrigin
            );
        }
    }

    receiveHover(pickingResult) {
        this.hoverOn(pickingResult.node?.gltfObjectIndex, pickingResult.controller);
    }

    getParentNodeIndex(nodeIndex) {
        if (this.world === undefined || this.world.gltf === undefined) {
            return undefined;
        }
        const node = this.world.gltf.nodes[nodeIndex];
        if (node === undefined || node.parentNode === undefined) {
            return undefined;
        }
        return node.parentNode.gltfObjectIndex;
    }

    loadGraph(graphIndex) {
        const graphArray = this.world?.gltf?.extensions?.KHR_interactivity?.graphs;
        if (graphArray && graphArray.length > graphIndex) {
            const graphCopy = JSON.parse(JSON.stringify(graphArray[graphIndex]));
            let events = graphCopy.events ?? [];
            events = events.filter((event) => event.id !== undefined);
            events = JSON.parse(JSON.stringify(events)); // Deep copy to avoid mutation
            for (const event of events) {
                if (event.values !== undefined) {
                    for (const value of Object.values(event.values)) {
                        value.type = graphCopy.types[value.type].signature;
                    }
                }
            }
            this.behaveEngine.loadBehaveGraph(graphCopy, false);
            return events;
        }
        throw new Error(`Graph with index ${graphIndex} does not exist.`);
    }

    resetGraph() {
        this.pauseEventQueue();
        // Clearing the engine must not pass an empty-but-shaped graph: the engine rejects
        // graphs whose arrays are present yet empty (schema minItems: 1). An empty object
        // is valid and resets nodes/variables/events/types/declarations to nothing.
        this.behaveEngine.loadBehaveGraph({});
        if (this.world === undefined) {
            return;
        }
        for (const animation of this.world.gltf.animations) {
            animation.reset();
        }

        this.behaveEngine.clearEventList();
        this.behaveEngine.clearPointerInterpolation();
        this.behaveEngine.clearVariableInterpolation();
        this.behaveEngine.clearScheduledDelays();
        this.behaveEngine.clearValueEvaluationCache();

        this.world.gltf.resetAnimatedProperties(this.world.sceneIndex ?? -1);
    }

    processNodeStarted(_node) {
        // console.log("Node started:", node);
    }

    processAddingNodeToQueue(_flow) {
        // console.log("Adding node to queue:", flow);
    }

    processExecutingNextNode(_flow) {
        // console.log("Executing next node:", flow);
    }

    getTypeFromValue(value) {
        if (typeof value === "number") {
            return "float";
        }
        if (typeof value === "boolean") {
            return "bool";
        }
        if (value.length === 2) {
            return "float2";
        }
        if (value.length === 3) {
            return "float3";
        }
        if (value.length === 4) {
            return "float4";
        }
        if (value.length === 16) {
            return "float4x4";
        }
        return undefined;
    }

    getDefaultValueFromType(type) {
        switch (type) {
            case "int":
                return 0;
            case "float":
                return NaN;
            case "bool":
                return false;
            case "float2":
                return [NaN, NaN];
            case "float3":
                return [NaN, NaN, NaN];
            case "float4":
            case "float2x2":
                return [NaN, NaN, NaN, NaN];
            case "float3x3":
                // prettier-ignore
                return [
                    NaN, NaN, NaN, 
                    NaN, NaN, NaN, 
                    NaN, NaN, NaN];
            case "float4x4":
                // prettier-ignore
                return [
                    NaN, NaN, NaN, NaN,
                    NaN, NaN, NaN, NaN,
                    NaN, NaN, NaN, NaN,
                    NaN, NaN, NaN, NaN
                ];
        }
        return undefined;
    }

    traversePath(path, type, value = undefined) {
        const pathPieces = path.split("/");
        pathPieces.shift(); // Remove first empty piece from split
        const lastPiece = pathPieces[pathPieces.length - 1];
        if (value !== undefined) {
            pathPieces.pop();
        }
        let currentNode = this.world.gltf;

        for (let i = 0; i < pathPieces.length; i++) {
            if (Array.isArray(currentNode)) {
                const index = parseInt(pathPieces[i]);
                if (isNaN(index) || index < 0 || index >= currentNode.length) {
                    return undefined; // Invalid index
                }
                currentNode = currentNode[index];
                continue;
            }
            const pathPiece = pathPieces[i];
            if (currentNode[pathPiece] !== undefined) {
                currentNode = currentNode[pathPiece];
            } else {
                return undefined;
            }
        }
        if (
            type === "float2" ||
            type === "float3" ||
            type === "float4" ||
            type === "float2x2" ||
            type === "float3x3" ||
            type === "float4x4"
        ) {
            if (value !== undefined) {
                value = value.slice(0); //clone array
            } else {
                currentNode = currentNode.slice(0); //clone array
            }
        }

        if (value !== undefined) {
            currentNode.animatedPropertyObjects[lastPiece].animate(value);
        }
        return currentNode;
    }

    registerKnownPointers() {
        // The engine is checking if a path is valid so we do not need to handle this here
        if (this.world === undefined) {
            return;
        }
        const registerFunction = (currentPath, propertyName, parent, readOnly) => {
            if (parent instanceof gltfNode && propertyName === "weights") {
                return;
            }
            let jsonPtr = currentPath + "/" + propertyName;
            let type = this.getTypeFromValue(parent[propertyName]);
            if (readOnly) {
                if (type === "float") {
                    // All read-only number properties are currently integers
                    type = "int";
                }

                // If the property is an array, read-only pointers return the length of the array
                if (Array.isArray(parent[propertyName])) {
                    jsonPtr += ".length";
                    type = "int";
                    this.registerJsonPointer(
                        jsonPtr,
                        (path) => {
                            const fixedPath = path.slice(0, -7); // Remove ".length"
                            const result = this.traversePath(fixedPath, type);
                            if (result === undefined) {
                                return [0];
                            }
                            return [result.length];
                        },
                        (_path, _value) => {},
                        type,
                        true
                    );
                    return;
                }

                this.registerJsonPointer(
                    jsonPtr,
                    (path) => {
                        let result = this.traversePath(path, type);
                        if (result === undefined) {
                            result = this.getDefaultValueFromType(type);
                        }
                        if (type === "bool" || type === "int" || type === "float") {
                            result = [result];
                        }
                        return result;
                    },
                    (_path, _value) => {},
                    type,
                    true
                );
                return;
            }

            if (type === undefined) {
                return;
            }

            // Register getter and setter for the property
            this.registerJsonPointer(
                jsonPtr,
                (path) => {
                    let result = this.traversePath(path, type);
                    if (result === undefined) {
                        result = this.getDefaultValueFromType(type);
                    }
                    if (type === "bool" || type === "int" || type === "float") {
                        result = [result];
                    }
                    return result;
                },
                (path, value) => {
                    this.traversePath(path, type, value);
                },
                type,
                false
            );
        };
        recurseAllAnimatedProperties(this.world.gltf, registerFunction);
        this.registerNodeWeightPointers();

        // Special pointers that need to be handled manually

        this.registerJsonPointer(
            `/extensions/KHR_lights_punctual/lights.length`,
            (_path) => {
                const lights = this.world.gltf.extensions?.KHR_lights_punctual?.lights;
                if (lights === undefined) {
                    return [0];
                }
                return [lights.length];
            },
            (_path, _value) => {},
            "int",
            true
        );

        // Shapes moved from KHR_implicit_shapes to the core `shapes` array in glTF 2.1.
        // Both pointers resolve to the same array so existing graphs keep working.
        for (const pointer of [`/shapes.length`, `/extensions/KHR_implicit_shapes/shapes.length`]) {
            this.registerJsonPointer(
                pointer,
                (_path) => [this.world.gltf.shapes?.length ?? 0],
                (_path, _value) => {},
                "int",
                true
            );
        }

        this.registerJsonPointer(
            `/materials.length`,
            (_path) => {
                // Return the number of materials excluding the default material
                return [this.world.gltf.materials.length - 1];
            },
            (_path, _value) => {},
            "int",
            true
        );

        const nodeCount = this.world.gltf.nodes.length;
        const meshCount = this.world.gltf.meshes.length;
        const primitiveCount = Math.max(
            ...this.world.gltf.meshes.map((mesh) => mesh.primitives.length)
        );

        // Returns the currently computed global matrix of the node
        this.registerJsonPointer(
            `/nodes/${nodeCount}/globalMatrix`,
            (path) => {
                const pathParts = path.split("/");
                const nodeIndex = parseInt(pathParts[2]);
                const node = this.world.gltf.nodes[nodeIndex];
                node.scene.applyTransformHierarchy(this.world.gltf);
                return node.getRenderedWorldTransform().slice(0);
            },
            (_path, _value) => {},
            "float4x4",
            true
        );

        // Returns the currently computed local matrix of the node
        this.registerJsonPointer(
            `/nodes/${nodeCount}/matrix`,
            (path) => {
                const pathParts = path.split("/");
                const nodeIndex = parseInt(pathParts[2]);
                const node = this.world.gltf.nodes[nodeIndex];
                if (!node.scaledPhysicsTransform) {
                    return node.getLocalTransform();
                }
                node.scene.applyTransformHierarchy(this.world.gltf);
                const parentTransform = node.parentNode
                    ? node.parentNode.getRenderedWorldTransform()
                    : mat4.create();
                const parentInverse = mat4.create();
                mat4.invert(parentInverse, parentTransform);
                const localTransform = mat4.create();
                mat4.multiply(localTransform, parentInverse, node.getRenderedWorldTransform());
                return localTransform;
            },
            (_path, _value) => {},
            "float4x4",
            true
        );

        // Returns the parent node of the node
        this.registerJsonPointer(
            `/nodes/${nodeCount}/parent`,
            (path) => {
                const pathParts = path.split("/");
                const nodeIndex = parseInt(pathParts[2]);
                const node = this.world.gltf.nodes[nodeIndex];
                const index = node.parentNode?.gltfObjectIndex;
                if (index === undefined) {
                    return [undefined];
                }
                return [`/nodes/${index}`];
            },
            (_path, _value) => {},
            "ref",
            true
        );

        // Returns the child node of the node
        this.registerJsonPointer(
            `/nodes/${nodeCount}/children.length`,
            (path) => {
                const pathParts = path.split("/");
                const nodeIndex = parseInt(pathParts[2]);
                const node = this.world.gltf.nodes[nodeIndex];
                return [node.children?.length ?? 0];
            },
            (_path, _value) => {},
            "int",
            true
        );

        this.registerJsonPointer(
            `/nodes/${nodeCount}/children/${nodeCount}`,
            (path) => {
                const pathParts = path.split("/");
                const nodeIndex = parseInt(pathParts[2]);
                const childIndex = parseInt(pathParts[4]);
                const node = this.world.gltf.nodes[nodeIndex];
                const childNodeIndex = node.children?.[childIndex];
                if (childNodeIndex >= this.world.gltf.nodes.length) {
                    return [undefined];
                }
                return [`/nodes/${childNodeIndex}`];
            },
            (_path, _value) => {},
            "ref",
            true
        );

        this.registerJsonPointer(
            `/nodes/${nodeCount}/camera`,
            (path) => {
                const pathParts = path.split("/");
                const nodeIndex = parseInt(pathParts[2]);
                const node = this.world.gltf.nodes[nodeIndex];
                const cameraIndex = node.camera;
                if (cameraIndex === undefined) {
                    return [undefined];
                }
                return [`/cameras/${cameraIndex}`];
            },
            (_path, _value) => {},
            "ref",
            true
        );

        this.registerJsonPointer(
            `/nodes/${nodeCount}/mesh`,
            (path) => {
                const pathParts = path.split("/");
                const nodeIndex = parseInt(pathParts[2]);
                const node = this.world.gltf.nodes[nodeIndex];
                const meshIndex = node.mesh;
                if (meshIndex === undefined) {
                    return [undefined];
                }
                return [`/meshes/${meshIndex}`];
            },
            (_path, _value) => {},
            "ref",
            true
        );

        this.registerJsonPointer(
            `/nodes/${nodeCount}/skin`,
            (path) => {
                const pathParts = path.split("/");
                const nodeIndex = parseInt(pathParts[2]);
                const node = this.world.gltf.nodes[nodeIndex];
                const skinIndex = node.skin;
                if (skinIndex === undefined) {
                    return [undefined];
                }
                return [`/skins/${skinIndex}`];
            },
            (_path, _value) => {},
            "ref",
            true
        );

        // Returns the child node of the node
        this.registerJsonPointer(
            `/meshes/${meshCount}/primitives/${primitiveCount}/material`,
            (path) => {
                const pathParts = path.split("/");
                const meshIndex = parseInt(pathParts[2]);
                const primitiveIndex = parseInt(pathParts[4]);
                const mesh = this.world.gltf.meshes[meshIndex];
                if (
                    mesh === undefined ||
                    mesh.primitives === undefined ||
                    primitiveIndex >= mesh.primitives.length
                ) {
                    return [undefined];
                }
                const materialIndex = mesh.primitives[primitiveIndex].material;
                return [`/materials/${materialIndex}`];
            },
            (_path, _value) => {},
            "ref",
            true
        );

        // Pointer to indices

        this.registerJsonPointer(
            `/nodes/${nodeCount}/extensions/KHR_lights_punctual/light`,
            (path) => {
                return [this.traversePath(path, "ref")];
            },
            (_path, _value) => {},
            "ref",
            true
        );

        const sceneCount = this.world.gltf.scenes.length;
        this.registerJsonPointer(
            `/scenes/${sceneCount}/nodes/${nodeCount}`,
            (path) => {
                const pathParts = path.split("/");
                const sceneIndex = parseInt(pathParts[2]);
                const nodeIndex = parseInt(pathParts[4]);
                const sceneNodeIndex = this.world.gltf.scenes[sceneIndex].nodes[nodeIndex];
                if (sceneNodeIndex === undefined) {
                    return [undefined];
                }
                return [`/nodes/${sceneNodeIndex}`];
            },
            (_path, _value) => {},
            "ref",
            true
        );

        const skinCount = this.world.gltf.skins.length;
        this.registerJsonPointer(
            `/skins/${skinCount}/joints/${nodeCount}`,
            (path) => {
                const pathParts = path.split("/");
                const skinIndex = parseInt(pathParts[2]);
                const jointIndex = parseInt(pathParts[4]);
                const skin = this.world.gltf.skins[skinIndex];
                if (jointIndex < 0 || jointIndex >= skin.joints.length) {
                    return [undefined];
                }
                const jointNodeIndex = skin.joints[jointIndex];
                return [`/nodes/${jointNodeIndex}`];
            },
            (_path, _value) => {},
            "ref",
            true
        );
        this.registerJsonPointer(
            `/skins/${skinCount}/skeleton`,
            (path) => {
                const pathParts = path.split("/");
                const skinIndex = parseInt(pathParts[2]);
                const skin = this.world.gltf.skins[skinIndex];
                const jointNodeIndex = skin.skeleton;
                if (jointNodeIndex === undefined) {
                    return [undefined];
                }
                return [`/nodes/${jointNodeIndex}`];
            },
            (_path, _value) => {},
            "ref",
            true
        );

        // Pointer for animation control

        const animationCount = this.world.gltf.animations.length;
        this.registerJsonPointer(
            `/animations/${animationCount}`,
            (path) => {
                return [path];
            },
            (_path, _value) => {},
            "ref",
            true
        );
        this.registerJsonPointer(
            `/animations/${animationCount}/extensions/KHR_interactivity/isPlaying`,
            (path) => {
                const pathParts = path.split("/");
                const animationIndex = parseInt(pathParts[2]);
                const animation = this.world.gltf.animations[animationIndex];
                return [animation.createdTimestamp !== undefined];
            },
            (_path, _value) => {},
            "bool",
            true
        );
        this.registerJsonPointer(
            `/animations/${animationCount}/extensions/KHR_interactivity/minTime`,
            (path) => {
                const pathParts = path.split("/");
                const animationIndex = parseInt(pathParts[2]);
                const animation = this.world.gltf.animations[animationIndex];
                animation.computeMinMaxTime(this.world.gltf);
                return [animation.minTime];
            },
            (_path, _value) => {},
            "float",
            true
        );
        this.registerJsonPointer(
            `/animations/${animationCount}/extensions/KHR_interactivity/maxTime`,
            (path) => {
                const pathParts = path.split("/");
                const animationIndex = parseInt(pathParts[2]);
                const animation = this.world.gltf.animations[animationIndex];
                animation.computeMinMaxTime(this.world.gltf);
                return [animation.maxTime];
            },
            (_path, _value) => {},
            "float",
            true
        );

        // The playhead returns a number between 0 and maxTime
        this.registerJsonPointer(
            `/animations/${animationCount}/extensions/KHR_interactivity/playhead`,
            (path) => {
                const pathParts = path.split("/");
                const animationIndex = parseInt(pathParts[2]);
                const animation = this.world.gltf.animations[animationIndex];
                if (animation.interpolators.length === 0) {
                    return [NaN];
                }
                return [animation.interpolators[0].prevT];
            },
            (_path, _value) => {},
            "float",
            true
        );

        // The virtual playhead return the current time on the infinite timeline. Can be negative or larger than maxTime
        this.registerJsonPointer(
            `/animations/${animationCount}/extensions/KHR_interactivity/virtualPlayhead`,
            (path) => {
                const pathParts = path.split("/");
                const animationIndex = parseInt(pathParts[2]);
                const animation = this.world.gltf.animations[animationIndex];
                if (animation.interpolators.length === 0) {
                    return [NaN];
                }
                return [animation.interpolators[0].prevRequestedT];
            },
            (_path, _value) => {},
            "float",
            true
        );

        // Pointer for the active camera

        this.registerJsonPointer(
            `/extensions/KHR_interactivity/activeCamera/rotation`,
            (_path) => {
                let activeCamera = this.world.userCamera;
                if (this.world.cameraNodeIndex !== undefined) {
                    if (
                        this.world.cameraNodeIndex < 0 ||
                        this.world.cameraNodeIndex >= this.world.gltf.nodes.length
                    ) {
                        return [NaN, NaN, NaN, NaN];
                    }
                    const cameraIndex = this.world.gltf.nodes[this.world.cameraNodeIndex].camera;
                    if (cameraIndex === undefined) {
                        return [NaN, NaN, NaN, NaN];
                    }
                    activeCamera = this.world.gltf.cameras[cameraIndex];
                    activeCamera.setNode(this.world.gltf, this.world.cameraNodeIndex);
                }
                return activeCamera.getRotation(this.world.gltf).slice(0);
            },
            (_path, _value) => {
                //no-op
            },
            "float4",
            true
        );

        this.registerJsonPointer(
            `/extensions/KHR_interactivity/activeCamera/position`,
            (_path) => {
                let activeCamera = this.world.userCamera;
                if (this.world.cameraNodeIndex !== undefined) {
                    if (
                        this.world.cameraNodeIndex < 0 ||
                        this.world.cameraNodeIndex >= this.world.gltf.nodes.length
                    ) {
                        return [NaN, NaN, NaN];
                    }
                    const cameraIndex = this.world.gltf.nodes[this.world.cameraNodeIndex].camera;
                    if (cameraIndex === undefined) {
                        return [NaN, NaN, NaN];
                    }
                    activeCamera = this.world.gltf.cameras[cameraIndex];
                    activeCamera.setNode(this.world.gltf, this.world.cameraNodeIndex);
                }
                return activeCamera.getPosition(this.world.gltf).slice(0);
            },
            (_path, _value) => {
                //no-op
            },
            "float3",
            true
        );
    }

    registerNodeWeightPointers() {
        this.nodeWeightPointers.clear();
        for (const node of this.world.gltf.nodes) {
            const mesh = this.world.gltf.meshes[node.mesh];
            if (mesh === undefined) {
                continue;
            }
            const targetCount = mesh.primitives[0]?.targets?.length ?? 0;
            const path = `/nodes/${node.gltfObjectIndex}/weights`;
            this.nodeWeightPointers.set(`${path}.length`, {
                typeName: "int",
                readOnly: true,
                getValue: () => [targetCount],
                setValue: () => {}
            });
            if (targetCount === 0) {
                continue;
            }
            node.weights = Array.from(
                node.weights ?? mesh.weights ?? new Array(targetCount).fill(0)
            );
            const property = node.animatedPropertyObjects.weights;
            this.nodeWeightPointers.set(path, {
                typeName: "float[]",
                readOnly: false,
                getValue: () => Array.from(node.weights),
                setValue: (_path, value) => property.animate(Array.from(value))
            });
            for (let index = 0; index < targetCount; index++) {
                this.nodeWeightPointers.set(`${path}/${index}`, {
                    typeName: "float",
                    readOnly: false,
                    getValue: () => [node.weights[index]],
                    setValue: (_path, value) => {
                        const weights = Array.from(node.weights);
                        weights[index] = typeof value === "number" ? value : value[0];
                        property.animate(weights);
                    }
                });
            }
        }
    }

    registerJsonPointer(jsonPtr, getterCallback, setterCallback, typeName, readOnly) {
        this.behaveEngine.registerJsonPointer(
            jsonPtr,
            getterCallback,
            setterCallback,
            typeName,
            readOnly
        );
    }

    getWorld() {
        return this.world?.gltf;
    }

    stopAnimation(animationIndex) {
        const animation = this.world.gltf.animations[animationIndex];
        animation.reset();
    }

    stopAnimationAt(animationIndex, stopTime, callback) {
        const animation = this.world.gltf.animations[animationIndex];
        if (animation.createdTimestamp === undefined) {
            return;
        }
        animation.stopTime = stopTime;
        animation.stopCallback = callback;
    }

    startAnimation(animationIndex, startTime, endTime, speed, callback) {
        const animation = this.world.gltf.animations[animationIndex];
        animation.createdTimestamp = undefined;
        animation.startTime = startTime;
        animation.endTime = endTime;
        animation.speed = speed;
        animation.endCallback = callback;
        animation.createdTimestamp = this.world.animationTimer.elapsedSec();
    }

    rayCastRigidBodies(rayStart, rayEnd) {
        const result = this.world.physicsController.rayCast(rayStart, rayEnd);
        // The physics engine keys actors by node object; the graph addresses nodes by
        // their index within this document, so translate the hit node back.
        if (result?.hitNodeIndex?.gltfObjectIndex !== undefined) {
            result.hitNodeIndex = result.hitNodeIndex.gltfObjectIndex;
        }
        return result;
    }

    applyImpulseToRigidBody(nodeIndex, linearImpulse, angularImpulse) {
        const node = this.world.gltf.nodes[nodeIndex];
        if (node !== undefined) {
            this.world.physicsController.applyImpulse(node, linearImpulse, angularImpulse);
        }
    }

    applyPointImpulseToRigidBody(nodeIndex, impulse, position) {
        const node = this.world.gltf.nodes[nodeIndex];
        if (node !== undefined) {
            this.world.physicsController.applyPointImpulse(node, impulse, position);
        }
    }
}

// A decorator plus engine for one instantiated external asset, rooted at that document
// so its JSON pointers and animated properties resolve strictly locally. Shares the
// viewer's camera, animation timer and physics controller, but keeps its own engine,
// event bus and document so there is no cross-graph event or variable sharing.
function createSubController(state, document) {
    const eventBus = new interactivity.DOMEventBus();
    const engine = new interactivity.BasicBehaveEngine(60, eventBus);
    const decorator = new SampleViewerDecorator(engine, false);
    decorator.setState({
        gltf: document,
        sceneIndex: document.scene ?? 0,
        userCamera: state.userCamera,
        cameraNodeIndex: undefined,
        animationTimer: state.animationTimer,
        physicsController: state.physicsController
    });
    const graphIndex = document.extensions.KHR_interactivity.graph ?? 0;
    decorator.loadGraph(graphIndex);
    return { decorator, engine, graphIndex, document };
}

export { gltfGraph, GraphController };
