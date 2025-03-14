import { mat3, vec3, vec4 } from 'gl-matrix';
import { gltfTextureInfo } from './texture.js';
import { jsToGl, initGlForMembers } from './utils.js';
import { GltfObject } from './gltf_object.js';

class gltfMaterial extends GltfObject
{
    static animatedProperties = ["alphaCutoff", "emissiveFactor"];
    constructor()
    {
        super();
        this.name = undefined;
        this.pbrMetallicRoughness = new PbrMetallicRoughness();
        this.normalTexture = undefined;
        this.occlusionTexture = undefined;
        this.emissiveTexture = undefined;
        this.emissiveFactor = vec3.fromValues(0, 0, 0);
        this.alphaMode = "OPAQUE";
        this.alphaCutoff = 0.5;
        this.doubleSided = false;

        // pbr next extension toggles
        this.hasClearcoat = false;
        this.hasSheen = false;
        this.hasTransmission = false;
        this.hasDiffuseTransmission = false;
        this.hasIOR = false;
        this.hasEmissiveStrength = false;
        this.hasVolume = false;
        this.hasIridescence = false;
        this.hasAnisotropy = false;
        this.hasDispersion = false;

        // non gltf properties
        this.type = "unlit";
        this.textures = [];
        this.textureTransforms = [];
        this.defines = [];
    }

    static createDefault()
    {
        const defaultMaterial = new gltfMaterial();
        defaultMaterial.type = "MR";
        defaultMaterial.name = "Default Material";
        defaultMaterial.defines.push("MATERIAL_METALLICROUGHNESS 1");

        return defaultMaterial;
    }

    getDefines(renderingParameters)
    {
        const defines = Array.from(this.defines);

        if (this.hasClearcoat && renderingParameters.enabledExtensions.KHR_materials_clearcoat)
        {
            defines.push("MATERIAL_CLEARCOAT 1");
        }
        if (this.hasSheen && renderingParameters.enabledExtensions.KHR_materials_sheen)
        {
            defines.push("MATERIAL_SHEEN 1");
        }
        if (this.hasTransmission && renderingParameters.enabledExtensions.KHR_materials_transmission)
        {
            defines.push("MATERIAL_TRANSMISSION 1");
        }
        if(this.hasDiffuseTransmission && renderingParameters.enabledExtensions.KHR_materials_diffuse_transmission)
        {
            defines.push("MATERIAL_DIFFUSE_TRANSMISSION 1");
        }
        if (this.hasVolume && renderingParameters.enabledExtensions.KHR_materials_volume)
        {
            defines.push("MATERIAL_VOLUME 1");
        }
        if(this.hasIOR && renderingParameters.enabledExtensions.KHR_materials_ior)
        {
            defines.push("MATERIAL_IOR 1");
        }
        if(this.hasSpecular && renderingParameters.enabledExtensions.KHR_materials_specular)
        {
            defines.push("MATERIAL_SPECULAR 1");
        }
        if(this.hasIridescence && renderingParameters.enabledExtensions.KHR_materials_iridescence)
        {
            defines.push("MATERIAL_IRIDESCENCE 1");
        }
        if(this.hasEmissiveStrength && renderingParameters.enabledExtensions.KHR_materials_emissive_strength)
        {
            defines.push("MATERIAL_EMISSIVE_STRENGTH 1");
        }
        if(this.hasAnisotropy && renderingParameters.enabledExtensions.KHR_materials_anisotropy)
        {
            defines.push("MATERIAL_ANISOTROPY 1");
        }
        if(this.hasDispersion && renderingParameters.enabledExtensions.KHR_materials_dispersion)
        {
            defines.push("MATERIAL_DISPERSION 1");
        }

        return defines;
    }

    updateTextureTransforms(shader)
    {
        for (const { key, uv } of this.textureTransforms) {
            let rotation = mat3.create();
            let scale = mat3.create();
            let translation = mat3.create();

            if (uv.rotation !== undefined)
            {
                const s =  Math.sin(uv.rotation);
                const c =  Math.cos(uv.rotation);
                rotation = jsToGl([
                    c, -s, 0.0,
                    s, c, 0.0,
                    0.0, 0.0, 1.0]);
            }

            if (uv.scale !== undefined)
            {
                scale = jsToGl([
                    uv.scale[0], 0, 0, 
                    0, uv.scale[1], 0, 
                    0, 0, 1
                ]);
            }

            if (uv.offset !== undefined)
            {
                translation = jsToGl([
                    1, 0, 0, 
                    0, 1, 0, 
                    uv.offset[0], uv.offset[1], 1
                ]);
            }

            let uvMatrix = mat3.create();
            mat3.multiply(uvMatrix, translation, rotation);
            mat3.multiply(uvMatrix, uvMatrix, scale);
            shader.updateUniform("u_" + key + "UVTransform", jsToGl(uvMatrix));
            
            if(key === "Normal") {
                shader.updateUniform("u_vertNormalUVTransform", jsToGl(uvMatrix));
            }
        }
    }

