import { ImageMimeType } from "../gltf/image_mime_type.js";

let GL = undefined;

class gltfWebGl {
    constructor(context) {
        this.context = context;
        if (GL === undefined) {
            GL = context;
        }
    }

    loadWebGlExtensions() {
        let EXT_texture_filter_anisotropic = this.context.getExtension(
            "EXT_texture_filter_anisotropic"
        );
        if (EXT_texture_filter_anisotropic) {
            this.context.anisotropy = EXT_texture_filter_anisotropic.TEXTURE_MAX_ANISOTROPY_EXT;
            this.context.maxAnisotropy = this.context.getParameter(
                EXT_texture_filter_anisotropic.MAX_TEXTURE_MAX_ANISOTROPY_EXT
            );
            this.context.supports_EXT_texture_filter_anisotropic = true;
        } else {
            console.warn("Anisotropic filtering is not supported");
            this.context.supports_EXT_texture_filter_anisotropic = false;
        }
        this.context.supports_EXT_color_buffer_float = this.context.getExtension(
            "EXT_color_buffer_float"
        )
            ? true
            : false;
        this.context.supports_EXT_color_buffer_half_float =
            this.context.supports_EXT_color_buffer_float ||
            (this.context.getExtension("EXT_color_buffer_half_float") ? true : false);
    }

    setTexture(loc, gltf, textureInfo, texSlot) {
        if (loc === null) {
            return false;
        }

        let gltfTex = gltf.textures[textureInfo.index];

        if (gltfTex === undefined) {
            return false;
        }

        const image = gltf.images[gltfTex.source];
        if (image === undefined) {
            return false;
        }

        if (
            (gltfTex.glTexture === undefined && textureInfo.linear) ||
            (gltfTex.glTextureSRGB === undefined && !textureInfo.linear)
        ) {
            if (
                image.mimeType === ImageMimeType.KTX2 ||
                image.mimeType === ImageMimeType.GLTEXTURE
            ) {
                // these image resources are directly loaded to a GPU resource by resource loader
                if (textureInfo.linear) {
                    gltfTex.glTexture = image.image;
                } else {
                    gltfTex.glTextureSRGB = image.image;
                }
            } else {
                // other images will be uploaded in a later step
                if (textureInfo.linear) {
                    gltfTex.glTexture = this.context.createTexture();
                } else {
                    gltfTex.glTextureSRGB = this.context.createTexture();
                }
            }
        }

        this.context.activeTexture(GL.TEXTURE0 + texSlot);
        this.context.bindTexture(
            gltfTex.type,
            textureInfo.linear ? gltfTex.glTexture : gltfTex.glTextureSRGB
        );

        this.context.uniform1i(loc, texSlot);

        if (
            (!gltfTex.initialized && textureInfo.linear) ||
            (!gltfTex.initializedSRGB && !textureInfo.linear)
        ) {
            const gltfSampler = gltf.samplers[gltfTex.sampler];

            if (gltfSampler === undefined) {
                console.warn("Sampler is undefined for texture: " + textureInfo.index);
                return false;
            }

            this.context.pixelStorei(GL.UNPACK_FLIP_Y_WEBGL, false);

            // upload images that are not directly loaded as GPU resource
            if (
                image.mimeType === ImageMimeType.PNG ||
                image.mimeType === ImageMimeType.JPEG ||
                image.mimeType === ImageMimeType.WEBP ||
                image.mimeType === ImageMimeType.HDR
            ) {
                // the check `GL.SRGB8_ALPHA8 === undefined` is needed as at the moment node-gles does not define the full format enum
                const internalformat =
                    textureInfo.linear || GL.SRGB8_ALPHA8 === undefined ? GL.RGBA : GL.SRGB8_ALPHA8;
                this.context.texImage2D(
                    image.type,
                    image.miplevel,
                    internalformat,
                    GL.RGBA,
                    GL.UNSIGNED_BYTE,
                    image.image
                );
            }

            this.setSampler(gltfSampler, gltfTex.type, textureInfo.generateMips);

            if (textureInfo.generateMips) {
                switch (gltfSampler.minFilter) {
                    case GL.NEAREST_MIPMAP_NEAREST:
                    case GL.NEAREST_MIPMAP_LINEAR:
                    case GL.LINEAR_MIPMAP_NEAREST:
                    case GL.LINEAR_MIPMAP_LINEAR:
                        this.context.generateMipmap(gltfTex.type);
                        break;
                    default:
                        break;
                }
            }

            if (textureInfo.linear) {
                gltfTex.initialized = true;
            } else {
                gltfTex.initializedSRGB = true;
            }
        }
        if (textureInfo.linear) {
            return gltfTex.initialized;
        }
        return gltfTex.initializedSRGB;
    }

