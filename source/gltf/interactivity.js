import { GltfObject } from "./gltf_object";
import * as interactivity from "@khronosgroup/khr_interactivity_authoring_engine";

class gltfGraph extends GltfObject {
    static animatedProperties = [];

    constructor() {
        super();
    }
}

/**
 * A controller for managing KHR_interactivity graphs in a glTF scene.
 */
class GraphController {
    constructor(fps = 60, debug = false) {
        this.fps = fps;
        this.graphIndex = undefined;
        this.playing = false;
        this.reset = false;
        this.customEvents = [];
        this.eventBus = new interactivity.DOMEventBus();
        this.engine = new interactivity.BasicBehaveEngine(this.fps, this.eventBus);
        this.decorator = new SampleViewerDecorator(this.engine, debug);
    }

    /**
     * Initialize the graph controller with the given state and debug flag.
     * This needs to be called every time a glTF assets is loaded.
     * @param {GltfState} state - The state of the application.
     * @param {boolean} debug - Whether to enable debug mode.
     */
    initializeGraphs(state) {
        this.graphIndex = undefined;
        this.playing = false;
        this.reset = false;
        this.decorator.setWorld(state);
        this.engine.clearCustomEventListeners();
        this.engine.clearEventList();
        this.engine.clearPointerInterpolation();
        this.engine.clearVariableInterpolation();
        this.engine.clearScheduledDelays();
        this.engine.clearValueEvaluationCache();
    }

    /**
     * Starts playing the specified graph. Resets the engine.
     * @param {number} graphIndex
     * @return {Array} An array of custom events defined in the graph.
     */
    startGraph(graphIndex) {
        this.engine.clearCustomEventListeners();
        try {
            this.customEvents = this.decorator.loadGraph(graphIndex);
            this.graphIndex = graphIndex;
            this.playing = true;
            this.reset = false;
        } catch (error) {
            console.error("Error loading graph:", error);
        }
        return this.customEvents;
    }

    /**
     * Stops the currently playing graph.
     */
    stopGraph() {
        if (this.graphIndex === undefined) {
            return;
        }
        this.graphIndex = undefined;
        this.playing = false;
        this.engine.clearCustomEventListeners();
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
        if (this.reset) {
            this.startGraph(this.graphIndex);
        } else {
            this.decorator.resumeEventQueue();
            this.playing = true;
        }
    }

    /**
     * Resets the current graph.
     */
    resetGraph() {
        if (this.graphIndex === undefined) {
            return;
        }
        this.decorator.resetGraph();
        this.reset = true;
        if (this.playing) {
            this.startGraph(this.graphIndex);
        }
    }

    /**
     * Dispatches an event to the behavior engine.
     * @param {string} eventName 
     * @param {*} data 
     */
    dispatchEvent(eventName, data) {
        if (this.graphIndex !== undefined) {
            this.decorator.dispatchCustomEvent(`KHR_INTERACTIVITY:${eventName}`, data);
        }
    }

}

class SampleViewerDecorator extends interactivity.ADecorator {
    
    constructor(behaveEngine, debug = false) {
        super(behaveEngine);
        this.dispatchCustomEvent = this.dispatchCustomEvent.bind(this);

        if (debug) {
            this.behaveEngine.processNodeStarted = this.processNodeStarted;
            this.behaveEngine.processAddingNodeToQueue = this.processAddingNodeToQueue;
            this.behaveEngine.processExecutingNextNode = this.processExecutingNextNode;
        }

        this.behaveEngine.stopAnimation = this.stopAnimation;
        this.behaveEngine.stopAnimationAt = this.stopAnimationAt;
        this.behaveEngine.startAnimation = this.startAnimation;

        this.registerBehaveEngineNode("animation/stop", interactivity.AnimationStop);
        this.registerBehaveEngineNode("animation/start", interactivity.AnimationStart);
        this.registerBehaveEngineNode("animation/stopAt", interactivity.AnimationStopAt);

        this.behaveEngine.alertParentOnSelect = this.alertParentOnSelect;
        this.behaveEngine.alertParentOnHoverIn = this.alertParentOnHoverIn;
        this.behaveEngine.alertParentOnHoverOut = this.alertParentOnHoverOut;
        this.behaveEngine.addNodeClickedListener = this.addNodeClickedListener;

        //this.registerBehaveEngineNode("event/onSelect", interactivity.OnSelect);
        //this.registerBehaveEngineNode("event/onHoverIn", interactivity.OnHoverIn);
        //this.registerBehaveEngineNode("event/onHoverOut", interactivity.OnHoverOut);
    }

    setWorld(world) {
        this.resetGraph();
        this.world = world;
        this.registerKnownPointers();
    }

    loadGraph(graphIndex) {
        const graphArray = this.world?.gltf?.extensions?.KHR_interactivity.graphs;
        if (graphArray && graphArray.length > graphIndex) {
            const graphCopy = JSON.parse(JSON.stringify(graphArray[graphIndex]));
            let events = graphCopy.events ?? [];
            events = events.filter(event => event.id !== undefined);
            events = JSON.parse(JSON.stringify(events)); // Deep copy to avoid mutation
            for (const event of events) {
                for (const value of Object.values(event.values)) {
                    value.type = graphCopy.types[value.type].signature;
                }
            }
            this.behaveEngine.loadBehaveGraph(graphCopy);
            return events;
        }
        throw new Error(`Graph with index ${graphIndex} does not exist.`);
    }

