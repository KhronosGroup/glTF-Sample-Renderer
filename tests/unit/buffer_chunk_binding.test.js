import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import { gltfLoader } from "../../source/ResourceLoader/loader.js";
import { GlbParser } from "../../source/ResourceLoader/glb_parser.js";
import { writeGlb, jsonChunk, binChunk } from "../helpers/glb_writer.js";

// glTF 2.1 lets a buffer name the GLB chunk holding its data, which is what makes
// multiple binary chunks usable. glTF 2.0 had no such property and relied on buffer 0
// implicitly meaning chunk 1.

let errorSpy;
beforeEach(() => {
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
    errorSpy.mockRestore();
});

function buildGlb(json, binaries, { version = 3 } = {}) {
    const chunks = [jsonChunk(json), ...binaries.map((data) => binChunk(data))];
    const buffer = writeGlb({ version, chunks });
    const parser = new GlbParser(buffer);
    return { glb: { ...parser.extractGlbData(), parser } };
}

const resolve = (buffer, index, appendix) =>
    gltfLoader.resolveBufferChunk({}, buffer, index, appendix.glb);

describe("explicit buffer.chunk binding", () => {
    it("binds a buffer to the chunk it names", () => {
        const appendix = buildGlb({ asset: { version: "2.1" } }, [
            new Uint8Array([1, 2, 3, 4]),
            new Uint8Array([5, 6, 7, 8])
        ]);

        expect(resolve({ chunk: 1, byteLength: 4 }, 0, appendix).index).toBe(1);
        expect(resolve({ chunk: 2, byteLength: 4 }, 1, appendix).index).toBe(2);
    });

    it("lets a buffer other than the first use a chunk", () => {
        const appendix = buildGlb({ asset: { version: "2.1" } }, [new Uint8Array([1, 2, 3, 4])]);

        expect(resolve({ chunk: 1, byteLength: 4 }, 3, appendix).index).toBe(1);
    });

    it("rejects a chunk index that does not exist", () => {
        const appendix = buildGlb({ asset: { version: "2.1" } }, [new Uint8Array([1, 2, 3, 4])]);

        expect(resolve({ chunk: 9, byteLength: 4 }, 0, appendix)).toBeUndefined();
        expect(errorSpy).toHaveBeenCalled();
    });

    it("rejects a buffer pointing at the JSON chunk", () => {
        const appendix = buildGlb({ asset: { version: "2.1" } }, [new Uint8Array([1, 2, 3, 4])]);

        expect(resolve({ chunk: 0, byteLength: 4 }, 0, appendix)).toBeUndefined();
    });

    it("rejects a chunk smaller than the buffer claims to be", () => {
        const appendix = buildGlb({ asset: { version: "2.1" } }, [new Uint8Array([1, 2, 3, 4])]);

        expect(resolve({ chunk: 1, byteLength: 64 }, 0, appendix)).toBeUndefined();
        expect(errorSpy.mock.calls.flat().join(" ")).toMatch(/only holds/);
    });

    it("accepts a chunk larger than the buffer, since padding is not rewritten", () => {
        const appendix = buildGlb({ asset: { version: "2.1" } }, [new Uint8Array([1, 2, 3, 4])]);

        expect(resolve({ chunk: 1, byteLength: 2 }, 0, appendix)).toBeDefined();
    });

    it("rejects a chunk whose encoding is not understood", () => {
        const buffer = writeGlb({
            version: 3,
            chunks: [
                jsonChunk({ asset: { version: "2.1" } }),
                binChunk(new Uint8Array([1, 2, 3, 4]), { encoding: 3 })
            ]
        });
        const parser = new GlbParser(buffer);
        const appendix = { glb: { ...parser.extractGlbData(), parser } };

        expect(resolve({ chunk: 1, byteLength: 4 }, 0, appendix)).toBeUndefined();
        expect(errorSpy.mock.calls.flat().join(" ")).toMatch(/encoding/);
    });
});

describe("glTF 2.0 implicit chunk 1 fallback", () => {
    it("binds buffer 0 to chunk 1 when neither chunk nor uri is given", () => {
        const appendix = buildGlb({ asset: { version: "2.0" } }, [new Uint8Array([1, 2, 3, 4])], {
            version: 2
        });

        expect(resolve({ byteLength: 4 }, 0, appendix).index).toBe(1);
    });

    it("applies in a v3 container too, when the layout matches", () => {
        const appendix = buildGlb({ asset: { version: "2.1" } }, [new Uint8Array([1, 2, 3, 4])]);

        expect(resolve({ byteLength: 4 }, 0, appendix).index).toBe(1);
    });

    it("does not apply to buffers other than the first", () => {
        const appendix = buildGlb({ asset: { version: "2.1" } }, [new Uint8Array([1, 2, 3, 4])]);

        expect(resolve({ byteLength: 4 }, 1, appendix)).toBeUndefined();
    });

    it("does not apply when the buffer has a uri", () => {
        const appendix = buildGlb({ asset: { version: "2.1" } }, [new Uint8Array([1, 2, 3, 4])]);

        expect(resolve({ byteLength: 4, uri: "data.bin" }, 0, appendix)).toBeUndefined();
    });

    it("does not apply when a non-JSON chunk precedes the glTF JSON", () => {
        const buffer = writeGlb({
            version: 3,
            chunks: [
                { type: 0x4f464e49, data: new Uint8Array([9]) },
                jsonChunk({ asset: { version: "2.1" } }),
                binChunk(new Uint8Array([1, 2, 3, 4]))
            ]
        });
        const parser = new GlbParser(buffer);
        const appendix = { glb: { ...parser.extractGlbData(), parser } };

        expect(resolve({ byteLength: 4 }, 0, appendix)).toBeUndefined();
    });

    it("does not apply when chunk 1 is not a binary chunk", () => {
        const buffer = writeGlb({
            version: 3,
            chunks: [
                jsonChunk({ asset: { version: "2.1" } }),
                { type: 0x4f464e49, data: new Uint8Array([9]) }
            ]
        });
        const parser = new GlbParser(buffer);
        const appendix = { glb: { ...parser.extractGlbData(), parser } };

        expect(resolve({ byteLength: 4 }, 0, appendix)).toBeUndefined();
    });
});

describe("non-GLB loads", () => {
    it("resolves no chunk when there is no GLB container", () => {
        expect(gltfLoader.resolveBufferChunk({}, { byteLength: 4 }, 0, undefined)).toBeUndefined();
    });

    it("ignores a File appendix when looking for a GLB container", () => {
        expect(gltfLoader.getGlbContainer([["a.bin", {}]])).toBeUndefined();
    });
});
