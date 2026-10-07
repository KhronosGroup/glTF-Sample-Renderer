import { CHUNK_TYPE_BIN, CHUNK_ENCODING_PLAIN } from "./glb_parser.js";

class gltfLoader {
    static async load(gltf, webGlContext, appendix = undefined, allowResourceAbsolutePath = true) {
        const glb = gltfLoader.getGlbContainer(appendix);
        const additionalFiles = gltfLoader.getAdditionalFiles(appendix);

        const buffersPromise = gltfLoader.loadBuffers(
            gltf,
            glb,
            additionalFiles,
            allowResourceAbsolutePath
        );

        await buffersPromise; // images might be stored in the buffers
        const imagesPromise = gltfLoader.loadImages(
            gltf,
            additionalFiles,
            allowResourceAbsolutePath
        );

        return await Promise.all([buffersPromise, imagesPromise]).then(() =>
            gltf.initGl(webGlContext)
        );
    }

    static unload(gltf) {
        for (let image of gltf.images) {
            image.image = undefined;
        }
        gltf.images = [];

        for (let texture of gltf.textures) {
            texture.destroy();
        }
        gltf.textures = [];

        for (let accessor of gltf.accessors) {
            accessor.destroy();
        }
        gltf.accessors = [];
    }

    static getGlbContainer(appendix) {
        return appendix?.glb;
    }

    static getAdditionalFiles(appendix) {
        if (typeof File !== "undefined") {
            return gltfLoader.getTypedAppendix(appendix, File);
        } else {
            return;
        }
    }

    static getTypedAppendix(appendix, Type) {
        if (appendix && appendix.length > 0) {
            if (appendix[0] instanceof Type || appendix[0][1] instanceof Type) {
                return appendix;
            }
        }
    }

    // Binds a buffer to the GLB chunk that holds its data.
    //
    // glTF 2.1 lets a buffer name its chunk explicitly, which is what makes multiple
    // binary chunks usable. glTF 2.0 had no such property and relied on buffer 0
    // implicitly meaning chunk 1; that stays supported, but only for the exact layout
    // 2.0 could produce, so it cannot be mistaken for a 2.1 buffer that forgot its
    // `chunk` property.
    static resolveBufferChunk(gltf, buffer, bufferIndex, glb) {
        if (glb === undefined) {
            return undefined;
        }

        let chunk = undefined;
        if (buffer.chunk !== undefined) {
            chunk = glb.chunks[buffer.chunk];
            if (chunk === undefined) {
                console.error(
                    `Buffer ${bufferIndex} references GLB chunk ${buffer.chunk}, ` +
                        `but the file only has ${glb.chunks.length} chunks`
                );
                return undefined;
            }
        } else if (
            bufferIndex === 0 &&
            buffer.uri === undefined &&
            glb.jsonChunkIndex === 0 &&
            glb.chunks[1]?.type === CHUNK_TYPE_BIN
        ) {
            chunk = glb.chunks[1];
        }

        if (chunk === undefined) {
            return undefined;
        }

        if (chunk.type !== CHUNK_TYPE_BIN) {
            console.error(
                `Buffer ${bufferIndex} references GLB chunk ${chunk.index}, ` +
                    `which is not a binary chunk`
            );
            return undefined;
        }
        if (chunk.encoding !== CHUNK_ENCODING_PLAIN) {
            console.error(
                `Buffer ${bufferIndex} references GLB chunk ${chunk.index}, which uses ` +
                    `unsupported encoding 0x${chunk.encoding.toString(16)}`
            );
            return undefined;
        }
        // The spec requires the chunk to be at least as large as the buffer rather than
        // exactly equal, so that GLB padding does not force byteLength to be rewritten.
        if (buffer.byteLength !== undefined && chunk.length < buffer.byteLength) {
            console.error(
                `Buffer ${bufferIndex} declares ${buffer.byteLength} bytes but GLB chunk ` +
                    `${chunk.index} only holds ${chunk.length}`
            );
            return undefined;
        }

        return chunk;
    }

    static loadBuffers(gltf, glb, additionalFiles, allowResourceAbsolutePath) {
        const promises = [];

        for (const [index, buffer] of gltf.buffers.entries()) {
            const chunk = gltfLoader.resolveBufferChunk(gltf, buffer, index, glb);
            if (chunk !== undefined) {
                buffer.buffer = glb.parser.getBufferFromChunk(chunk);
                continue;
            }
            promises.push(buffer.load(gltf, additionalFiles, allowResourceAbsolutePath));
        }

        return Promise.all(promises);
    }

    static loadImages(gltf, additionalFiles, allowResourceAbsolutePath) {
        const imagePromises = [];
        for (let image of gltf.images) {
            if (image.isThumbnail && !image.usedByTexture) {
                continue;
            }
            imagePromises.push(image.load(gltf, additionalFiles, allowResourceAbsolutePath));
        }
        return Promise.all(imagePromises);
    }
}

export { gltfLoader };