    parseTextureInfoExtensions(textureInfo, textureKey)
    {
        if (textureInfo.extensions?.KHR_texture_transform === undefined)
        {
            return;
        }

        const uv = textureInfo.extensions.KHR_texture_transform;

        this.textureTransforms.push({
            key: textureKey,
            uv: uv
        });

        if(uv.texCoord !== undefined)
        {
            textureInfo.texCoord = uv.texCoord;
        }

        this.defines.push("HAS_" + textureKey.toUpperCase() + "_UV_TRANSFORM 1");
    }

    initGl(gltf, webGlContext)
    {
        if (this.normalTexture !== undefined)
        {
            this.normalTexture.samplerName = "u_NormalSampler";
            this.parseTextureInfoExtensions(this.normalTexture, "Normal");
            this.textures.push(this.normalTexture);
            this.defines.push("HAS_NORMAL_MAP 1");
        }

        if (this.occlusionTexture !== undefined)
        {
            this.occlusionTexture.samplerName = "u_OcclusionSampler";
            this.parseTextureInfoExtensions(this.occlusionTexture, "Occlusion");
            this.textures.push(this.occlusionTexture);
            this.defines.push("HAS_OCCLUSION_MAP 1");
        }

        if (this.emissiveTexture !== undefined)
        {
            this.emissiveTexture.samplerName = "u_EmissiveSampler";
            this.parseTextureInfoExtensions(this.emissiveTexture, "Emissive");
            this.textures.push(this.emissiveTexture);
            this.defines.push("HAS_EMISSIVE_MAP 1");
        }

        if (this.pbrMetallicRoughness.baseColorTexture !== undefined)
        {
            this.pbrMetallicRoughness.baseColorTexture.samplerName = "u_BaseColorSampler";
            this.parseTextureInfoExtensions(this.pbrMetallicRoughness.baseColorTexture, "BaseColor");
            this.textures.push(this.pbrMetallicRoughness.baseColorTexture);
            this.defines.push("HAS_BASE_COLOR_MAP 1");
        }

        if (this.pbrMetallicRoughness.metallicRoughnessTexture !== undefined)
        {
            this.pbrMetallicRoughness.metallicRoughnessTexture.samplerName = "u_MetallicRoughnessSampler";
            this.parseTextureInfoExtensions(this.pbrMetallicRoughness.metallicRoughnessTexture, "MetallicRoughness");
            this.textures.push(this.pbrMetallicRoughness.metallicRoughnessTexture);
            this.defines.push("HAS_METALLIC_ROUGHNESS_MAP 1");
        }

        if (this.extensions?.KHR_materials_pbrSpecularGlossiness?.diffuseTexture !== undefined)
        {
            const diffuseTexture = this.extensions.KHR_materials_pbrSpecularGlossiness.diffuseTexture;
            diffuseTexture.samplerName = "u_DiffuseSampler";
            diffuseTexture.linear = false;
            this.parseTextureInfoExtensions(diffuseTexture, "Diffuse");
            this.textures.push(diffuseTexture);
            this.defines.push("HAS_DIFFUSE_MAP 1");
        }

        if (this.extensions?.KHR_materials_pbrSpecularGlossiness?.specularGlossinessTexture !== undefined)
        {
            const specularGlossinessTexture = this.extensions.KHR_materials_pbrSpecularGlossiness.specularGlossinessTexture;
            specularGlossinessTexture.samplerName = "u_SpecularGlossinessSampler";
            specularGlossinessTexture.linear = false;
            this.parseTextureInfoExtensions(specularGlossinessTexture, "SpecularGlossiness");
            this.textures.push(specularGlossinessTexture);
            this.defines.push("HAS_SPECULAR_GLOSSINESS_MAP 1");
        }

        this.defines.push("ALPHAMODE_OPAQUE 0");
        this.defines.push("ALPHAMODE_MASK 1");
        this.defines.push("ALPHAMODE_BLEND 2");
        if(this.alphaMode === 'MASK') // only set cutoff value for mask material
        {
            this.defines.push("ALPHAMODE ALPHAMODE_MASK");
        }
        else if (this.alphaMode === 'OPAQUE')
        {
            this.defines.push("ALPHAMODE ALPHAMODE_OPAQUE");
        }
        else
        {
            this.defines.push("ALPHAMODE ALPHAMODE_BLEND");
        }

        // if we have SG, we prefer SG (best practice) but if we have neither objects we use MR default values
        if (this.type !== "SG")
        {
            this.defines.push("MATERIAL_METALLICROUGHNESS 1");
        }

        if (this.extensions !== undefined)
        {
            if (this.extensions.KHR_materials_unlit !== undefined)
            {
                this.defines.push("MATERIAL_UNLIT 1");
            }

            if (this.extensions.KHR_materials_pbrSpecularGlossiness !== undefined)
            {
                this.defines.push("MATERIAL_SPECULARGLOSSINESS 1");
            }

            // Clearcoat is part of the default metallic-roughness shader
            if(this.extensions.KHR_materials_clearcoat !== undefined)
            {
                this.hasClearcoat = true;

                const clearcoatTexture = this.extensions.KHR_materials_clearcoat.clearcoatTexture;
                if (clearcoatTexture !== undefined)
                {
                    clearcoatTexture.samplerName = "u_ClearcoatSampler";
                    this.parseTextureInfoExtensions(clearcoatTexture, "Clearcoat");
                    this.textures.push(clearcoatTexture);
                    this.defines.push("HAS_CLEARCOAT_MAP 1");
                }

                const clearcoatRoughnessTexture = this.extensions.KHR_materials_clearcoat.clearcoatRoughnessTexture;
                if (clearcoatRoughnessTexture !== undefined)
                {
                    clearcoatRoughnessTexture.samplerName = "u_ClearcoatRoughnessSampler";
                    this.parseTextureInfoExtensions(clearcoatRoughnessTexture, "ClearcoatRoughness");
                    this.textures.push(clearcoatRoughnessTexture);
                    this.defines.push("HAS_CLEARCOAT_ROUGHNESS_MAP 1");
                }

                const clearcoatNormalTexture = this.extensions.KHR_materials_clearcoat.clearcoatNormalTexture;
                if (clearcoatNormalTexture !== undefined)
                {
                    clearcoatNormalTexture.samplerName = "u_ClearcoatNormalSampler";
                    this.parseTextureInfoExtensions(clearcoatNormalTexture, "ClearcoatNormal");
                    this.textures.push(clearcoatNormalTexture);
                    this.defines.push("HAS_CLEARCOAT_NORMAL_MAP 1");
                }
            }

            // Sheen material extension
            // https://github.com/sebavan/glTF/tree/KHR_materials_sheen/extensions/2.0/Khronos/KHR_materials_sheen
            if(this.extensions.KHR_materials_sheen !== undefined)
            {
                this.hasSheen = true;
     
                if (this.extensions.KHR_materials_sheen.sheenRoughnessTexture !== undefined)
                {
                    this.extensions.KHR_materials_sheen.sheenRoughnessTexture.samplerName = "u_SheenRoughnessSampler";
                    this.parseTextureInfoExtensions(this.extensions.KHR_materials_sheen.sheenRoughnessTexture, "SheenRoughness");
                    this.textures.push(this.extensions.KHR_materials_sheen.sheenRoughnessTexture);
                    this.defines.push("HAS_SHEEN_ROUGHNESS_MAP 1");
                }
                
                const sheenColorTexture = this.extensions.KHR_materials_sheen.sheenColorTexture;
                if (sheenColorTexture !== undefined)
                {
                    sheenColorTexture.samplerName = "u_SheenColorSampler";
                    this.parseTextureInfoExtensions(sheenColorTexture, "SheenColor");
                    sheenColorTexture.linear = false;
                    this.textures.push(sheenColorTexture);
                    this.defines.push("HAS_SHEEN_COLOR_MAP 1");
                }
            }

            // KHR Extension: Specular
            if (this.extensions.KHR_materials_specular !== undefined)
            {
                this.hasSpecular = true;

                if (this.extensions.KHR_materials_specular?.specularTexture !== undefined)
                {
                    this.extensions.KHR_materials_specular.specularTexture.samplerName = "u_SpecularSampler";
                    this.parseTextureInfoExtensions(this.extensions?.KHR_materials_specular?.specularTexture, "Specular");
                    this.textures.push(this.extensions?.KHR_materials_specular?.specularTexture);
                    this.defines.push("HAS_SPECULAR_MAP 1");
                }

                if (this.extensions.KHR_materials_specular?.specularColorTexture !== undefined)
                {
                    this.extensions.KHR_materials_specular.specularColorTexture.samplerName = "u_SpecularColorSampler";
                    this.parseTextureInfoExtensions(this.extensions?.KHR_materials_specular.specularColorTexture, "SpecularColor");
                    this.extensions.KHR_materials_specular.specularColorTexture.linear = false;
                    this.textures.push(this.extensions.KHR_materials_specular.specularColorTexture);
                    this.defines.push("HAS_SPECULAR_COLOR_MAP 1");
                }
            }

            // KHR Extension: Emissive strength
            if (this.extensions.KHR_materials_emissive_strength !== undefined)
            {
                this.hasEmissiveStrength = true;
            }

            // KHR Extension: Transmission
            if (this.extensions.KHR_materials_transmission !== undefined)
            {
                this.hasTransmission = true;

                if (this.extensions?.KHR_materials_transmission?.transmissionTexture !== undefined)
                {
                    this.extensions.KHR_materials_transmission.transmissionTexture.samplerName = "u_TransmissionSampler";
                    this.parseTextureInfoExtensions(this.extensions?.KHR_materials_transmission?.transmissionTexture, "Transmission");
                    this.textures.push(this.extensions?.KHR_materials_transmission?.transmissionTexture);
                    this.defines.push("HAS_TRANSMISSION_MAP 1");
                }
            }

            // KHR Extension: Diffuse Transmission
            if(this.extensions.KHR_materials_diffuse_transmission !== undefined)
            {
                const extension = this.extensions.KHR_materials_diffuse_transmission;

                this.hasDiffuseTransmission = true;

                if (extension.diffuseTransmissionTexture !== undefined)
                {
                    extension.diffuseTransmissionTexture.samplerName = "u_DiffuseTransmissionSampler";
                    this.parseTextureInfoExtensions(extension.diffuseTransmissionTexture, "DiffuseTransmission");
                    this.textures.push(extension.diffuseTransmissionTexture);
                    this.defines.push("HAS_DIFFUSE_TRANSMISSION_MAP 1");
                }

                if (extension.diffuseTransmissionColorTexture !== undefined)
                {
                    extension.diffuseTransmissionColorTexture.samplerName = "u_DiffuseTransmissionColorSampler";
                    this.parseTextureInfoExtensions(extension.diffuseTransmissionColorTexture, "DiffuseTransmissionColor");
                    this.textures.push(extension.diffuseTransmissionColorTexture);
                    this.defines.push("HAS_DIFFUSE_TRANSMISSION_COLOR_MAP 1");
                }
            }

            // KHR Extension: IOR
            //https://github.com/DassaultSystemes-Technology/glTF/tree/KHR_materials_ior/extensions/2.0/Khronos/KHR_materials_ior
            if (this.extensions.KHR_materials_ior !== undefined)
            {
                this.hasIOR = true;
            }

            // KHR Extension: Volume
            if (this.extensions.KHR_materials_volume !== undefined)
            {
                this.hasVolume = true;

                if (this.extensions?.KHR_materials_volume?.thicknessTexture !== undefined)
                {
                    this.extensions.KHR_materials_volume.thicknessTexture.samplerName = "u_ThicknessSampler";
                    this.parseTextureInfoExtensions(this.extensions.KHR_materials_volume.thicknessTexture, "Thickness");
                    this.textures.push(this.extensions.KHR_materials_volume.thicknessTexture);
                    this.defines.push("HAS_THICKNESS_MAP 1");
                }
            }

            // KHR Extension: Iridescence
            // See https://github.com/ux3d/glTF/tree/extensions/KHR_materials_iridescence/extensions/2.0/Khronos/KHR_materials_iridescence
            if(this.extensions.KHR_materials_iridescence !== undefined)
            {
                this.hasIridescence = true;

                const extension = this.extensions.KHR_materials_iridescence;

                if (extension.iridescenceTexture !== undefined)
                {
                    extension.iridescenceTexture.samplerName = "u_IridescenceSampler";
                    this.parseTextureInfoExtensions(extension.iridescenceTexture, "Iridescence");
                    this.textures.push(extension.iridescenceTexture);
                    this.defines.push("HAS_IRIDESCENCE_MAP 1");
                }

                if (extension.iridescenceThicknessTexture !== undefined)
                {
                    extension.iridescenceThicknessTexture.samplerName = "u_IridescenceThicknessSampler";
                    this.parseTextureInfoExtensions(extension.iridescenceThicknessTexture, "IridescenceThickness");
                    this.textures.push(extension.iridescenceThicknessTexture);
                    this.defines.push("HAS_IRIDESCENCE_THICKNESS_MAP 1");
                }
            }

            // KHR Extension: Anisotropy
            // See https://github.com/KhronosGroup/glTF/tree/main/extensions/2.0/Khronos/KHR_materials_anisotropy
            if(this.extensions.KHR_materials_anisotropy !== undefined)
            {
                this.hasAnisotropy = true;

                const anisotropyTexture = this.extensions.KHR_materials_anisotropy.anisotropyTexture;

                if (anisotropyTexture !== undefined)
                {
                    anisotropyTexture.samplerName = "u_AnisotropySampler";
                    this.parseTextureInfoExtensions(anisotropyTexture, "Anisotropy");
                    this.textures.push(anisotropyTexture);
                    this.defines.push("HAS_ANISOTROPY_MAP 1");
                }
            }

            // KHR Extension: Dispersion
            // See https://github.com/KhronosGroup/glTF/tree/main/extensions/2.0/Khronos/KHR_materials_dispersion
            if (this.extensions.KHR_materials_dispersion !== undefined)
            {
                this.hasDispersion = true;
            }
        }

        initGlForMembers(this, gltf, webGlContext);
    }

