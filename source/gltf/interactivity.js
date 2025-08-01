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
    constructor(fps = 60) {
        this.fps = fps;
        this.graphIndex = undefined;
        this.playing = false;
        this.customEvents = [];
        this.eventBus = undefined;
        this.engine = undefined;
        this.decorator = undefined;
    }

    /**
     * Initialize the graph controller with the given state and debug flag.
     * This needs to be called every time a glTF assets is loaded.
     * @param {GltfState} state - The state of the application.
     * @param {boolean} debug - Whether to enable debug mode.
     */
    initializeGraphs(state, debug = false) {
        this.eventBus = new interactivity.DOMEventBus();
        this.engine = new interactivity.BasicBehaveEngine(this.fps, this.eventBus);
        this.decorator = new SampleViewerDecorator(this.engine, state, debug);
        this.playing = false;
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
        } catch (error) {
            console.error("Error loading graph:", error);
        }
        return this.customEvents;
    }

    /**
     * Stops the currently playing graph.
     */
    stopGraph() {
        this.graphIndex = undefined;
        this.playing = false;
        if (this.engine !== undefined) {
            this.engine.clearCustomEventListeners();
        }
    }

    /**
     * Pauses the currently playing graph.
     */
    pauseGraph() {
        //TODO
        this.playing = false;
    }
    
    /**
     * Resumes the currently paused graph.
     */
    playGraph() {
        //TODO
        this.playing = true;
    }

    /**
     * Resets the current graph.
     */
    resetGraph() {
        if (this.graphIndex === undefined) {
            return;
        }
        this.startGraph(this.graphIndex);
    }

    /**
     * Dispatches an event to the behavior engine.
     * @param {string} eventName 
     * @param {*} data 
     */
    dispatchEvent(eventName, data) {
        if (this.decorator !== undefined) {
            this.decorator.dispatchCustomEvent(eventName, data);
        }
    }

}

class SampleViewerDecorator extends interactivity.ADecorator {
    
    constructor(behaveEngine, world, debug = false) {
        super(behaveEngine);
        this.world = world;

        this.registerKnownPointers();

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

    dispatchCustomEvent(eventName, data) {
        this.behaveEngine.dispatchCustomEvent(`KHR_INTERACTIVITY:${eventName}`, data);
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
            currentNode[lastPiece] = value;
        }
        return currentNode;
    }


    registerKnownPointersHelper(gltfObject, currentPath = "") {
        if (gltfObject === undefined || !(gltfObject instanceof GltfObject)) {
            return;
        }
        for (const property of gltfObject.constructor.animatedProperties) {
            if (gltfObject[property] === undefined) {
                continue;
            }
            const jsonPtr = currentPath + "/" + property;
            const type = this.getTypeFromValue(gltfObject[property]);
            if (type === undefined) {
                continue;
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
        }
        for (const key in gltfObject) {
            if (gltfObject[key] instanceof GltfObject) {
                this.registerKnownPointersHelper(gltfObject[key], currentPath + "/" + key);
            } else if (Array.isArray(gltfObject[key])) {
                if (gltfObject[key].length === 0 || !(gltfObject[key][0] instanceof GltfObject)) {
                    continue;
                }
                for (let i = 0; i < gltfObject[key].length; i++) {
                    this.registerKnownPointersHelper(gltfObject[key][i], currentPath + "/" + key + "/" + i);
                }
            }
        }
        for (const extensionName in gltfObject.extensions) {
            const extension = gltfObject.extensions[extensionName];
            if (extension instanceof GltfObject) {
                this.registerKnownPointersHelper(extension, currentPath + "/extensions/" + extensionName);
            }
        }
        
    }

    registerKnownPointers() {
        if (this.world === undefined) {
            return;
        }
        this.registerKnownPointersHelper(this.world.gltf);
    }

    registerJsonPointer(jsonPtr, getterCallback, setterCallback, typeName, readOnly) {
        // Register a custom JSON pointer for property access
        // Store or use the callbacks as needed for Sample Viewer
        if (typeof this.behaveEngine.registerJsonPointer === "function") {
            this.behaveEngine.registerJsonPointer(jsonPtr, getterCallback, setterCallback, typeName, readOnly);
        }
    }

    animateProperty(path, easingParameters, callback) {
        // Animate a property at the given path using easing parameters
        // Implement animation logic for Sample Viewer properties
        // Example: interpolate value over time, then call callback
        if (callback) callback();
    }

    animateCubicBezier(path, p1, p2, initialValue, targetValue, duration, valueType, callback) {
        // Animate a property using a cubic bezier curve
        // Implement animation logic for Sample Viewer properties
        if (callback) callback();
    }

    getWorld() {
        // Return the world or scene context for the Sample Viewer
        return this.world;
    }

    stopAnimation(animationIndex) {

    }

    stopAnimationAt(animationIndex, stopTime, callback) {
        // Stop animation at a specific time
    }

    startAnimation(animationIndex, startTime, endTime, speed, callback) {
    
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