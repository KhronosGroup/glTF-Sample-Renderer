import { gltfAccessor } from "./accessor.js";
import { gltfBuffer } from "./buffer.js";
import { gltfBufferView } from "./buffer_view.js";
import { gltfCamera } from "./camera.js";
import { gltfImage } from "./image.js";
import { gltfLight } from "./light.js";
import { gltfShape } from "./shape.js";
import { gltfMaterial } from "./material.js";
import { gltfMesh } from "./mesh.js";
import { gltfNode } from "./node.js";
import { gltfSampler } from "./sampler.js";
import { gltfScene } from "./scene.js";
import { gltfTexture } from "./texture.js";
import { initGlForMembers, objectsFromJsons, objectFromJson } from "./utils";
import { gltfAsset } from "./asset.js";
import { GltfObject } from "./gltf_object.js";
import { gltfAnimation } from "./animation.js";
import { gltfSkin } from "./skin.js";
import { gltfVariant } from "./variant.js";
import { gltfGraph } from "./interactivity.js";
import { gltfFile } from "./file.js";
import { gltfExternalAsset } from "./external_asset.js";
import { KHR_physics_rigid_bodies } from "./rigid_bodies.js";
import { recurseAllAnimatedProperties } from "./gltf_utils.js";
import { AnimatableProperty } from "./animatable_property.js";

// Extensions still accepted in `extensionsRequired`. The four marked "2.1 core" were
// promoted into the core specification in glTF 2.1 and are also supported without being
// declared at all; they remain listed so glTF 2.0 assets that require them keep loading.
const allowedExtensions = [
    "KHR_accessor_float64",
    "KHR_animation_pointer",
    "KHR_draco_mesh_compression",
    "KHR_gaussian_splatting",
    "KHR_implicit_shapes",
    "KHR_interactivity",
    "KHR_lights_image_based",
    "KHR_lights_punctual",
    "KHR_materials_anisotropy",
    "KHR_materials_clearcoat",
    "KHR_materials_diffuse_transmission",
    "KHR_materials_dispersion",
    "KHR_materials_emissive_strength", // 2.1 core
    "KHR_materials_ior",
    "KHR_materials_iridescence",
    "KHR_materials_pbrSpecularGlossiness",
    "KHR_materials_retroreflection",
    "KHR_materials_sheen",
    "KHR_materials_specular",
    "KHR_materials_transmission",
    "KHR_materials_unlit",
    "KHR_materials_variants",
    "KHR_materials_volume",
    "KHR_materials_volume_scatter",
    "KHR_meshopt_compression",
    "KHR_mesh_quantization", // 2.1 core
    "KHR_node_hoverability",
    "KHR_node_selectability",
    "KHR_node_visibility", // 2.1 core
    "KHR_physics_rigid_bodies",
    "KHR_texture_basisu",
    "KHR_texture_transform",
    "KHR_xmp_json_ld",
    "EXT_mesh_gpu_instancing",
    "EXT_meshopt_compression",
    "EXT_texture_webp" // 2.1 core
];

class glTF extends GltfObject {
    static animatedProperties = [];
    static readOnlyAnimatedProperties = [
        "animations",
        "cameras",
        // "materials", materials.length need to be handled manually due to the default material
        "meshes",
        "nodes",
        "scene",
        "scenes",
        "skins"
    ];
    static nextDocumentId = 1;
    constructor(file) {
        super();
        this.asset = undefined;
        this.accessors = [];
        this.nodes = [];
        this.scene = undefined; // the default scene to show.
        this.scenes = [];
        this.cameras = [];
        this.imageBasedLights = [];
        this.textures = [];
        this.images = [];
        this.samplers = [];
        this.meshes = [];
        this.buffers = [];
        this.bufferViews = [];
        this.materials = [];
        this.animations = [];
        this.skins = [];
        this.shapes = [];
        this.files = [];
        this.externalAssets = [];
        this.path = file;

        // Distinguishes documents in a tree of external assets, where indices such as a
        // mesh index only mean something together with the document they belong to.
        this.documentId = glTF.nextDocumentId++;

        // Set once the tree is instantiated: something below this document animates.
        this.hasInstancedAnimations = false;

        // Generated tangent cache
        this.tangentCache = new Map();
    }

    initGl(webGlContext) {
        initGlForMembers(this, this, webGlContext);
    }

    isAtLeast(major, minor) {
        return this.asset?.isAtLeast(major, minor) ?? false;
    }

