import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { loadThumbnail } from "../../source/ResourceLoader/thumbnail_loader.js";
import { glTF } from "../../source/gltf/gltf.js";
import { installWebGlConstants } from "../helpers/webgl_constants.js";
import { writeGlb, jsonChunk, binChunk } from "../helpers/glb_writer.js";

installWebGlConstants();

const here = dirname(fileURLToPath(import.meta.url));
const assetDir = join(here, "..", "..", "..", "public", "test-assets");

let available = [];
try {
    available = await readdir(assetDir);
} catch {
    available = [];
}
const describeIfGenerated = available.length > 0 ? describe : describe.skip;

async function loadAsset(name) {
    const bytes = await readFile(join(assetDir, name));
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

// Object URLs do not exist in node. The thumbnail loader only ever creates them, so a
// stub that records the blob is enough to assert on the bytes it produced.
const blobs = new Map();
beforeEach(() => {
    let counter = 0;
    globalThis.URL.createObjectURL = (blob) => {
        const url = `blob:test/${counter++}`;
        blobs.set(url, blob);
        return url;
    };
});
afterEach(() => {
    blobs.clear();
    delete globalThis.URL.createObjectURL;
});

describe("asset.thumbnail parsing", () => {
    it("marks the thumbnail image and notes that no texture uses it", () => {
        const gltf = new glTF("test");
        gltf.fromJson({
            asset: { version: "2.1", thumbnail: 0 },
            images: [{ uri: "thumb.png", mimeType: "image/png" }]
        });

        expect(gltf.images[0].isThumbnail).toBe(true);
        expect(gltf.images[0].usedByTexture).toBe(false);
    });

    it("notes when the thumbnail is also used as a texture", () => {
        const gltf = new glTF("test");
        gltf.fromJson({
            asset: { version: "2.1", thumbnail: 0 },
            images: [{ uri: "thumb.png", mimeType: "image/png" }],
            textures: [{ source: 0 }]
        });

        expect(gltf.images[0].usedByTexture).toBe(true);
    });

    it("drops a thumbnail index that points at no image", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const gltf = new glTF("test");
        gltf.fromJson({ asset: { version: "2.1", thumbnail: 4 }, images: [] });

        expect(gltf.asset.thumbnail).toBeUndefined();
        expect(warn).toHaveBeenCalled();
        warn.mockRestore();
    });

    it("leaves images alone when the asset has no thumbnail", () => {
        const gltf = new glTF("test");
        gltf.fromJson({
            asset: { version: "2.1" },
            images: [{ uri: "a.png", mimeType: "image/png" }]
        });

        expect(gltf.images[0].isThumbnail).toBe(false);
    });
});

describe("loadThumbnail", () => {
    it("returns undefined when the asset declares no thumbnail", async () => {
        const data = new TextEncoder().encode(JSON.stringify({ asset: { version: "2.1" } }));

        expect(await loadThumbnail(data.buffer)).toBeUndefined();
    });

    // Thumbnails are optional, so a source this cannot read must not raise: whatever is
    // wrong with it gets reported by the real load instead.
    it.each([
        ["undefined", undefined],
        ["a number", 7],
        ["an empty array", []],
        ["an object", {}]
    ])("yields no thumbnail for %s rather than throwing", async (_label, source) => {
        await expect(loadThumbnail(source)).resolves.toBeUndefined();
    });

    it("yields no thumbnail for an unparseable source", async () => {
        const data = new TextEncoder().encode("not json at all");

        await expect(loadThumbnail(data.buffer)).resolves.toBeUndefined();
    });

    // The viewer hands dropped files over as [path, File] pairs.
    it("reads a dropped file given as a [path, File] pair", async () => {
        const json = JSON.stringify({
            asset: { version: "2.1", thumbnail: 0 },
            images: [{ uri: "data:image/png;base64,AAAA", mimeType: "image/png" }]
        });
        const file = new Blob([json], { type: "model/gltf+json" });

        const result = await loadThumbnail(["models/suzanne.gltf", file]);

        expect(result.url).toBe("data:image/png;base64,AAAA");
    });

    it("resolves a thumbnail uri against a dropped sibling file", async () => {
        const json = JSON.stringify({
            asset: { version: "2.1", thumbnail: 0 },
            images: [{ uri: "thumbnail.png", mimeType: "image/png" }]
        });
        const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);
        const dropped = [["models/thumbnail.png", new Blob([png])]];

        const result = await loadThumbnail(["models/suzanne.gltf", new Blob([json])], dropped);

        expect(new Uint8Array(await blobs.get(result.url).arrayBuffer())).toEqual(png);
    });

    it("passes a data URI through without creating a blob", async () => {
        const json = {
            asset: { version: "2.1", thumbnail: 0 },
            images: [{ uri: "data:image/png;base64,AAAA", mimeType: "image/png" }]
        };
        const data = new TextEncoder().encode(JSON.stringify(json));

        const result = await loadThumbnail(data.buffer);
        expect(result.url).toBe("data:image/png;base64,AAAA");
        expect(blobs.size).toBe(0);
    });

    it("reads a thumbnail out of a GLB binary chunk", async () => {
        const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);
        const json = {
            asset: { version: "2.1", thumbnail: 0 },
            buffers: [{ byteLength: png.length, chunk: 1 }],
            bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: png.length }],
            images: [{ bufferView: 0, mimeType: "image/png" }]
        };
        const glb = writeGlb({ version: 3, chunks: [jsonChunk(json), binChunk(png)] });

        const result = await loadThumbnail(glb);
        expect(result.mimeType).toBe("image/png");
        expect(new Uint8Array(await blobs.get(result.url).arrayBuffer())).toEqual(png);
    });

    it("preserves an unusual media type rather than rejecting it", async () => {
        const json = {
            asset: { version: "2.1", thumbnail: 0 },
            images: [{ uri: "data:image/svg+xml,<svg/>", mimeType: "image/svg+xml" }]
        };
        const data = new TextEncoder().encode(JSON.stringify(json));

        expect((await loadThumbnail(data.buffer)).mimeType).toBe("image/svg+xml");
    });

    it("reports a thumbnail index that points at no image", async () => {
        const json = { asset: { version: "2.1", thumbnail: 2 }, images: [] };
        const data = new TextEncoder().encode(JSON.stringify(json));

        await expect(loadThumbnail(data.buffer)).rejects.toThrow(/does not exist/);
    });
});

describeIfGenerated("generated thumbnail assets", () => {
    it("reads the bufferView thumbnail", async () => {
        const result = await loadThumbnail(await loadAsset("thumbnail_bufferview.glb"));

        expect(result.mimeType).toBe("image/png");
        const bytes = new Uint8Array(await blobs.get(result.url).arrayBuffer());
        expect(Array.from(bytes.slice(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47]);
    });

    it("reads the data URI thumbnail", async () => {
        const result = await loadThumbnail(await loadAsset("thumbnail_datauri.gltf"));

        expect(result.url.startsWith("data:image/png;base64,")).toBe(true);
    });

    it("reads a thumbnail that is also a material texture", async () => {
        const result = await loadThumbnail(await loadAsset("thumbnail_shared.glb"));

        expect(result.mimeType).toBe("image/png");
    });
});
