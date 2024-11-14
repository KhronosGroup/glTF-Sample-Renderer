import { ShaderCache } from './Renderer/shader_cache.js';
import iblFiltering from './shaders/ibl_filtering.frag';
import panoramaToCubeMap from './shaders/panorama_to_cubemap.frag';
import debugOutput from './shaders/debug.frag';
import fullscreenShader from './shaders/fullscreen.vert';

class iblSampler
{
    constructor(view)
    {
        this.gl = view.context;

        this.textureSize = 256;
        this.ggxSampleCount = 1024;
        this.lambertianSampleCount = 2048;
        this.sheenSamplCount = 64;
        this.lodBias = 0.0;
        this.lowestMipLevel = 4;
        this.lutResolution = 1024;

        this.scaleValue = 1.0;

        this.mipmapCount = undefined;

        this.lambertianTextureID = undefined;
        this.ggxTextureID = undefined;
        this.sheenTextureID = undefined;

        this.ggxLutTextureID = undefined;
        this.charlieLutTextureID = undefined;

        this.inputTextureID = undefined;
        this.cubemapTextureID = undefined;
        this.framebuffer = undefined;

        this.supportedFormats = ["BYTE"];
        this.preferredFormat = "HALF_FLOAT";

        const shaderSources = new Map();

        shaderSources.set("fullscreen.vert", fullscreenShader);
        shaderSources.set("panorama_to_cubemap.frag", panoramaToCubeMap);
        shaderSources.set("ibl_filtering.frag", iblFiltering);
        shaderSources.set("debug.frag", debugOutput);

        this.shaderCache = new ShaderCache(shaderSources, view.renderer.webGl);
    }