    fromJson(json) {
        super.fromJson(json);

        for (const extensionName of json.extensionsRequired ?? []) {
            if (!allowedExtensions.includes(extensionName)) {
                throw new Error("Unsupported extension: " + extensionName);
            }
        }

        this.asset = objectFromJson(json.asset, gltfAsset);
        this.cameras = objectsFromJsons(json.cameras, gltfCamera);
        this.accessors = objectsFromJsons(json.accessors, gltfAccessor);
        this.meshes = objectsFromJsons(json.meshes, gltfMesh);
        this.samplers = objectsFromJsons(json.samplers, gltfSampler);
        this.materials = objectsFromJsons(json.materials, gltfMaterial);
        this.buffers = objectsFromJsons(json.buffers, gltfBuffer);
        this.bufferViews = objectsFromJsons(json.bufferViews, gltfBufferView);
        this.scenes = objectsFromJsons(json.scenes, gltfScene);
        this.textures = objectsFromJsons(json.textures, gltfTexture);
        this.nodes = objectsFromJsons(json.nodes, gltfNode);
        this.images = objectsFromJsons(json.images, gltfImage);
        this.animations = objectsFromJsons(json.animations, gltfAnimation);
        this.skins = objectsFromJsons(json.skins, gltfSkin);
        this.files = objectsFromJsons(json.files, gltfFile);
        this.externalAssets = objectsFromJsons(json.externalAssets, gltfExternalAsset);
        this.shapes = objectsFromJsons(json.shapes, gltfShape);

        if (json.extensions?.KHR_lights_punctual !== undefined) {
            this.extensions.KHR_lights_punctual = new GltfObject([]);
            this.extensions.KHR_lights_punctual.lights = objectsFromJsons(
                json.extensions.KHR_lights_punctual.lights,
                gltfLight
            );
        }
        if (json.extensions?.KHR_materials_variants !== undefined) {
            this.extensions.KHR_materials_variants = new GltfObject([]);
            this.extensions.KHR_materials_variants.variants = objectsFromJsons(
                json.extensions.KHR_materials_variants?.variants,
                gltfVariant
            );
            this.extensions.KHR_materials_variants.variants = enforceVariantsUniqueness(
                this.extensions.KHR_materials_variants.variants
            );
        }
        if (json.extensions?.KHR_interactivity !== undefined) {
            this.extensions.KHR_interactivity = new GltfObject([]);
            this.extensions.KHR_interactivity.graphs = objectsFromJsons(
                json.extensions.KHR_interactivity?.graphs,
                gltfGraph
            );
            this.extensions.KHR_interactivity.graph = json.extensions.KHR_interactivity?.graph ?? 0;
        }

        if (json.extensions?.KHR_implicit_shapes !== undefined) {
            // KHR_implicit_shapes becomes the core `shapes` array in glTF 2.1. An asset
            // cannot sensibly use both spellings, because collider shape indices would be
            // ambiguous, so the extension array simply becomes the core array.
            if (this.shapes.length > 0) {
                console.warn(
                    "Asset defines both shapes and KHR_implicit_shapes; ignoring the extension"
                );
            } else {
                this.shapes = objectsFromJsons(
                    json.extensions.KHR_implicit_shapes.shapes,
                    gltfShape
                );
            }
        }

        if (json.extensions?.KHR_physics_rigid_bodies !== undefined) {
            this.extensions.KHR_physics_rigid_bodies = new KHR_physics_rigid_bodies();
            this.extensions.KHR_physics_rigid_bodies.fromJson(
                json.extensions.KHR_physics_rigid_bodies
            );
        }

        this.materials.push(gltfMaterial.createDefault());
        this.samplers.push(gltfSampler.createDefault());

        if (json.scenes !== undefined) {
            if (json.scene === undefined && json.scenes.length > 0) {
                this.scene = 0;
            } else {
                this.scene = json.scene;
            }
        }

        this.computeDisjointAnimations();
        this.addNodeMetaInformation();
        this.markThumbnailImage();
    }

    // glTF 2.1 thumbnails exist so an application can preview an asset without loading
    // the scene. A thumbnail that no texture uses is therefore dead weight during a
    // normal load, and is skipped; ResourceLoader.loadThumbnail fetches it on its own.
    markThumbnailImage() {
        const index = this.asset?.thumbnail;
        if (index === undefined) {
            return;
        }
        const image = this.images[index];
        if (image === undefined) {
            console.warn(`asset.thumbnail refers to image ${index}, which does not exist`);
            this.asset.thumbnail = undefined;
            return;
        }
        image.isThumbnail = true;
        image.usedByTexture = this.textures.some((texture) => texture.source === index);
    }

