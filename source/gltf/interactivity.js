import { GltfObject } from "./gltf_object";
import * as interactivity from "@khronosgroup/gltf-interactivity-sample-engine";
import { mat4 } from "gl-matrix";

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
    constructor(fps = 60, debug = false) {
        this.fps = fps;
        this.debug = debug;
        this.graphIndex = undefined;
        this.playing = false;
        this.customEvents = [];
        this.eventBus = new interactivity.DOMEventBus();
        this.engine = new interactivity.BasicBehaveEngine(this.fps, this.eventBus);
        this.decorator = new SampleViewerDecorator(this.engine, this.debug);
        this.eventSubscriptions = new Map();
    }

    needsHover() {
        if (this.graphIndex === undefined || !this.playing) {
            return false;
        }
        if (
            this.state?.renderingParameters?.enabledExtensions?.KHR_interactivity !== true ||
            this.state?.renderingParameters?.enabledExtensions?.KHR_node_hoverability !== true
        ) {
            return false;
        }
        return (
            this.state?.gltf?.extensions?.KHR_interactivity?.graphs[this.graphIndex]
                ?.hasHoverEvent === true
        );
    }

    receiveSelection(pickingResult) {
        if (this.graphIndex !== undefined) {
            this.decorator.receiveSelection(pickingResult);
        }
    }

    receiveHover(pickingResult) {
        if (this.graphIndex !== undefined) {
            this.decorator.receiveHover(pickingResult);
        }
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
            if (this.playing) {
                this.decorator.playEventQueue();
            }
        } catch (error) {
            console.error("Error loading graph:", error);
        }
        return this.customEvents;
    }

    /**
     * Stops the graph engine.
     */
    stopGraphEngine() {
        if (this.graphIndex === undefined) {
            return;
        }
        this.graphIndex = undefined;
        this.playing = false;
        this.decorator.pauseEventQueue();
        this.decorator.resetGraph();
    }

    /**
     * Pauses the currently playing graph.
     */
    pauseGraph() {
        if (this.graphIndex === undefined || !this.playing) {
            return;
        }
        this.decorator.pauseEventQueue();
        this.playing = false;
    }

    /**
     * Resumes the currently paused graph.
     */
    resumeGraph() {
        if (this.graphIndex === undefined || this.playing) {
            return;
        }
        this.decorator.playEventQueue();
        this.playing = true;
    }

    /**
     * Resets the current graph.
     */
    resetGraph() {
        if (this.graphIndex === undefined) {
            return;
        }
        this.loadGraph(this.graphIndex);
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

        this.registerBehaveEngineNode("animation/stop", interactivity.AnimationStop);
        this.registerBehaveEngineNode("animation/start", interactivity.AnimationStart);
        this.registerBehaveEngineNode("animation/stopAt", interactivity.AnimationStopAt);

        this.registerBehaveEngineNode("event/onSelect", interactivity.OnSelect);
        this.registerBehaveEngineNode("event/onHoverIn", interactivity.OnHoverIn);
        this.registerBehaveEngineNode("event/onHoverOut", interactivity.OnHoverOut);
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
                for (const value of Object.values(event.values)) {
                    value.type = graphCopy.types[value.type].signature;
                }
            }
            this.behaveEngine.loadBehaveGraph(graphCopy, false);
            return events;
        }
        throw new Error(`Graph with index ${graphIndex} does not exist.`);
    }

    resetGraph() {
        this.pauseEventQueue();
        this.behaveEngine.loadBehaveGraph({
            nodes: [],
            types: [],
            events: [],
            declarations: [],
            variables: []
        });
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

        const resetAnimatedProperty = (path, propertyName, parent, readOnly) => {
            if (readOnly) {
                return;
            }
            parent.animatedPropertyObjects[propertyName].rest();
        };
        this.recurseAllAnimatedProperties(this.world.gltf, resetAnimatedProperty);
    }

    processNodeStarted(node) {
        console.log("Node started:", node);
    }

    processAddingNodeToQueue(flow) {
        console.log("Adding node to queue:", flow);
    }

    processExecutingNextNode(flow) {
        console.log("Executing next node:", flow);
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
                return [NaN, NaN, NaN, NaN];
            case "float2x2":
                return [
                    [NaN, NaN],
                    [NaN, NaN]
                ];
            case "float3x3":
                return [
                    [NaN, NaN, NaN],
                    [NaN, NaN, NaN],
                    [NaN, NaN, NaN]
                ];
            case "float4x4":
                return [
                    [NaN, NaN, NaN, NaN],
                    [NaN, NaN, NaN, NaN],
                    [NaN, NaN, NaN, NaN],
                    [NaN, NaN, NaN, NaN]
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
        if (type === "float2x2" || type === "float3x3" || type === "float4x4") {
            if (value !== undefined) {
                value = value.flat();
            } else {
                const width = parseInt(type.charAt(5));
                // The engine currently uses 2D Arrays for matrices
                currentNode = this.convertArrayToMatrix(currentNode, width);
            }
        } else if (type === "float2" || type === "float3" || type === "float4") {
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

    recurseAllAnimatedProperties(gltfObject, callable, currentPath = "") {
        if (gltfObject === undefined || !(gltfObject instanceof GltfObject)) {
            return;
        }

        // Call for all animated properties of this gltfObject
        for (const property of gltfObject.constructor.animatedProperties) {
            if (gltfObject[property] === undefined) {
                continue;
            }
            callable(currentPath, property, gltfObject, false);
        }

        // Call for all read-only animated properties of this gltfObject
        for (const property of gltfObject.constructor.readOnlyAnimatedProperties) {
            if (gltfObject[property] === undefined) {
                continue;
            }
            callable(currentPath, property, gltfObject, true);
        }

        // Recurse into all GltfObject
        for (const key in gltfObject) {
            if (gltfObject[key] instanceof GltfObject) {
                this.recurseAllAnimatedProperties(
                    gltfObject[key],
                    callable,
                    currentPath + "/" + key
                );
            } else if (Array.isArray(gltfObject[key])) {
                if (gltfObject[key].length === 0 || !(gltfObject[key][0] instanceof GltfObject)) {
                    continue;
                }
                for (let i = 0; i < gltfObject[key].length; i++) {
                    this.recurseAllAnimatedProperties(
                        gltfObject[key][i],
                        callable,
                        currentPath + "/" + key + "/" + i
                    );
                }
            }
        }

        // Recurse into all extensions
        for (const extensionName in gltfObject.extensions) {
            const extension = gltfObject.extensions[extensionName];
            if (extension instanceof GltfObject) {
                this.recurseAllAnimatedProperties(
                    extension,
                    callable,
                    currentPath + "/extensions/" + extensionName
                );
            }
        }
    }

    registerKnownPointers() {
        // The engine is checking if a path is valid so we do not need to handle this here
        if (this.world === undefined) {
            return;
        }
        const registerFunction = (currentPath, propertyName, parent, readOnly) => {
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
        this.recurseAllAnimatedProperties(this.world.gltf, registerFunction);

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

        this.registerJsonPointer(
            `/extensions/KHR_implicit_shapes/shapes.length`,
            (_path) => {
                const shapes = this.world.gltf.extensions?.KHR_implicit_shapes?.shapes;
                if (shapes === undefined) {
                    return [0];
                }
                return [shapes.length];
            },
            (_path, _value) => {},
            "int",
            true
        );

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
        this.registerJsonPointer(
            `/nodes/${nodeCount}/children/${nodeCount}`,
            (path) => {
                return [this.traversePath(path, "int")];
            },
            (_path, _value) => {},
            "int",
            true
        );

        // Returns the currently computed global matrix of the node
        this.registerJsonPointer(
            `/nodes/${nodeCount}/globalMatrix`,
            (path) => {
                const pathParts = path.split("/");
                const nodeIndex = parseInt(pathParts[2]);
                const node = this.world.gltf.nodes[nodeIndex];
                node.scene.applyTransformHierarchy(this.world.gltf);
                return this.convertArrayToMatrix(node.getRenderedWorldTransform(), 4); // gl-matrix uses column-major order
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
                if (!node.physicsTransform) {
                    return this.convertArrayToMatrix(node.getLocalTransform(), 4); // gl-matrix uses column-major order
                }
                node.scene.applyTransformHierarchy(this.world.gltf);
                const parentTransform = node.parentNode
                    ? node.parentNode.getRenderedWorldTransform()
                    : mat4.create();
                const parentInverse = mat4.create();
                mat4.invert(parentInverse, parentTransform);
                const localTransform = mat4.create();
                mat4.multiply(localTransform, parentInverse, node.getRenderedWorldTransform());
                return this.convertArrayToMatrix(localTransform, 4); // gl-matrix uses column-major order
            },
            (_path, _value) => {},
            "float4x4",
            true
        );

        // Returns the parent node index of the node
        this.registerJsonPointer(
            `/nodes/${nodeCount}/parent`,
            (path) => {
                const pathParts = path.split("/");
                const nodeIndex = parseInt(pathParts[2]);
                const node = this.world.gltf.nodes[nodeIndex];
                return [node.parentNode?.gltfObjectIndex];
            },
            (_path, _value) => {},
            "int",
            true
        );

        // Pointer to indices

        this.registerJsonPointer(
            `/nodes/${nodeCount}/extensions/KHR_lights_punctual/light`,
            (path) => {
                return [this.traversePath(path, "int")];
            },
            (_path, _value) => {},
            "int",
            true
        );

        const sceneCount = this.world.gltf.scenes.length;
        this.registerJsonPointer(
            `/scenes/${sceneCount}/nodes/${nodeCount}`,
            (path) => {
                return [this.traversePath(path, "int")];
            },
            (_path, _value) => {},
            "int",
            true
        );

        const skinCount = this.world.gltf.skins.length;
        this.registerJsonPointer(
            `/skins/${skinCount}/joints/${nodeCount}`,
            (path) => {
                return [this.traversePath(path, "int")];
            },
            (_path, _value) => {},
            "int",
            true
        );

        // Pointer for animation control

        const animationCount = this.world.gltf.animations.length;
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
                animation.computeMinMaxTime();
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
                animation.computeMinMaxTime();
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
                }
                return activeCamera.getRotation().slice(0);
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
                }
                return activeCamera.getPosition().slice(0);
            },
            (_path, _value) => {
                //no-op
            },
            "float3",
            true
        );
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
}

export { gltfGraph, GraphController };
