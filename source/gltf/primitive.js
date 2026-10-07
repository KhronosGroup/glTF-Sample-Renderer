import { initGlForMembers } from "./utils.js";
import { GltfObject } from "./gltf_object.js";
import { gltfBuffer } from "./buffer.js";
import { gltfAccessor } from "./accessor.js";
import { gltfImage } from "./image.js";
import { ImageMimeType } from "./image_mime_type.js";
import { gltfTexture } from "./texture.js";
import { gltfTextureInfo } from "./texture.js";
import { gltfSampler } from "./sampler.js";
import { gltfBufferView } from "./buffer_view.js";
import { DracoDecoder } from "../ResourceLoader/draco.js";
import { GL } from "../Renderer/webgl.js";
import { generateTangents } from "../libs/mikktspace.js";

class gltfPrimitive extends GltfObject {
    static animatedProperties = [];
    static readOnlyAnimatedProperties = ["material"];
    // The shaders declare this many varyings per indexed semantic.
    static maxTexCoordSlots = 2;
    static maxColorSlots = 1;
    constructor() {
        super();
        this.attributes = {};
        this.targets = [];
        this.indices = undefined;
        this.material = undefined;
        this.mode = GL.TRIANGLES;

        // non gltf
        this.glAttributes = [];
        this.morphTargetTextureInfo = undefined;
        this.defines = [];
        this.skip = true;
        this.hasWeights = false;
        this.hasJoints = false;
        this.hasNormals = false;
        this.hasTangents = false;
        this.hasTexcoord = false;
        this.hasColor = false;
        // glTF set index -> shader slot, since 2.1 allows non-sequential set indices.
        this.texCoordSlots = new Map();
        this.colorSlots = new Map();
        this.warnedMissingTexCoords = new Set();

        // Gaussian Splatting
        this.hasDegree1 = false;
        this.hasDegree2 = false;
        this.hasDegree3 = false;
        this.linear = true;
        this.positionTextureInfo = undefined;
        this.rotationTextureInfo = undefined;
        this.scaleTextureInfo = undefined;
        this.opacityTextureInfo = undefined;
        this.sphericalHarmonicsTextureInfo = undefined;
        this.sortOrder = undefined;
        this.splatTextureWidth = undefined;

        // Worker-based sort state
        this.sortWorker = undefined;
        this.sortWorkerReady = false;
        this.sortPending = false;

        // Store the view matrix if sort is currently running
        this.queuedViewMatrix = undefined;
        // Compare against a stored value to detect whether a redraw is needed.
        this.lastSortViewMatrix = undefined;

        // The primitive centroid is used for depth sorting.
        this.centroid = undefined;
    }

    //Currently only support types relevant for gaussian splatting
    // If an alignment of 4 bytes is not possible for a given format, the correct alignment is returned.
    _getInternalTextureFormat(componentType, componentCount, normalized = false) {
        if (componentType === GL.FLOAT) {
            switch (componentCount) {
                case 1: // OPACITIY
                    return { internalFormat: GL.R32F, format: GL.RED };
                case 3: // POSITION, SCALE, Spherical Harmonics
                    return { internalFormat: GL.RGB32F, format: GL.RGB };
                case 4: // ROTATION
                    return { internalFormat: GL.RGBA32F, format: GL.RGBA };
            }
        }
        if (componentType === GL.UNSIGNED_BYTE) {
            switch (componentCount) {
                case 1: // OPACITY
                    return { internalFormat: GL.R8, format: GL.RED, alignment: 1 }; // Opacity is always normalized
                case 3: // POSITION, SCALE
                    return {
                        internalFormat: normalized ? GL.RGB8 : GL.RGB8UI,
                        format: normalized ? GL.RGB : GL.RGB_INTEGER,
                        alignment: 1
                    };
            }
        }
        if (componentType === GL.BYTE) {
            switch (componentCount) {
                case 3: // POSITION
                    return {
                        internalFormat: normalized ? GL.RGB8_SNORM : GL.RGB8I,
                        format: normalized ? GL.RGB : GL.RGB_INTEGER,
                        alignment: 1
                    };
                case 4: // ROTATION
                    return { internalFormat: GL.RGBA8_SNORM, format: GL.RGBA }; // Rotation is always normalized
            }
        }

        // There is no normalized format for unsigned short and short. Needs to be resolved in the shader
        if (componentType === GL.UNSIGNED_SHORT) {
            switch (componentCount) {
                case 1: // OPACITY
                    return { internalFormat: GL.R16UI, format: GL.RED_INTEGER, alignment: 2 }; // Opacity is always normalized
                case 3: // POSITION, SCALE
                    return { internalFormat: GL.RGB16UI, format: GL.RGB_INTEGER, alignment: 2 };
            }
        }
        if (componentType === GL.SHORT) {
            switch (componentCount) {
                case 3: // POSITION
                    return { internalFormat: GL.RGB16I, format: GL.RGB_INTEGER, alignment: 2 };
                case 4: // ROTATION
                    return { internalFormat: GL.RGBA16I, format: GL.RGBA_INTEGER };
            }
        }
        console.error(
            "Unsupported texture format for componentType:",
            componentType,
            "and componentCount:",
            componentCount
        );
        return undefined;
    }

    _createDataTexture(gltf, webGlContext, attributeName, accessor) {
        if (accessor === undefined) {
            return undefined;
        }
        let texture = webGlContext.createTexture();
        webGlContext.bindTexture(webGlContext.TEXTURE_2D, texture);
        // Set texture format and upload data.
        const componentType = accessor.componentType;
        const componentCount = accessor.getComponentCount(accessor.type);
        const formats = this._getInternalTextureFormat(
            componentType,
            componentCount,
            accessor.normalized
        );
        if (
            formats.format === GL.RED_INTEGER ||
            formats.format === GL.RGB_INTEGER ||
            formats.format === GL.RGBA_INTEGER
        ) {
            if (componentType === GL.UNSIGNED_BYTE || componentType === GL.UNSIGNED_SHORT) {
                this.defines.push(`${attributeName}_IS_UINTEGER 1`);
            } else {
                this.defines.push(`${attributeName}_IS_INTEGER 1`);
            }
            if (accessor.normalized) {
                // Only shorts do not support normalized integer formats, so we need to normalize them manually in the shader.
                this.defines.push(`${attributeName}_NEEDS_NORMALIZATION 1`);
            }
        } else {
            this.defines.push(`${attributeName}_IS_FLOAT 1`);
        }
        const size = Math.ceil(Math.sqrt(accessor.count));
        const data = accessor.getDeinterlacedView(gltf);
        const paddedData = new data.constructor(size * size * componentCount);
        paddedData.set(data);

        webGlContext.pixelStorei(webGlContext.UNPACK_ALIGNMENT, formats.alignment ?? 4);
        webGlContext.texImage2D(
            webGlContext.TEXTURE_2D,
            0, //level
            formats.internalFormat,
            size,
            size,
            0, //border
            formats.format,
            accessor.componentType,
            paddedData
        );
        webGlContext.pixelStorei(webGlContext.UNPACK_ALIGNMENT, 4); // restore default
        // Ensure mipmapping is disabled and the sampler is configured correctly.
        webGlContext.texParameteri(GL.TEXTURE_2D, GL.TEXTURE_WRAP_S, GL.CLAMP_TO_EDGE);
        webGlContext.texParameteri(GL.TEXTURE_2D, GL.TEXTURE_WRAP_T, GL.CLAMP_TO_EDGE);
        webGlContext.texParameteri(GL.TEXTURE_2D, GL.TEXTURE_MIN_FILTER, GL.NEAREST);
        webGlContext.texParameteri(GL.TEXTURE_2D, GL.TEXTURE_MAG_FILTER, GL.NEAREST);

        // Now we add the morph target texture as a gltf texture info resource, so that
        // we can just call webGl.setTexture(..., gltfTextureInfo, ...) in the renderer.
        const image = new gltfImage(
            undefined, // uri
            GL.TEXTURE_2D, // type
            0, // mip level
            undefined, // buffer view
            undefined, // name
            ImageMimeType.GLTEXTURE, // mimeType
            texture // image
        );
        gltf.images.push(image);

        gltf.samplers.push(
            new gltfSampler(GL.NEAREST, GL.NEAREST, GL.CLAMP_TO_EDGE, GL.CLAMP_TO_EDGE, undefined)
        );

        const tex = new gltfTexture(
            gltf.samplers.length - 1,
            gltf.images.length - 1,
            GL.TEXTURE_2D
        );
        // The webgl texture is already initialized -> this flag informs
        // webgl.setTexture about this.
        tex.initialized = true;

        gltf.textures.push(tex);

        const textureInfo = new gltfTextureInfo(gltf.textures.length - 1, 0, true);
        textureInfo.samplerName = `u_${attributeName}Sampler`; //TODO Check if this works
        textureInfo.generateMips = false;
        return textureInfo;
    }