    resetGraph() {
        this.behaveEngine.loadBehaveGraph({nodes: [], types: [], events: [], declarations: [], variables: []});
        if (this.world === undefined) {
            return;
        }
        const resetAnimatedProperty = (path, propertyName, parent) => {
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
        if (value instanceof Number) {
            return "float";
        }
        if (value instanceof Boolean) {
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
        case "float2x2":
        case "float4":
            return [NaN, NaN, NaN, NaN];
        case "float3x3":
            return [NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN];
        case "float4x4":
            return [NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN];
        }
        return undefined;
    }

    traversePath(path, value = undefined) {
        const pathPieces = path.split('/');
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
        if (value !== undefined) {
            currentNode.animatedPropertyObjects[lastPiece].animate(value);
        }
        return currentNode;
    }


    recurseAllAnimatedProperties(gltfObject, callable, currentPath = "") {
        if (gltfObject === undefined || !(gltfObject instanceof GltfObject)) {
            return;
        }
        for (const property of gltfObject.constructor.animatedProperties) {
            if (gltfObject[property] === undefined) {
                continue;
            }
            callable(currentPath, property, gltfObject);
        }
        for (const key in gltfObject) {
            if (gltfObject[key] instanceof GltfObject) {
                this.recurseAllAnimatedProperties(gltfObject[key], callable,currentPath + "/" + key);
            } else if (Array.isArray(gltfObject[key])) {
                if (gltfObject[key].length === 0 || !(gltfObject[key][0] instanceof GltfObject)) {
                    continue;
                }
                for (let i = 0; i < gltfObject[key].length; i++) {
                    this.recurseAllAnimatedProperties(gltfObject[key][i], callable, currentPath + "/" + key + "/" + i);
                }
            }
        }
        for (const extensionName in gltfObject.extensions) {
            const extension = gltfObject.extensions[extensionName];
            if (extension instanceof GltfObject) {
                this.recurseAllAnimatedProperties(extension, callable, currentPath + "/extensions/" + extensionName);
            }
        }
        
    }

    registerKnownPointers() {
        if (this.world === undefined) {
            return;
        }
        const registerFunction = (currentPath, propertyName, parent) => {
            const jsonPtr = currentPath + "/" + propertyName;
            const type = this.getTypeFromValue(parent[propertyName]);
            if (type === undefined) {
                return;
            }
            this.registerJsonPointer(jsonPtr, (path) => {
                const result = this.traversePath(path);
                if (result === undefined) {
                    return this.getDefaultValueFromType(type);
                }
                return result;
            }, (path, value) => {
                this.traversePath(path, value);
            }, type, false);
        };
        this.recurseAllAnimatedProperties(this.world.gltf, registerFunction);
    }

    registerJsonPointer(jsonPtr, getterCallback, setterCallback, typeName, readOnly) {
        this.behaveEngine.registerJsonPointer(jsonPtr, getterCallback, setterCallback, typeName, readOnly);
    }

    animateProperty(path, easingParameters, callback) {
        // Animate a property at the given path using easing parameters
        // Implement animation logic for Sample Viewer properties
        // Example: interpolate value over time, then call callback
        if (callback) callback();
    }

    animateCubicBezier(path, p1, p2, initialValue, targetValue, duration, valueType, callback) {
        this.behaveEngine.clearPointerInterpolation(path);
        const startTime = performance.now();

        const action = async () => {
            const elapsedDuration = (performance.now() - startTime) / 1000;
            const t = Math.min(elapsedDuration / duration, 1);
            const p = interactivity.cubicBezier(t, {x: 0, y:0}, {x: p1[0], y:p1[1]}, {x: p2[0], y:p2[1]}, {x: 1, y:1});
            if (valueType === "float3") {
                const value = [interactivity.linearFloat(p.y, initialValue[0], targetValue[0]), interactivity.linearFloat(p.y, initialValue[1], targetValue[1]), interactivity.linearFloat(p.y, initialValue[2], targetValue[2])];
                this.behaveEngine.setPathValue(path, value);
            } else if (valueType === "float4") {
                if (this.isSlerpPath(path)) {
                    const value = interactivity.slerpFloat4(p.y, initialValue, targetValue);
                    this.behaveEngine.setPathValue(path, value);
                } else {
                    const value = [interactivity.linearFloat(p.y, initialValue[0], targetValue[0]), interactivity.linearFloat(p.y, initialValue[1], targetValue[1]), interactivity.linearFloat(p.y, initialValue[2], targetValue[2]), interactivity.linearFloat(p.y, initialValue[3], targetValue[3])];
                    this.behaveEngine.setPathValue(path, value);
                }
            } else if (valueType === "float") {
                const value = [interactivity.linearFloat(p.y, initialValue[0], targetValue[0])];
                this.behaveEngine.setPathValue(path, value);
            } else if (valueType == "float2") {
                const value = [interactivity.linearFloat(p.y, initialValue[0], targetValue[0]), interactivity.linearFloat(p.y, initialValue[1], targetValue[1])];
                this.behaveEngine.setPathValue(path, value);
            }

            if (elapsedDuration >= duration) {
                this.behaveEngine.setPathValue(path, targetValue);
                this.behaveEngine.clearPointerInterpolation(path);
                callback();
            }
        };

        this.behaveEngine.setPointerInterpolationCallback(path, {action: action} );
    }

    getWorld() {
        return this.world;
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

    alertParentOnSelect(selectionPoint, selectedNodeIndex, controllerIndex, selectionRayOrigin, childNodeIndex) {
    
    }

    alertParentOnHoverIn(selectedNodeIndex, controllerIndex, childNodeIndex) {
    
    }

    alertParentOnHoverOut(selectedNodeIndex, controllerIndex, childNodeIndex) {

    }

    addNodeClickedListener = (nodeIndex, callback) => {
    
    }
}

export { gltfGraph, GraphController };