import { mat4, mat3, vec3, quat } from 'gl-matrix';
import { ShaderCache } from './shader_cache.js';
import { GltfState } from '../GltfState/gltf_state.js';
import { gltfWebGl, GL } from './webgl.js';
import { EnvironmentRenderer } from './environment_renderer.js';

import pbrShader from './shaders/pbr.frag';
import brdfShader from './shaders/brdf.glsl';
import iridescenceShader from './shaders/iridescence.glsl';
import materialInfoShader from './shaders/material_info.glsl';
import iblShader from './shaders/ibl.glsl';
import punctualShader from './shaders/punctual.glsl';
import primitiveShader from './shaders/primitive.vert';
import texturesShader from './shaders/textures.glsl';
import tonemappingShader from './shaders/tonemapping.glsl';
import shaderFunctions from './shaders/functions.glsl';
import animationShader from './shaders/animation.glsl';
import cubemapVertShader from './shaders/cubemap.vert';
import cubemapFragShader from './shaders/cubemap.frag';
import specularGlossinesShader from './shaders/specular_glossiness.frag';
import { gltfLight } from '../gltf/light.js';
import { jsToGl } from '../gltf/utils.js';

class gltfRenderer
{
    constructor(context)
    {
        this.shader = undefined; // current shader

        this.currentWidth = 0;
        this.currentHeight = 0;

        this.webGl = new gltfWebGl(context);
        this.initialized = false;
        this.samples = 4;

        // create render target for non transmission materials
        this.opaqueRenderTexture = 0;
        this.opaqueFramebuffer = 0;
        this.opaqueDepthTexture = 0;
        this.opaqueFramebufferWidth = 1024;
        this.opaqueFramebufferHeight = 1024;

        const shaderSources = new Map();
        shaderSources.set("primitive.vert", primitiveShader);
        shaderSources.set("pbr.frag", pbrShader);
        shaderSources.set("material_info.glsl", materialInfoShader);
        shaderSources.set("brdf.glsl", brdfShader);
        shaderSources.set("iridescence.glsl", iridescenceShader);
        shaderSources.set("ibl.glsl", iblShader);
        shaderSources.set("punctual.glsl", punctualShader);
        shaderSources.set("tonemapping.glsl", tonemappingShader);
        shaderSources.set("textures.glsl", texturesShader);
        shaderSources.set("functions.glsl", shaderFunctions);
        shaderSources.set("animation.glsl", animationShader);
        shaderSources.set("cubemap.vert", cubemapVertShader);
        shaderSources.set("cubemap.frag", cubemapFragShader);
        shaderSources.set("specular_glossiness.frag", specularGlossinesShader);

        this.shaderCache = new ShaderCache(shaderSources, this.webGl);

        this.webGl.loadWebGlExtensions();

        this.visibleLights = [];

        this.viewMatrix = mat4.create();
        this.projMatrix = mat4.create();
        this.viewProjectionMatrix = mat4.create();

        this.currentCameraPosition = vec3.create();

        this.lightKey = new gltfLight();
        this.lightFill = new gltfLight();
        this.lightFill.intensity = 0.5;
        const quatKey = quat.fromValues(
            -0.3535534,
            -0.353553385,
            -0.146446586,
            0.8535534);
        const quatFill = quat.fromValues(
            -0.8535534,
            0.146446645,
            -0.353553325,
            -0.353553444);
        this.lightKey.direction = vec3.create();
        this.lightFill.direction = vec3.create();
        vec3.transformQuat(this.lightKey.direction, [0, 0, -1], quatKey);
        vec3.transformQuat(this.lightFill.direction, [0, 0, -1], quatFill);
        
        this.maxVertAttributes = undefined;
        this.instanceBuffer = undefined;
    }

    /////////////////////////////////////////////////////////////////////
    // Render glTF scene graph
    /////////////////////////////////////////////////////////////////////