    setIndices(gltf, accessorIndex) {
        let gltfAccessor = gltf.accessors[accessorIndex];

        if (gltfAccessor.glBuffer === undefined) {
            gltfAccessor.glBuffer = this.context.createBuffer();

            let data = gltfAccessor.getTypedView(gltf);

            if (data === undefined) {
                return false;
            }

            this.context.bindBuffer(GL.ELEMENT_ARRAY_BUFFER, gltfAccessor.glBuffer);
            this.context.bufferData(GL.ELEMENT_ARRAY_BUFFER, data, GL.STATIC_DRAW);
        } else {
            this.context.bindBuffer(GL.ELEMENT_ARRAY_BUFFER, gltfAccessor.glBuffer);
        }

        return true;
    }

    /**
     * Binds an element array buffer containing the edges of a triangle primitive as line pairs.
     * The buffer is generated lazily and cached on the accessor it was derived from
     * (the index accessor, or the POSITION accessor for non-indexed primitives),
     * so it is released together with that accessor.
     * @returns {number} the number of indices to draw with GL.LINES, or 0 on failure
     */
    setWireframeIndices(gltf, primitive) {
        const indexed = primitive.indices !== undefined;
        const sourceAccessor =
            gltf.accessors[indexed ? primitive.indices : primitive.attributes.POSITION];
        if (sourceAccessor === undefined) {
            return 0;
        }

        sourceAccessor.wireframeGlBuffers ??= new Map();
        let wireframe = sourceAccessor.wireframeGlBuffers.get(primitive.mode);
        if (wireframe === undefined) {
            let indices = undefined;
            if (indexed) {
                indices = sourceAccessor.getTypedView(gltf);
                if (indices === undefined) {
                    return 0;
                }
            }
            const lineIndices = generateWireframeIndices(
                primitive.mode,
                indices,
                sourceAccessor.count
            );
            if (lineIndices === undefined) {
                return 0;
            }

            wireframe = { glBuffer: this.context.createBuffer(), count: lineIndices.length };
            this.context.bindBuffer(GL.ELEMENT_ARRAY_BUFFER, wireframe.glBuffer);
            this.context.bufferData(GL.ELEMENT_ARRAY_BUFFER, lineIndices, GL.STATIC_DRAW);
            sourceAccessor.wireframeGlBuffers.set(primitive.mode, wireframe);
        } else {
            this.context.bindBuffer(GL.ELEMENT_ARRAY_BUFFER, wireframe.glBuffer);
        }

        return wireframe.count;
    }

    enableAttribute(gltf, attributeLocation, gltfAccessor) {
        if (attributeLocation === null) {
            console.warn("Tried to access unknown attribute");
            return false;
        }

        if (gltfAccessor.glBuffer === undefined) {
            if (gltfAccessor.componentType === 5130) {
                throw new Error("64-bit float attributes are not supported in WebGL2");
            }
            gltfAccessor.glBuffer = this.context.createBuffer();

            let data = gltfAccessor.getTypedView(gltf);

            if (data === undefined) {
                return false;
            }

            this.context.bindBuffer(GL.ARRAY_BUFFER, gltfAccessor.glBuffer);
            this.context.bufferData(GL.ARRAY_BUFFER, data, GL.STATIC_DRAW);
        } else {
            this.context.bindBuffer(GL.ARRAY_BUFFER, gltfAccessor.glBuffer);
        }

        this.context.vertexAttribPointer(
            attributeLocation,
            gltfAccessor.getComponentCount(gltfAccessor.type),
            gltfAccessor.componentType,
            gltfAccessor.normalized,
            gltfAccessor.byteStride(gltf),
            0
        );
        this.context.enableVertexAttribArray(attributeLocation);

        return true;
    }

    compileShader(shaderIdentifier, isVert, shaderSource) {
        const shader = this.context.createShader(isVert ? GL.VERTEX_SHADER : GL.FRAGMENT_SHADER);
        this.context.shaderSource(shader, shaderSource);
        this.context.compileShader(shader);
        const compiled = this.context.getShaderParameter(shader, GL.COMPILE_STATUS);

        if (!compiled) {
            // output surrounding source code
            let info = "";
            const messages = this.context.getShaderInfoLog(shader).split("\n");
            for (const message of messages) {
                const matches = message.match(/(WARNING|ERROR): ([0-9]*):([0-9]*):(.*)/i);
                if (matches && matches.length == 5) {
                    const lineNumber = parseInt(matches[3]) - 1;
                    const lines = shaderSource.split("\n");

                    info += `${matches[1]}: ${shaderIdentifier}+includes:${lineNumber}: ${matches[4]}`;

                    for (
                        let i = Math.max(0, lineNumber - 2);
                        i < Math.min(lines.length, lineNumber + 3);
                        i++
                    ) {
                        if (lineNumber === i) {
                            info += "->";
                        }
                        info += "\t" + lines[i] + "\n";
                    }
                } else {
                    info += message + "\n";
                }
            }

            throw new Error("Could not compile WebGL program '" + shaderIdentifier + "': " + info);
        }

        return shader;
    }