    fromJson(jsonMaterial)
    {
        super.fromJson(jsonMaterial);

        if (jsonMaterial.normalTexture !== undefined)
        {
            const normalTexture = new gltfTextureInfo();
            normalTexture.fromJson(jsonMaterial.normalTexture);
            this.normalTexture = normalTexture;
        }

        if (jsonMaterial.occlusionTexture !== undefined)
        {
            const occlusionTexture = new gltfTextureInfo();
            occlusionTexture.fromJson(jsonMaterial.occlusionTexture);
            this.occlusionTexture = occlusionTexture;
        }

        if (jsonMaterial.emissiveTexture !== undefined)
        {
            const emissiveTexture = new gltfTextureInfo(undefined, 0, false);
            emissiveTexture.fromJson(jsonMaterial.emissiveTexture);
            this.emissiveTexture = emissiveTexture;
        }

        if(jsonMaterial.extensions !== undefined)
        {
            this.fromJsonMaterialExtensions(jsonMaterial.extensions);
        }
        this.pbrMetallicRoughness = new PbrMetallicRoughness();
        if (jsonMaterial.pbrMetallicRoughness !== undefined && this.type !== "SG")
        {
            this.type = "MR";
            this.pbrMetallicRoughness.fromJson(jsonMaterial.pbrMetallicRoughness);
        }
    }