    prepareTextureData(image)
    {
        let texture =  {
            internalFormat: this.gl.RGB32F,
            format:this.gl.RGB,
            type: this.gl.FLOAT,
            data:undefined 
        };

        // Reset scaling of hdrs 
        this.scaleValue = 1.0;

        if(this.supportedFormats.includes("FLOAT") == false && this.supportedFormats.includes("HALF_FLOAT") == false)
        {
            texture.internalFormat = this.internalFormat();
            texture.format = this.gl.RGBA;
            texture.type = this.gl.UNSIGNED_BYTE;

            const numPixels = image.dataFloat.length / 3;

            let max_value = 0.0;
            let clamped_sum = 0.0;
            let diff_sum = 0.0;

            for(let i = 0, src = 0, dst = 0; i < numPixels; ++i, src += 3, dst += 4)
            {
                let max_component = Math.max(image.dataFloat[src+0], image.dataFloat[src+1], image.dataFloat[src+2]);
                if(max_component > 1.0) {
                    diff_sum += max_component-1.0;
                }
                clamped_sum += Math.min(max_component, 1.0);

                max_value =  Math.max(max_component, max_value);
            }

            let scaleFactor = 1.0;  
            if(clamped_sum > 1.0) {
                // Apply global scale factor to compensate for intensity lost when clamping
                scaleFactor = (clamped_sum+diff_sum)/clamped_sum;
            }

            if(max_value > 1.0){
                console.warn("Environment light intensity cannot be displayed correctly on this device");
            }
           
            texture.data = new Uint8Array(numPixels * 4);
            for(let i = 0, src = 0, dst = 0; i < numPixels; ++i, src += 3, dst += 4)
            {
                // copy the pixels and pad the alpha channel
                texture.data[dst+0] = Math.min((image.dataFloat[src+0])*255, 255);
                texture.data[dst+1] = Math.min((image.dataFloat[src+1])*255, 255);
                texture.data[dst+2] = Math.min((image.dataFloat[src+2])*255, 255);
                texture.data[dst+3] = 255;  // unused
            }

            this.scaleValue =  scaleFactor;
            return texture;
        }



        const numPixels = image.dataFloat.length / 3;
        texture.data = new Float32Array(numPixels * 4);
        
        let max_value = 0.0;
        for(let i = 0, src = 0, dst = 0; i < numPixels; ++i, src += 3, dst += 4)
        {
            // pad the alpha channel
            // workaround for node-gles not supporting RGB32F -> convert to RGBA32F
            texture.data[dst] =  image.dataFloat[src];
            texture.data[dst+1] = image.dataFloat[src+1];
            texture.data[dst+2] = image.dataFloat[src+2];
            texture.data[dst+3] = 1.0; // unused
            
            let max_component = Math.max(image.dataFloat[src+0], image.dataFloat[src+1], image.dataFloat[src+2]);
            max_value =  Math.max(max_component, max_value);
        }

        if(max_value > 65504.0) {
            // We need float (32 bit) to support value range
            if(this.supportedFormats.includes("FLOAT"))
            {
                // Remove HALF_FLOAT from supported list as we require a higher value range 
                this.supportedFormats.splice(this.supportedFormats.indexOf("HALF_FLOAT"), 1);
            }
            else
            {
                console.warn("Supported texture formats do not support HDR value range ");
                console.warn("Environment light intensity cannot be displayed correctly on this device");

                // Recalcualte texture data to fit in half_float range
                let clamped_sum = 0.0;
                let diff_sum = 0.0;
                const max_range = 65504.0;
                for(let i = 0, src = 0, dst = 0; i < numPixels; ++i, src += 3, dst += 4)
                {
                    texture.data[dst] =  Math.min(image.dataFloat[src], max_range);
                    texture.data[dst+1] = Math.min(image.dataFloat[src+1], max_range);
                    texture.data[dst+2] = Math.min(image.dataFloat[src+2], max_range);
                    texture.data[dst+3] = 1.0; // unused

                    let max_component = Math.max(image.dataFloat[src+0], image.dataFloat[src+1], image.dataFloat[src+2]);
                    if(max_component > max_range) {
                        diff_sum += max_component-max_range;
                    }
                    clamped_sum += Math.min(max_component, max_range);
     
                } 
                if(clamped_sum > 1.0) {
                    // Apply global scale factor to compensate for intensity lost when clamping
                    this.scaleValue =   (clamped_sum+diff_sum)/clamped_sum;
                }
    

            }
        }


        if(image.dataFloat instanceof Float32Array && this.supportedFormats.includes("HALF_FLOAT"))
        {
            texture.internalFormat = this.internalFormat();
            texture.format = this.gl.RGBA;
            texture.type = this.gl.FLOAT;

            return texture;
        }
 
        if (image.dataFloat instanceof Float32Array &&  this.supportedFormats.includes("FLOAT"))
        {
            
            texture.internalFormat = this.gl.RGBA32F;
            texture.format = this.gl.RGBA;
            texture.type = this.gl.FLOAT;

            return texture;
        }

        if (typeof(Image) !== 'undefined' && image instanceof Image)
        {
            texture.internalFormat = this.gl.RGBA8;
            texture.format = this.gl.RGBA;
            texture.type = this.gl.UNSIGNED_BYTE;
            texture.data = image;
            return texture;
        }

        console.error("loadTextureHDR failed, unsupported HDR image");

    }