    // app state
    init(state)
    {
        const context = this.webGl.context;
        const maxSamples = context.getParameter(context.MAX_SAMPLES);
        const samples = state.internalMSAA < maxSamples ? state.internalMSAA : maxSamples;
        if (!this.initialized){

            context.pixelStorei(GL.UNPACK_COLORSPACE_CONVERSION_WEBGL, GL.NONE);
            context.enable(GL.DEPTH_TEST);
            context.depthFunc(GL.LEQUAL);
            context.colorMask(true, true, true, true);
            context.clearDepth(1.0);

            this.opaqueRenderTexture = context.createTexture();
            context.bindTexture(context.TEXTURE_2D, this.opaqueRenderTexture);
            context.texParameteri(context.TEXTURE_2D, context.TEXTURE_MIN_FILTER, context.LINEAR_MIPMAP_LINEAR);
            context.texParameteri(context.TEXTURE_2D, context.TEXTURE_WRAP_S, context.CLAMP_TO_EDGE);
            context.texParameteri(context.TEXTURE_2D, context.TEXTURE_WRAP_T, context.CLAMP_TO_EDGE);
            context.texParameteri(context.TEXTURE_2D, context.TEXTURE_MAG_FILTER, context.NEAREST);
            context.texImage2D(context.TEXTURE_2D, 0, context.RGBA, this.opaqueFramebufferWidth, this.opaqueFramebufferHeight, 0, context.RGBA, context.UNSIGNED_BYTE, null);
            context.bindTexture(context.TEXTURE_2D, null);

            this.opaqueDepthTexture = context.createTexture();
            context.bindTexture(context.TEXTURE_2D, this.opaqueDepthTexture);
            context.texParameteri(context.TEXTURE_2D, context.TEXTURE_MIN_FILTER, context.NEAREST);
            context.texParameteri(context.TEXTURE_2D, context.TEXTURE_WRAP_S, context.CLAMP_TO_EDGE);
            context.texParameteri(context.TEXTURE_2D, context.TEXTURE_WRAP_T, context.CLAMP_TO_EDGE);
            context.texParameteri(context.TEXTURE_2D, context.TEXTURE_MAG_FILTER, context.NEAREST);
            context.texImage2D( context.TEXTURE_2D, 0, context.DEPTH_COMPONENT24, this.opaqueFramebufferWidth, this.opaqueFramebufferHeight, 0, context.DEPTH_COMPONENT, context.UNSIGNED_INT, null);
            context.bindTexture(context.TEXTURE_2D, null);


            this.colorRenderBuffer = context.createRenderbuffer();
            context.bindRenderbuffer(context.RENDERBUFFER, this.colorRenderBuffer);
            context.renderbufferStorageMultisample( context.RENDERBUFFER, samples, context.RGBA8,  this.opaqueFramebufferWidth, this.opaqueFramebufferHeight);

            this.depthRenderBuffer = context.createRenderbuffer();
            context.bindRenderbuffer(context.RENDERBUFFER, this.depthRenderBuffer);
            context.renderbufferStorageMultisample( context.RENDERBUFFER,
                samples,
                context.DEPTH_COMPONENT24, 
                this.opaqueFramebufferWidth,
                this.opaqueFramebufferHeight);

            this.samples = samples;

            this.opaqueFramebufferMSAA = context.createFramebuffer();
            context.bindFramebuffer(context.FRAMEBUFFER, this.opaqueFramebufferMSAA);
            context.framebufferRenderbuffer(context.FRAMEBUFFER, context.COLOR_ATTACHMENT0, context.RENDERBUFFER, this.colorRenderBuffer);
            context.framebufferRenderbuffer(context.FRAMEBUFFER, context.DEPTH_ATTACHMENT, context.RENDERBUFFER, this.depthRenderBuffer);


            this.opaqueFramebuffer = context.createFramebuffer();
            context.bindFramebuffer(context.FRAMEBUFFER, this.opaqueFramebuffer);
            context.framebufferTexture2D(context.FRAMEBUFFER, context.COLOR_ATTACHMENT0, context.TEXTURE_2D, this.opaqueRenderTexture, 0);
            context.framebufferTexture2D(context.FRAMEBUFFER, context.DEPTH_ATTACHMENT, context.TEXTURE_2D, this.opaqueDepthTexture, 0);
            context.viewport(0, 0, this.opaqueFramebufferWidth, this.opaqueFramebufferHeight);
            context.bindFramebuffer(context.FRAMEBUFFER, null);

            this.maxVertAttributes = context.getParameter(context.MAX_VERTEX_ATTRIBS);

            this.initialized = true;

            this.environmentRenderer = new EnvironmentRenderer(this.webGl);
        }
        else {
            if (this.samples != samples)
            {
                this.samples = samples;
                context.bindRenderbuffer(context.RENDERBUFFER, this.colorRenderBuffer);
                context.renderbufferStorageMultisample( context.RENDERBUFFER,
                    samples,
                    context.RGBA8, 
                    this.opaqueFramebufferWidth,
                    this.opaqueFramebufferHeight);
                
                context.bindRenderbuffer(context.RENDERBUFFER, this.depthRenderBuffer);
                context.renderbufferStorageMultisample( context.RENDERBUFFER,
                    samples,
                    context.DEPTH_COMPONENT16, 
                    this.opaqueFramebufferWidth,
                    this.opaqueFramebufferHeight);
            }
        }
    }

    resize(width, height)
    {
        if (this.currentWidth !== width || this.currentHeight !== height)
        {
            this.currentHeight = height;
            this.currentWidth = width;
            this.webGl.context.viewport(0, 0, width, height);
        }
    }

    // frame state
    clearFrame(clearColor)
    {
        this.webGl.context.bindFramebuffer(this.webGl.context.FRAMEBUFFER, null);
        this.webGl.context.clearColor(...clearColor);
        this.webGl.context.clear(GL.COLOR_BUFFER_BIT | GL.DEPTH_BUFFER_BIT);
        this.webGl.context.bindFramebuffer(this.webGl.context.FRAMEBUFFER, this.opaqueFramebuffer);
        this.webGl.context.clearColor(...clearColor);
        this.webGl.context.clear(GL.COLOR_BUFFER_BIT | GL.DEPTH_BUFFER_BIT);
        this.webGl.context.bindFramebuffer(this.webGl.context.FRAMEBUFFER, null);
        this.webGl.context.bindFramebuffer(this.webGl.context.FRAMEBUFFER, this.opaqueFramebufferMSAA);
        this.webGl.context.clearColor(...clearColor);
        this.webGl.context.clear(GL.COLOR_BUFFER_BIT | GL.DEPTH_BUFFER_BIT);
        this.webGl.context.bindFramebuffer(this.webGl.context.FRAMEBUFFER, null);
    }

    prepareScene(state, scene) {
        this.nodes = scene.gatherNodes(state.gltf);

        // collect drawables by essentially zipping primitives (for geometry and material)
        // and nodes for the transform
        const drawables = this.nodes
            .filter(node => node.mesh !== undefined)
            .reduce((acc, node) => acc.concat(state.gltf.meshes[node.mesh].primitives.map( (primitive, index) => {
                return  {node: node, primitive: primitive, primitiveIndex: index};
            })), [])
            .filter(({primitive}) => primitive.material !== undefined);

        // opaque drawables don't need sorting
        this.opaqueDrawables = drawables
            .filter(({primitive}) => state.gltf.materials[primitive.material].alphaMode !== "BLEND"
                && (state.gltf.materials[primitive.material].extensions === undefined
                    || state.gltf.materials[primitive.material].extensions.KHR_materials_transmission === undefined));
        
        let counter = 0;
        this.opaqueDrawables = Object.groupBy(this.opaqueDrawables, (a) => {
            const winding = Math.sign(mat4.determinant(a.node.worldTransform));
            const id = `${a.node.mesh}_${winding}_${a.primitiveIndex}`;
            // Disable instancing for skins, morph targets and if the GPU attributes limit is reached.
            // Additionally we define a new id for each instance of the EXT_mesh_gpu_instancing extension.
            if (a.node.skin || a.primitive.targets.length > 0 || a.primitive.glAttributes.length + 4 > this.maxVertAttributes || a.node.instanceMatrices) {
                if (a.node.instanceMatrices && a.primitive.glAttributes.length + 4 > this.maxVertAttributes) {
                    console.warn(`EXT_mesh_gpu_instancing disabled for mesh ${a.node.mesh} because the GPU vertex attribute limit is reached.`);
                }
                counter++;
                return id + "_" + counter;
            }
            return id;
        });

        // transparent drawables need sorting before they can be drawn
        this.transparentDrawables = drawables
            .filter(({primitive}) => state.gltf.materials[primitive.material].alphaMode === "BLEND"
                && (state.gltf.materials[primitive.material].extensions === undefined
                    || state.gltf.materials[primitive.material].extensions.KHR_materials_transmission === undefined));

        this.transmissionDrawables = drawables
            .filter(({primitive}) => state.gltf.materials[primitive.material].extensions !== undefined
                && state.gltf.materials[primitive.material].extensions.KHR_materials_transmission !== undefined);
    }

