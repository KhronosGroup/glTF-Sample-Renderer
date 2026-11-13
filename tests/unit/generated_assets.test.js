import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { GlbParser } from "../../source/ResourceLoader/glb_parser.js";
import { gltfLoader } from "../../source/ResourceLoader/loader.js";

// Round-trips the assets emitted by the sample viewer's generator through the parser, so
// a generator change that produces an unreadable container fails here rather than in a
// browser. Skipped when the assets have not been generated.

const here = dirname(fileURLToPath(import.meta.url));
const assetDir = join(here, "..", "..", "..", "public", "test-assets");

async function loadAsset(name) {
    const bytes = await readFile(join(assetDir, name));
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

let available = [];
try {
    available = await readdir(assetDir);
} catch {
    available = [];
}

const describeIfGenerated = available.length > 0 ? describe : describe.skip;

let errorSpy;
beforeEach(() => {
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
    errorSpy.mockRestore();
});

describeIfGenerated("generated GLB test assets", () => {
    const readable = [
        "glb2_baseline.glb",
        "glb3_single_bin.glb",
        "glb3_implicit.glb",
        "glb3_multi_bin.glb",
        "glb3_chunk_before_json.glb",
        "glb3_unknown_chunk_type.glb",
        "glb3_unknown_encoding.glb",
        "glb3_gap_padding.glb"
    ];

    it.each(readable)("%s parses into a glTF document", async (name) => {
        const data = await loadAsset(name);
        const glb = new GlbParser(data).extractGlbData();

        expect(glb, `${name} should parse`).toBeDefined();
        expect(glb.json.asset.version).toBeDefined();
        expect(glb.json.meshes).toHaveLength(1);
    });

    it("binds each buffer of the multi-chunk asset to its own chunk", async () => {
        const data = await loadAsset("glb3_multi_bin.glb");
        const parser = new GlbParser(data);
        const glb = { ...parser.extractGlbData(), parser };

        expect(glb.json.buffers.length).toBeGreaterThan(1);

        const used = new Set();
        glb.json.buffers.forEach((buffer, index) => {
            const chunk = gltfLoader.resolveBufferChunk({}, buffer, index, glb);
            expect(chunk, `buffer ${index} should resolve`).toBeDefined();
            expect(chunk.length).toBeGreaterThanOrEqual(buffer.byteLength);
            used.add(chunk.index);
        });

        expect(used.size).toBe(glb.json.buffers.length);
    });

    it("resolves the implicit chunk 1 asset without a chunk property", async () => {
        const data = await loadAsset("glb3_implicit.glb");
        const parser = new GlbParser(data);
        const glb = { ...parser.extractGlbData(), parser };

        expect(glb.json.buffers[0].chunk).toBeUndefined();
        expect(gltfLoader.resolveBufferChunk({}, glb.json.buffers[0], 0, glb).index).toBe(1);
    });

    it("refuses the asset whose JSON chunk is encoded", async () => {
        const data = await loadAsset("glb3_unknown_encoding_json.glb");

        expect(new GlbParser(data).extractGlbData()).toBeUndefined();
    });

    it("refuses to bind a buffer to an undecodable chunk", async () => {
        const data = await loadAsset("glb3_unknown_encoding.glb");
        const parser = new GlbParser(data);
        const glb = { ...parser.extractGlbData(), parser };

        expect(gltfLoader.resolveBufferChunk({}, glb.json.buffers[0], 0, glb)).toBeUndefined();
    });

    it("skips the leading non-JSON chunk when locating the glTF JSON", async () => {
        const data = await loadAsset("glb3_chunk_before_json.glb");
        const glb = new GlbParser(data).extractGlbData();

        expect(glb.jsonChunkIndex).toBe(1);
    });
});