    _createDataTextureArray(
        gltf,
        webGlContext,
        data,
        width,
        textureCount,
        componentCount,
        samplerName
    ) {
        let texture = webGlContext.createTexture();
        webGlContext.bindTexture(webGlContext.TEXTURE_2D_ARRAY, texture);
        // Set texture format and upload data.
        // Use 16-bit half-precision floats: half the bandwidth of RGB32F with negligible
        // quality loss for SH coefficients. WebGL2 accepts Float32Array with FLOAT type
        // when the internal format is a 16F format — the driver converts on upload.
        let internalFormat = componentCount === 4 ? webGlContext.RGBA16F : webGlContext.RGB16F;
        let format = componentCount === 4 ? webGlContext.RGBA : webGlContext.RGB;
        let type = webGlContext.FLOAT;
        webGlContext.texImage3D(
            webGlContext.TEXTURE_2D_ARRAY,
            0, //level
            internalFormat,
            width,
            width,
            textureCount, //Layer count
            0, //border
            format,
            type,
            data
        );
        // Ensure mipmapping is disabled and the sampler is configured correctly.
        webGlContext.texParameteri(GL.TEXTURE_2D_ARRAY, GL.TEXTURE_WRAP_S, GL.CLAMP_TO_EDGE);
        webGlContext.texParameteri(GL.TEXTURE_2D_ARRAY, GL.TEXTURE_WRAP_T, GL.CLAMP_TO_EDGE);
        webGlContext.texParameteri(GL.TEXTURE_2D_ARRAY, GL.TEXTURE_MIN_FILTER, GL.NEAREST);
        webGlContext.texParameteri(GL.TEXTURE_2D_ARRAY, GL.TEXTURE_MAG_FILTER, GL.NEAREST);

        // Now we add the morph target texture as a gltf texture info resource, so that
        // we can just call webGl.setTexture(..., gltfTextureInfo, ...) in the renderer.
        const image = new gltfImage(
            undefined, // uri
            GL.TEXTURE_2D_ARRAY, // type
            0, // mip level
            undefined, // buffer view
            undefined, // name
            ImageMimeType.GLTEXTURE, // mimeType
            texture // image
        );
        gltf.images.push(image);

        gltf.samplers.push(
            new gltfSampler(GL.NEAREST, GL.NEAREST, GL.CLAMP_TO_EDGE, GL.CLAMP_TO_EDGE, undefined)
        );

        const tex = new gltfTexture(
            gltf.samplers.length - 1,
            gltf.images.length - 1,
            GL.TEXTURE_2D_ARRAY
        );
        // The webgl texture is already initialized -> this flag informs
        // webgl.setTexture about this.
        tex.initialized = true;

        gltf.textures.push(tex);

        const textureInfo = new gltfTextureInfo(gltf.textures.length - 1, 0, true);
        textureInfo.generateMips = false;
        textureInfo.samplerName = samplerName;
        return textureInfo;
    }

