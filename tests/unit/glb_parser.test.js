import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import {
    GlbParser,
    CHUNK_TYPE_JSON,
    CHUNK_TYPE_BIN,
    CHUNK_ENCODING_PLAIN
} from "../../source/ResourceLoader/glb_parser.js";
import { writeGlb, jsonChunk, binChunk } from "../helpers/glb_writer.js";

const MINIMAL_GLTF = { asset: { version: "2.0" } };

// The parser reports malformed containers through console.error and returns undefined,
// so the failure cases have to silence it to keep the output readable.
let errorSpy;
beforeEach(() => {
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
    errorSpy.mockRestore();
});

const parse = (buffer) => new GlbParser(buffer).extractGlbData();

describe.each([2, 3])("GLB version %i", (version) => {
    it("reads the JSON chunk", () => {
        const glb = parse(writeGlb({ version, chunks: [jsonChunk(MINIMAL_GLTF)] }));

        expect(glb.version).toBe(version);
        expect(glb.json).toEqual(MINIMAL_GLTF);
        expect(glb.jsonChunkIndex).toBe(0);
    });

    it("reads a binary chunk alongside the JSON chunk", () => {
        const payload = new Uint8Array([1, 2, 3, 4, 5, 6, 7]);
        const buffer = writeGlb({
            version,
            chunks: [jsonChunk(MINIMAL_GLTF), binChunk(payload)]
        });

        const glb = parse(buffer);
        expect(glb.chunks).toHaveLength(2);
        expect(glb.chunks[1].type).toBe(CHUNK_TYPE_BIN);

        const parser = new GlbParser(buffer);
        const data = new Uint8Array(parser.getBufferFromChunk(glb.chunks[1]));
        // v2 counts its alignment padding in chunkLength, so the slice can be longer
        // than the payload. The spec allows that; it requires chunk >= buffer, not equal.
        expect(data.slice(0, payload.length)).toEqual(payload);
    });

    it("rejects a file whose declared length disagrees with its actual size", () => {
        const buffer = writeGlb({
            version,
            chunks: [jsonChunk(MINIMAL_GLTF)],
            declaredLength: 4
        });

        expect(parse(buffer)).toBeUndefined();
        expect(errorSpy).toHaveBeenCalled();
    });

    it("rejects a chunk that runs past the end of the file", () => {
        const buffer = writeGlb({ version, chunks: [jsonChunk(MINIMAL_GLTF)] });
        const view = new DataView(buffer);
        // Overwrite the JSON chunk's length field with something far too large.
        if (version === 3) {
            view.setBigUint64(12 + 8, 4096n, true);
        } else {
            view.setUint32(12, 4096, true);
        }

        expect(parse(buffer)).toBeUndefined();
    });
});

describe("GLB header validation", () => {
    it("rejects a bad magic", () => {
        const buffer = writeGlb({ version: 2, chunks: [jsonChunk(MINIMAL_GLTF)] });
        new DataView(buffer).setUint32(0, 0xdeadbeef, true);

        expect(parse(buffer)).toBeUndefined();
    });

    it.each([1, 4, 0])("rejects container version %i", (version) => {
        const buffer = writeGlb({ version: 2, chunks: [jsonChunk(MINIMAL_GLTF)] });
        new DataView(buffer).setUint32(4, version, true);

        expect(parse(buffer)).toBeUndefined();
    });

    it("rejects a file too short to hold a header", () => {
        expect(parse(new ArrayBuffer(8))).toBeUndefined();
    });

    it("rejects a v3 length beyond the exactly representable integer range", () => {
        const buffer = writeGlb({ version: 3, chunks: [jsonChunk(MINIMAL_GLTF)] });
        new DataView(buffer).setBigUint64(8, BigInt(Number.MAX_SAFE_INTEGER) + 1n, true);

        expect(parse(buffer)).toBeUndefined();
        expect(errorSpy.mock.calls.flat().join(" ")).toMatch(/representable/);
    });

    it("reports a v2 file claiming to exceed the format's size limit", () => {
        const buffer = writeGlb({ version: 2, chunks: [jsonChunk(MINIMAL_GLTF)] });
        new DataView(buffer).setUint32(8, 0xfffffffe, true);

        expect(parse(buffer)).toBeUndefined();
        expect(errorSpy.mock.calls.flat().join(" ")).toMatch(/at most/);
    });
});

