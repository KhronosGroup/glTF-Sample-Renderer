import { glTF } from "../gltf/gltf.js";
import { GlbParser } from "./glb_parser.js";
import { gltfLoader } from "./loader.js";
import { gltfImage, ImageMimeType } from "../gltf/image.js";
import { gltfTexture, gltfTextureInfo } from "../gltf/texture.js";
import { gltfSampler } from "../gltf/sampler.js";
import { GL } from "../Renderer/webgl.js";
import { iblSampler } from "../ibl_sampler.js";
import init from "../libs/mikktspace.js";

import { AsyncFileReader } from "./async_file_reader.js";

import { MeshoptDecoder } from "meshoptimizer";
import { DracoDecoder } from "./draco.js";
import { KtxDecoder } from "./ktx.js";

import { loadHDR } from "../libs/hdrpng.js";

import { ResourceLoaderUtils } from "./loader_utils.js";
import { loadThumbnail } from "./thumbnail_loader.js";

/**
 * ResourceLoader can be used to load resources for the GltfState
 * that are then used to display the loaded data with GltfView
 */
class ResourceLoader {
    /**
     * ResourceLoader class that provides an interface to load resources into
     * the view. Typically this is created with GltfView.createResourceLoader()
     * You cannot share resource loaders between GltfViews as some of the resources
     * are allocated directly on the WebGl2 Context
     * @param {Object} view the GltfView for which the resources are loaded
     * @param {String} libPath path to the lib folder. This can be used to find the WASM files if sample viewer is repackaged
     */
    constructor(view, libPath = "./libs/") {
        this.view = view;
        this.libPath = libPath;
    }

    /**
     * loadGltf asynchroneously and create resources for rendering
     * @param {(String | ArrayBuffer | File)} gltfFile the .gltf or .glb file either as path or as preloaded resource. In node.js environments, only ArrayBuffer types are accepted.
     * @param {File[]} [externalFiles] additional files containing resources that are referenced in the gltf
     * @param {Boolean} allowResourceAbsolutePath whether to allow absolute paths for images/buffers.
     * @returns {Promise} a promise that fulfills when the gltf file was loaded
     */
    async loadGltf(gltfFile, externalFiles, allowResourceAbsolutePath = true) {
        let isGlb = undefined;
        let appendix = undefined;
        let json = undefined;
        let data = undefined;
        let filename = "";
        if (typeof gltfFile === "string") {
            const response = await fetch(gltfFile);
            const responseData = await response.arrayBuffer();
            const uintData = new Uint8Array(responseData);
            const fileMagicNumbers = new TextDecoder().decode(uintData.subarray(0, 5));

            isGlb = fileMagicNumbers.startsWith("glTF");
            if (isGlb) {
                json = data = responseData;
            } else {
                json = data = JSON.parse(new TextDecoder().decode(uintData));
            }

            filename = gltfFile;
        } else if (gltfFile instanceof ArrayBuffer) {
            isGlb = externalFiles === undefined;
            if (isGlb) {
                data = gltfFile;
            } else {
                console.error("Only .glb files can be loaded from an array buffer");
            }
        } else if (
            Array.isArray(gltfFile) &&
            typeof File !== "undefined" &&
            gltfFile[1] instanceof File
        ) {
            let fileContent = gltfFile[1];
            filename = gltfFile[0];
            isGlb = ResourceLoaderUtils.getExtension(filename) == "glb";
            if (isGlb) {
                data = await AsyncFileReader.readAsArrayBuffer(fileContent);
            } else {
                data = await AsyncFileReader.readAsText(fileContent);
                json = JSON.parse(data);
                appendix = externalFiles;
            }
        } else {
            // Load empty glTF
            data = '{"asset":{"version": "2.0"}}';
            filename = "empty";
            isGlb = false;
            json = JSON.parse(data);
        }

        if (isGlb) {
            const glbParser = new GlbParser(data);
            const glb = glbParser.extractGlbData();
            if (glb === undefined) {
                throw new Error(`Could not read the GLB container of ${filename}`);
            }
            json = glb.json;
            // Buffers bind to chunks by index, so the loader needs the whole chunk table
            // and the parser that can slice it, not just a list of binary payloads.
            appendix = { glb: { ...glb, parser: glbParser } };
        }

        const gltf = new glTF(filename);
        gltf.ktxDecoder = this.view.ktxDecoder;
        gltf.moptDecoder = MeshoptDecoder;
        //Make sure draco decoder instance is ready
        gltf.fromJson(json);

        await init(`${this.libPath}mikktspace_bg.wasm`);
        await gltfLoader.load(gltf, this.view.context, appendix, allowResourceAbsolutePath);

        return gltf;
    }

