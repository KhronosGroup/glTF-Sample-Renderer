// Writes GLB containers for tests and for the sample viewer's test-asset generator.
//
// Binary format version 2 is glTF 2.0's container; version 3 is added by glTF 2.1 and
// widens the length fields to 64 bits, adds a per-chunk encoding field, and moves chunk
// alignment from 4 to 8 bytes. Note that the chunk header field order differs between
// the two: v2 is (length, type), v3 is (type, encoding, length).

const GLB_MAGIC = 0x46546c67;
const CHUNK_TYPE_JSON = 0x4e4f534a;
const CHUNK_TYPE_BIN = 0x004e4942;

const CHUNK_ENCODING_PLAIN = 0x00000000;

const PAD_SPACE = 0x20;
const PAD_ZERO = 0x00;

function alignmentFor(version) {
    return version === 3 ? 8 : 4;
}

function headerLengthFor(version) {
    return version === 3 ? 16 : 12;
}

function chunkHeaderLengthFor(version) {
    return version === 3 ? 16 : 8;
}

function alignUp(value, alignment) {
    return Math.ceil(value / alignment) * alignment;
}

function jsonChunk(json, overrides = {}) {
    return {
        type: CHUNK_TYPE_JSON,
        data: new TextEncoder().encode(JSON.stringify(json)),
        padByte: PAD_SPACE,
        ...overrides
    };
}

function binChunk(data, overrides = {}) {
    return {
        type: CHUNK_TYPE_BIN,
        data: data instanceof Uint8Array ? data : new Uint8Array(data),
        padByte: PAD_ZERO,
        ...overrides
    };
}

/**
 * @param {object} options
 * @param {number} [options.version] 2 or 3.
 * @param {Array<object>} options.chunks `{ type, data, encoding?, padByte?, padInside? }`.
 *   `padInside` counts alignment padding in `chunkLength` rather than leaving it in the
 *   gap between chunks. v2 requires it; v3 permits either, so it is exercised both ways.
 * @param {number} [options.declaredLength] Overrides the header length field, for
 *   testing a parser's handling of a corrupt file.
 * @returns {ArrayBuffer}
 */
function writeGlb({ version = 2, chunks, declaredLength = undefined }) {
    if (version !== 2 && version !== 3) {
        throw new Error(`Unsupported GLB container version ${version}`);
    }
    const alignment = alignmentFor(version);
    const chunkHeaderLength = chunkHeaderLengthFor(version);

    // v2 has no way to express a gap between chunks, since a chunk's end is required to
    // be aligned and the next chunk starts immediately after.
    const layout = chunks.map((chunk) => {
        const padInside = chunk.padInside ?? version === 2;
        const dataLength = chunk.data.length;
        const storedLength = padInside ? alignUp(dataLength, alignment) : dataLength;
        return { ...chunk, dataLength, storedLength };
    });

    let total = headerLengthFor(version);
    for (const chunk of layout) {
        chunk.headerStart = total;
        chunk.dataStart = total + chunkHeaderLength;
        total = alignUp(chunk.dataStart + chunk.storedLength, alignment);
    }

    const buffer = new ArrayBuffer(total);
    const view = new DataView(buffer);
    const bytes = new Uint8Array(buffer);

    view.setUint32(0, GLB_MAGIC, true);
    view.setUint32(4, version, true);
    if (version === 3) {
        view.setBigUint64(8, BigInt(declaredLength ?? total), true);
    } else {
        view.setUint32(8, declaredLength ?? total, true);
    }

    for (const chunk of layout) {
        if (version === 3) {
            view.setUint32(chunk.headerStart, chunk.type, true);
            view.setUint32(chunk.headerStart + 4, chunk.encoding ?? CHUNK_ENCODING_PLAIN, true);
            view.setBigUint64(chunk.headerStart + 8, BigInt(chunk.storedLength), true);
        } else {
            view.setUint32(chunk.headerStart, chunk.storedLength, true);
            view.setUint32(chunk.headerStart + 4, chunk.type, true);
        }

        bytes.set(chunk.data, chunk.dataStart);

        // Padding inside the chunk belongs to the payload, so JSON pads with spaces to
        // stay parseable. Padding in the gap between chunks is always zeros.
        const padByte = chunk.padByte ?? PAD_ZERO;
        bytes.fill(
            padByte,
            chunk.dataStart + chunk.dataLength,
            chunk.dataStart + chunk.storedLength
        );
    }

    return buffer;
}

export {
    writeGlb,
    jsonChunk,
    binChunk,
    GLB_MAGIC,
    CHUNK_TYPE_JSON,
    CHUNK_TYPE_BIN,
    CHUNK_ENCODING_PLAIN
};
