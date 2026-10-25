import { GlbParser, CHUNK_TYPE_BIN, CHUNK_ENCODING_PLAIN } from "./glb_parser.js";
import { FileResolver } from "./file_resolver.js";
import { ResourceLoaderUtils } from "./loader_utils.js";

// Reads only `asset.thumbnail` and the one image it points at.
//
// The point of glTF 2.1 thumbnails is previewing an asset without loading its scene, so
// this path deliberately does not build a glTF document, touch WebGL, or decode anything
// else. The result is an object URL the caller owns and must revoke.
//
// Thumbnails are optional, so a source this cannot read yields no thumbnail rather than
// an error: whatever is wrong with it will be reported by the real load. A thumbnail the
// asset does declare but that fails to resolve is a genuine fault and does throw.

const GLTF_MAGIC = "glTF";

function isFileLike(value) {
    return typeof Blob !== "undefined" && value instanceof Blob;
}

/**
 * Accepts the same source forms as ResourceLoader.loadGltf.
 * @returns {Promise<{data: ArrayBuffer, path: string}|undefined>}
 */
async function normalizeSource(source) {
    if (typeof source === "string") {
        const response = await fetch(source);
        if (!response.ok) {
            throw new Error(`Failed to fetch ${source}: ${response.statusText}`);
        }
        return { data: await response.arrayBuffer(), path: source };
    }
    if (source instanceof ArrayBuffer) {
        return { data: source, path: "" };
    }
    // A dropped file arrives as [path, File].
    if (Array.isArray(source) && isFileLike(source[1])) {
        return { data: await source[1].arrayBuffer(), path: source[0] };
    }
    if (isFileLike(source)) {
        return { data: await source.arrayBuffer(), path: source.name ?? "" };
    }
    return undefined;
}

function isGlb(data) {
    if (data.byteLength < 4) {
        return false;
    }
    return new TextDecoder().decode(new Uint8Array(data, 0, 4)) === GLTF_MAGIC;
}

// Only GLB chunks and data URIs avoid an extra read. An external .bin means pulling the
// whole buffer in for one image, which is still far cheaper than loading the scene.
async function readBufferViewBytes(json, bufferViewIndex, glb, resolver) {
    const bufferView = json.bufferViews?.[bufferViewIndex];
    if (bufferView === undefined) {
        throw new Error(`Thumbnail refers to bufferView ${bufferViewIndex}, which does not exist`);
    }
    const buffer = json.buffers?.[bufferView.buffer];
    if (buffer === undefined) {
        throw new Error(`Thumbnail refers to buffer ${bufferView.buffer}, which does not exist`);
    }

    let bufferData;
    if (buffer.uri === undefined && glb !== undefined) {
        const chunkIndex = buffer.chunk ?? (glb.jsonChunkIndex === 0 ? 1 : undefined);
        const chunk = chunkIndex !== undefined ? glb.chunks[chunkIndex] : undefined;
        if (chunk === undefined || chunk.type !== CHUNK_TYPE_BIN) {
            throw new Error("Thumbnail buffer does not resolve to a GLB binary chunk");
        }
        if (chunk.encoding !== CHUNK_ENCODING_PLAIN) {
            throw new Error("Thumbnail buffer chunk uses an unsupported encoding");
        }
        bufferData = new Uint8Array(glb.parser.getBufferFromChunk(chunk));
    } else if (buffer.uri !== undefined) {
        bufferData = (await resolver.resolve(buffer.uri)).bytes;
    } else {
        throw new Error("Thumbnail buffer has no data source");
    }

    const offset = bufferView.byteOffset ?? 0;
    return bufferData.subarray(offset, offset + bufferView.byteLength);
}

/**
 * @param {(string|ArrayBuffer|Blob|Array)} source A `.gltf` or `.glb`.
 * @param {Array} [droppedFiles] `[path, File]` pairs accompanying a dropped asset.
 * @returns {Promise<{url: string, mimeType: string}|undefined>} undefined when the asset
 *   declares no thumbnail, or when the source is not something this can read.
 */
async function loadThumbnail(source, droppedFiles = undefined) {
    const normalized = await normalizeSource(source);
    if (normalized === undefined) {
        return undefined;
    }
    const { data, path } = normalized;

    let json;
    let glb;
    if (isGlb(data)) {
        const parser = new GlbParser(data);
        const parsed = parser.extractGlbData();
        if (parsed === undefined) {
            return undefined;
        }
        json = parsed.json;
        glb = { ...parsed, parser };
    } else {
        try {
            json = JSON.parse(new TextDecoder().decode(new Uint8Array(data)));
        } catch {
            return undefined;
        }
    }

    const index = json.asset?.thumbnail;
    if (index === undefined) {
        return undefined;
    }

    const image = json.images?.[index];
    if (image === undefined) {
        throw new Error(`asset.thumbnail refers to image ${index}, which does not exist`);
    }

    // The spec allows any media type here, so it is passed through to the Blob untouched
    // and the browser decides whether it can display it.
    const mimeType = image.mimeType ?? "application/octet-stream";

    if (image.uri !== undefined && image.uri.startsWith("data:")) {
        return { url: image.uri, mimeType };
    }

    const resolver = new FileResolver({
        baseUri: ResourceLoaderUtils.getContainingFolder(path),
        droppedFiles
    });

    let bytes;
    if (image.uri !== undefined) {
        bytes = (await resolver.resolve(image.uri)).bytes;
    } else if (image.bufferView !== undefined) {
        bytes = await readBufferViewBytes(json, image.bufferView, glb, resolver);
    } else {
        throw new Error("Thumbnail image has neither a uri nor a bufferView");
    }

    return { url: URL.createObjectURL(new Blob([bytes], { type: mimeType })), mimeType };
}

export { loadThumbnail };