    /**
     * loadThumbnail reads only the `asset.thumbnail` image of a glTF 2.1 asset, without
     * building a glTF document or touching WebGL. Use it to preview an asset cheaply.
     * @param {(String | ArrayBuffer | Blob)} gltfFile the .gltf or .glb file
     * @param {String} [path] used to resolve relative URIs when gltfFile is not a path
     * @returns {Promise<Object|undefined>} `{ url, mimeType }`, or undefined when the
     *   asset declares no thumbnail. The caller owns `url` and must revoke it.
     */
    async loadThumbnail(gltfFile, path = undefined) {
        return loadThumbnail(gltfFile, path);
    }

    /**
     * loadEnvironment asynchroneously, run IBL sampling and create resources for rendering
     * @param {(String | ArrayBuffer | File)} environmentFile the .hdr file either as path or resource
     * @param {Object} [lutFiles] object containing paths or resources for the environment look up textures. Keys are lut_ggx_file, lut_charlie_file and lut_sheen_E_file
     * @returns {Promise} a promise that fulfills when the environment file was loaded
     */
    async loadEnvironment(environmentFile, lutFiles) {
        let image = undefined;
        if (typeof environmentFile === "string") {
            let response = await fetch(environmentFile);
            image = await loadHDR(new Uint8Array(await response.arrayBuffer()));
        } else if (environmentFile instanceof ArrayBuffer) {
            image = await loadHDR(new Uint8Array(environmentFile));
        } else if (typeof File !== "undefined" && environmentFile instanceof File) {
            const imageData = await AsyncFileReader.readAsArrayBuffer(environmentFile).catch(() => {
                console.error("Could not load image with FileReader");
            });
            image = await loadHDR(new Uint8Array(imageData));
        } else {
            console.error("Passed invalid type to loadEnvironment " + typeof environmentFile);
        }
        if (image === undefined) {
            return undefined;
        }
        return _loadEnvironmentFromPanorama(image, this.view, lutFiles);
    }

    /**
     * initKtxLib must be called before loading gltf files with ktx2 assets
     * @param {Object} [externalKtxLib] external ktx library (for example from a CDN)
     */
    initKtxLib(externalKtxLib) {
        this.view.ktxDecoder = new KtxDecoder(this.view.context, externalKtxLib);
    }

    /**
     * initDracoLib must be called before loading gltf files with draco meshes
     * @param {*} [externalDracoLib] external draco library (for example from a CDN)
     */
    async initDracoLib(externalDracoLib) {
        const dracoDecoder = new DracoDecoder(externalDracoLib);
        if (dracoDecoder !== undefined) {
            await dracoDecoder.ready();
        }
    }
}