    // render complete gltf scene with given camera
    drawScene(state, scene)
    {
        if (this.preparedScene !== scene) {
            this.prepareScene(state, scene);
            this.preparedScene = scene;
        }

        let currentCamera = undefined;

        if (state.cameraIndex === undefined)
        {
            currentCamera = state.userCamera;
            currentCamera.perspective.aspectRatio = this.currentWidth / this.currentHeight;
        }
        else
        {
            currentCamera = state.gltf.cameras[state.cameraIndex];
        }

        let aspectHeight = this.currentHeight;
        let aspectWidth = this.currentWidth;
        let aspectOffsetX = 0;
        let aspectOffsetY = 0;
        const currentAspectRatio = aspectWidth / aspectHeight;
        if (currentCamera.type === "perspective") {
            if (currentCamera.perspective.aspectRatio) {
                if (currentCamera.perspective.aspectRatio > currentAspectRatio) {
                    aspectHeight = aspectWidth * 1 / currentCamera.perspective.aspectRatio;
                } else {
                    aspectWidth = aspectHeight * currentCamera.perspective.aspectRatio;
                }
            }
        } else {
            const orthoAspect = currentCamera.orthographic.xmag / currentCamera.orthographic.ymag;
            if (orthoAspect > currentAspectRatio) {
                aspectHeight = aspectWidth * 1 / orthoAspect;
            } else {
                aspectWidth = aspectHeight * orthoAspect;
            }
        }
        if (aspectHeight < this.currentHeight) {
            aspectOffsetY = (this.currentHeight - aspectHeight) / 2;
        }
        if (aspectWidth < this.currentWidth) {
            aspectOffsetX = (this.currentWidth - aspectWidth) / 2;
        }

        this.projMatrix = currentCamera.getProjectionMatrix(currentAspectRatio);
        this.viewMatrix = currentCamera.getViewMatrix(state.gltf);
        this.currentCameraPosition = currentCamera.getPosition(state.gltf);

        this.visibleLights = this.getVisibleLights(state.gltf, scene.nodes);
        if (this.visibleLights.length === 0 && !state.renderingParameters.useIBL &&
            state.renderingParameters.useDirectionalLightsWithDisabledIBL)
        {
            this.visibleLights.push([null, this.lightKey]);
            this.visibleLights.push([null, this.lightFill]);
        }

        mat4.multiply(this.viewProjectionMatrix, this.projMatrix, this.viewMatrix);

        // Update skins.
        for (const node of this.nodes)
        {
            if (node.mesh !== undefined && node.skin !== undefined)
            {
                this.updateSkin(state, node);
            }
        }

        const instanceWorldTransforms = [];
        for (const instance of Object.values(this.opaqueDrawables))
        {  
            let instanceOffset = undefined;
            if (instance.length > 1) {
                instanceOffset = [];
                for (const iDrawable of instance) {
                    instanceOffset.push(iDrawable.node.worldTransform);
                }
            } else if (instance[0].node.instanceMatrices !== undefined) {
                // Set instance matrices for EXT_mesh_gpu_instancing extension
                if (instance[0].primitive.glAttributes.length + 4 <= this.maxVertAttributes) {
                    instanceOffset = instance[0].node.instanceWorldTransforms;
                }
            }
            instanceWorldTransforms.push(instanceOffset);
        }

        // If any transmissive drawables are present, render all opaque and transparent drawables into a separate framebuffer.
        if (this.transmissionDrawables.length > 0) {
            // Render transmission sample texture
            this.webGl.context.bindFramebuffer(this.webGl.context.FRAMEBUFFER, this.opaqueFramebufferMSAA);
            this.webGl.context.viewport(0, 0, this.opaqueFramebufferWidth, this.opaqueFramebufferHeight);

            // Render environment for the transmission background
            this.environmentRenderer.drawEnvironmentMap(this.webGl, this.viewProjectionMatrix, state, this.shaderCache, ["LINEAR_OUTPUT 1"]);

            let drawableCounter = 0;
            for (const instance of Object.values(this.opaqueDrawables))
            {
                const drawable = instance[0];
                let renderpassConfiguration = {};
                renderpassConfiguration.linearOutput = true;
                const instanceOffset = instanceWorldTransforms[drawableCounter];
                drawableCounter++;
                this.drawPrimitive(state, renderpassConfiguration, drawable.primitive, drawable.node, this.viewProjectionMatrix, undefined, instanceOffset);
            }

            this.transparentDrawables = currentCamera.sortPrimitivesByDepth(state.gltf, this.transparentDrawables);
            for (const drawable of this.transparentDrawables)
            {
                let renderpassConfiguration = {};
                renderpassConfiguration.linearOutput = true;
                this.drawPrimitive(state, renderpassConfiguration, drawable.primitive, drawable.node, this.viewProjectionMatrix);
            }

            // "blit" the multisampled opaque texture into the color buffer, which adds antialiasing
            this.webGl.context.bindFramebuffer(this.webGl.context.READ_FRAMEBUFFER, this.opaqueFramebufferMSAA);
            this.webGl.context.bindFramebuffer(this.webGl.context.DRAW_FRAMEBUFFER, this.opaqueFramebuffer);
            this.webGl.context.blitFramebuffer(0, 0, this.opaqueFramebufferWidth, this.opaqueFramebufferHeight, 0, 0, this.opaqueFramebufferWidth, this.opaqueFramebufferHeight, this.webGl.context.COLOR_BUFFER_BIT, this.webGl.context.NEAREST);

            // Create Framebuffer Mipmaps
            this.webGl.context.bindTexture(this.webGl.context.TEXTURE_2D, this.opaqueRenderTexture);

            this.webGl.context.generateMipmap(this.webGl.context.TEXTURE_2D);
        }

        // Render to canvas
        this.webGl.context.bindFramebuffer(this.webGl.context.FRAMEBUFFER, null);
        this.webGl.context.viewport(aspectOffsetX, aspectOffsetY,  aspectWidth, aspectHeight);

        // Render environment
        const fragDefines = [];
        this.pushFragParameterDefines(fragDefines, state);
        this.environmentRenderer.drawEnvironmentMap(this.webGl, this.viewProjectionMatrix, state, this.shaderCache, fragDefines);

        let drawableCounter = 0;
        for (const instance of Object.values(this.opaqueDrawables))
        {  
            const drawable = instance[0];
            let renderpassConfiguration = {};
            renderpassConfiguration.linearOutput = false;
            const instanceOffset = instanceWorldTransforms[drawableCounter];
            drawableCounter++;
            this.drawPrimitive(state, renderpassConfiguration, drawable.primitive, drawable.node, this.viewProjectionMatrix, undefined, instanceOffset);
        }

        // filter materials with transmission extension
        this.transmissionDrawables = currentCamera.sortPrimitivesByDepth(state.gltf, this.transmissionDrawables);
        for (const drawable of this.transmissionDrawables.filter((a) => a.depth <= 0))
        {
            let renderpassConfiguration = {};
            renderpassConfiguration.linearOutput = false;
            this.drawPrimitive(state, renderpassConfiguration, drawable.primitive, drawable.node, this.viewProjectionMatrix, this.opaqueRenderTexture);
        }


        this.transparentDrawables = currentCamera.sortPrimitivesByDepth(state.gltf, this.transparentDrawables);
        for (const drawable of this.transparentDrawables.filter((a) => a.depth <= 0))
        {
            let renderpassConfiguration = {};
            renderpassConfiguration.linearOutput = false;
            this.drawPrimitive(state, renderpassConfiguration, drawable.primitive, drawable.node, this.viewProjectionMatrix);
        }
    }