    initGl(gltf, webGlContext) {
        // Use the default glTF material.
        if (this.material === undefined) {
            this.material = gltf.materials.length - 1;
        }

        initGlForMembers(this, gltf, webGlContext);

        const maxAttributes = webGlContext.getParameter(GL.MAX_VERTEX_ATTRIBS);

        // https://github.com/KhronosGroup/glTF/blob/master/specification/2.0/README.md#meshes

        if (this.extensions !== undefined) {
            // Decode Draco compressed mesh:
            if (this.extensions.KHR_draco_mesh_compression !== undefined) {
                const dracoDecoder = new DracoDecoder();
                if (dracoDecoder !== undefined && Object.isFrozen(dracoDecoder)) {
                    let dracoGeometry = this.decodeDracoBufferToIntermediate(
                        this.extensions.KHR_draco_mesh_compression,
                        gltf
                    );
                    this.copyDataFromDecodedGeometry(gltf, dracoGeometry, this.attributes);
                } else {
                    console.warn(
                        "Failed to load draco compressed mesh: DracoDecoder not initialized"
                    );
                }
            }
        }

        // Must run after Draco decoding, which is what adds the decompressed attributes.
        this.assignIndexedAttributeSlots();

        // Generate tangents with Mikktspace which needs normals and texcoords as inputs for triangles
        const primaryTexCoord = this.primaryTexCoordAttribute();
        if (
            this.attributes.TANGENT === undefined &&
            this.attributes.NORMAL !== undefined &&
            primaryTexCoord !== undefined &&
            this.mode > 3
        ) {
            console.info("Generating tangents using the MikkTSpace algorithm.");
            console.time("Tangent generation");
            const tangentHash = `${this.indices}_${this.attributes.POSITION}_${this.attributes.NORMAL}_${this.attributes[primaryTexCoord]}`;
            this.unweld(gltf);
            this.generateTangents(gltf, tangentHash, primaryTexCoord);
            console.timeEnd("Tangent generation");
        }

        // VERTEX ATTRIBUTES
        for (const attribute of Object.keys(this.attributes)) {
            if (this.glAttributes.length >= maxAttributes) {
                console.error(
                    "To many vertex attributes for this primitive, skipping " + attribute
                );
                break;
            }
            let knownAttribute = true;
            let isTexture = false;
            const indexedAttribute = /^(TEXCOORD|COLOR)_(\d+)$/.exec(attribute);
            if (indexedAttribute !== null) {
                // glTF 2.1 no longer requires these to start at 0 or be consecutive, so
                // the set index in the file is mapped onto a shader slot instead of
                // being used directly.
                const slot =
                    indexedAttribute[1] === "TEXCOORD"
                        ? this.texCoordSlots.get(Number(indexedAttribute[2]))
                        : this.colorSlots.get(Number(indexedAttribute[2]));
                if (slot === undefined) {
                    continue;
                }
                const idx = this.attributes[attribute];
                const name = `${indexedAttribute[1].toLowerCase()}_${slot}`;
                this.glAttributes.push({
                    attribute,
                    name: `a_${name}`,
                    accessor: idx
                });
                this.defines.push(
                    `HAS_${indexedAttribute[1]}_${slot}_${gltf.accessors[idx].type} 1`
                );
                if (indexedAttribute[1] === "TEXCOORD") {
                    this.hasTexcoord = true;
                } else {
                    this.hasColor = true;
                }
                continue;
            }
            switch (attribute) {
                case "POSITION":
                    this.skip = false;
                    break;
                case "NORMAL":
                    this.hasNormals = true;
                    break;
                case "TANGENT":
                    this.hasTangents = true;
                    break;
                case "JOINTS_0":
                    this.hasJoints = true;
                    break;
                case "WEIGHTS_0":
                    this.hasWeights = true;
                    break;
                case "JOINTS_1":
                    this.hasJoints = true;
                    break;
                case "WEIGHTS_1":
                    this.hasWeights = true;
                    break;
                case "KHR_gaussian_splatting:ROTATION":
                case "KHR_gaussian_splatting:SCALE":
                case "KHR_gaussian_splatting:OPACITY":
                    isTexture = true;
                    break;
                case "KHR_gaussian_splatting:SH_DEGREE_0_COEF_0":
                    isTexture = true;
                    break;
                case "KHR_gaussian_splatting:SH_DEGREE_1_COEF_0":
                case "KHR_gaussian_splatting:SH_DEGREE_1_COEF_1":
                case "KHR_gaussian_splatting:SH_DEGREE_1_COEF_2":
                    isTexture = true;
                    this.hasDegree1 = true;
                    break;
                case "KHR_gaussian_splatting:SH_DEGREE_2_COEF_0":
                case "KHR_gaussian_splatting:SH_DEGREE_2_COEF_1":
                case "KHR_gaussian_splatting:SH_DEGREE_2_COEF_2":
                case "KHR_gaussian_splatting:SH_DEGREE_2_COEF_3":
                case "KHR_gaussian_splatting:SH_DEGREE_2_COEF_4":
                    isTexture = true;
                    this.hasDegree2 = true;
                    break;
                case "KHR_gaussian_splatting:SH_DEGREE_3_COEF_0":
                case "KHR_gaussian_splatting:SH_DEGREE_3_COEF_1":
                case "KHR_gaussian_splatting:SH_DEGREE_3_COEF_2":
                case "KHR_gaussian_splatting:SH_DEGREE_3_COEF_3":
                case "KHR_gaussian_splatting:SH_DEGREE_3_COEF_4":
                case "KHR_gaussian_splatting:SH_DEGREE_3_COEF_5":
                case "KHR_gaussian_splatting:SH_DEGREE_3_COEF_6":
                    isTexture = true;
                    this.hasDegree3 = true;
                    break;
                default:
                    knownAttribute = false;
                    console.log("Unknown attribute: " + attribute);
            }
            if (knownAttribute && !isTexture) {
                const idx = this.attributes[attribute];
                this.glAttributes.push({
                    attribute: attribute,
                    name: "a_" + attribute.toLowerCase(),
                    accessor: idx
                });
                this.defines.push(`HAS_${attribute}_${gltf.accessors[idx].type} 1`);
            }
        }

        // Gaussian Splatting
        if (this.extensions?.KHR_gaussian_splatting !== undefined) {
            const extension = this.extensions.KHR_gaussian_splatting;
            if (extension.kernel !== "ellipse") {
                console.warn(
                    `Unsupported kernel type for Gaussian Splatting: ${extension.kernel}. Using ellipse kernel.`
                );
            }
            if (extension.colorSpace === "srgb_rec709_display") {
                this.linear = false;
            } else if (extension.colorSpace !== "lin_rec709_display") {
                console.warn(
                    `Unsupported color space for Gaussian Splatting: ${extension.colorSpace}. Using linear Rec. 709 display.`
                );
            }
            if (extension.projection !== undefined && extension.projection !== "perspective") {
                console.warn(
                    `Unsupported projection type for Gaussian Splatting: ${extension.projection}. Using perspective projection.`
                );
            }
            if (
                extension.sortingMethod !== undefined &&
                extension.sortingMethod !== "cameraDistance"
            ) {
                console.warn(
                    `Unsupported sorting method for Gaussian Splatting: ${extension.sortingMethod}. Using camera distance.`
                );
            }
            if (this.hasDegree2 && !this.hasDegree1) {
                console.warn(
                    "Degree 2 SH Coefficients provided without Degree 1. This is not supported and Degree 2 coefficients will be ignored."
                );
                this.hasDegree2 = false;
            }
            if (this.hasDegree3 && (!this.hasDegree1 || !this.hasDegree2)) {
                console.warn(
                    "Degree 3 SH Coefficients provided without Degree 1 or Degree 2. This is not supported and Degree 3 coefficients will be ignored."
                );
                this.hasDegree3 = false;
            }

            const max2DTextureSize = Math.pow(webGlContext.getParameter(GL.MAX_TEXTURE_SIZE), 2);
            const vertexCount =
                gltf.accessors[this.attributes["KHR_gaussian_splatting:SH_DEGREE_0_COEF_0"]].count;
            this.initSortWorker(gltf, vertexCount);
            this.splatTextureWidth = Math.ceil(Math.sqrt(vertexCount));
            const singleTextureSize = Math.pow(this.splatTextureWidth, 2);

            if (vertexCount > max2DTextureSize) {
                console.error("Vertex count exceeds maximum 2D texture size.");
                this.skip = true;
                return;
            }

            this.positionTextureInfo = this._createDataTexture(
                gltf,
                webGlContext,
                "POSITION",
                gltf.accessors[this.attributes.POSITION]
            );

            this.rotationTextureInfo = this._createDataTexture(
                gltf,
                webGlContext,
                "ROTATION",
                gltf.accessors[this.attributes["KHR_gaussian_splatting:ROTATION"]]
            );

            if (this.rotationTextureInfo === undefined) {
                console.error(
                    "Rotation attribute is required for Gaussian Splatting but not found. Skipping primitive."
                );
                this.skip = true;
                return;
            }

            this.scaleTextureInfo = this._createDataTexture(
                gltf,
                webGlContext,
                "SCALE",
                gltf.accessors[this.attributes["KHR_gaussian_splatting:SCALE"]]
            );

            if (this.scaleTextureInfo === undefined) {
                console.error(
                    "Scale attribute is required for Gaussian Splatting but not found. Skipping primitive."
                );
                this.skip = true;
                return;
            }

            this.opacityTextureInfo = this._createDataTexture(
                gltf,
                webGlContext,
                "OPACITY",
                gltf.accessors[this.attributes["KHR_gaussian_splatting:OPACITY"]]
            );

            if (this.opacityTextureInfo === undefined) {
                console.error(
                    "Opacity attribute is required for Gaussian Splatting but not found. Skipping primitive."
                );
                this.skip = true;
                return;
            }

            if (this.attributes["KHR_gaussian_splatting:SH_DEGREE_0_COEF_0"] === undefined) {
                console.error(
                    "SH Degree 0 Coefficient 0 attribute is required for Gaussian Splatting but not found. Skipping primitive."
                );
                this.skip = true;
                return;
            }

            let textureAtlasSize = 1;
            if (this.hasDegree1) {
                this.defines.push("HAS_GAUSSIAN_SPLATTING_DEGREE_1 1");
                textureAtlasSize += 3;
                if (this.hasDegree2) {
                    this.defines.push("HAS_GAUSSIAN_SPLATTING_DEGREE_2 1");
                    textureAtlasSize += 5;
                    if (this.hasDegree3) {
                        this.defines.push("HAS_GAUSSIAN_SPLATTING_DEGREE_3 1");
                        textureAtlasSize += 7;
                    }
                }
            }
            const shData = new Float32Array(singleTextureSize * textureAtlasSize * 3);
            const shAttributes = Object.keys(this.attributes)
                .filter((attr) => attr.startsWith("KHR_gaussian_splatting:SH_DEGREE_"))
                .sort();
            for (let i = 0; i < shAttributes.length; i++) {
                const accessor = gltf.accessors[this.attributes[shAttributes[i]]];
                const data = accessor.getDeinterlacedView(gltf);
                shData.set(data, i * singleTextureSize * 3);
            }

            this.shArray = this._createDataTextureArray(
                gltf,
                webGlContext,
                shData,
                this.splatTextureWidth,
                textureAtlasSize,
                3,
                "u_SHCoefficientsSampler"
            );

            this.sortOrder = new Uint32Array(vertexCount);
            for (let i = 0; i < vertexCount; i++) this.sortOrder[i] = i;
        }

        // MORPH TARGETS
        if (this.targets !== undefined && this.targets.length > 0) {
            const max2DTextureSize = Math.pow(webGlContext.getParameter(GL.MAX_TEXTURE_SIZE), 2);
            const maxTextureArraySize = webGlContext.getParameter(GL.MAX_ARRAY_TEXTURE_LAYERS);
            // Check which attributes are affected by morph targets and
            // define offsets for the attributes in the morph target texture.
            const attributeOffsets = {};
            let attributeOffset = 0;

            // Gather used attributes from all targets (some targets might
            // use more attributes than others)
            const attributes = Array.from(
                this.targets.reduce((acc, target) => {
                    Object.keys(target).map((val) => acc.add(val));
                    return acc;
                }, new Set())
            );

            const vertexCount = gltf.accessors[this.attributes[attributes[0]]].count;
            this.defines.push(`NUM_VERTICIES ${vertexCount}`);
            let targetCount = this.targets.length;
            if (targetCount * attributes.length > maxTextureArraySize) {
                targetCount = Math.floor(maxTextureArraySize / attributes.length);
                console.warn(
                    `Morph targets exceed texture size limit. Only ${targetCount} of ${this.targets.length} are used.`
                );
            }

            for (const attribute of attributes) {
                // Morph target semantics are remapped onto shader slots the same way the
                // primitive's own attributes are, otherwise a displacement on, say,
                // TEXCOORD_3 would emit a define no shader knows about.
                const shaderName = this.shaderAttributeName(attribute);
                // Add morph target defines
                this.defines.push(`HAS_MORPH_TARGET_${shaderName} 1`);
                this.defines.push(`MORPH_TARGET_${shaderName}_OFFSET ${attributeOffset}`);
                // Store the attribute offset so that later the
                // morph target texture can be assembled.
                attributeOffsets[attribute] = attributeOffset;
                attributeOffset += targetCount;
            }
            this.defines.push("HAS_MORPH_TARGETS 1");

            if (vertexCount <= max2DTextureSize) {
                // Allocate the texture buffer. Note that all target attributes must be vec3 types and
                // all must have the same vertex count as the primitives other attributes.
                const width = Math.ceil(Math.sqrt(vertexCount));
                const singleTextureSize = Math.pow(width, 2) * 4;
                const morphTargetTextureArray = new Float32Array(
                    singleTextureSize * targetCount * attributes.length
                );

                // Now assemble the texture from the accessors.
                for (let i = 0; i < targetCount; ++i) {
                    let target = this.targets[i];
                    for (let [attributeName, offsetRef] of Object.entries(attributeOffsets)) {
                        if (target[attributeName] != undefined) {
                            const accessor = gltf.accessors[target[attributeName]];
                            const offset = offsetRef * singleTextureSize;
                            if (
                                accessor.componentType != GL.FLOAT &&
                                accessor.normalized == false
                            ) {
                                console.warn("Unsupported component type for morph targets");
                                attributeOffsets[attributeName] = offsetRef + 1;
                                continue;
                            }
                            const data = accessor.getNormalizedDeinterlacedView(gltf);
                            switch (accessor.type) {
                                case "VEC2":
                                case "VEC3": {
                                    // Add padding to fit vec2/vec3 into rgba
                                    let paddingOffset = 0;
                                    let accessorOffset = 0;
                                    const componentCount = accessor.getComponentCount(
                                        accessor.type
                                    );
                                    for (let j = 0; j < accessor.count; ++j) {
                                        morphTargetTextureArray.set(
                                            data.subarray(
                                                accessorOffset,
                                                accessorOffset + componentCount
                                            ),
                                            offset + paddingOffset
                                        );
                                        paddingOffset += 4;
                                        accessorOffset += componentCount;
                                    }
                                    break;
                                }
                                case "VEC4":
                                    morphTargetTextureArray.set(data, offset);
                                    break;
                                default:
                                    console.warn("Unsupported attribute type for morph targets");
                                    break;
                            }
                        }
                        attributeOffsets[attributeName] = offsetRef + 1;
                    }
                }

                // Add the morph target texture.
                this.morphTargetTextureInfo = this._createDataTextureArray(
                    gltf,
                    webGlContext,
                    morphTargetTextureArray,
                    width,
                    targetCount * attributes.length,
                    4,
                    "u_MorphTargetsSampler"
                );
            } else {
                console.warn("Mesh of Morph targets too big. Cannot apply morphing.");
            }
        }

        this.computeCentroid(gltf);
    }

