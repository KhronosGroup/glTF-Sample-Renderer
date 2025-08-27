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
        this.decorator.setState(state);
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
        this.decorator.resetGraph();
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
     * Stops the graph engine.
     */
    stopGraphEngine() {
        if (this.graphIndex === undefined) {
            return;
        }
        this.graphIndex = undefined;
        this.playing = false;
        this.reset = false;
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
        this.world = undefined;

        if (debug) {
            this.behaveEngine.processNodeStarted = this.processNodeStarted;
            this.behaveEngine.processAddingNodeToQueue = this.processAddingNodeToQueue;
            this.behaveEngine.processExecutingNextNode = this.processExecutingNextNode;
        }
        this.behaveEngine.getWorld = this.getWorld;

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

    setState(state) {
        this.resetGraph();
        this.world = state;
        this.behaveEngine.world = state;
        this.registerKnownPointers();
    }

    loadGraph(graphIndex) {
        const graphArray = this.world?.gltf?.extensions?.KHR_interactivity?.graphs;
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
        for (const animation of this.world.gltf.animations) {
            animation.reset();
        }
        const resetAnimatedProperty = (path, propertyName, parent, readOnly) => {
            if (readOnly) {
                return;
            }
            parent.animatedPropertyObjects[propertyName].rest();
        };
        this.recurseAllAnimatedProperties(this.world.gltf, resetAnimatedProperty);
        this.behaveEngine.clearCustomEventListeners();
        this.behaveEngine.clearEventList();
        this.behaveEngine.clearPointerInterpolation();
        this.behaveEngine.clearVariableInterpolation();
        this.behaveEngine.clearScheduledDelays();
        this.behaveEngine.clearValueEvaluationCache();
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
            callable(currentPath, property, gltfObject, false);
        }
        for (const property in gltfObject.constructor.readOnlyAnimatedProperties) {
            if (gltfObject[property] === undefined) {
                continue;
            }
            callable(currentPath, property, gltfObject, true);
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
        const registerFunction = (currentPath, propertyName, parent, readOnly) => {
            let jsonPtr = currentPath + "/" + propertyName;
            let type = this.getTypeFromValue(parent[propertyName]);
            if (readOnly) {
                if (Array.isArray(parent[propertyName])) {
                    jsonPtr += ".length";
                    type = "int";
                    this.registerJsonPointer(jsonPtr, (path) => {
                        const result = this.traversePath(path);
                        if (result === undefined) {
                            return 0;
                        }
                        return result.length;
                    }, (path, value) => {}, "int", true);
                    return;
                }
                this.registerJsonPointer(jsonPtr, (path) => {
                    const result = this.traversePath(path);
                    if (result === undefined) {
                        return this.getDefaultValueFromType(type);
                    }
                    return result;
                }, (path, value) => {}, type, true);
            }
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

        this.registerJsonPointer(`/extensions/KHR_lights_punctual/lights.length`, (path) => {
            const lights = this.world.gltf.extensions?.KHR_lights_punctual?.lights;
            if (lights === undefined) {
                return 0;
            }
            return lights.length;
        }, (path, value) => {}, "int", true);

        const nodeCount = this.world.gltf.nodes.length;
        this.registerJsonPointer(`/nodes/${nodeCount}/children/${nodeCount}`, (path) => {
            return this.traversePath(path);
        }, (path, value) => {}, "int", true);
        this.registerJsonPointer(`/nodes/${nodeCount}/globalMatrix`, (path) => {
            const node = this.traversePath(path);
            if (node === undefined) {
                return undefined;
            }
            //Should we call applyWorldTransform for all scenes here?
            return node.worldTransform; // gl-matrix uses column-major order
        }, (path, value) => {}, "float4x4", true);
        this.registerJsonPointer(`/nodes/${nodeCount}/matrix`, (path) => {
            const node = this.traversePath(path);
            if (node === undefined) {
                return undefined;
            }
            return node.getLocalTransform(); // gl-matrix uses column-major order
        }, (path, value) => {}, "float4x4", true);
        this.registerJsonPointer(`/nodes/${nodeCount}/parent`, (path) => {
            // TODO Use implementation from gltfx demo
        }, (path, value) => {}, "int", true);
        this.registerJsonPointer(`/nodes/${nodeCount}/extensions/KHR_lights_punctual/light`, (path) => {
            return this.traversePath(path);
        }, (path, value) => {}, "int", true);

        const sceneCount = this.world.gltf.scenes.length;
        this.registerJsonPointer(`/scenes/${sceneCount}/nodes/${nodeCount}`, (path) => {
            return this.traversePath(path);
        }, (path, value) => {}, "int", true);

        const skinCount = this.world.gltf.skins.length;
        this.registerJsonPointer(`/skins/${skinCount}/joints/${nodeCount}`, (path) => {
            return this.traversePath(path);
        }, (path, value) => {}, "int", true);

        const animationCount = this.world.gltf.animations.length;
        this.registerJsonPointer(`/animations/${animationCount}/extensions/KHR_interactivity/isPlaying`, (path) => {
            const pathParts = path.split('/');
            const animationIndex = parseInt(pathParts[2]);
            if (isNaN(animationIndex) || animationIndex < 0 || animationIndex >= this.world.gltf.animations.length) {
                return undefined;
            }
            const animation = this.world.gltf.animations[animationIndex];
            return animation.createdTimestamp !== undefined;
        }, (path, value) => {}, "bool", true);
        this.registerJsonPointer(`/animations/${animationCount}/extensions/KHR_interactivity/minTime`, (path) => {
            const pathParts = path.split('/');
            const animationIndex = parseInt(pathParts[2]);
            if (isNaN(animationIndex) || animationIndex < 0 || animationIndex >= this.world.gltf.animations.length) {
                return NaN;
            }
            const animation = this.world.gltf.animations[animationIndex];
            animation.computeMinMaxTime();
            return animation.minTime;
        }, (path, value) => {}, "float", true);
        this.registerJsonPointer(`/animations/${animationCount}/extensions/KHR_interactivity/maxTime`, (path) => {
            const pathParts = path.split('/');
            const animationIndex = parseInt(pathParts[2]);
            if (isNaN(animationIndex) || animationIndex < 0 || animationIndex >= this.world.gltf.animations.length) {
                return NaN;
            }
            const animation = this.world.gltf.animations[animationIndex];
            animation.computeMinMaxTime();
            return animation.maxTime;
        }, (path, value) => {}, "float", true);
        this.registerJsonPointer(`/animations/${animationCount}/extensions/KHR_interactivity/playhead`, (path) => {
            const pathParts = path.split('/');
            const animationIndex = parseInt(pathParts[2]);
            if (isNaN(animationIndex) || animationIndex < 0 || animationIndex >= this.world.gltf.animations.length) {
                return NaN;
            }
            const animation = this.world.gltf.animations[animationIndex];
            if (animation.interpolators.length === 0) {
                return NaN;
            }
            return animation.interpolators[0].prevT;
        }, (path, value) => {}, "float", true);
        this.registerJsonPointer(`/animations/${animationCount}/extensions/KHR_interactivity/virtualPlayhead`, (path) => {
            const pathParts = path.split('/');
            const animationIndex = parseInt(pathParts[2]);
            if (isNaN(animationIndex) || animationIndex < 0 || animationIndex >= this.world.gltf.animations.length) {
                return NaN;
            }
            const animation = this.world.gltf.animations[animationIndex];
            if (animation.interpolators.length === 0) {
                return NaN;
            }
            return animation.interpolators[0].prevRequestedT;
        }, (path, value) => {}, "float", true);

        this.registerJsonPointer(`/extensions/KHR_interactivity/activeCamera/rotation`, (path) => {
            let activeCamera = this.world.userCamera;
            if (this.world.cameraNodeIndex !== undefined) {
                if (this.world.cameraNodeIndex < 0 || this.world.cameraNodeIndex >= this.world.gltf.nodes.length) {
                    return [NaN, NaN, NaN, NaN];
                }
                const cameraIndex = this.world.gltf.nodes[this.world.cameraNodeIndex].camera;
                if (cameraIndex === undefined) {
                    return [NaN, NaN, NaN, NaN];
                }
                activeCamera = this.world.gltf.cameras[cameraIndex];
            }
            return activeCamera.getRotation();
        }, (path, value) => {
            //no-op
        }, "float4", true);

        this.registerJsonPointer(`/extensions/KHR_interactivity/activeCamera/position`, (path) => {
            let activeCamera = this.world.userCamera;
            if (this.world.cameraNodeIndex !== undefined) {
                if (this.world.cameraNodeIndex < 0 || this.world.cameraNodeIndex >= this.world.gltf.nodes.length) {
                    return [NaN, NaN, NaN];
                }
                const cameraIndex = this.world.gltf.nodes[this.world.cameraNodeIndex].camera;
                if (cameraIndex === undefined) {
                    return [NaN, NaN, NaN];
                }
                activeCamera = this.world.gltf.cameras[cameraIndex];
            }
            return activeCamera.getPosition();
        }, (path, value) => {
            //no-op
        }, "float3", true);
    }

    registerJsonPointer(jsonPtr, getterCallback, setterCallback, typeName, readOnly) {
        this.behaveEngine.registerJsonPointer(jsonPtr, getterCallback, setterCallback, typeName, readOnly);
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