    fromJsonMaterialExtensions(jsonExtensions)
    {
        if (jsonExtensions.KHR_materials_pbrSpecularGlossiness !== undefined)
        {
            this.type = "SG";
            this.extensions.KHR_materials_pbrSpecularGlossiness = new KHR_materials_pbrSpecularGlossiness();
            this.extensions.KHR_materials_pbrSpecularGlossiness.fromJson(jsonExtensions.KHR_materials_pbrSpecularGlossiness);
        }

        if(jsonExtensions.KHR_materials_unlit !== undefined)
        {
            this.type = "unlit";
        }

        if(jsonExtensions.KHR_materials_clearcoat !== undefined)
        {
            this.extensions.KHR_materials_clearcoat = new KHR_materials_clearcoat();
            this.extensions.KHR_materials_clearcoat.fromJson(jsonExtensions.KHR_materials_clearcoat);
        }

        if(jsonExtensions.KHR_materials_sheen !== undefined)
        {
            this.extensions.KHR_materials_sheen = new KHR_materials_sheen();
            this.extensions.KHR_materials_sheen.fromJson(jsonExtensions.KHR_materials_sheen);
        }

        if(jsonExtensions.KHR_materials_transmission !== undefined)
        {
            this.extensions.KHR_materials_transmission = new KHR_materials_transmission();
            this.extensions.KHR_materials_transmission.fromJson(jsonExtensions.KHR_materials_transmission);
        }

        if(jsonExtensions.KHR_materials_diffuse_transmission !== undefined)
        {
            this.extensions.KHR_materials_diffuse_transmission = new KHR_materials_diffuse_transmission();
            this.extensions.KHR_materials_diffuse_transmission.fromJson(jsonExtensions.KHR_materials_diffuse_transmission);
        }

        if(jsonExtensions.KHR_materials_specular !== undefined)
        {
            this.extensions.KHR_materials_specular = new KHR_materials_specular();
            this.extensions.KHR_materials_specular.fromJson(jsonExtensions.KHR_materials_specular);
        }

        if(jsonExtensions.KHR_materials_volume !== undefined)
        {
            this.extensions.KHR_materials_volume = new KHR_materials_volume();
            this.extensions.KHR_materials_volume.fromJson(jsonExtensions.KHR_materials_volume);
        }

        if(jsonExtensions.KHR_materials_iridescence !== undefined)
        {
            this.extensions.KHR_materials_iridescence = new KHR_materials_iridescence();
            this.extensions.KHR_materials_iridescence.fromJson(jsonExtensions.KHR_materials_iridescence);
        }

        if(jsonExtensions.KHR_materials_anisotropy !== undefined)
        {
            this.extensions.KHR_materials_anisotropy = new KHR_materials_anisotropy();
            this.extensions.KHR_materials_anisotropy.fromJson(jsonExtensions.KHR_materials_anisotropy);
        }
        
        if(jsonExtensions.KHR_materials_emissive_strength !== undefined)
        {
            this.extensions.KHR_materials_emissive_strength = new KHR_materials_emissive_strength();
            this.extensions.KHR_materials_emissive_strength.fromJson(jsonExtensions.KHR_materials_emissive_strength);
        }

        if(jsonExtensions.KHR_materials_dispersion !== undefined) {
            this.extensions.KHR_materials_dispersion = new KHR_materials_dispersion();
            this.extensions.KHR_materials_dispersion.fromJson(jsonExtensions.KHR_materials_dispersion);
        }

        if(jsonExtensions.KHR_materials_ior !== undefined) {
            this.extensions.KHR_materials_ior = new KHR_materials_ior();
            this.extensions.KHR_materials_ior.fromJson(jsonExtensions.KHR_materials_ior);
        }
    }
}