    // vertices with given material
    drawPrimitive(state, renderpassConfiguration, primitive, node, viewProjectionMatrix, transmissionSampleTexture, instanceOffset = undefined)
    {
        if (primitive.skip) return;

        let material;
        if(primitive.mappings !== undefined && state.variant != "default")
        {
            const names = state.gltf.variants.map(obj => obj.name);
            const idx = names.indexOf(state.variant);
            let materialIdx = primitive.material;
            primitive.mappings.forEach(element => {
                if(element.variants.indexOf(idx) >= 0)
                {
                    materialIdx = element.material;
                }
            });
            material = state.gltf.materials[materialIdx];
        }
        else
        {
            material = state.gltf.materials[primitive.material];
        }

        //select shader permutation, compile and link program.

        let vertDefines = [];
        this.pushVertParameterDefines(vertDefines, state.renderingParameters, state.gltf, node, primitive);
        vertDefines = primitive.defines.concat(vertDefines);
        if (instanceOffset !== undefined) {
            vertDefines.push("USE_INSTANCING 1");
        }
        if (material.textureTransforms.length > 0) {
            for (let i = 0; i < material.textureTransforms.length; i++) {
                if (material.textureTransforms[i] !== undefined && material.textureTransforms[i].key === "Normal") {
                    vertDefines.push("HAS_VERT_NORMAL_UV_TRANSFORM 1");
                    break;
                }
            }
        }

        let fragDefines = material.getDefines(state.renderingParameters).concat(vertDefines);
        if (renderpassConfiguration.linearOutput)
        {
            fragDefines.push("LINEAR_OUTPUT 1");
        }

        // POINTS, LINES, LINE_LOOP, LINE_STRIP
        if (primitive.mode < 4) {
            fragDefines.push("NOT_TRIANGLE 1");
            if (primitive.attributes?.NORMAL !== undefined && primitive.attributes?.TANGENT === undefined) {
                //Points or Lines with NORMAL but without TANGENT attributes SHOULD be rendered with standard lighting but ignoring any normal textures on the material.
                fragDefines = fragDefines.filter(e => e !== "HAS_NORMAL_MAP 1" && e !== "HAS_CLEARCOAT_NORMAL_MAP 1");
            }
        }

        this.pushFragParameterDefines(fragDefines, state);
        
        const fragmentShader = material.type === "SG" ? "specular_glossiness.frag" : "pbr.frag";

        const fragmentHash = this.shaderCache.selectShader(fragmentShader, fragDefines);
        const vertexHash = this.shaderCache.selectShader("primitive.vert", vertDefines);

        if (fragmentHash && vertexHash)
        {
            this.shader = this.shaderCache.getShaderProgram(fragmentHash, vertexHash);
        }

        if (this.shader === undefined)
        {
            return;
        }

        this.webGl.context.useProgram(this.shader.program);

        if (state.renderingParameters.usePunctual)
        {
            this.applyLights();
        }

        // update model dependant matrices once per node
        this.shader.updateUniform("u_ViewProjectionMatrix", viewProjectionMatrix);
        this.shader.updateUniform("u_ModelMatrix", node.worldTransform);
        this.shader.updateUniform("u_NormalMatrix", node.normalMatrix, false);
        this.shader.updateUniform("u_Exposure", state.renderingParameters.exposure, false);
        this.shader.updateUniform("u_Camera", this.currentCameraPosition, false);
        

        this.updateAnimationUniforms(state, node, primitive);

        if (mat4.determinant(node.worldTransform) < 0.0)
        {
            this.webGl.context.frontFace(GL.CW);
        }
        else
        {
            this.webGl.context.frontFace(GL.CCW);
        }

        if (material.doubleSided)
        {
            this.webGl.context.disable(GL.CULL_FACE);
        }
        else
        {
            this.webGl.context.enable(GL.CULL_FACE);
        }
    
        if (material.alphaMode === 'BLEND')
        {
            this.webGl.context.enable(GL.BLEND);
            this.webGl.context.blendFuncSeparate(GL.SRC_ALPHA, GL.ONE_MINUS_SRC_ALPHA, GL.ONE, GL.ONE_MINUS_SRC_ALPHA);
            this.webGl.context.blendEquation(GL.FUNC_ADD);
        }
        else
        {
            this.webGl.context.disable(GL.BLEND);
        }
        

        const drawIndexed = primitive.indices !== undefined;
        if (drawIndexed)
        {
            if (!this.webGl.setIndices(state.gltf, primitive.indices))
            {
                return;
            }
        }

        let vertexCount = 0;
        for (const attribute of primitive.glAttributes)
        {
            const gltfAccessor = state.gltf.accessors[attribute.accessor];
            vertexCount = gltfAccessor.count;

            const location = this.shader.getAttributeLocation(attribute.name);
            if (location === null)
            {
                continue; // only skip this attribute
            }
            if (!this.webGl.enableAttribute(state.gltf, location, gltfAccessor))
            {
                return; // skip this primitive
            }
        }

        if (instanceOffset !== undefined) {
            const location = this.shader.getAttributeLocation("a_instance_model_matrix");
            const location2 = location + 1;
            const location3 = location2 + 1;
            const location4 = location3 + 1;
            if (this.instanceBuffer === undefined) {
                this.instanceBuffer = this.webGl.context.createBuffer();
            }
            this.webGl.context.enableVertexAttribArray(location);
            this.webGl.context.enableVertexAttribArray(location2);
            this.webGl.context.enableVertexAttribArray(location3);
            this.webGl.context.enableVertexAttribArray(location4);

            this.webGl.context.bindBuffer(GL.ARRAY_BUFFER, this.instanceBuffer);
            const data = new Float32Array(instanceOffset.length * 16);
            instanceOffset.forEach((element, index) => {
                data.set(element, 16 * index);
            });
            this.webGl.context.bufferData(GL.ARRAY_BUFFER, data, GL.DYNAMIC_DRAW);
            this.webGl.context.vertexAttribPointer(location, 4, GL.FLOAT, GL.FALSE, 4 * 16, 0);
            this.webGl.context.vertexAttribPointer(location2, 4, GL.FLOAT, GL.FALSE, 4 * 16, 4 * 4);
            this.webGl.context.vertexAttribPointer(location3, 4, GL.FLOAT, GL.FALSE, 4 * 16, 4 * 8);
            this.webGl.context.vertexAttribPointer(location4, 4, GL.FLOAT, GL.FALSE, 4 * 16, 4 * 12);
            
            this.webGl.context.vertexAttribDivisor(location, 1);
            this.webGl.context.vertexAttribDivisor(location2, 1);
            this.webGl.context.vertexAttribDivisor(location3, 1);
            this.webGl.context.vertexAttribDivisor(location4, 1);
        }

        // Update material uniforms
        material.updateTextureTransforms(this.shader);

        this.shader.updateUniform("u_EmissiveFactor", jsToGl(material.emissiveFactor));
        this.shader.updateUniform("u_AlphaCutoff", material.alphaCutoff);

        this.shader.updateUniform("u_NormalScale", material.normalTexture?.scale);
        this.shader.updateUniform("u_NormalUVSet", material.normalTexture?.texCoord);

        this.shader.updateUniform("u_OcclusionStrength", material.occlusionTexture?.strength);
        this.shader.updateUniform("u_OcclusionUVSet", material.occlusionTexture?.texCoord);

        this.shader.updateUniform("u_EmissiveUVSet", material.emissiveTexture?.texCoord);

        this.shader.updateUniform("u_BaseColorUVSet", material.pbrMetallicRoughness?.baseColorTexture?.texCoord);
        
        this.shader.updateUniform("u_MetallicRoughnessUVSet", material.pbrMetallicRoughness?.metallicRoughnessTexture?.texCoord);
        this.shader.updateUniform("u_MetallicFactor", material.pbrMetallicRoughness?.metallicFactor);
        this.shader.updateUniform("u_RoughnessFactor", material.pbrMetallicRoughness?.roughnessFactor);
        this.shader.updateUniform("u_BaseColorFactor", jsToGl(material.pbrMetallicRoughness?.baseColorFactor));

        this.shader.updateUniform("u_AnisotropyUVSet", material.extensions?.KHR_materials_anisotropy?.anisotropyTexture?.texCoord);

        const factor = material.extensions?.KHR_materials_anisotropy?.anisotropyStrength;
        const rotation = material.extensions?.KHR_materials_anisotropy?.anisotropyRotation;
        const anisotropy =  vec3.fromValues(Math.cos(rotation ?? 0), Math.sin(rotation ?? 0), factor ?? 0.0);
        this.shader.updateUniform("u_Anisotropy", anisotropy);

        this.shader.updateUniform("u_ClearcoatFactor", material.extensions?.KHR_materials_clearcoat?.clearcoatFactor);
        this.shader.updateUniform("u_ClearcoatRoughnessFactor", material.extensions?.KHR_materials_clearcoat?.clearcoatRoughnessFactor);
        this.shader.updateUniform("u_ClearcoatUVSet", material.extensions?.KHR_materials_clearcoat?.clearcoatTexture?.texCoord);
        this.shader.updateUniform("u_ClearcoatRoughnessUVSet", material.extensions?.KHR_materials_clearcoat?.clearcoatRoughnessTexture?.texCoord);
        this.shader.updateUniform("u_ClearcoatNormalUVSet", material.extensions?.KHR_materials_clearcoat?.clearcoatNormalTexture?.texCoord);
        this.shader.updateUniform("u_ClearcoatNormalScale", material.extensions?.KHR_materials_clearcoat?.clearcoatNormalTexture?.scale);

        this.shader.updateUniform("u_Dispersion", material.extensions?.KHR_materials_dispersion?.dispersion);

        this.shader.updateUniform("u_EmissiveStrength", material.extensions?.KHR_materials_emissive_strength?.emissiveStrength);

        this.shader.updateUniform("u_Ior", material.extensions?.KHR_materials_ior?.ior);

        this.shader.updateUniform("u_IridescenceFactor", material.extensions?.KHR_materials_iridescence?.iridescenceFactor);
        this.shader.updateUniform("u_IridescenceIor", material.extensions?.KHR_materials_iridescence?.iridescenceIor);
        this.shader.updateUniform("u_IridescenceThicknessMaximum", material.extensions?.KHR_materials_iridescence?.iridescenceThicknessMaximum);
        this.shader.updateUniform("u_IridescenceUVSet", material.extensions?.KHR_materials_iridescence?.iridescenceTexture?.texCoord);
        this.shader.updateUniform("u_IridescenceThicknessUVSet", material.extensions?.KHR_materials_iridescence?.iridescenceThicknessTexture?.texCoord);
        this.shader.updateUniform("u_IridescenceThicknessMinimum", material.extensions?.KHR_materials_iridescence?.iridescenceThicknessMinimum);

        this.shader.updateUniform("u_SheenRoughnessFactor", material.extensions?.KHR_materials_sheen?.sheenRoughnessFactor);
        this.shader.updateUniform("u_SheenColorFactor", jsToGl(material.extensions?.KHR_materials_sheen?.sheenColorFactor));
        this.shader.updateUniform("u_SheenRoughnessUVSet", material.extensions?.KHR_materials_sheen?.sheenRoughnessTexture?.texCoord);
        this.shader.updateUniform("u_SheenColorUVSet", material.extensions?.KHR_materials_sheen?.sheenColorTexture?.texCoord);
        
        this.shader.updateUniform("u_KHR_materials_specular_specularColorFactor", jsToGl(material.extensions?.KHR_materials_specular?.specularColorFactor));
        this.shader.updateUniform("u_KHR_materials_specular_specularFactor", material.extensions?.KHR_materials_specular?.specularFactor);
        this.shader.updateUniform("u_SpecularUVSet", material.extensions?.KHR_materials_specular?.specularTexture?.texCoord);
        this.shader.updateUniform("u_SpecularColorUVSet", material.extensions?.KHR_materials_specular?.specularColorTexture?.texCoord);

        this.shader.updateUniform("u_TransmissionFactor", material.extensions?.KHR_materials_transmission?.transmissionFactor);
        this.shader.updateUniform("u_TransmissionUVSet", material.extensions?.KHR_materials_transmission?.transmissionTexture?.texCoord);

        this.shader.updateUniform("u_AttenuationColor", jsToGl(material.extensions?.KHR_materials_volume?.attenuationColor));
        this.shader.updateUniform("u_AttenuationDistance", material.extensions?.KHR_materials_volume?.attenuationDistance);
        this.shader.updateUniform("u_ThicknessFactor", material.extensions?.KHR_materials_volume?.thicknessFactor);
        this.shader.updateUniform("u_ThicknessUVSet", material.extensions?.KHR_materials_volume?.thicknessTexture?.texCoord);

        this.shader.updateUniform("u_DiffuseTransmissionFactor", material.extensions?.KHR_materials_diffuse_transmission?.diffuseTransmissionFactor);
        this.shader.updateUniform("u_DiffuseTransmissionColorFactor", jsToGl(material.extensions?.KHR_materials_diffuse_transmission?.diffuseTransmissionColorFactor));
        this.shader.updateUniform("u_DiffuseTransmissionUVSet", material.extensions?.KHR_materials_diffuse_transmission?.diffuseTransmissionTexture?.texCoord);
        this.shader.updateUniform("u_DiffuseTransmissionColorUVSet", material.extensions?.KHR_materials_diffuse_transmission?.diffuseTransmissionColorTexture?.texCoord);

        this.shader.updateUniform("u_DiffuseFactor", jsToGl(material.extensions?.KHR_materials_pbrSpecularGlossiness?.diffuseFactor));
        this.shader.updateUniform("u_SpecularFactor", jsToGl(material.extensions?.KHR_materials_pbrSpecularGlossiness?.specularFactor));
        this.shader.updateUniform("u_GlossinessFactor", material.extensions?.KHR_materials_pbrSpecularGlossiness?.glossinessFactor);
        this.shader.updateUniform("u_SpecularGlossinessUVSet", material.extensions?.KHR_materials_pbrSpecularGlossiness?.specularGlossinessTexture?.texCoord);
        this.shader.updateUniform("u_DiffuseUVSet", material.extensions?.KHR_materials_pbrSpecularGlossiness?.diffuseTexture?.texCoord);
    
        let textureIndex = 0;
        for (; textureIndex < material.textures.length; ++textureIndex)
        {
            let info = material.textures[textureIndex];
            const location = this.shader.getUniformLocation(info.samplerName);
            if (!this.webGl.setTexture(location, state.gltf, info, textureIndex))
            {
                continue;
            }
        }


        // set the morph target texture
        if (primitive.morphTargetTextureInfo !== undefined) 
        {
            const location = this.shader.getUniformLocation(primitive.morphTargetTextureInfo.samplerName);
            this.webGl.setTexture(location, state.gltf, primitive.morphTargetTextureInfo, textureIndex); // binds texture and sampler
            textureIndex++;
        }

        // set the joints texture
        if (state.renderingParameters.skinning && node.skin !== undefined && primitive.hasWeights && primitive.hasJoints) 
        {
            const skin = state.gltf.skins[node.skin];
            const location = this.shader.getUniformLocation(skin.jointTextureInfo.samplerName);
            this.webGl.setTexture(location, state.gltf, skin.jointTextureInfo, textureIndex); // binds texture and sampler
            textureIndex++;
        }

        let textureCount = textureIndex;

        textureCount = this.applyEnvironmentMap(state, textureCount);


        if (state.environment !== undefined)
        {
            this.webGl.setTexture(this.shader.getUniformLocation("u_SheenELUT"), state.environment, state.environment.sheenELUT, textureCount++);
        }

        if(transmissionSampleTexture !== undefined &&
            state.environment &&
            state.renderingParameters.enabledExtensions.KHR_materials_transmission)
        {
            this.webGl.context.activeTexture(GL.TEXTURE0 + textureCount);
            this.webGl.context.bindTexture(this.webGl.context.TEXTURE_2D, this.opaqueRenderTexture);
            this.webGl.context.uniform1i(this.shader.getUniformLocation("u_TransmissionFramebufferSampler"), textureCount);
            textureCount++;

            this.webGl.context.uniform2i(this.shader.getUniformLocation("u_TransmissionFramebufferSize"), this.opaqueFramebufferWidth, this.opaqueFramebufferHeight);

            this.webGl.context.uniformMatrix4fv(this.shader.getUniformLocation("u_ModelMatrix"),false, node.worldTransform);
            this.webGl.context.uniformMatrix4fv(this.shader.getUniformLocation("u_ViewMatrix"),false, this.viewMatrix);
            this.webGl.context.uniformMatrix4fv(this.shader.getUniformLocation("u_ProjectionMatrix"),false, this.projMatrix);
        }

        if (drawIndexed)
        {
            const indexAccessor = state.gltf.accessors[primitive.indices];
            if (instanceOffset !== undefined) {
                this.webGl.context.drawElementsInstanced(primitive.mode, indexAccessor.count, indexAccessor.componentType, 0, instanceOffset.length);
            } else {
                this.webGl.context.drawElements(primitive.mode, indexAccessor.count, indexAccessor.componentType, 0);
            }
        }
        else
        {
            if (instanceOffset !== undefined) {
                this.webGl.context.drawArraysInstanced(primitive.mode, 0, vertexCount, instanceOffset.length);
            } else {
                this.webGl.context.drawArrays(primitive.mode, 0, vertexCount);
            }
        }

        for (const attribute of primitive.glAttributes)
        {
            const location = this.shader.getAttributeLocation(attribute.name);
            if (location === null)
            {
                continue; // skip this attribute
            }
            this.webGl.context.disableVertexAttribArray(location);
        }
        if (instanceOffset !== undefined) {
            const location = this.shader.getAttributeLocation("a_instance_model_matrix");
            this.webGl.context.vertexAttribDivisor(location, 0);
            this.webGl.context.vertexAttribDivisor(location + 1, 0);
            this.webGl.context.vertexAttribDivisor(location + 2, 0);
            this.webGl.context.vertexAttribDivisor(location + 3, 0);
            this.webGl.context.disableVertexAttribArray(location);
            this.webGl.context.disableVertexAttribArray(location + 1);
            this.webGl.context.disableVertexAttribArray(location + 2);
            this.webGl.context.disableVertexAttribArray(location + 3);
        }
    }

