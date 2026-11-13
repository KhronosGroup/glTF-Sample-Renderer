// Parses both GLB container versions.
//
// Version 2 is glTF 2.0's container. Version 3 is added by glTF 2.1 and differs in three
// ways that all matter here:
//   - 64-bit length fields in both the file header and the chunk headers
//   - a per-chunk `encoding` field, with a reordered chunk header: (type, encoding,
//     length) rather than v2's (length, type)
//   - 8-byte chunk alignment instead of 4, and the glTF JSON chunk no longer has to be
//     the first chunk
//
// The container version is independent of the glTF version in the JSON: a glTF 2.1 asset
// may legitimately ship in a v2 container, so callers must check `asset.version`
// separately.

const GLB_MAGIC = 0x46546c67;
const CHUNK_TYPE_JSON = 0x4e4f534a;
const CHUNK_TYPE_BIN = 0x004e4942;
const CHUNK_ENCODING_PLAIN = 0x00000000;

// A v2 file is bounded by its uint32 length field and its 4-byte end alignment.
const MAX_GLB_V2_LENGTH = 2 ** 32 - 4;

const VERSION_LAYOUT = {
    2: { headerLength: 12, chunkHeaderLength: 8, alignment: 4 },
    3: { headerLength: 16, chunkHeaderLength: 16, alignment: 8 }
};

class GlbParser {
    constructor(data) {
        this.data = data;
        this.view = new DataView(data);
    }

    extractGlbData() {
        const header = this.getCheckedGlbInfo();
        if (header === undefined) {
            return undefined;
        }

        const chunks = this.getAllChunkInfos(header);
        if (chunks === undefined) {
            return undefined;
        }

        // In v2 the glTF JSON must be chunk 0. In v3 it is the first JSON chunk, which
        // lets chunks of other types precede it.
        const jsonChunkIndex = chunks.findIndex((chunk) => chunk.type === CHUNK_TYPE_JSON);
        if (jsonChunkIndex === -1) {
            console.error("GLB file contains no JSON chunk");
            return undefined;
        }
        if (header.version === 2 && jsonChunkIndex !== 0) {
            console.error("In GLB version 2 the JSON chunk must be the first chunk");
            return undefined;
        }

        const jsonChunk = chunks[jsonChunkIndex];
        if (jsonChunk.encoding !== CHUNK_ENCODING_PLAIN) {
            console.error(
                `Cannot read a GLB whose JSON chunk uses unsupported encoding ` +
                    `0x${jsonChunk.encoding.toString(16)}`
            );
            return undefined;
        }

        const json = this.getJsonFromChunk(jsonChunk);
        if (json === undefined) {
            return undefined;
        }

        return { version: header.version, json, jsonChunkIndex, chunks };
    }

    getCheckedGlbInfo() {
        if (this.data.byteLength < VERSION_LAYOUT[2].headerLength) {
            console.error("GLB file is too short to contain a header");
            return undefined;
        }

        const magic = this.view.getUint32(0, true);
        if (magic !== GLB_MAGIC) {
            console.error(
                `Found invalid glb magic, expected 0x${GLB_MAGIC.toString(16)}, ` +
                    `but was 0x${magic.toString(16)}`
            );
            return undefined;
        }

        const version = this.view.getUint32(4, true);
        const layout = VERSION_LAYOUT[version];
        if (layout === undefined) {
            console.error(`Unsupported glb container version ${version}, expected 2 or 3`);
            return undefined;
        }
        if (this.data.byteLength < layout.headerLength) {
            console.error("GLB file is too short to contain a header");
            return undefined;
        }

        const length = this.readLength(8, version, "length");
        if (length === undefined) {
            return undefined;
        }
        if (version === 2 && length > MAX_GLB_V2_LENGTH) {
            console.error(`GLB version 2 files may be at most ${MAX_GLB_V2_LENGTH} bytes`);
            return undefined;
        }
        if (length !== this.data.byteLength) {
            console.error(
                `Found invalid/unsupported glb byte length, expected: ` +
                    `${this.data.byteLength}, but was: ${length}`
            );
            return undefined;
        }

        return { magic, version, length, ...layout };
    }

    // Reads a length field, keeping BigInt confined to this method. Values beyond
    // Number.MAX_SAFE_INTEGER cannot be used as offsets, and in a browser nothing
    // approaching that is loadable into an ArrayBuffer anyway.
    readLength(offset, version, name) {
        if (version !== 3) {
            return this.view.getUint32(offset, true);
        }
        const raw = this.view.getBigUint64(offset, true);
        if (raw > BigInt(Number.MAX_SAFE_INTEGER)) {
            console.error(
                `GLB ${name} of ${raw} exceeds the largest exactly representable integer`
            );
            return undefined;
        }
        return Number(raw);
    }

    getAllChunkInfos(header) {
        const infos = [];
        let chunkStart = header.headerLength;

        while (chunkStart < this.data.byteLength) {
            if (chunkStart + header.chunkHeaderLength > this.data.byteLength) {
                console.error("GLB file ends in the middle of a chunk header");
                return undefined;
            }

            const chunkInfo = this.getChunkInfo(chunkStart, header, infos.length);
            if (chunkInfo === undefined) {
                return undefined;
            }
            if (chunkInfo.start + chunkInfo.length > this.data.byteLength) {
                console.error(`GLB chunk ${infos.length} extends past the end of the file`);
                return undefined;
            }
            infos.push(chunkInfo);

            const next = this.alignUp(chunkInfo.start + chunkInfo.length, header.alignment);
            if (next <= chunkStart) {
                console.error("GLB chunk layout does not advance, file is malformed");
                return undefined;
            }
            chunkStart = next;
        }

        return infos;
    }

    getChunkInfo(headerStart, header, index) {
        let type;
        let encoding;
        let length;

        if (header.version === 3) {
            type = this.view.getUint32(headerStart, true);
            encoding = this.view.getUint32(headerStart + 4, true);
            length = this.readLength(headerStart + 8, 3, `chunk ${index} length`);
        } else {
            length = this.view.getUint32(headerStart, true);
            type = this.view.getUint32(headerStart + 4, true);
            encoding = CHUNK_ENCODING_PLAIN;
        }

        if (length === undefined) {
            return undefined;
        }

        return {
            index,
            type,
            encoding,
            start: headerStart + header.chunkHeaderLength,
            length
        };
    }

    alignUp(value, alignment) {
        return Math.ceil(value / alignment) * alignment;
    }

    getJsonFromChunk(chunkInfo) {
        const jsonSlice = new Uint8Array(this.data, chunkInfo.start, chunkInfo.length);
        try {
            return JSON.parse(new TextDecoder("utf-8").decode(jsonSlice));
        } catch (error) {
            console.error(`Could not parse the glTF JSON chunk: ${error}`);
            return undefined;
        }
    }

    getBufferFromChunk(chunkInfo) {
        return this.data.slice(chunkInfo.start, chunkInfo.start + chunkInfo.length);
    }
}

export {
    GlbParser,
    GLB_MAGIC,
    CHUNK_TYPE_JSON,
    CHUNK_TYPE_BIN,
    CHUNK_ENCODING_PLAIN,
    MAX_GLB_V2_LENGTH
};