    /**
     * Spawn a mkkellogg WASM sort worker and hand it the splat centre positions.
     * Called once during initGl for Gaussian Splatting primitives.
     * @param {object} gltf
     * @param {number} vertexCount
     */
    initSortWorker(gltf, vertexCount) {
        try {
            this.sortWorker = new Worker(
                new URL("./libs/mkkellogg-sort.worker.js", import.meta.url), //URL needs to be relative to rollup build
                { type: "module" }
            );
        } catch (err) {
            console.warn("Failed to spawn sort worker:", err);
            return;
        }

        // Build stride-4 Float32Array (x, y, z, 1) from the POSITION accessor.
        const posAccessor = gltf.accessors[this.attributes.POSITION];
        const rawPositions = posAccessor.getDeinterlacedView(gltf);
        const posOp = new Float32Array(vertexCount * 4);
        for (let i = 0; i < vertexCount; i++) {
            posOp[i * 4 + 0] = rawPositions[i * 3 + 0];
            posOp[i * 4 + 1] = rawPositions[i * 3 + 1];
            posOp[i * 4 + 2] = rawPositions[i * 3 + 2];
            posOp[i * 4 + 3] = 1.0;
        }

        this.sortWorker.onmessage = (e) => {
            const { type } = e.data;
            if (type === "ready") {
                this.sortWorkerReady = true;
                this.sortPending = false;
                // Fire any sort that was queued while the worker was initialising.
                if (this.queuedViewMatrix !== undefined) {
                    // Skip if the view matrix hasn't changed since the last dispatched sort.
                    if (this.lastSortViewMatrix !== undefined) {
                        let same = true;
                        for (let i = 0; i < 16; i++) {
                            if (this.lastSortViewMatrix[i] !== this.queuedViewMatrix[i]) {
                                same = false;
                                break;
                            }
                        }
                        if (same) return;
                    }
                    this.sortPending = true;
                    this.sortWorker.postMessage({
                        type: "sort",
                        viewMatrix: this.queuedViewMatrix
                    });
                    this.queuedViewMatrix = undefined;
                }
            } else if (type === "sorted") {
                this.sortOrder = e.data.indices;
                this.sortPending = false;
            } else if (type === "error") {
                console.error("Sort worker error:", e.data.message);
                this.sortPending = false;
            }
        };

        this.sortWorker.onerror = (err) => {
            console.error(
                "Sort worker uncaught error:",
                err.message,
                err.filename,
                "line",
                err.lineno,
                err
            );
            this.sortPending = false;
        };

        // Transfer positions buffer to the worker (zero-copy).
        this.sortWorker.postMessage({ type: "init", posOp: posOp, splatCount: vertexCount }, [
            posOp.buffer
        ]);
        this.sortPending = true;
    }