    /// Compute a list of lights instantiated by one or more nodes as a list of node-light tuples.
    getVisibleLights(gltf, nodes)
    {
        let nodeLights = [];

        for (const nodeIndex of nodes) {
            const node = gltf.nodes[nodeIndex];

            if (node.children !== undefined) {
                nodeLights = nodeLights.concat(this.getVisibleLights(gltf, node.children));
            }

            const lightIndex = node.extensions?.KHR_lights_punctual?.light;
            if (lightIndex === undefined) {
                continue;
            }
            const light = gltf.lights[lightIndex];
            nodeLights.push([node, light]);
        }

        return nodeLights;
    }

    updateSkin(state, node)
    {
        if (state.renderingParameters.skinning && state.gltf.skins !== undefined)
        {
            const skin = state.gltf.skins[node.skin];
            skin.computeJoints(state.gltf, this.webGl.context);
        }
    }

    pushVertParameterDefines(vertDefines, parameters, gltf, node, primitive)
    {
        // skinning
        if (parameters.skinning && node.skin !== undefined && primitive.hasWeights && primitive.hasJoints)
        {
            vertDefines.push("USE_SKINNING 1");
        }

        // morphing
        if (parameters.morphing && node.mesh !== undefined && primitive.targets.length > 0)
        {
            const weights = node.getWeights(gltf);
            if (weights !== undefined && weights.length > 0)
            {
                vertDefines.push("USE_MORPHING 1");
                vertDefines.push("WEIGHT_COUNT " + weights.length);
            }
        }
    }