class PbrMetallicRoughness extends GltfObject {
    static animatedProperties = ["baseColorFactor", "metallicFactor", "roughnessFactor"];
    constructor()
    {
        super();
        this.baseColorFactor = vec4.fromValues(1, 1, 1, 1);
        this.baseColorTexture = undefined;
        this.metallicFactor = 1;
        this.roughnessFactor = 1;
        this.metallicRoughnessTexture = undefined;
    }

    fromJson(json) {
        super.fromJson(json);
        if (json.baseColorTexture !== undefined)
        {
            const baseColorTexture = new gltfTextureInfo(undefined, 0, false);
            baseColorTexture.fromJson(json.baseColorTexture);
            this.baseColorTexture = baseColorTexture;
        }

        if (json.metallicRoughnessTexture !== undefined)
        {
            const metallicRoughnessTexture = new gltfTextureInfo();
            metallicRoughnessTexture.fromJson(json.metallicRoughnessTexture);
            this.metallicRoughnessTexture = metallicRoughnessTexture;
        }
    }
}

class KHR_materials_anisotropy extends GltfObject {
    static animatedProperties = ["anisotropyStrength", "anisotropyRotation"];
    constructor()
    {
        super();
        this.anisotropyStrength = 0;
        this.anisotropyRotation = 0;
        this.anisotropyTexture = undefined;
    }