    /**
     * Request an asynchronous back-to-front sort of the splat indices.
     * Safe to call every frame — the request is dropped while a previous sort
     * is still in flight.
     * @param {Float32Array} modelViewMatrix  Column-major 4×4 model-view matrix (view * world).
     */
    requestSort(modelViewMatrix) {
        if (this.sortWorker === undefined) {
            return;
        }
        if (!this.sortWorkerReady || this.sortPending) {
            // Worker is busy — keep the latest matrix so it sorts immediately once ready
            this.queuedViewMatrix = new Float32Array(modelViewMatrix);
            return;
        }
        // Skip if the view matrix hasn't changed since the last dispatched sort.
        if (this.lastSortViewMatrix !== undefined) {
            let same = true;
            for (let i = 0; i < 16; i++) {
                if (this.lastSortViewMatrix[i] !== modelViewMatrix[i]) {
                    same = false;
                    break;
                }
            }
            if (same) return;
        }
        const vm = new Float32Array(modelViewMatrix);
        this.lastSortViewMatrix = vm;
        this.sortPending = true;
        this.sortWorker.postMessage({ type: "sort", viewMatrix: vm });
    }

    computeCentroid(gltf) {
        const positionsAccessor = gltf.accessors[this.attributes.POSITION];
        const positions = positionsAccessor.getNormalizedDeinterlacedView(gltf);

        if (positions instanceof Float64Array) {
            throw new Error("64-bit float attributes are not supported in WebGL2");
        }

        if (this.indices !== undefined) {
            // Primitive has indices.

            const indicesAccessor = gltf.accessors[this.indices];

            const indices = indicesAccessor.getDeinterlacedView(gltf);

            const acc = new Float32Array(3);

            for (let i = 0; i < indices.length; i++) {
                const offset = 3 * indices[i];
                acc[0] += positions[offset];
                acc[1] += positions[offset + 1];
                acc[2] += positions[offset + 2];
            }

            const centroid = new Float32Array([
                acc[0] / indices.length,
                acc[1] / indices.length,
                acc[2] / indices.length
            ]);

            this.centroid = centroid;
        } else {
            // Primitive does not have indices.

            const acc = new Float32Array(3);

            for (let i = 0; i < positions.length; i += 3) {
                acc[0] += positions[i];
                acc[1] += positions[i + 1];
                acc[2] += positions[i + 2];
            }

            const positionVectors = positions.length / 3;

            const centroid = new Float32Array([
                acc[0] / positionVectors,
                acc[1] / positionVectors,
                acc[2] / positionVectors
            ]);

            this.centroid = centroid;
        }
    }

    fromJson(jsonPrimitive) {
        super.fromJson(jsonPrimitive);

        if (jsonPrimitive.extensions !== undefined) {
            this.fromJsonPrimitiveExtensions(jsonPrimitive.extensions);
        }
    }

    fromJsonPrimitiveExtensions(jsonExtensions) {
        if (jsonExtensions.KHR_materials_variants !== undefined) {
            this.fromJsonVariants(jsonExtensions.KHR_materials_variants);
        }
    }

    fromJsonVariants(jsonVariants) {
        if (jsonVariants.mappings !== undefined) {
            this.mappings = jsonVariants.mappings;
        }
    }

    copyDataFromDecodedGeometry(gltf, dracoGeometry, primitiveAttributes) {
        // indices
        if (this.indices !== undefined) {
            let indexBuffer = this.loadArrayIntoArrayBuffer(
                dracoGeometry.index.array,
                dracoGeometry.index.array.constructor.name
            );
            this.loadBufferIntoGltf(indexBuffer, gltf, this.indices, 34963, "index buffer view");

            // DRACO decoder always outputs uint32 indices
            gltf.accessors[this.indices].componentType = GL.UNSIGNED_INT;
        }

        // Position
        if (dracoGeometry.attributes.POSITION !== undefined) {
            let positionBuffer = this.loadArrayIntoArrayBuffer(
                dracoGeometry.attributes.POSITION.array,
                dracoGeometry.attributes.POSITION.componentType
            );
            this.loadBufferIntoGltf(
                positionBuffer,
                gltf,
                primitiveAttributes["POSITION"],
                34962,
                "position buffer view"
            );
        }

        // Normal
        if (dracoGeometry.attributes.NORMAL !== undefined) {
            let normalBuffer = this.loadArrayIntoArrayBuffer(
                dracoGeometry.attributes.NORMAL.array,
                dracoGeometry.attributes.NORMAL.componentType
            );
            this.loadBufferIntoGltf(
                normalBuffer,
                gltf,
                primitiveAttributes["NORMAL"],
                34962,
                "normal buffer view"
            );
        }

        // TEXCOORD_0
        if (dracoGeometry.attributes.TEXCOORD_0 !== undefined) {
            let uvBuffer = this.loadArrayIntoArrayBuffer(
                dracoGeometry.attributes.TEXCOORD_0.array,
                dracoGeometry.attributes.TEXCOORD_0.componentType
            );
            this.loadBufferIntoGltf(
                uvBuffer,
                gltf,
                primitiveAttributes["TEXCOORD_0"],
                34962,
                "TEXCOORD_0 buffer view"
            );
        }

        // TEXCOORD_1
        if (dracoGeometry.attributes.TEXCOORD_1 !== undefined) {
            let uvBuffer = this.loadArrayIntoArrayBuffer(
                dracoGeometry.attributes.TEXCOORD_1.array,
                dracoGeometry.attributes.TEXCOORD_1.componentType
            );
            this.loadBufferIntoGltf(
                uvBuffer,
                gltf,
                primitiveAttributes["TEXCOORD_1"],
                34962,
                "TEXCOORD_1 buffer view"
            );
        }

        // Tangent
        if (dracoGeometry.attributes.TANGENT !== undefined) {
            let tangentBuffer = this.loadArrayIntoArrayBuffer(
                dracoGeometry.attributes.TANGENT.array,
                dracoGeometry.attributes.TANGENT.componentType
            );
            this.loadBufferIntoGltf(
                tangentBuffer,
                gltf,
                primitiveAttributes["TANGENT"],
                34962,
                "Tangent buffer view"
            );
        }

        // Color
        if (dracoGeometry.attributes.COLOR_0 !== undefined) {
            let colorBuffer = this.loadArrayIntoArrayBuffer(
                dracoGeometry.attributes.COLOR_0.array,
                dracoGeometry.attributes.COLOR_0.componentType
            );
            this.loadBufferIntoGltf(
                colorBuffer,
                gltf,
                primitiveAttributes["COLOR_0"],
                34962,
                "color buffer view"
            );
        }

        // JOINTS_0
        if (dracoGeometry.attributes.JOINTS_0 !== undefined) {
            let jointsBuffer = this.loadArrayIntoArrayBuffer(
                dracoGeometry.attributes.JOINTS_0.array,
                dracoGeometry.attributes.JOINTS_0.componentType
            );
            this.loadBufferIntoGltf(
                jointsBuffer,
                gltf,
                primitiveAttributes["JOINTS_0"],
                34963,
                "JOINTS_0 buffer view"
            );
        }

        // WEIGHTS_0
        if (dracoGeometry.attributes.WEIGHTS_0 !== undefined) {
            let weightsBuffer = this.loadArrayIntoArrayBuffer(
                dracoGeometry.attributes.WEIGHTS_0.array,
                dracoGeometry.attributes.WEIGHTS_0.componentType
            );
            this.loadBufferIntoGltf(
                weightsBuffer,
                gltf,
                primitiveAttributes["WEIGHTS_0"],
                34963,
                "WEIGHTS_0 buffer view"
            );
        }

        // JOINTS_1
        if (dracoGeometry.attributes.JOINTS_1 !== undefined) {
            let jointsBuffer = this.loadArrayIntoArrayBuffer(
                dracoGeometry.attributes.JOINTS_1.array,
                dracoGeometry.attributes.JOINTS_1.componentType
            );
            this.loadBufferIntoGltf(
                jointsBuffer,
                gltf,
                primitiveAttributes["JOINTS_1"],
                34963,
                "JOINTS_1 buffer view"
            );
        }

        // WEIGHTS_1
        if (dracoGeometry.attributes.WEIGHTS_1 !== undefined) {
            let weightsBuffer = this.loadArrayIntoArrayBuffer(
                dracoGeometry.attributes.WEIGHTS_1.array,
                dracoGeometry.attributes.WEIGHTS_1.componentType
            );
            this.loadBufferIntoGltf(
                weightsBuffer,
                gltf,
                primitiveAttributes["WEIGHTS_1"],
                34963,
                "WEIGHTS_1 buffer view"
            );
        }
    }

