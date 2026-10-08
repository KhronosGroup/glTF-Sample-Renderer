import { mat4, quat } from "gl-matrix";
import { GltfObject } from "./gltf_object";

// The roots of the scene an external asset instance contributes at a node, or an empty
// list when the node instantiates nothing. A child document contributes its default scene.
function externalAssetRoots(node) {
    const instance = node.externalAssetInstance;
    if (instance === undefined) {
        return [];
    }
    const scene = instance.scenes[instance.scene ?? 0];
    if (scene === undefined) {
        return [];
    }
    return scene.nodes.map((index) => instance.nodes[index]);
}

class gltfScene extends GltfObject {
    static animatedProperties = [];
    static readOnlyAnimatedProperties = ["nodes"];
    constructor(nodes = [], name = undefined) {
        super();
        this.nodes = nodes;
        this.name = name;
    }

    initGl(gltf, webGlContext) {
        super.initGl(gltf, webGlContext);
    }

    applyTransformHierarchy(gltf, rootTransform = mat4.create()) {
        function applyTransform(
            gltf,
            node,
            parentTransform,
            parentRotation,
            parentDirty,
            parentScaleDirty
        ) {
            const nodeDirty = parentDirty || node.isLocalTransformDirty();
            node.dirtyTransform = nodeDirty;
            node.dirtyScale = false;
            if (nodeDirty) {
                mat4.multiply(node.worldTransform, parentTransform, node.getLocalTransform());
                mat4.invert(node.inverseWorldTransform, node.worldTransform);
                quat.multiply(node.worldQuaternion, parentRotation, node.rotation);
                mat4.getScaling(node.worldScale, node.worldTransform);
                if (parentScaleDirty || node.animatedPropertyObjects["scale"].dirty) {
                    node.dirtyScale = true;
                }
            }

            if (nodeDirty && node.instanceMatrices) {
                node.instanceWorldTransforms = [];
                for (let i = 0; i < node.instanceMatrices.length; i++) {
                    const instanceTransform = node.instanceMatrices[i];
                    const instanceWorldTransform = mat4.create();
                    mat4.multiply(instanceWorldTransform, node.worldTransform, instanceTransform);
                    node.instanceWorldTransforms.push(instanceWorldTransform);
                }
            }

            for (const child of node.children) {
                applyTransform(
                    gltf,
                    gltf.nodes[child],
                    node.worldTransform,
                    node.worldQuaternion,
                    nodeDirty,
                    node.dirtyScale
                );
            }

            // An instantiated external asset hangs below the node, so its roots continue
            // the transform chain from there.
            for (const root of externalAssetRoots(node)) {
                applyTransform(
                    node.externalAssetInstance,
                    root,
                    node.worldTransform,
                    node.worldQuaternion,
                    nodeDirty,
                    node.dirtyScale
                );
            }
        }
        for (const node of this.nodes) {
            applyTransform(gltf, gltf.nodes[node], rootTransform, quat.create(), false, false);
        }
    }

    resetHierarchyDirtyFlags(gltf) {
        for (const nodeIndex of this.nodes) {
            const node = gltf.nodes[nodeIndex];
            node.clearTransformDirty();
        }
    }

    gatherNodes(gltf, enabledExtensions) {
        const nodes = [];
        const selectableNodes = [];
        const hoverableNodes = [];

        function gatherNode(nodeIndex, visible, selectable, hoverable) {
            const node = gltf.nodes[nodeIndex];
            visitNode(node, visible, selectable, hoverable);
        }

        function visitNode(node, visible, selectable, hoverable) {
            if (!enabledExtensions.KHR_node_visibility || (node.visible !== false && visible)) {
                nodes.push(node);
            } else {
                visible = false;
            }
            if (
                !enabledExtensions.KHR_node_selectability ||
                (node.extensions?.KHR_node_selectability?.selectable !== false && selectable)
            ) {
                selectableNodes.push(node);
            } else {
                selectable = false;
            }
            if (
                !enabledExtensions.KHR_node_hoverability ||
                (node.extensions?.KHR_node_hoverability?.hoverable !== false && hoverable)
            ) {
                hoverableNodes.push(node);
            } else {
                hoverable = false;
            }

            // recurse into children
            for (const child of node.children) {
                visitNode(node.ownerDocument.nodes[child], visible, selectable, hoverable);
            }

            // An instantiated external asset inherits the state of the node holding it.
            for (const root of externalAssetRoots(node)) {
                visitNode(root, visible, selectable, hoverable);
            }
        }

        for (const node of this.nodes) {
            gatherNode(node, true, true, true);
        }

        return {
            nodes: nodes,
            selectableNodes: selectableNodes,
            hoverableNodes: hoverableNodes
        };
    }

    includesNode(gltf, nodeIndex) {
        let children = [...this.nodes];
        while (children.length > 0) {
            const childIndex = children.pop();

            if (childIndex === nodeIndex) {
                return true;
            }

            children = children.concat(gltf.nodes[childIndex].children);
        }

        return false;
    }
}

export { gltfScene };