    fromJson(json) {
        super.fromJson(json);
        if (json.anisotropyTexture !== undefined)
        {
            const anisotropyTexture = new gltfTextureInfo();
            anisotropyTexture.fromJson(json.anisotropyTexture);
            this.anisotropyTexture = anisotropyTexture;
        }
    }
}

class KHR_materials_clearcoat extends GltfObject {
    static animatedProperties = ["clearcoatFactor", "clearcoatRoughnessFactor"];
    constructor()
    {
        super();
        this.clearcoatFactor = 0;
        this.clearcoatTexture = undefined;
        this.clearcoatRoughnessFactor = 0;
        this.clearcoatRoughnessTexture = undefined;
        this.clearcoatNormalTexture = undefined;
    }

    fromJson(jsonClearcoat) {
        super.fromJson(jsonClearcoat);
        if(jsonClearcoat.clearcoatTexture !== undefined)
        {
            const clearcoatTexture = new gltfTextureInfo();
            clearcoatTexture.fromJson(jsonClearcoat.clearcoatTexture);
            this.clearcoatTexture = clearcoatTexture;
        }

        if(jsonClearcoat.clearcoatRoughnessTexture !== undefined)
        {
            const clearcoatRoughnessTexture =  new gltfTextureInfo();
            clearcoatRoughnessTexture.fromJson(jsonClearcoat.clearcoatRoughnessTexture);
            this.clearcoatRoughnessTexture = clearcoatRoughnessTexture;
        }

        if(jsonClearcoat.clearcoatNormalTexture !== undefined)
        {
            const clearcoatNormalTexture =  new gltfTextureInfo();
            clearcoatNormalTexture.fromJson(jsonClearcoat.clearcoatNormalTexture);
            this.clearcoatNormalTexture = clearcoatNormalTexture;
        }
    }
}