    updateAnimationUniforms(state, node, primitive)
    {
        if (state.renderingParameters.morphing && node.mesh !== undefined && primitive.targets.length > 0)
        {
            const weights = node.getWeights(state.gltf);
            if (weights !== undefined && weights.length > 0)
            {
                this.shader.updateUniformArray("u_morphWeights", weights);
            }
        }
    }

    pushFragParameterDefines(fragDefines, state)
    {
        if (state.renderingParameters.usePunctual)
        {
            fragDefines.push("USE_PUNCTUAL 1");
            fragDefines.push(`LIGHT_COUNT ${this.visibleLights.length}`);
        }

        if (state.renderingParameters.useIBL && state.environment)
        {
            fragDefines.push("USE_IBL 1");
        }

        switch (state.renderingParameters.toneMap)
        {
        case (GltfState.ToneMaps.KHR_PBR_NEUTRAL):
            fragDefines.push("TONEMAP_KHR_PBR_NEUTRAL 1");
            break;
        case (GltfState.ToneMaps.ACES_NARKOWICZ):
            fragDefines.push("TONEMAP_ACES_NARKOWICZ 1");
            break;
        case (GltfState.ToneMaps.ACES_HILL):
            fragDefines.push("TONEMAP_ACES_HILL 1");
            break;
        case (GltfState.ToneMaps.ACES_HILL_EXPOSURE_BOOST):
            fragDefines.push("TONEMAP_ACES_HILL_EXPOSURE_BOOST 1");
            break;
        case (GltfState.ToneMaps.NONE):
        default:
            break;
        }

        let debugOutputMapping = [
            {debugOutput: GltfState.DebugOutput.NONE, shaderDefine: "DEBUG_NONE"},
            
            {debugOutput: GltfState.DebugOutput.generic.WORLDSPACENORMAL, shaderDefine: "DEBUG_NORMAL_SHADING"},
            {debugOutput: GltfState.DebugOutput.generic.NORMAL, shaderDefine: "DEBUG_NORMAL_TEXTURE"},
            {debugOutput: GltfState.DebugOutput.generic.GEOMETRYNORMAL, shaderDefine: "DEBUG_NORMAL_GEOMETRY"},
            {debugOutput: GltfState.DebugOutput.generic.TANGENT, shaderDefine: "DEBUG_TANGENT"},
            {debugOutput: GltfState.DebugOutput.generic.BITANGENT, shaderDefine: "DEBUG_BITANGENT"},
            {debugOutput: GltfState.DebugOutput.generic.ALPHA, shaderDefine: "DEBUG_ALPHA"},
            {debugOutput: GltfState.DebugOutput.generic.UV_COORDS_0, shaderDefine: "DEBUG_UV_0"},
            {debugOutput: GltfState.DebugOutput.generic.UV_COORDS_1, shaderDefine: "DEBUG_UV_1"},
            {debugOutput: GltfState.DebugOutput.generic.OCCLUSION, shaderDefine: "DEBUG_OCCLUSION"},
            {debugOutput: GltfState.DebugOutput.generic.EMISSIVE, shaderDefine: "DEBUG_EMISSIVE"},

            {debugOutput: GltfState.DebugOutput.mr.BASECOLOR, shaderDefine: "DEBUG_BASE_COLOR"},
            {debugOutput: GltfState.DebugOutput.mr.ROUGHNESS, shaderDefine: "DEBUG_ROUGHNESS"},
            {debugOutput: GltfState.DebugOutput.mr.METALLIC, shaderDefine: "DEBUG_METALLIC"},
            
            {debugOutput: GltfState.DebugOutput.clearcoat.CLEARCOAT_FACTOR, shaderDefine: "DEBUG_CLEARCOAT_FACTOR"},
            {debugOutput: GltfState.DebugOutput.clearcoat.CLEARCOAT_ROUGHNESS, shaderDefine: "DEBUG_CLEARCOAT_ROUGHNESS"},
            {debugOutput: GltfState.DebugOutput.clearcoat.CLEARCOAT_NORMAL, shaderDefine: "DEBUG_CLEARCOAT_NORMAL"},
            
            {debugOutput: GltfState.DebugOutput.sheen.SHEEN_COLOR, shaderDefine: "DEBUG_SHEEN_COLOR"},
            {debugOutput: GltfState.DebugOutput.sheen.SHEEN_ROUGHNESS, shaderDefine: "DEBUG_SHEEN_ROUGHNESS"},

            {debugOutput: GltfState.DebugOutput.specular.SPECULAR_FACTOR, shaderDefine: "DEBUG_SPECULAR_FACTOR"},
            {debugOutput: GltfState.DebugOutput.specular.SPECULAR_COLOR, shaderDefine: "DEBUG_SPECULAR_COLOR"},

            {debugOutput: GltfState.DebugOutput.transmission.TRANSMISSION_FACTOR, shaderDefine: "DEBUG_TRANSMISSION_FACTOR"},
            {debugOutput: GltfState.DebugOutput.transmission.VOLUME_THICKNESS, shaderDefine: "DEBUG_VOLUME_THICKNESS"},

            {debugOutput: GltfState.DebugOutput.diffuseTransmission.DIFFUSE_TRANSMISSION_FACTOR, shaderDefine: "DEBUG_DIFFUSE_TRANSMISSION_FACTOR"},
            {debugOutput: GltfState.DebugOutput.diffuseTransmission.DIFFUSE_TRANSMISSION_COLOR_FACTOR, shaderDefine: "DEBUG_DIFFUSE_TRANSMISSION_COLOR_FACTOR"},

            {debugOutput: GltfState.DebugOutput.iridescence.IRIDESCENCE_FACTOR, shaderDefine: "DEBUG_IRIDESCENCE_FACTOR"},
            {debugOutput: GltfState.DebugOutput.iridescence.IRIDESCENCE_THICKNESS, shaderDefine: "DEBUG_IRIDESCENCE_THICKNESS"},

            {debugOutput: GltfState.DebugOutput.anisotropy.ANISOTROPIC_STRENGTH, shaderDefine: "DEBUG_ANISOTROPIC_STRENGTH"},
            {debugOutput: GltfState.DebugOutput.anisotropy.ANISOTROPIC_DIRECTION, shaderDefine: "DEBUG_ANISOTROPIC_DIRECTION"},
        ];

        let mappingCount = 0;
        let mappingFound = false;
        for (let mapping of debugOutputMapping) {
            fragDefines.push(mapping.shaderDefine+" "+mappingCount++);
            if(state.renderingParameters.debugOutput == mapping.debugOutput){
                fragDefines.push("DEBUG "+mapping.shaderDefine);
                mappingFound = true;
            }
        }

        if(mappingFound == false) { // fallback
            fragDefines.push("DEBUG DEBUG_NONE");
        }

    }