async function _loadEnvironmentFromPanorama(imageHDR, view, luts) {
    // The environment uses the same type of samplers, textures and images as used in the glTF class
    // so we just use it as a template
    const environment = new glTF();

    //
    // Prepare samplers.
    //

    let samplerIdx = environment.samplers.length;

    environment.samplers.push(
        new gltfSampler(
            GL.LINEAR,
            GL.LINEAR,
            GL.CLAMP_TO_EDGE,
            GL.CLAMP_TO_EDGE,
            "DiffuseCubeMapSampler"
        )
    );
    const diffuseCubeSamplerIdx = samplerIdx++;

    environment.samplers.push(
        new gltfSampler(
            GL.LINEAR,
            GL.LINEAR_MIPMAP_LINEAR,
            GL.CLAMP_TO_EDGE,
            GL.CLAMP_TO_EDGE,
            "SpecularCubeMapSampler"
        )
    );
    const specularCubeSamplerIdx = samplerIdx++;

    environment.samplers.push(
        new gltfSampler(
            GL.LINEAR,
            GL.LINEAR_MIPMAP_LINEAR,
            GL.CLAMP_TO_EDGE,
            GL.CLAMP_TO_EDGE,
            "SheenCubeMapSampler"
        )
    );
    const sheenCubeSamplerIdx = samplerIdx++;

    environment.samplers.push(
        new gltfSampler(GL.LINEAR, GL.LINEAR, GL.CLAMP_TO_EDGE, GL.CLAMP_TO_EDGE, "LUTSampler")
    );
    const lutSamplerIdx = samplerIdx++;

    //
    // Prepare images and textures.
    //

    let imageIdx = environment.images.length;

    let environmentFiltering = new iblSampler(view);

    environmentFiltering.init(imageHDR);
    environmentFiltering.filterAll();

    // Diffuse

    const diffuseGltfImage = new gltfImage(
        undefined,
        GL.TEXTURE_CUBE_MAP,
        0,
        undefined,
        "Diffuse",
        ImageMimeType.GLTEXTURE,
        environmentFiltering.lambertianTextureID
    );

    environment.images.push(diffuseGltfImage);

    const diffuseTexture = new gltfTexture(
        diffuseCubeSamplerIdx,
        [imageIdx++],
        GL.TEXTURE_CUBE_MAP
    );
    diffuseTexture.initialized = true; // iblsampler has already initialized the texture

    environment.textures.push(diffuseTexture);

    environment.diffuseEnvMap = new gltfTextureInfo(environment.textures.length - 1, 0, true);
    environment.diffuseEnvMap.generateMips = false;

    // Specular
    const specularGltfImage = new gltfImage(
        undefined,
        GL.TEXTURE_CUBE_MAP,
        0,
        undefined,
        "Specular",
        ImageMimeType.GLTEXTURE,
        environmentFiltering.ggxTextureID
    );

    environment.images.push(specularGltfImage);

    const specularTexture = new gltfTexture(
        specularCubeSamplerIdx,
        [imageIdx++],
        GL.TEXTURE_CUBE_MAP
    );
    specularTexture.initialized = true; // iblsampler has already initialized the texture

    environment.textures.push(specularTexture);

    environment.specularEnvMap = new gltfTextureInfo(environment.textures.length - 1, 0, true);
    environment.specularEnvMap.generateMips = false;

    // Sheen
    const sheenGltfImage = new gltfImage(
        undefined,
        GL.TEXTURE_CUBE_MAP,
        0,
        undefined,
        "Sheen",
        ImageMimeType.GLTEXTURE,
        environmentFiltering.sheenTextureID
    );

    environment.images.push(sheenGltfImage);

    const sheenTexture = new gltfTexture(sheenCubeSamplerIdx, [imageIdx++], GL.TEXTURE_CUBE_MAP);
    sheenTexture.initialized = true; // iblsampler has already initialized the texture

    environment.textures.push(sheenTexture);

    environment.sheenEnvMap = new gltfTextureInfo(environment.textures.length - 1, 0, true);
    environment.sheenEnvMap.generateMips = false;

    /*
        // Diffuse

        const lambertian = new gltfImage(filteredEnvironmentsDirectoryPath + "/lambertian/diffuse.ktx2", GL.TEXTURE_CUBE_MAP);
        lambertian.mimeType = ImageMimeType.KTX2;
        environment.images.push(lambertian);
        environment.textures.push(new gltfTexture(diffuseCubeSamplerIdx, [imageIdx++], GL.TEXTURE_CUBE_MAP));
        environment.diffuseEnvMap = new gltfTextureInfo(environment.textures.length - 1, 0, true);
        environment.diffuseEnvMap.generateMips = false;

        // Specular

        const specular = new gltfImage(filteredEnvironmentsDirectoryPath + "/ggx/specular.ktx2", GL.TEXTURE_CUBE_MAP);
        specular.mimeType = ImageMimeType.KTX2;
        environment.images.push(specular);
        environment.textures.push(new gltfTexture(specularCubeSamplerIdx, [imageIdx++], GL.TEXTURE_CUBE_MAP));
        environment.specularEnvMap = new gltfTextureInfo(environment.textures.length - 1, 0, true);
        environment.specularEnvMap.generateMips = false;

        const specularImage = environment.images[environment.textures[environment.textures.length - 1].source];

        // Sheen

        const sheen = new gltfImage(filteredEnvironmentsDirectoryPath + "/charlie/sheen.ktx2", GL.TEXTURE_CUBE_MAP);
        sheen.mimeType = ImageMimeType.KTX2;
        environment.images.push(sheen);
        environment.textures.push(new gltfTexture(sheenCubeSamplerIdx, [imageIdx++], GL.TEXTURE_CUBE_MAP));
        environment.sheenEnvMap = new gltfTextureInfo(environment.textures.length - 1, 0, true);
        environment.sheenEnvMap.generateMips = false;*/

    //
    // Look Up Tables.
    //

    // GGX

    if (luts === undefined) {
        luts = {
            lut_sheen_E_file: "assets/images/lut_sheen_E.png"
        };
    }

    environment.images.push(
        new gltfImage(
            undefined,
            GL.TEXTURE_2D,
            0,
            undefined,
            undefined,
            ImageMimeType.GLTEXTURE,
            environmentFiltering.ggxLutTextureID
        )
    );
    const lutTexture = new gltfTexture(lutSamplerIdx, [imageIdx++], GL.TEXTURE_2D);
    lutTexture.initialized = true; // iblsampler has already initialized the texture
    environment.textures.push(lutTexture);

    environment.lut = new gltfTextureInfo(environment.textures.length - 1, 0, true);
    environment.lut.generateMips = false;

    // Sheen
    // Charlie
    environment.images.push(
        new gltfImage(
            undefined,
            GL.TEXTURE_2D,
            0,
            undefined,
            undefined,
            ImageMimeType.GLTEXTURE,
            environmentFiltering.charlieLutTextureID
        )
    );
    const charlieLut = new gltfTexture(lutSamplerIdx, [imageIdx++], GL.TEXTURE_2D);
    charlieLut.initialized = true; // iblsampler has already initialized the texture
    environment.textures.push(charlieLut);

    environment.sheenLUT = new gltfTextureInfo(environment.textures.length - 1, 0, true);
    environment.sheenLUT.generateMips = false;

    // Sheen E LUT

    environment.images.push(
        new gltfImage(
            luts.lut_sheen_E_file,
            GL.TEXTURE_2D,
            0,
            undefined,
            undefined,
            ImageMimeType.PNG
        )
    );
    const sheenELut = new gltfTexture(lutSamplerIdx, [imageIdx++], GL.TEXTURE_2D);
    sheenELut.initialized = false; // iblsampler does not create this texture
    environment.textures.push(sheenELut);

    environment.sheenELUT = new gltfTextureInfo(environment.textures.length - 1, 0, true);
    environment.sheenELUT.generateMips = false;

    await gltfLoader.loadImages(environment);

    environment.initGl(view.context);

    environment.mipCount = environmentFiltering.mipmapLevels;
    environment.iblIntensityScale = environmentFiltering.scaleValue;

    return environment;
}

export { ResourceLoader };
