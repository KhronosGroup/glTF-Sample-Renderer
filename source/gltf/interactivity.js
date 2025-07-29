import { GltfObject } from "./gltf_object";
import * as interactivity from "khr_interactivity_authoring_engine/";
import { mat4, quat, vec3, vec2, vec4} from "gl-matrix";

class gltfGraph extends GltfObject {
    constructor() {
        super();
        //interactivity.IBehaveEngine
    }
}

class SampleViewerDecorator extends interactivity.ADecorator {
    
    constructor(behaveEngine, world) {
        super(behaveEngine);
        this.world = world;

        this.registerKnownPointers();



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

    loadGraph(graph) {
        this.behaveEngine.loadBehaveGraph(graph);
    }

    processNodeStarted(node) {
        //pass
    }

    processAddingNodeToQueue(flow) {
        //pass
    }

    processExecutingNextNode(flow) {
        //pass
    }

    getTypeFromValue(value) {
        if (value instanceof Number) {
            return "float";
        }
        if (value instanceof Boolean) {
            return "bool";
        }
        if (value instanceof vec2) {
            return "float2";
        }
        if (value instanceof vec3) {
            return "float3";
        }
        if (value instanceof vec4) {
            return "float4";
        }
        if (value instanceof quat) {
            return "float4";
        }
        if (value instanceof mat4) {
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
        const lastPiece = pathPieces[pathPieces.length - 1];
        if (value !== undefined) {
            pathPieces.pop();
        }
        let currentNode = this.world;

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
        if (gltfObject === undefined || !(gltfObject instanceof gltfObject)) {
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
                    this.registerKnownPointersHelper(gltfObject[key][i], currentPath + "/" + key + "[" + i + "]");
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
        this.registerJsonPointerHelper(this.world);
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

export { gltfGraph };