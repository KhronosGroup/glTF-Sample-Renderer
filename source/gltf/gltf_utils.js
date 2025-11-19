import { vec3 } from "gl-matrix";
import { jsToGl } from "./utils.js";
import { gltfAccessor } from "./accessor.js";

function getSceneExtents(gltf, sceneIndex, outMin, outMax) {
    for (const i of [0, 1, 2]) {
        outMin[i] = Number.POSITIVE_INFINITY;
        outMax[i] = Number.NEGATIVE_INFINITY;
    }

    const scene = gltf.scenes[sceneIndex];

    let nodeIndices = scene.nodes.slice();
    while (nodeIndices.length > 0) {
        const node = gltf.nodes[nodeIndices.pop()];
        nodeIndices = nodeIndices.concat(node.children);

        if (node.mesh === undefined) {
            continue;
        }

        const mesh = gltf.meshes[node.mesh];
        if (mesh.primitives === undefined) {
            continue;
        }

        for (const primitive of mesh.primitives) {
            const attribute = primitive.glAttributes.find((a) => a.attribute == "POSITION");
            if (attribute === undefined) {
                continue;
            }

            const accessor = gltf.accessors[attribute.accessor];
            const assetMin = vec3.create();
            const assetMax = vec3.create();
            getExtentsFromAccessor(accessor, node.getRenderedWorldTransform(), assetMin, assetMax);

            for (const i of [0, 1, 2]) {
                outMin[i] = Math.min(outMin[i], assetMin[i]);
                outMax[i] = Math.max(outMax[i], assetMax[i]);
            }
        }
    }
}

function getExtentsFromAccessor(accessor, worldTransform, outMin, outMax) {
    let min = jsToGl(accessor.min);
    let max = jsToGl(accessor.max);

    if (accessor.normalized) {
        min = gltfAccessor.dequantize(min, accessor.componentType);
        max = gltfAccessor.dequantize(max, accessor.componentType);
    }

    // Construct all eight corners from min and max values
    let boxVertices = [
        vec3.fromValues(min[0], min[1], min[2]),
        vec3.fromValues(min[0], min[1], max[2]),
        vec3.fromValues(min[0], max[1], min[2]),
        vec3.fromValues(min[0], max[1], max[2]),

        vec3.fromValues(max[0], min[1], min[2]),
        vec3.fromValues(max[0], min[1], max[2]),
        vec3.fromValues(max[0], max[1], min[2]),
        vec3.fromValues(max[0], max[1], max[2])
    ];

    // Transform all bounding box vertices
    for (let i in boxVertices) {
        vec3.transformMat4(boxVertices[i], boxVertices[i], worldTransform);
    }

    // Create new (axis-aligned) bounding box out of transformed bounding box
    const boxMin = vec3.clone(boxVertices[0]); // initialize
    const boxMax = vec3.clone(boxVertices[0]);

    for (let i in boxVertices) {
        for (const component of [0, 1, 2]) {
            boxMin[component] = Math.min(boxMin[component], boxVertices[i][component]);
            boxMax[component] = Math.max(boxMax[component], boxVertices[i][component]);
        }
    }

    const center = vec3.create();
    vec3.add(center, boxMax, boxMin);
    vec3.scale(center, center, 0.5);

    const centerToSurface = vec3.create();
    vec3.sub(centerToSurface, boxMax, center);

    const radius = vec3.length(centerToSurface);

    for (const i of [0, 1, 2]) {
        outMin[i] = center[i] - radius;
        outMax[i] = center[i] + radius;
    }
}

function getAnimatedIndices(gltf, prefix, properties) {
    const checkNodePointer = (pointer, prefix, properties, graphNode = undefined) => {
        if (!pointer.startsWith(prefix)) {
            return undefined;
        }
        let match = undefined;
        for (const property of properties) {
            if (pointer.endsWith("/" + property)) {
                match = property;
                break;
            }
        }
        if (!match) {
            return undefined;
        }
        const indexPart = pointer.substring(prefix.length, pointer.length - ("/" + match).length);
        if (indexPart.startsWith("{") && indexPart.endsWith("}")) {
            // Check in interactivity graph
            if (graphNode === undefined) {
                return undefined;
            }
            const nodeId = indexPart.substring(1, indexPart.length - 1);
            if (graphNode.values[nodeId] !== undefined) {
                return parseInt(graphNode.values[nodeId]);
            }
            // Every node can be animated since it is determined at runtime
            return Infinity;
        }
        return parseInt(indexPart);
    };

    const animatedIndices = new Set();
    let runtimeChanges = false;

    // Check animation channels
    for (const animation of gltf.animations) {
        for (const channel of animation.channels) {
            const target = channel.target;
            if (
                prefix === "/nodes/" &&
                target.node !== undefined &&
                properties.includes(target.path)
            ) {
                animatedIndices.add(target.node);
            }
            const pointer = target.extensions?.KHR_animation_pointer?.pointer;
            if (pointer) {
                const result = checkNodePointer(pointer, prefix, properties);
                if (result !== undefined) {
                    animatedIndices.add(result);
                }
            }
        }
    }

    // Check interactivity graphs
    if (gltf.extensions?.KHR_interactivity?.graphs !== undefined) {
        for (const graph of gltf.extensions.KHR_interactivity.graphs) {
            let pointerSetID = undefined;
            for (const [index, declaration] of graph.declarations.entries()) {
                if (declaration.op === "pointer/set") {
                    pointerSetID = index;
                    break;
                }
            }
            if (pointerSetID === undefined) {
                continue;
            }
            for (const node of graph.nodes) {
                if (node.declaration !== pointerSetID) {
                    continue;
                }
                const pointer = node.configuration.pointer.value[0];
                const result = checkNodePointer(pointer, prefix, properties, node);
                if (result === Infinity) {
                    runtimeChanges = true;
                } else if (result !== undefined) {
                    animatedIndices.add(result);
                }
            }
        }
    }
    return { animatedIndices: animatedIndices, runtimeChanges: runtimeChanges };
}

function getMorphedNodeIndices(gltf) {
    const morphedNodes = new Set();
    const morphedMeshes = new Set();
    for (const mesh of gltf.meshes) {
        if (mesh.primitives === undefined) {
            continue;
        }
        for (const primitive of mesh.primitives) {
            let isMorphed = false;
            if (primitive.targets !== undefined && primitive.targets.length > 0) {
                for (const target of primitive.targets) {
                    if (target.POSITION !== undefined) {
                        isMorphed = true;
                        break;
                    }
                }
            }
            if (isMorphed) {
                morphedMeshes.add(mesh.gltfObjectIndex);
                break;
            }
        }
    }
    for (const node of gltf.nodes) {
        if (node.mesh !== undefined && morphedMeshes.has(node.mesh)) {
            morphedNodes.add(node.gltfObjectIndex);
        }
    }
    return morphedNodes;
}

export { getSceneExtents, getAnimatedIndices, getMorphedNodeIndices };