    // Adds parent and scene information to each node
    addNodeMetaInformation() {
        function recurseNodes(gltf, nodeIndex, scene, parent) {
            const node = gltf.nodes[nodeIndex];
            node.scene = scene;
            node.parentNode = parent;

            // recurse into children
            for (const child of node.children) {
                recurseNodes(gltf, child, scene, node);
            }
        }
        // A node index only resolves against the document that owns it, and a tree of
        // external assets has several, so every node carries its own.
        for (const node of this.nodes) {
            node.ownerDocument = this;
        }
        for (const scene of this.scenes) {
            for (const nodeIndex of scene.nodes) {
                recurseNodes(this, nodeIndex, scene, undefined);
            }
        }
    }

    // Computes indices of animations which are disjoint and can be played simultaneously.
    computeDisjointAnimations() {
        for (let i = 0; i < this.animations.length; i++) {
            this.animations[i].disjointAnimations = [];

            for (let k = 0; k < this.animations.length; k++) {
                if (i == k) {
                    continue;
                }

                let isDisjoint = true;
                for (const iChannel of this.animations[i].channels) {
                    const getAnimationProperty = function (channel, nodes) {
                        let property = null;
                        switch (channel.target.path) {
                            case "translation":
                                property = `/nodes/${channel.target.node}/translation`;
                                break;
                            case "rotation":
                                property = `/nodes/${channel.target.node}/rotation`;
                                break;
                            case "scale":
                                property = `/nodes/${channel.target.node}/scale`;
                                break;
                            case "weights":
                                if (nodes[channel.target.node].weights !== undefined) {
                                    property = `/nodes/${channel.target.node}/weights`;
                                } else {
                                    property = `/meshes/${nodes[channel.target.node].mesh}/weights`;
                                }
                                break;
                            case "pointer":
                                property = channel.target.extensions.KHR_animation_pointer.pointer;
                                break;
                        }
                        return property;
                    };
                    const iProperty = getAnimationProperty(iChannel, this.nodes);
                    for (const kChannel of this.animations[k].channels) {
                        const kProperty = getAnimationProperty(kChannel, this.nodes);
                        if (iProperty === kProperty) {
                            isDisjoint = false;
                            break;
                        }
                    }
                }

                if (isDisjoint) {
                    this.animations[i].disjointAnimations.push(k);
                }
            }
        }
    }

    nonDisjointAnimations(animationIndices) {
        const animations = this.animations;
        const nonDisjointAnimations = [];

        for (let i = 0; i < animations.length; i++) {
            let isDisjoint = true;
            for (const k of animationIndices) {
                if (i == k) {
                    continue;
                }

                if (!animations[k].disjointAnimations.includes(i)) {
                    isDisjoint = false;
                }
            }

            if (!isDisjoint) {
                nonDisjointAnimations.push(i);
            }
        }

        return nonDisjointAnimations;
    }

    resetAnimatedProperties(sceneIndex = -1) {
        const resetAnimatedProperty = (path, propertyName, parent, readOnly) => {
            if (readOnly) {
                return;
            }
            parent.animatedPropertyObjects[propertyName].rest();
        };
        recurseAllAnimatedProperties(this, resetAnimatedProperty);
        if (sceneIndex >= 0) {
            const scene = this.scenes[sceneIndex];
            scene.applyTransformHierarchy(this);
        }
    }

    /**
     * Reset all dirty flags to false. This should be called after processing all animatable properties that have their dirty flags set to true.
     */
    resetAllDirtyFlags() {
        AnimatableProperty.resetAllDirtyFlags();
        for (const node of this.nodes) {
            node.dirtyScale = false;
            node.dirtyTransform = false;
        }
    }
}

function enforceVariantsUniqueness(variants) {
    for (let i = 0; i < variants.length; i++) {
        const name = variants[i].name;
        for (let j = i + 1; j < variants.length; j++) {
            if (variants[j].name == name) {
                variants[j].name += "0"; // Add random character to duplicates
            }
        }
    }

    return variants;
}

export {
    glTF,
    gltfAccessor,
    gltfBuffer,
    gltfCamera,
    gltfImage,
    gltfLight,
    gltfMaterial,
    gltfMesh,
    gltfNode,
    gltfSampler,
    gltfScene,
    gltfTexture,
    gltfAsset,
    GltfObject,
    gltfAnimation,
    gltfSkin,
    gltfVariant,
    gltfGraph
};
