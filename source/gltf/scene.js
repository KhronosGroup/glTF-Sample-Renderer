import { mat4, quat } from "gl-matrix";
import { GltfObject } from "./gltf_object";

class gltfScene extends GltfObject {
    static animatedProperties = [];
    static readOnlyAnimatedProperties = ["nodes"];
    constructor(nodes = [], name = undefined)
    {
        super();
        this.nodes = nodes;
        this.name = name;
    }

    initGl(gltf, webGlContext) {
        super.initGl(gltf, webGlContext);
    }

    applyTransformHierarchy(gltf, rootTransform = mat4.create()) {
        function applyTransform(gltf, node, parentTransform) {
            mat4.multiply(node.worldTransform, parentTransform, node.getLocalTransform());
            mat4.invert(node.inverseWorldTransform, node.worldTransform);
            mat4.transpose(node.normalMatrix, node.inverseWorldTransform);

            if (node.instanceMatrices) {
                node.instanceWorldTransforms = [];
                for (let i = 0; i < node.instanceMatrices.length; i++) {
                    const instanceTransform = node.instanceMatrices[i];
                    const instanceWorldTransform = mat4.create();
                    mat4.multiply(instanceWorldTransform, node.worldTransform, instanceTransform);
                    node.instanceWorldTransforms.push(instanceWorldTransform);
                }
            }

            for (const child of node.children) {
                applyTransform(gltf, gltf.nodes[child], node.worldTransform);
            }
        }
        for (const node of this.nodes) {
            applyTransform(gltf, gltf.nodes[node], rootTransform);
        }

        function applyWorldRotation(gltf, node, parentRotation) {
            quat.multiply(node.worldQuaternion, parentRotation, node.rotation);

            // Recurse into children
            for (const child of node.children) {
                applyWorldRotation(gltf, gltf.nodes[child], node.worldQuaternion);
            }
        }

        for (const node of this.nodes) {
            applyWorldRotation(gltf, gltf.nodes[node], quat.create());
        }
    }


    gatherNodes(gltf, enabledExtensions)
    {
        const nodes = [];
        const selectableNodes = [];
        const hoverableNodes = [];

        function gatherNode(nodeIndex, visible, selectable, hoverable)
        {
            const node = gltf.nodes[nodeIndex];
            if (!enabledExtensions.KHR_node_visibility || (node.extensions?.KHR_node_visibility?.visible !== false) && visible) {
                nodes.push(node);
            } else {
                visible = false;
            }
            if (!enabledExtensions.KHR_node_selectability || (node.extensions?.KHR_node_selectability?.selectable !== false) && selectable) {
                selectableNodes.push(node);
            } else {
                selectable = false;
            }
            if (!enabledExtensions.KHR_node_hoverability || (node.extensions?.KHR_node_hoverability?.hoverable !== false) && hoverable) {
                hoverableNodes.push(node);
            } else {
                hoverable = false;
            }

            // recurse into children
            for(const child of node.children)
            {
                gatherNode(child, visible, selectable, hoverable);
            }
        }

        for (const node of this.nodes)
        {
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