    applyLights()
    {
        const uniforms = [];
        for (const [node, light] of this.visibleLights)
        {
            uniforms.push(light.toUniform(node));
        }
        if (uniforms.length > 0)
        {
            this.shader.updateUniform("u_Lights", uniforms);
        }
    }

    applyEnvironmentMap(state, texSlotOffset)
    {
        const environment = state.environment;
        if (environment === undefined) {
            return texSlotOffset;
        }
        this.webGl.setTexture(this.shader.getUniformLocation("u_LambertianEnvSampler"), environment, environment.diffuseEnvMap, texSlotOffset++);

        this.webGl.setTexture(this.shader.getUniformLocation("u_GGXEnvSampler"), environment, environment.specularEnvMap, texSlotOffset++);
        this.webGl.setTexture(this.shader.getUniformLocation("u_GGXLUT"), environment, environment.lut, texSlotOffset++);

        this.webGl.setTexture(this.shader.getUniformLocation("u_CharlieEnvSampler"), environment, environment.sheenEnvMap, texSlotOffset++);
        this.webGl.setTexture(this.shader.getUniformLocation("u_CharlieLUT"), environment, environment.sheenLUT, texSlotOffset++);

        this.shader.updateUniform("u_MipCount", environment.mipCount);

        let rotMatrix4 = mat4.create();
        mat4.rotateY(rotMatrix4, rotMatrix4,  state.renderingParameters.environmentRotation / 180.0 * Math.PI);
        let rotMatrix3 = mat3.create();
        mat3.fromMat4(rotMatrix3, rotMatrix4);
        this.shader.updateUniform("u_EnvRotation", rotMatrix3);

        let envIntensity = state.renderingParameters.iblIntensity * state.environment.iblIntensityScale;

        if(state.renderingParameters.useIBL === false) {
            envIntensity = 0.0;
        }

        this.shader.updateUniform("u_EnvIntensity", envIntensity);

        return texSlotOffset;
    }

    destroy()
    {
        this.shaderCache.destroy();
    }
}

export { gltfRenderer };