describe("GLB v3 chunk layout", () => {
    it("accepts chunks of an unknown type before the glTF JSON chunk", () => {
        const custom = { type: 0x4f464e49, data: new Uint8Array([9, 9, 9]) };
        const glb = parse(writeGlb({ version: 3, chunks: [custom, jsonChunk(MINIMAL_GLTF)] }));

        expect(glb.jsonChunkIndex).toBe(1);
        expect(glb.json).toEqual(MINIMAL_GLTF);
        expect(glb.chunks[0].type).toBe(custom.type);
    });

    it("keeps unknown trailing chunks in the table rather than dropping them", () => {
        const glb = parse(
            writeGlb({
                version: 3,
                chunks: [
                    jsonChunk(MINIMAL_GLTF),
                    binChunk(new Uint8Array([1, 2])),
                    { type: 0x4f464e49, data: new Uint8Array([3]) }
                ]
            })
        );

        expect(glb.chunks).toHaveLength(3);
        expect(glb.chunks[2].type).toBe(0x4f464e49);
    });

    it("exposes multiple binary chunks", () => {
        const glb = parse(
            writeGlb({
                version: 3,
                chunks: [
                    jsonChunk(MINIMAL_GLTF),
                    binChunk(new Uint8Array([1])),
                    binChunk(new Uint8Array([2])),
                    binChunk(new Uint8Array([3]))
                ]
            })
        );

        expect(glb.chunks.filter((chunk) => chunk.type === CHUNK_TYPE_BIN)).toHaveLength(3);
    });

    it("refuses a file whose JSON chunk uses an unknown encoding", () => {
        const buffer = writeGlb({
            version: 3,
            chunks: [jsonChunk(MINIMAL_GLTF, { encoding: 1 })]
        });

        expect(parse(buffer)).toBeUndefined();
    });

    it("surfaces an unknown binary chunk encoding without failing the whole file", () => {
        const glb = parse(
            writeGlb({
                version: 3,
                chunks: [jsonChunk(MINIMAL_GLTF), binChunk(new Uint8Array([1]), { encoding: 7 })]
            })
        );

        expect(glb).toBeDefined();
        expect(glb.chunks[1].encoding).toBe(7);
    });

    it("handles padding that is counted inside the chunk length", () => {
        const glb = parse(
            writeGlb({
                version: 3,
                chunks: [
                    jsonChunk(MINIMAL_GLTF, { padInside: true }),
                    binChunk(new Uint8Array([1, 2, 3]), { padInside: true })
                ]
            })
        );

        expect(glb.json).toEqual(MINIMAL_GLTF);
        expect(glb.chunks).toHaveLength(2);
    });

    it("handles padding that sits in the gap between chunks", () => {
        const glb = parse(
            writeGlb({
                version: 3,
                chunks: [
                    jsonChunk(MINIMAL_GLTF, { padInside: false }),
                    binChunk(new Uint8Array([1, 2, 3]), { padInside: false })
                ]
            })
        );

        expect(glb.json).toEqual(MINIMAL_GLTF);
        expect(glb.chunks[1].length).toBe(3);
    });

    it("starts every chunk on an 8 byte boundary", () => {
        const glb = parse(
            writeGlb({
                version: 3,
                chunks: [
                    jsonChunk(MINIMAL_GLTF),
                    binChunk(new Uint8Array([1])),
                    binChunk(new Uint8Array([2, 3, 4, 5, 6]))
                ]
            })
        );

        for (const chunk of glb.chunks) {
            expect((chunk.start - 16) % 8).toBe(0);
        }
    });
});

describe("GLB v2 compatibility", () => {
    it("requires the JSON chunk to come first", () => {
        const buffer = writeGlb({
            version: 2,
            chunks: [binChunk(new Uint8Array([1, 2, 3, 4])), jsonChunk(MINIMAL_GLTF)]
        });

        expect(parse(buffer)).toBeUndefined();
    });

    it("reports plain encoding for every chunk", () => {
        const glb = parse(
            writeGlb({
                version: 2,
                chunks: [jsonChunk(MINIMAL_GLTF), binChunk(new Uint8Array([1, 2, 3, 4]))]
            })
        );

        for (const chunk of glb.chunks) {
            expect(chunk.encoding).toBe(CHUNK_ENCODING_PLAIN);
        }
    });

    it("starts every chunk on a 4 byte boundary", () => {
        const glb = parse(
            writeGlb({
                version: 2,
                chunks: [jsonChunk(MINIMAL_GLTF), binChunk(new Uint8Array([1, 2, 3]))]
            })
        );

        for (const chunk of glb.chunks) {
            expect((chunk.start - 12) % 4).toBe(0);
        }
    });
});

describe("GLB JSON chunk", () => {
    it("rejects a file with no JSON chunk", () => {
        expect(
            parse(writeGlb({ version: 3, chunks: [binChunk(new Uint8Array([1, 2]))] }))
        ).toBeUndefined();
    });

    it("rejects unparseable JSON", () => {
        const buffer = writeGlb({
            version: 3,
            chunks: [{ type: CHUNK_TYPE_JSON, data: new TextEncoder().encode("{ not json") }]
        });

        expect(parse(buffer)).toBeUndefined();
    });

    it("tolerates space padded JSON", () => {
        const padded = new TextEncoder().encode(JSON.stringify(MINIMAL_GLTF) + "   ");
        const glb = parse(
            writeGlb({ version: 3, chunks: [{ type: CHUNK_TYPE_JSON, data: padded }] })
        );

        expect(glb.json).toEqual(MINIMAL_GLTF);
    });
});