    loadBufferIntoGltf(buffer, gltf, gltfAccessorIndex, gltfBufferViewTarget, gltfBufferViewName) {
        const gltfBufferObj = new gltfBuffer();
        gltfBufferObj.byteLength = buffer.byteLength;
        gltfBufferObj.buffer = buffer;
        gltf.buffers.push(gltfBufferObj);

        const gltfBufferViewObj = new gltfBufferView();
        gltfBufferViewObj.buffer = gltf.buffers.length - 1;
        gltfBufferViewObj.byteLength = buffer.byteLength;
        if (gltfBufferViewName !== undefined) {
            gltfBufferViewObj.name = gltfBufferViewName;
        }
        gltfBufferViewObj.target = gltfBufferViewTarget;
        gltf.bufferViews.push(gltfBufferViewObj);

        gltf.accessors[gltfAccessorIndex].byteOffset = 0;
        gltf.accessors[gltfAccessorIndex].bufferView = gltf.bufferViews.length - 1;
    }

    loadArrayIntoArrayBuffer(arrayData, componentType) {
        let arrayBuffer;
        switch (componentType) {
            case "Int8Array":
                arrayBuffer = new ArrayBuffer(arrayData.length);
                new Int8Array(arrayBuffer).set(arrayData);
                break;
            case "Uint8Array":
                arrayBuffer = new ArrayBuffer(arrayData.length);
                new Uint8Array(arrayBuffer).set(arrayData);
                break;
            case "Int16Array":
                arrayBuffer = new ArrayBuffer(arrayData.length * 2);
                new Int16Array(arrayBuffer).set(arrayData);
                break;
            case "Uint16Array":
                arrayBuffer = new ArrayBuffer(arrayData.length * 2);
                new Uint16Array(arrayBuffer).set(arrayData);
                break;
            case "Int32Array":
                arrayBuffer = new ArrayBuffer(arrayData.length * 4);
                new Int32Array(arrayBuffer).set(arrayData);
                break;
            case "Uint32Array":
                arrayBuffer = new ArrayBuffer(arrayData.length * 4);
                new Uint32Array(arrayBuffer).set(arrayData);
                break;
            default:
            case "Float32Array":
                arrayBuffer = new ArrayBuffer(arrayData.length * 4);
                new Float32Array(arrayBuffer).set(arrayData);
                break;
        }

        return arrayBuffer;
    }

    decodeDracoBufferToIntermediate(dracoExtension, gltf) {
        let dracoBufferViewIDX = dracoExtension.bufferView;

        const origGltfDrBufViewObj = gltf.bufferViews[dracoBufferViewIDX];
        const origGltfDracoBuffer = gltf.buffers[origGltfDrBufViewObj.buffer];

        const totalBuffer = new Int8Array(origGltfDracoBuffer.buffer);
        const actualBuffer = totalBuffer.slice(
            origGltfDrBufViewObj.byteOffset,
            origGltfDrBufViewObj.byteOffset + origGltfDrBufViewObj.byteLength
        );

        // decode draco buffer to geometry intermediate
        let dracoDecoder = new DracoDecoder();
        let draco = dracoDecoder.module;
        let decoder = new draco.Decoder();
        let decoderBuffer = new draco.DecoderBuffer();
        decoderBuffer.Init(actualBuffer, origGltfDrBufViewObj.byteLength);
        let geometry = this.decodeGeometry(
            draco,
            decoder,
            decoderBuffer,
            dracoExtension.attributes,
            gltf
        );

        draco.destroy(decoderBuffer);

        return geometry;
    }

    getDracoArrayTypeFromComponentType(componentType) {
        switch (componentType) {
            case GL.BYTE:
                return "Int8Array";
            case GL.UNSIGNED_BYTE:
                return "Uint8Array";
            case GL.SHORT:
                return "Int16Array";
            case GL.UNSIGNED_SHORT:
                return "Uint16Array";
            case GL.INT:
                return "Int32Array";
            case GL.UNSIGNED_INT:
                return "Uint32Array";
            case GL.FLOAT:
                return "Float32Array";
            default:
                return "Float32Array";
        }
    }