    loadTextureHDR(image)
    {
        let texture = this.prepareTextureData(image);
       
        const textureID = this.gl.createTexture();
        this.gl.bindTexture(this.gl.TEXTURE_2D, textureID);      

        this.gl.texImage2D(
            this.gl.TEXTURE_2D, // target
            0, // level
            texture.internalFormat, 
            image.width,
            image.height,
            0, // border
            texture.format, // format of the pixel data
            texture.type, // type of the pixel data
            texture.data
        );

        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.MIRRORED_REPEAT);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.MIRRORED_REPEAT);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.LINEAR);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.LINEAR);

        return textureID;
    }

    internalFormat()
    {
        
        if(this.supportedFormats.includes(this.preferredFormat))
        { 
            // Try to use preferred format
            if(this.preferredFormat == "FLOAT") return  this.gl.RGBA32F;
            if(this.preferredFormat == "HALF_FLOAT") return  this.gl.RGBA16F;
            if(this.preferredFormat == "BYTE") return  this.gl.RGBA8;
        }
        if(this.supportedFormats.includes("FLOAT")) return  this.gl.RGBA32F;
        if(this.supportedFormats.includes("HALF_FLOAT")) return  this.gl.RGBA16F;
        if(this.supportedFormats.includes("BYTE")) return  this.gl.RGBA8;

        return this.gl.RGBA8; // Fallback
    }

    textureTargetType()
    {
        
        if(this.supportedFormats.includes(this.preferredFormat))
        { 
            // Try to use preferred format
            if(this.preferredFormat == "FLOAT") return   this.gl.FLOAT;
            if(this.preferredFormat == "HALF_FLOAT") return  this.gl.HALF_FLOAT;
            if(this.preferredFormat == "BYTE") return  this.gl.UNSIGNED_BYTE;
        }
        if(this.supportedFormats.includes("FLOAT")) return   this.gl.FLOAT;
        if(this.supportedFormats.includes("HALF_FLOAT")) return   this.gl.HALF_FLOAT;
        if(this.supportedFormats.includes("BYTE")) return  this.gl.UNSIGNED_BYTE;

        return this.gl.UNSIGNED_BYTE; // Fallback
    }

    createCubemapTexture(withMipmaps)
    {
        const targetTexture =  this.gl.createTexture();
        this.gl.bindTexture(this.gl.TEXTURE_CUBE_MAP, targetTexture);

        for(let i = 0; i < 6; ++i)
        {
            this.gl.texImage2D(
                this.gl.TEXTURE_CUBE_MAP_POSITIVE_X + i,
                0,
                this.internalFormat(),
                this.textureSize,
                this.textureSize,
                0,
                this.gl.RGBA,
                this.textureTargetType(),
                null
            );
        }

        if(withMipmaps)
        {
            this.gl.texParameteri(this.gl.TEXTURE_CUBE_MAP, this.gl.TEXTURE_MIN_FILTER, this.gl.LINEAR_MIPMAP_LINEAR);
        }
        else
        {
            this.gl.texParameteri(this.gl.TEXTURE_CUBE_MAP, this.gl.TEXTURE_MIN_FILTER, this.gl.LINEAR);
        }

        this.gl.texParameteri(this.gl.TEXTURE_CUBE_MAP, this.gl.TEXTURE_MAG_FILTER, this.gl.LINEAR);
        this.gl.texParameteri(this.gl.TEXTURE_CUBE_MAP, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE);
        this.gl.texParameteri(this.gl.TEXTURE_CUBE_MAP, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE);

        return targetTexture;
    }

    createLutTexture()
    {
        const targetTexture = this.gl.createTexture();
        this.gl.bindTexture(this.gl.TEXTURE_2D, targetTexture);

        this.gl.texImage2D(
            this.gl.TEXTURE_2D,
            0,
            this.internalFormat(),
            this.lutResolution,
            this.lutResolution,
            0,
            this.gl.RGBA,
            this.textureTargetType(),
            null
        );

        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.LINEAR);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.LINEAR);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE);

        return targetTexture;
    }

    init(panoramaImage)
    {
        if (this.gl.getExtension("EXT_color_buffer_float") && this.gl.getExtension("OES_texture_float_linear"))
        {
            this.supportedFormats.push("FLOAT");
        }
        if (this.gl.getExtension("EXT_color_buffer_float") || this.gl.getExtension("EXT_color_buffer_half_float"))
        {
            this.supportedFormats.push("HALF_FLOAT");
        }
       

        this.inputTextureID = this.loadTextureHDR(panoramaImage);

        this.cubemapTextureID = this.createCubemapTexture(true);

        this.framebuffer = this.gl.createFramebuffer();

        this.lambertianTextureID = this.createCubemapTexture(false);
        this.ggxTextureID = this.createCubemapTexture(true);
        this.sheenTextureID = this.createCubemapTexture(true);


        this.gl.bindTexture(this.gl.TEXTURE_CUBE_MAP, this.ggxTextureID);
        this.gl.generateMipmap(this.gl.TEXTURE_CUBE_MAP);

        this.gl.bindTexture(this.gl.TEXTURE_CUBE_MAP, this.sheenTextureID);
        this.gl.generateMipmap(this.gl.TEXTURE_CUBE_MAP);

        this.mipmapLevels = Math.floor(Math.log2(this.textureSize))+1 - this.lowestMipLevel;
    }

    filterAll()
    {
        this.panoramaToCubeMap();
        this.cubeMapToLambertian();
        this.cubeMapToGGX();
        this.cubeMapToSheen();

        this.sampleGGXLut();
        this.sampleCharlieLut();

        this.gl.bindFramebuffer( this.gl.FRAMEBUFFER, null);
    }

    panoramaToCubeMap()
    {
        for(let i = 0; i < 6; ++i)
        {
            this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, this.framebuffer);
            this.gl.framebufferTexture2D(this.gl.FRAMEBUFFER, this.gl.COLOR_ATTACHMENT0, this.gl.TEXTURE_CUBE_MAP_POSITIVE_X + i, this.cubemapTextureID, 0);

            this.gl.bindTexture(this.gl.TEXTURE_CUBE_MAP, this.cubemapTextureID);

            this.gl.viewport(0, 0, this.textureSize, this.textureSize);

            this.gl.clearColor(1.0, 0.0, 0.0, 0.0);
            this.gl.clear(this.gl.COLOR_BUFFER_BIT| this.gl.DEPTH_BUFFER_BIT);

            const vertexHash = this.shaderCache.selectShader("fullscreen.vert", []);
            const fragmentHash = this.shaderCache.selectShader("panorama_to_cubemap.frag", []);

            const shader = this.shaderCache.getShaderProgram(fragmentHash, vertexHash);
            this.gl.useProgram(shader.program);

            //  TEXTURE0 = active.
            this.gl.activeTexture(this.gl.TEXTURE0+0);

            // Bind texture ID to active texture
            this.gl.bindTexture(this.gl.TEXTURE_2D, this.inputTextureID);

            // map shader uniform to texture unit (TEXTURE0)
            const location = this.gl.getUniformLocation(shader.program,"u_panorama");
            this.gl.uniform1i(location, 0); // texture unit 0 (TEXTURE0)

            shader.updateUniform("u_currentFace", i);

            //fullscreen triangle
            this.gl.drawArrays(this.gl.TRIANGLES, 0, 3);
        }

        this.gl.bindTexture(this.gl.TEXTURE_CUBE_MAP, this.cubemapTextureID);
        this.gl.generateMipmap(this.gl.TEXTURE_CUBE_MAP);

    }


    applyFilter(
        distribution,
        roughness,
        targetMipLevel,
        targetTexture,
        sampleCount,
        lodBias = 0.0)
    {
        const currentTextureSize = this.textureSize >> targetMipLevel;

        for(let i = 0; i < 6; ++i)
        {
            this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, this.framebuffer);
            this.gl.framebufferTexture2D(this.gl.FRAMEBUFFER, this.gl.COLOR_ATTACHMENT0, this.gl.TEXTURE_CUBE_MAP_POSITIVE_X + i, targetTexture, targetMipLevel);

            this.gl.bindTexture(this.gl.TEXTURE_CUBE_MAP, targetTexture);

            this.gl.viewport(0, 0, currentTextureSize, currentTextureSize);

            this.gl.clearColor(1.0, 0.0, 0.0, 0.0);
            this.gl.clear(this.gl.COLOR_BUFFER_BIT| this.gl.DEPTH_BUFFER_BIT);

            const vertexHash = this.shaderCache.selectShader("fullscreen.vert", []);
            const fragmentHash = this.shaderCache.selectShader("ibl_filtering.frag", []);

            const shader = this.shaderCache.getShaderProgram(fragmentHash, vertexHash);
            this.gl.useProgram(shader.program);

            //  TEXTURE0 = active.
            this.gl.activeTexture(this.gl.TEXTURE0);

            // Bind texture ID to active texture
            this.gl.bindTexture(this.gl.TEXTURE_CUBE_MAP, this.cubemapTextureID);

            // map shader uniform to texture unit (TEXTURE0)
            const location = this.gl.getUniformLocation(shader.program,"u_cubemapTexture");
            this.gl.uniform1i(location, 0); // texture unit 0

            shader.updateUniform("u_roughness", roughness);
            shader.updateUniform("u_sampleCount", sampleCount);
            shader.updateUniform("u_width", this.textureSize);
            shader.updateUniform("u_lodBias", lodBias);
            shader.updateUniform("u_distribution", distribution);
            shader.updateUniform("u_currentFace", i);
            shader.updateUniform("u_isGeneratingLUT", 0);
            if(this.supportedFormat === "BYTE") {
                shader.updateUniform("u_floatTexture", 0);
            } else {
                shader.updateUniform("u_floatTexture", 1);
            }
            shader.updateUniform("u_intensityScale", this.scaleValue);

            //fullscreen triangle
            this.gl.drawArrays(this.gl.TRIANGLES, 0, 3);
        }

    }

    cubeMapToLambertian()
    {
        this.applyFilter(
            0,
            0.0,
            0,
            this.lambertianTextureID,
            this.lambertianSampleCount);
    }


    cubeMapToGGX()
    {
        for(let currentMipLevel = 0; currentMipLevel <= this.mipmapLevels; ++currentMipLevel)
        {
            const roughness = (currentMipLevel) / (this.mipmapLevels - 1);
            this.applyFilter(
                1,
                roughness,
                currentMipLevel,
                this.ggxTextureID,
                this.ggxSampleCount);
        }
    }

    cubeMapToSheen()
    {
        for(let currentMipLevel = 0; currentMipLevel <= this.mipmapLevels; ++currentMipLevel)
        {
            const roughness = (currentMipLevel) / (this.mipmapLevels - 1);
            this.applyFilter(
                2,
                roughness,
                currentMipLevel,
                this.sheenTextureID,
                this.sheenSamplCount);
        }
    }

    sampleLut(distribution, targetTexture, currentTextureSize)
    {
        this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, this.framebuffer);
        this.gl.framebufferTexture2D(this.gl.FRAMEBUFFER, this.gl.COLOR_ATTACHMENT0, this.gl.TEXTURE_2D, targetTexture, 0);

        this.gl.bindTexture(this.gl.TEXTURE_2D, targetTexture);

        this.gl.viewport(0, 0, currentTextureSize, currentTextureSize);

        this.gl.clearColor(1.0, 0.0, 0.0, 0.0);
        this.gl.clear(this.gl.COLOR_BUFFER_BIT| this.gl.DEPTH_BUFFER_BIT);

        const vertexHash = this.shaderCache.selectShader("fullscreen.vert", []);
        const fragmentHash = this.shaderCache.selectShader("ibl_filtering.frag", []);

        const shader = this.shaderCache.getShaderProgram(fragmentHash, vertexHash);
        this.gl.useProgram(shader.program);


        //  TEXTURE0 = active.
        this.gl.activeTexture(this.gl.TEXTURE0+0);

        // Bind texture ID to active texture
        this.gl.bindTexture(this.gl.TEXTURE_CUBE_MAP, this.cubemapTextureID);

        // map shader uniform to texture unit (TEXTURE0)
        const location = this.gl.getUniformLocation(shader.program,"u_cubemapTexture");
        this.gl.uniform1i(location, 0); // texture unit 0


        shader.updateUniform("u_roughness", 0.0);
        shader.updateUniform("u_sampleCount", 512);
        shader.updateUniform("u_width", 0.0);
        shader.updateUniform("u_lodBias", 0.0);
        shader.updateUniform("u_distribution", distribution);
        shader.updateUniform("u_currentFace", 0);
        shader.updateUniform("u_isGeneratingLUT", 1);

        //fullscreen triangle
        this.gl.drawArrays(this.gl.TRIANGLES, 0, 3);
    }

    sampleGGXLut()
    {
        this.ggxLutTextureID = this.createLutTexture();
        this.sampleLut(1, this.ggxLutTextureID, this.lutResolution);
    }

    sampleCharlieLut()
    {
        this.charlieLutTextureID = this.createLutTexture();
        this.sampleLut(2, this.charlieLutTextureID, this.lutResolution);
    }

    destroy()
    {
        this.shaderCache.destroy();
    }
}

export { iblSampler };
