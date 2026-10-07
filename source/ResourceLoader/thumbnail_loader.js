import { GlbParser, CHUNK_TYPE_BIN, CHUNK_ENCODING_PLAIN } from "./glb_parser.js";
import { ResourceLoaderUtils } from "./loader_utils.js";

// Reads only `asset.thumbnail` and the one image it points at.
//
// The point of glTF 2.1 thumbnails is previewing an asset without loading its scene, so
// this path deliberately does not build a glTF document, touch WebGL, or decode anything
// else. The result is an object URL the caller owns and must revoke.

const GLTF_MAGIC = "glTF";

async function readAsArrayBuffer(source) {
    if (typeof source === "string") {
        const response = await fetch(source);
        if (!response.ok) {
            throw new Error(`Failed to fetch ${source}: ${response.statusText}`);
        }
        return response.arrayBuffer();
    }
    if (source instanceof ArrayBuffer) {
        return source;
    }
    if (typeof Blob !== "undefined" && source instanceof Blob) {
        return source.arrayBuffer();
    }
    throw new Error("Unsupported source passed to the thumbnail loader");
}

function isGlb(data) {
    if (data.byteLength < 4) {
        return false;
    }
    return new TextDecoder().decode(new Uint8Array(data, 0, 4)) === GLTF_MAGIC;
}

// Resolves the bufferView holding the thumbnail. Only GLB chunks and data URIs are
// handled without extra fetches; an external .bin means fetching the whole buffer, which
// is still cheaper than loading the scene but is the slow case.
async function readBufferViewBytes(json, bufferViewIndex, glb, basePath) {
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
        bufferData = glb.parser.getBufferFromChunk(chunk);
    } else if (buffer.uri !== undefined) {
        const uri = buffer.uri.startsWith("data:") ? buffer.uri : basePath + buffer.uri;
        bufferData = await readAsArrayBuffer(uri);
    } else {
        throw new Error("Thumbnail buffer has no data source");
    }

    const offset = bufferView.byteOffset ?? 0;
    return new Uint8Array(bufferData, offset, bufferView.byteLength);
}

/**
 * @param {(string|ArrayBuffer|Blob)} source A `.gltf` or `.glb`.
 * @param {string} [path] Used to resolve relative URIs when `source` is not a string.
 * @returns {Promise<{url: string, mimeType: string}|undefined>} undefined when the asset
 *   declares no thumbnail.
 */
async function loadThumbnail(source, path = undefined) {
    const location = typeof source === "string" ? source : (path ?? "");
    const basePath = ResourceLoaderUtils.getContainingFolder(location);

    const data = await readAsArrayBuffer(source);

    let json;
    let glb;
    if (isGlb(data)) {
        const parser = new GlbParser(data);
        const parsed = parser.extractGlbData();
        if (parsed === undefined) {
            throw new Error(`Could not read the GLB container of ${location}`);
        }
        json = parsed.json;
        glb = { ...parsed, parser };
    } else {
        json = JSON.parse(new TextDecoder().decode(new Uint8Array(data)));
    }

    const index = json.asset?.thumbnail;
    if (index === undefined) {
        return undefined;
    }

    const image = json.images?.[index];
    if (image === undefined) {
        throw new Error(`asset.thumbnail refers to image ${index}, which does not exist`);
    }

    // The spec allows any media type here, so the type is passed through to the Blob
    // untouched and the browser decides whether it can display it.
    const mimeType = image.mimeType ?? "application/octet-stream";

    if (image.uri !== undefined && image.uri.startsWith("data:")) {
        return { url: image.uri, mimeType };
    }

    let bytes;
    if (image.uri !== undefined) {
        bytes = new Uint8Array(await readAsArrayBuffer(basePath + image.uri));
    } else if (image.bufferView !== undefined) {
        bytes = await readBufferViewBytes(json, image.bufferView, glb, basePath);
    } else {
        throw new Error("Thumbnail image has neither a uri nor a bufferView");
    }

    return { url: URL.createObjectURL(new Blob([bytes], { type: mimeType })), mimeType };
}

export { loadThumbnail };