    decodeGeometry(draco, decoder, decoderBuffer, gltfDracoAttributes, gltf) {
        let dracoGeometry;
        let decodingStatus;

        // decode mesh in draco decoder
        let geometryType = decoder.GetEncodedGeometryType(decoderBuffer);
        if (geometryType === draco.TRIANGULAR_MESH) {
            dracoGeometry = new draco.Mesh();
            decodingStatus = decoder.DecodeBufferToMesh(decoderBuffer, dracoGeometry);
        } else {
            throw new Error("DRACOLoader: Unexpected geometry type.");
        }

        if (!decodingStatus.ok() || dracoGeometry.ptr === 0) {
            throw new Error("DRACOLoader: Decoding failed: " + decodingStatus.error_msg());
        }

        let geometry = { index: null, attributes: {} };
        let vertexCount = dracoGeometry.num_points();

        // Gather all vertex attributes.
        for (let dracoAttr in gltfDracoAttributes) {
            let componentType = GL.BYTE;
            let accessotVertexCount;
            // find gltf accessor for this draco attribute
            for (const [key, value] of Object.entries(this.attributes)) {
                if (key === dracoAttr) {
                    componentType = gltf.accessors[value].componentType;
                    accessotVertexCount = gltf.accessors[value].count;
                    break;
                }
            }

            // check if vertex count matches
            if (vertexCount !== accessotVertexCount) {
                throw new Error(
                    `DRACOLoader: Accessor vertex count ${accessotVertexCount} does not match draco decoder vertex count  ${vertexCount}`
                );
            }
            componentType = this.getDracoArrayTypeFromComponentType(componentType);

            let dracoAttribute = decoder.GetAttributeByUniqueId(
                dracoGeometry,
                gltfDracoAttributes[dracoAttr]
            );
            var tmpObj = this.decodeAttribute(
                draco,
                decoder,
                dracoGeometry,
                dracoAttr,
                dracoAttribute,
                componentType
            );
            geometry.attributes[tmpObj.name] = tmpObj;
        }

        // Add index buffer
        if (geometryType === draco.TRIANGULAR_MESH) {
            // Generate mesh faces.
            let numFaces = dracoGeometry.num_faces();
            let numIndices = numFaces * 3;
            let dataSize = numIndices * 4;
            let ptr = draco._malloc(dataSize);
            decoder.GetTrianglesUInt32Array(dracoGeometry, dataSize, ptr);
            let index = new Uint32Array(draco.HEAPU32.buffer, ptr, numIndices).slice();
            draco._free(ptr);

            geometry.index = { array: index, itemSize: 1 };
        }

        draco.destroy(dracoGeometry);
        return geometry;
    }

    decodeAttribute(draco, decoder, dracoGeometry, attributeName, attribute, attributeType) {
        let numComponents = attribute.num_components();
        let numPoints = dracoGeometry.num_points();
        let numValues = numPoints * numComponents;

        let ptr;
        let array;

        let dataSize;
        switch (attributeType) {
            case "Float32Array":
                dataSize = numValues * 4;
                ptr = draco._malloc(dataSize);
                decoder.GetAttributeDataArrayForAllPoints(
                    dracoGeometry,
                    attribute,
                    draco.DT_FLOAT32,
                    dataSize,
                    ptr
                );
                array = new Float32Array(draco.HEAPF32.buffer, ptr, numValues).slice();
                draco._free(ptr);
                break;

            case "Int8Array":
                ptr = draco._malloc(numValues);
                decoder.GetAttributeDataArrayForAllPoints(
                    dracoGeometry,
                    attribute,
                    draco.DT_INT8,
                    numValues,
                    ptr
                );
                array = new Int8Array(draco.HEAP8.buffer, ptr, numValues).slice();
                draco._free(ptr);
                break;

            case "Int16Array":
                dataSize = numValues * 2;
                ptr = draco._malloc(dataSize);
                decoder.GetAttributeDataArrayForAllPoints(
                    dracoGeometry,
                    attribute,
                    draco.DT_INT16,
                    dataSize,
                    ptr
                );
                array = new Int16Array(draco.HEAP16.buffer, ptr, numValues).slice();
                draco._free(ptr);
                break;

            case "Int32Array":
                dataSize = numValues * 4;
                ptr = draco._malloc(dataSize);
                decoder.GetAttributeDataArrayForAllPoints(
                    dracoGeometry,
                    attribute,
                    draco.DT_INT32,
                    dataSize,
                    ptr
                );
                array = new Int32Array(draco.HEAP32.buffer, ptr, numValues).slice();
                draco._free(ptr);
                break;

            case "Uint8Array":
                ptr = draco._malloc(numValues);
                decoder.GetAttributeDataArrayForAllPoints(
                    dracoGeometry,
                    attribute,
                    draco.DT_UINT8,
                    numValues,
                    ptr
                );
                array = new Uint8Array(draco.HEAPU8.buffer, ptr, numValues).slice();
                draco._free(ptr);
                break;

            case "Uint16Array":
                dataSize = numValues * 2;
                ptr = draco._malloc(dataSize);
                decoder.GetAttributeDataArrayForAllPoints(
                    dracoGeometry,
                    attribute,
                    draco.DT_UINT16,
                    dataSize,
                    ptr
                );
                array = new Uint16Array(draco.HEAPU16.buffer, ptr, numValues).slice();
                draco._free(ptr);
                break;

            case "Uint32Array":
                dataSize = numValues * 4;
                ptr = draco._malloc(dataSize);
                decoder.GetAttributeDataArrayForAllPoints(
                    dracoGeometry,
                    attribute,
                    draco.DT_UINT32,
                    dataSize,
                    ptr
                );
                array = new Uint32Array(draco.HEAPU32.buffer, ptr, numValues).slice();
                draco._free(ptr);
                break;

            default:
                throw new Error("DRACOLoader: Unexpected attribute type.");
        }

        return {
            name: attributeName,
            array: array,
            itemSize: numComponents,
            componentType: attributeType
        };
    }

    /**
     * Maps the TEXCOORD_n and COLOR_n set indices present on this primitive onto the
     * contiguous shader slots the shaders declare varyings for.
     *
     * glTF 2.0 required these to start at 0 and be consecutive, so the file index and
     * the shader slot were always the same. glTF 2.1 relaxes that, so a primitive may
     * carry TEXCOORD_1 and TEXCOORD_3 and nothing else. Sets are assigned to slots in
     * ascending index order, which keeps the lowest-numbered set primary as the spec
     * recommends.
     */
    assignIndexedAttributeSlots() {
        const collect = (semantic) =>
            Object.keys(this.attributes)
                .map((name) => new RegExp(`^${semantic}_(\\d+)$`).exec(name))
                .filter((match) => match !== null)
                .map((match) => Number(match[1]))
                .sort((a, b) => a - b);

        const assign = (indices, limit, semantic) => {
            const slots = new Map();
            indices.forEach((index, position) => {
                if (position < limit) {
                    slots.set(index, position);
                }
            });
            if (indices.length > limit) {
                console.warn(
                    `Primitive has ${indices.length} ${semantic} sets but only ${limit} ` +
                        `can be used; ignoring ${indices
                            .slice(limit)
                            .map((i) => `${semantic}_${i}`)
                            .join(", ")}`
                );
            }
            return slots;
        };

        this.texCoordSlots = assign(
            collect("TEXCOORD"),
            gltfPrimitive.maxTexCoordSlots,
            "TEXCOORD"
        );
        this.colorSlots = assign(collect("COLOR"), gltfPrimitive.maxColorSlots, "COLOR");
    }

    /**
     * Translates a material's `texCoord` set index into the shader slot carrying it.
     * Returns undefined for an undefined input so callers can leave the uniform unset.
     */
    mapTexCoord(texCoord) {
        if (texCoord === undefined) {
            return undefined;
        }
        const slot = this.texCoordSlots.get(texCoord);
        if (slot !== undefined) {
            return slot;
        }
        if (!this.warnedMissingTexCoords.has(texCoord)) {
            this.warnedMissingTexCoords.add(texCoord);
            console.warn(
                `Material references TEXCOORD_${texCoord}, which this primitive does not ` +
                    `provide; falling back to the first available set`
            );
        }
        return 0;
    }

