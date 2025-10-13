import { gltfAccessor } from './accessor.js';
import { gltfBuffer } from './buffer.js';
import { gltfBufferView } from './buffer_view.js';
import { gltfCamera } from './camera.js';
import { gltfImage } from './image.js';
import { gltfLight } from './light.js';
import { gltfMaterial } from './material.js';
import { gltfMesh } from './mesh.js';
import { gltfNode } from './node.js';
import { gltfSampler } from './sampler.js';
import { gltfScene } from './scene.js';
import { gltfTexture } from './texture.js';
import { initGlForMembers, objectsFromJsons, objectFromJson } from './utils';
import { gltfAsset } from './asset.js';
import { GltfObject } from './gltf_object.js';
import { gltfAnimation } from './animation.js';
import { gltfSkin } from './skin.js';
import { gltfVariant } from './variant.js';
import { gltfGraph } from './interactivity.js';

const allowedExtensions = [
    "KHR_accessor_float64",
    "KHR_animation_pointer",
    "KHR_draco_mesh_compression",
    "KHR_interactivity",
    "KHR_lights_image_based",
    "KHR_lights_punctual",
    "KHR_materials_anisotropy",
    "KHR_materials_clearcoat",
    "KHR_materials_diffuse_transmission",
    "KHR_materials_dispersion",
    "KHR_materials_emissive_strength",
    "KHR_materials_ior",
    "KHR_materials_iridescence",
    "KHR_materials_pbrSpecularGlossiness",
    "KHR_materials_sheen",
    "KHR_materials_specular",
    "KHR_materials_transmission",
    "KHR_materials_unlit",
    "KHR_materials_variants",
    "KHR_materials_volume",
    "KHR_materials_volume_scatter",
    "KHR_mesh_quantization",
    "KHR_node_visibility",
    "KHR_texture_basisu",
    "KHR_texture_transform",
    "KHR_xmp_json_ld",
    "EXT_mesh_gpu_instancing",
    "EXT_texture_webp",
];

class glTF extends GltfObject
{
    static animatedProperties = [];
    static readOnlyAnimatedProperties = ["animations", "cameras", "materials", "meshes", "nodes", "scene", "scenes", "skins"];
    constructor(file)
    {
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
        this.path = file;

        // Generated tangent cache
        this.tangentCache = new Map();
    }

    initGl(webGlContext)
    {
        initGlForMembers(this, this, webGlContext);
    }

    fromJson(json)
    {
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

        if (json.extensions?.KHR_lights_punctual !== undefined) {
            this.extensions.KHR_lights_punctual.lights = objectsFromJsons(json.extensions.KHR_lights_punctual.lights, gltfLight);
        }
        if (json.extensions?.KHR_materials_variants !== undefined) {
            this.extensions.KHR_materials_variants.variants = objectsFromJsons(json.extensions.KHR_materials_variants?.variants, gltfVariant);
            this.extensions.KHR_materials_variants.variants = enforceVariantsUniqueness(this.extensions.KHR_materials_variants.variants);
        }
        if (json.extensions?.KHR_interactivity !== undefined) {
            this.extensions.KHR_interactivity.graphs = objectsFromJsons(json.extensions.KHR_interactivity?.graphs, gltfGraph);
            this.extensions.KHR_interactivity.graph = json.extensions.KHR_interactivity?.graph ?? 0;
        }

        this.materials.push(gltfMaterial.createDefault());
        this.samplers.push(gltfSampler.createDefault());

        if (json.scenes !== undefined)
        {
            if (json.scene === undefined && json.scenes.length > 0)
            {
                this.scene = 0;
            }
            else
            {
                this.scene = json.scene;
            }
        }

        this.computeDisjointAnimations();
        this.addNodeMetaInformation();
    }

    // Adds parent and scene information to each node
    addNodeMetaInformation()
    {
        function recurseNodes(gltf, nodeIndex, scene, parent)
        {
            const node = gltf.nodes[nodeIndex];
            node.scene = scene;
            node.parentNode = parent;

            // recurse into children
            for(const child of node.children)
            {
                recurseNodes(gltf, child, scene, node);
            }
        }
        for (const scene of this.scenes) {
            for (const nodeIndex of scene.nodes) {
                recurseNodes(this, nodeIndex, scene, undefined);
            }
        }
    }

    // Computes indices of animations which are disjoint and can be played simultaneously.
    computeDisjointAnimations()
    {
        for (let i = 0; i < this.animations.length; i++)
        {
            this.animations[i].disjointAnimations = [];

            for (let k = 0; k < this.animations.length; k++)
            {
                if (i == k)
                {
                    continue;
                }

                let isDisjoint = true;
                for (const iChannel of this.animations[i].channels)
                {
                    const getAnimationProperty = function (channel, nodes){ 
                     
                        let property = null;
                        switch(channel.target.path)
                        {
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
                    for (const kChannel of this.animations[k].channels)
                    {
                        const kProperty = getAnimationProperty(kChannel, this.nodes);
                        if (iProperty === kProperty)
                        {
                            isDisjoint = false;
                            break;
                        }
                    }
                }

                if (isDisjoint)
                {
                    this.animations[i].disjointAnimations.push(k);
                }
            }
        }
    }

    nonDisjointAnimations(animationIndices)
    {
        const animations = this.animations;
        const nonDisjointAnimations = [];

        for (let i = 0; i < animations.length; i++)
        {
            let isDisjoint = true;
            for (const k of animationIndices)
            {
                if (i == k)
                {
                    continue;
                }

                if (!animations[k].disjointAnimations.includes(i))
                {
                    isDisjoint = false;
                }
            }

            if (!isDisjoint)
            {
                nonDisjointAnimations.push(i);
            }
        }

        return nonDisjointAnimations;
    }
}

function enforceVariantsUniqueness(variants)
{
    for(let i=0;i<variants.length;i++)
    {
        const name = variants[i].name;
        for(let j=i+1;j<variants.length;j++)
        {
            if(variants[j].name == name)
            {
                variants[j].name += "0";  // Add random character to duplicates
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