class KHR_materials_dispersion extends GltfObject {
    static animatedProperties = ["dispersion"];
    constructor()
    {
        super();
        this.dispersion = 0;
    }
}

class KHR_materials_emissive_strength extends GltfObject {
    static animatedProperties = ["emissiveStrength"];
    constructor()
    {
        super();
        this.emissiveStrength = 1.0;
    }
}

class KHR_materials_ior extends GltfObject {
    static animatedProperties = ["ior"];
    constructor()
    {
        super();
        this.ior = 1.5;
    }
}

class KHR_materials_iridescence extends GltfObject {
    static animatedProperties = ["iridescenceFactor", "iridescenceIor", "iridescenceThicknessMinimum", "iridescenceThicknessMaximum"];
    constructor()
    {
        super();
        this.iridescenceFactor = 0;
        this.iridescenceIor = 1.3;
        this.iridescenceThicknessMinimum = 100;
        this.iridescenceThicknessMaximum = 400;
        this.iridescenceTexture = undefined;
        this.iridescenceThicknessTexture = undefined;
    }

    fromJson(jsonIridescence) {
        super.fromJson(jsonIridescence);
        if(jsonIridescence.iridescenceTexture !== undefined)
        {
            const iridescenceTexture = new gltfTextureInfo();
            iridescenceTexture.fromJson(jsonIridescence.iridescenceTexture);
            this.iridescenceTexture = iridescenceTexture;
        }

        if(jsonIridescence.iridescenceThicknessTexture !== undefined)
        {
            const iridescenceThicknessTexture = new gltfTextureInfo();
            iridescenceThicknessTexture.fromJson(jsonIridescence.iridescenceThicknessTexture);
            this.iridescenceThicknessTexture = iridescenceThicknessTexture;
        }
    }
}

class KHR_materials_sheen extends GltfObject {
    static animatedProperties = ["sheenRoughnessFactor", "sheenColorFactor"];
    constructor()
    {
        super();
        this.sheenRoughnessFactor = 0;
        this.sheenColorFactor = vec3.fromValues(0, 0, 0);
        this.sheenColorTexture = undefined;
        this.sheenRoughnessTexture = undefined;
    }

    fromJson(jsonSheen) {
        super.fromJson(jsonSheen);
        if(jsonSheen.sheenColorTexture !== undefined)
        {
            const sheenColorTexture = new gltfTextureInfo();
            sheenColorTexture.fromJson(jsonSheen.sheenColorTexture);
            this.sheenColorTexture = sheenColorTexture;
        }

        if(jsonSheen.sheenRoughnessTexture !== undefined)
        {
            const sheenRoughnessTexture = new gltfTextureInfo();
            sheenRoughnessTexture.fromJson(jsonSheen.sheenRoughnessTexture);
            this.sheenRoughnessTexture = sheenRoughnessTexture;
        }
    }
}

class KHR_materials_specular extends GltfObject {
    static animatedProperties = ["specularFactor", "specularColorFactor"];
    constructor()
    {
        super();
        this.specularFactor = 1;
        this.specularColorFactor = vec3.fromValues(1, 1, 1);
        this.specularTexture = undefined;
        this.specularColorTexture = undefined;
    }

