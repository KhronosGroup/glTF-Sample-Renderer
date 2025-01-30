/* globals WebGl */

import { fromKeys, initGlForMembers } from './utils.js';
import { GL } from '../Renderer/webgl.js';
import { GltfObject } from './gltf_object.js';

class gltfTexture extends GltfObject
{
    static animatedProperties = [];
    constructor(sampler = undefined, source = undefined, type = GL.TEXTURE_2D)
    {
        super();
        this.sampler = sampler; // index to gltfSampler, default sampler ?
        this.source = source; // index to gltfImage

        // non gltf
        this.glTexture = undefined;
        this.type = type;
        this.initialized = false;
        this.mipLevelCount = 0;
        this.linear = true;
    }

    initGl(gltf, webGlContext)
    {
        if (this.sampler === undefined)
        {
            this.sampler = gltf.samplers.length - 1;
        }

        initGlForMembers(this, gltf, webGlContext);
    }

    fromJson(jsonTexture)
    {
        super.fromJson(jsonTexture);
        if (jsonTexture.extensions !== undefined &&
            jsonTexture.extensions.EXT_texture_webp !== undefined &&
            jsonTexture.extensions.EXT_texture_webp.source !== undefined)
        {
            this.source = jsonTexture.extensions.EXT_texture_webp.source;
        }
        if (jsonTexture.extensions !== undefined &&
            jsonTexture.extensions.KHR_texture_basisu !== undefined &&
            jsonTexture.extensions.KHR_texture_basisu.source !== undefined)
        {
            this.source = jsonTexture.extensions.KHR_texture_basisu.source;
        }
    }

    destroy()
    {
        if (this.glTexture !== undefined)
        {
            // TODO: this breaks the dependency direction
            WebGl.context.deleteTexture(this.glTexture);
        }

        this.glTexture = undefined;
    }
}

class gltfTextureInfo extends GltfObject
{
    static animatedProperties = ["strength", "scale"];
    constructor(index = undefined, texCoord = 0, linear = true, samplerName = "", generateMips = true) // linear by default
    {
        super();
        this.index = index; // reference to gltfTexture
        this.texCoord = texCoord; // which UV set to use
        this.linear = linear;
        this.samplerName = samplerName;
        this.strength = 1.0; // occlusion
        this.scale = 1.0; // normal
        this.generateMips = generateMips;

        this.extensions = undefined;
    }

    initGl(gltf, webGlContext)
    {
        if (!this.linear) {
            gltf.textures[this.index].linear = false;
        }
        initGlForMembers(this, gltf, webGlContext);
    }

    fromJson(jsonTextureInfo)
    {
        fromKeys(this, jsonTextureInfo);

        if (jsonTextureInfo?.extensions?.KHR_texture_transform !== undefined)
        {
            this.extensions.KHR_texture_transform = new KHR_texture_transform();
            this.extensions.KHR_texture_transform.fromJson(jsonTextureInfo.extensions.KHR_texture_transform);
        }
    }
}

class KHR_texture_transform extends GltfObject {
    static animatedProperties = ["offset", "scale", "rotation"];
    constructor() {
        super();
        this.offset = [0, 0];
        this.scale = [1, 1];
        this.rotation = 0;
    }
}

export { gltfTexture, gltfTextureInfo };