    /**
     * The semantic carrying this primitive's primary texture coordinates, i.e. whichever
     * set landed in shader slot 0. Under glTF 2.0 that is always TEXCOORD_0, but 2.1
     * lets the lowest set be any index.
     */
    primaryTexCoordAttribute() {
        for (const [setIndex, slot] of this.texCoordSlots) {
            if (slot === 0) {
                return `TEXCOORD_${setIndex}`;
            }
        }
        return undefined;
    }

    /**
     * Maps a glTF attribute semantic onto the name the shaders use for it. Only the
     * indexed semantics differ, and only when the file's set indices are not already
     * contiguous from zero.
     */
    shaderAttributeName(semantic) {
        const match = /^(TEXCOORD|COLOR)_(\d+)$/.exec(semantic);
        if (match === null) {
            return semantic;
        }
        const slots = match[1] === "TEXCOORD" ? this.texCoordSlots : this.colorSlots;
        const slot = slots.get(Number(match[2]));
        return slot === undefined ? semantic : `${match[1]}_${slot}`;
    }

    /**
     * Unwelds this primitive, i.e. applies the index mapping.
     * This is required for generating tangents using the MikkTSpace algorithm,
     * because the same vertex might be mapped to different tangents.
     * @param {*} gltf The glTF document.
     */
    unweld(gltf) {
        // Unwelding is an idempotent operation.
        if (this.indices === undefined) {
            return;
        }
        const indices = gltf.accessors[this.indices].getDeinterlacedView(gltf);

        // Unweld attributes:
        for (const [attribute, accessorIndex] of Object.entries(this.attributes)) {
            this.attributes[attribute] = this.unweldAccessor(
                gltf,
                gltf.accessors[accessorIndex],
                indices
            );
        }

        // Unweld morph targets:
        for (const target of this.targets) {
            for (const [attribute, accessorIndex] of Object.entries(target)) {
                target[attribute] = this.unweldAccessor(
                    gltf,
                    gltf.accessors[accessorIndex],
                    indices
                );
            }
        }

        // Dipose the indices:
        this.indices = undefined;
    }

    /**
     * Unwelds a single accessor. Used by {@link unweld}.
     * @param {*} gltf The glTF document.
     * @param {*} accessor The accessor to unweld.
     * @param {*} typedIndexView A typed view of the indices.
     * @returns A new accessor index containing the unwelded attribute.
     */
    unweldAccessor(gltf, accessor, typedIndexView) {
        const componentCount = accessor.getComponentCount(accessor.type);

        const weldedAttribute = accessor.getDeinterlacedView(gltf);
        // Create new array with same type as weldedAttribute
        const unweldedAttribute = new weldedAttribute.constructor(
            gltf.accessors[this.indices].count * componentCount
        );

        // Apply the index mapping.
        for (let i = 0; i < typedIndexView.length; i++) {
            for (let j = 0; j < componentCount; j++) {
                unweldedAttribute[i * componentCount + j] =
                    weldedAttribute[typedIndexView[i] * componentCount + j];
            }
        }

        // Create a new buffer and buffer view for the unwelded attribute:
        const unweldedBuffer = new gltfBuffer();
        unweldedBuffer.byteLength = unweldedAttribute.byteLength;
        unweldedBuffer.buffer = unweldedAttribute.buffer;
        gltf.buffers.push(unweldedBuffer);

        const unweldedBufferView = new gltfBufferView();
        unweldedBufferView.buffer = gltf.buffers.length - 1;
        unweldedBufferView.byteLength = unweldedAttribute.byteLength;
        unweldedBufferView.target = GL.ARRAY_BUFFER;
        gltf.bufferViews.push(unweldedBufferView);

        // Create a new accessor for the unwelded attribute:
        const unweldedAccessor = new gltfAccessor();
        unweldedAccessor.bufferView = gltf.bufferViews.length - 1;
        unweldedAccessor.byteOffset = 0;
        unweldedAccessor.count = typedIndexView.length;
        unweldedAccessor.type = accessor.type;
        unweldedAccessor.componentType = accessor.componentType;
        unweldedAccessor.min = accessor.min;
        unweldedAccessor.max = accessor.max;
        unweldedAccessor.normalized = accessor.normalized;
        gltf.accessors.push(unweldedAccessor);

        // Update the primitive to use the unwelded attribute:
        return gltf.accessors.length - 1;
    }

    generateTangents(gltf, tangentHash, texCoordAttribute = "TEXCOORD_0") {
        if (
            this.attributes.NORMAL === undefined ||
            this.attributes[texCoordAttribute] === undefined
        ) {
            return;
        }
        if (gltf.tangentCache[tangentHash] !== undefined) {
            // Tangents already generated for this primitive.
            this.attributes.TANGENT = gltf.tangentCache[tangentHash];
            return;
        }

        let positions =
            gltf.accessors[this.attributes.POSITION].getNormalizedDeinterlacedView(gltf);
        const normals = gltf.accessors[this.attributes.NORMAL].getNormalizedDeinterlacedView(gltf);
        let texcoords =
            gltf.accessors[this.attributes[texCoordAttribute]].getNormalizedDeinterlacedView(gltf);

        if (positions instanceof Float64Array) {
            console.warn(
                "Cannot generate tangents: WebGL2 does not support 64-bit float attributes."
            );
            return;
        } else if (positions instanceof Float32Array === false) {
            positions = new Float32Array(positions);
        }

        if (normals instanceof Float64Array) {
            console.warn(
                "Cannot generate tangents: WebGL2 does not support 64-bit float attributes."
            );
            return;
        } else if (normals instanceof Float32Array === false) {
            console.warn("Cannot generate tangents: Normal attribute in wrong format");
            return;
        }

        if (texcoords instanceof Float64Array) {
            console.warn(
                "Cannot generate tangents: WebGL2 does not support 64-bit float attributes."
            );
            return;
        } else if (texcoords instanceof Float32Array === false) {
            texcoords = new Float32Array(texcoords);
        }

        const tangents = generateTangents(positions, normals, texcoords);

        // convert coordinate system handedness to respect output format of MikkTSpace
        for (let idx = 0; idx < tangents.length; idx += 4) {
            tangents[idx + 3] = -tangents[idx + 3]; // Flip w-channel
        }

        // Create a new buffer and buffer view for the tangents:
        const tangentBuffer = new gltfBuffer();
        tangentBuffer.byteLength = tangents.byteLength;
        tangentBuffer.buffer = tangents.buffer;
        gltf.buffers.push(tangentBuffer);

        const tangentBufferView = new gltfBufferView();
        tangentBufferView.buffer = gltf.buffers.length - 1;
        tangentBufferView.byteLength = tangents.byteLength;
        tangentBufferView.target = GL.ARRAY_BUFFER;
        gltf.bufferViews.push(tangentBufferView);

        // Create a new accessor for the tangents:
        const tangentAccessor = new gltfAccessor();
        tangentAccessor.bufferView = gltf.bufferViews.length - 1;
        tangentAccessor.byteOffset = 0;
        tangentAccessor.count = tangents.length / 4;
        tangentAccessor.type = "VEC4";
        tangentAccessor.componentType = GL.FLOAT;

        // Update the primitive to use the tangents:
        this.attributes.TANGENT = gltf.accessors.length;
        gltf.accessors.push(tangentAccessor);
        gltf.tangentCache[tangentHash] = this.attributes.TANGENT;
    }
}

export { gltfPrimitive };