    fromJson(jsonSpecular) {
        super.fromJson(jsonSpecular);
        if(jsonSpecular.specularTexture !== undefined)
        {
            const specularTexture = new gltfTextureInfo();
            specularTexture.fromJson(jsonSpecular.specularTexture);
            this.specularTexture = specularTexture;
        }

        if(jsonSpecular.specularColorTexture !== undefined)
        {
            const specularColorTexture = new gltfTextureInfo();
            specularColorTexture.fromJson(jsonSpecular.specularColorTexture);
            this.specularColorTexture = specularColorTexture;
        }
    }
}

class KHR_materials_transmission extends GltfObject {
    static animatedProperties = ["transmissionFactor"];
    constructor()
    {
        super();
        this.transmissionFactor = 0;
        this.transmissionTexture = undefined;
    }

    fromJson(jsonTransmission) {
        super.fromJson(jsonTransmission);
        if(jsonTransmission.transmissionTexture !== undefined)
        {
            const transmissionTexture = new gltfTextureInfo();
            transmissionTexture.fromJson(jsonTransmission.transmissionTexture);
            this.transmissionTexture = transmissionTexture;
        }
    }
}

class KHR_materials_volume extends GltfObject {
    static animatedProperties = ["thicknessFactor", "attenuationDistance", "attenuationColor"];
    constructor()
    {
        super();
        this.thicknessFactor = 0;
        this.thicknessTexture = undefined;
        this.attenuationDistance = 0; // 0 means infinite distance
        this.attenuationColor = vec3.fromValues(1, 1, 1);
    }

    fromJson(jsonVolume) {
        super.fromJson(jsonVolume);
        if(jsonVolume.thicknessTexture !== undefined)
        {
            const thicknessTexture = new gltfTextureInfo();
            thicknessTexture.fromJson(jsonVolume.thicknessTexture);
            this.thicknessTexture = thicknessTexture;
        }
    }
}

class KHR_materials_diffuse_transmission extends GltfObject {

    //TODO: define animated properties
    static animatedProperties = [];
    constructor()
    {
        super();
        this.diffuseTransmissionFactor = 0;
        this.diffuseTransmissionColorFactor = vec3.fromValues(1, 1, 1);
        this.diffuseTransmissionTexture = undefined;
        this.diffuseTransmissionColorTexture = undefined;
    }

    fromJson(jsonDiffuseTransmission) {
        super.fromJson(jsonDiffuseTransmission);
        if(jsonDiffuseTransmission.diffuseTransmissionTexture !== undefined)
        {
            const diffuseTransmissionTexture = new gltfTextureInfo();
            diffuseTransmissionTexture.fromJson(jsonDiffuseTransmission.diffuseTransmissionTexture);
            this.diffuseTransmissionTexture = diffuseTransmissionTexture;
        }

        if(jsonDiffuseTransmission.diffuseTransmissionColorTexture !== undefined)
        {
            const diffuseTransmissionColorTexture = new gltfTextureInfo();
            diffuseTransmissionColorTexture.fromJson(jsonDiffuseTransmission.diffuseTransmissionColorTexture);
            this.diffuseTransmissionColorTexture = diffuseTransmissionColorTexture;
        }
    }
}

class KHR_materials_pbrSpecularGlossiness extends GltfObject {
    static animatedProperties = [];
    constructor()
    {
        super();
        this.diffuseFactor = vec4.fromValues(1, 1, 1, 1);
        this.diffuseTexture = undefined;
        this.specularFactor = vec3.fromValues(1, 1, 1);
        this.specularGlossinessTexture = undefined;
        this.glossinessFactor = 1;
    }

    fromJson(jsonSpecularGlossiness) {
        super.fromJson(jsonSpecularGlossiness);
        if(jsonSpecularGlossiness.diffuseTexture !== undefined)
        {
            const diffuseTexture = new gltfTextureInfo();
            diffuseTexture.fromJson(jsonSpecularGlossiness.diffuseTexture);
            this.diffuseTexture = diffuseTexture;
        }

        if(jsonSpecularGlossiness.specularGlossinessTexture !== undefined)
        {
            const specularGlossinessTexture = new gltfTextureInfo();
            specularGlossinessTexture.fromJson(jsonSpecularGlossiness.specularGlossinessTexture);
            this.specularGlossinessTexture = specularGlossinessTexture;
        }
    }
}

export { gltfMaterial };