    linkProgram(vertex, fragment) {
        let program = this.context.createProgram();
        this.context.attachShader(program, vertex);
        this.context.attachShader(program, fragment);
        this.context.linkProgram(program);

        if (!this.context.getProgramParameter(program, GL.LINK_STATUS)) {
            var info = this.context.getProgramInfoLog(program);
            throw new Error("Could not link WebGL program. \n\n" + info);
        }

        return program;
    }

    //https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/Constants
    setSampler(
        gltfSamplerObj,
        type,
        generateMipmaps // TEXTURE_2D
    ) {
        if (generateMipmaps) {
            this.context.texParameteri(type, GL.TEXTURE_WRAP_S, gltfSamplerObj.wrapS);
            this.context.texParameteri(type, GL.TEXTURE_WRAP_T, gltfSamplerObj.wrapT);
        } else {
            this.context.texParameteri(type, GL.TEXTURE_WRAP_S, GL.CLAMP_TO_EDGE);
            this.context.texParameteri(type, GL.TEXTURE_WRAP_T, GL.CLAMP_TO_EDGE);
        }

        // If not mip-mapped, force to non-mip-mapped sampler.
        if (
            !generateMipmaps &&
            gltfSamplerObj.minFilter != GL.NEAREST &&
            gltfSamplerObj.minFilter != GL.LINEAR
        ) {
            if (
                gltfSamplerObj.minFilter == GL.NEAREST_MIPMAP_NEAREST ||
                gltfSamplerObj.minFilter == GL.NEAREST_MIPMAP_LINEAR
            ) {
                this.context.texParameteri(type, GL.TEXTURE_MIN_FILTER, GL.NEAREST);
            } else {
                this.context.texParameteri(type, GL.TEXTURE_MIN_FILTER, GL.LINEAR);
            }
        } else {
            this.context.texParameteri(type, GL.TEXTURE_MIN_FILTER, gltfSamplerObj.minFilter);
        }
        this.context.texParameteri(type, GL.TEXTURE_MAG_FILTER, gltfSamplerObj.magFilter);

        if (this.context.supports_EXT_texture_filter_anisotropic) {
            if (
                gltfSamplerObj.magFilter !== GL.NEAREST &&
                (gltfSamplerObj.minFilter === GL.NEAREST_MIPMAP_LINEAR ||
                    gltfSamplerObj.minFilter === GL.LINEAR_MIPMAP_LINEAR)
            ) {
                this.context.texParameterf(
                    type,
                    this.context.anisotropy,
                    this.context.maxAnisotropy
                ); // => 16xAF
            }
        }
    }
}

const MODE_TRIANGLES = 4;
const MODE_TRIANGLE_STRIP = 5;
const MODE_TRIANGLE_FAN = 6;

/**
 * Converts triangle topology into a list of line segments (pairs of vertex indices).
 * @param {number} mode TRIANGLES, TRIANGLE_STRIP or TRIANGLE_FAN
 * @param {ArrayLike<number> | undefined} indices index data, or undefined for non-indexed geometry
 * @param {number} count number of indices (or vertices for non-indexed geometry)
 * @returns {Uint32Array | undefined} undefined if mode is not a triangle mode
 */
function generateWireframeIndices(mode, indices, count) {
    let triangleCount;
    switch (mode) {
        case MODE_TRIANGLES:
            triangleCount = Math.floor(count / 3);
            break;
        case MODE_TRIANGLE_STRIP:
        case MODE_TRIANGLE_FAN:
            triangleCount = Math.max(count - 2, 0);
            break;
        default:
            return undefined;
    }

    const index = indices !== undefined ? (i) => indices[i] : (i) => i;
    const lines = new Uint32Array(triangleCount * 6);
    for (let t = 0, o = 0; t < triangleCount; t++, o += 6) {
        let a, b, c;
        if (mode === MODE_TRIANGLES) {
            a = index(3 * t);
            b = index(3 * t + 1);
            c = index(3 * t + 2);
        } else if (mode === MODE_TRIANGLE_STRIP) {
            a = index(t);
            b = index(t + 1);
            c = index(t + 2);
        } else {
            a = index(0);
            b = index(t + 1);
            c = index(t + 2);
        }
        lines[o] = a;
        lines[o + 1] = b;
        lines[o + 2] = b;
        lines[o + 3] = c;
        lines[o + 4] = c;
        lines[o + 5] = a;
    }
    return lines;
}

export { gltfWebGl, GL, generateWireframeIndices };
