import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import { ExternalAssetLoader, isGlb } from "../../source/ResourceLoader/external_asset_loader.js";
import { FileResolver } from "../../source/ResourceLoader/file_resolver.js";

// Exercises the recursion itself: which files get read, in what order, and what the
// child's resolver ends up able to see. Building real glTF documents is left to the
// browser tests; here createDocument is a stub that records what it was handed.

const encode = (value) => new TextEncoder().encode(JSON.stringify(value));

let errorSpy;
beforeEach(() => {
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
    errorSpy.mockRestore();
    delete globalThis.fetch;
});

/**
 * @param {object} files Path to the JSON each path should return.
 */
function serve(files) {
    globalThis.fetch = vi.fn(async (path) => {
        if (files[path] === undefined) {
            return { ok: false, statusText: "Not Found" };
        }
        return {
            ok: true,
            statusText: "OK",
            headers: { get: () => "model/gltf+json" },
            arrayBuffer: async () => encode(files[path]).buffer
        };
    });
}

/** A fake document whose externalAssets come from the served JSON. */
function fakeDocument(json, path) {
    return {
        path,
        files: json.files ?? [],
        externalAssets: (json.externalAssets ?? []).map((entry) => ({ ...entry })),
        bufferViews: json.bufferViews ?? [],
        buffers: json.buffers ?? []
    };
}

function makeLoader(onDocument = () => {}) {
    const built = [];
    const loader = new ExternalAssetLoader({
        createDocument: async ({ json, path, resolver, ancestry, depth }) => {
            built.push({ path, resolver, ancestry, depth });
            onDocument({ json, path, resolver });
            const document = fakeDocument(json, path);
            await loader.loadFor(document, resolver, ancestry, depth);
            return document;
        }
    });
    return { loader, built };
}

const gltfFile = (uri) => ({ uri, mimeType: "model/gltf+json" });

describe("isGlb", () => {
    it("recognises the glTF magic", () => {
        expect(isGlb(new Uint8Array([0x67, 0x6c, 0x54, 0x46, 2]))).toBe(true);
    });

    it("rejects JSON and short input", () => {
        expect(isGlb(new TextEncoder().encode('{"asset"'))).toBe(false);
        expect(isGlb(new Uint8Array([0x67, 0x6c]))).toBe(false);
    });
});

describe("recursion", () => {
    it("loads a referenced asset", async () => {
        serve({ "child.gltf": { asset: { version: "2.1" } } });
        const { loader, built } = makeLoader();
        const root = fakeDocument(
            { files: [gltfFile("child.gltf")], externalAssets: [{ file: 0 }] },
            "root.gltf"
        );

        await loader.loadFor(root, new FileResolver(), new Set(["root.gltf"]));

        expect(built.map((entry) => entry.path)).toEqual(["child.gltf"]);
        expect(root.externalAssets[0].document.path).toBe("child.gltf");
    });

    it("recurses to the full depth of the tree", async () => {
        serve({
            "a.gltf": { files: [gltfFile("b.gltf")], externalAssets: [{ file: 0 }] },
            "b.gltf": { files: [gltfFile("c.gltf")], externalAssets: [{ file: 0 }] },
            "c.gltf": { asset: { version: "2.1" } }
        });
        const { loader, built } = makeLoader();
        const root = fakeDocument(
            { files: [gltfFile("a.gltf")], externalAssets: [{ file: 0 }] },
            "root.gltf"
        );

        await loader.loadFor(root, new FileResolver(), new Set(["root.gltf"]));

        expect(built.map((entry) => entry.path)).toEqual(["a.gltf", "b.gltf", "c.gltf"]);
        expect(built.map((entry) => entry.depth)).toEqual([1, 2, 3]);
    });

    it("parses a file reached from two places only once", async () => {
        serve({
            "left.gltf": { files: [gltfFile("shared.gltf")], externalAssets: [{ file: 0 }] },
            "right.gltf": { files: [gltfFile("shared.gltf")], externalAssets: [{ file: 0 }] },
            "shared.gltf": { asset: { version: "2.1" } }
        });
        const { loader, built } = makeLoader();
        const root = fakeDocument(
            {
                files: [gltfFile("left.gltf"), gltfFile("right.gltf")],
                externalAssets: [{ file: 0 }, { file: 1 }]
            },
            "root.gltf"
        );

        await loader.loadFor(root, new FileResolver(), new Set(["root.gltf"]));

        const sharedBuilds = built.filter((entry) => entry.path === "shared.gltf");
        expect(sharedBuilds).toHaveLength(1);
        // Both branches still end up pointing at it.
        expect(root.externalAssets[0].document.externalAssets[0].document.path).toBe("shared.gltf");
        expect(root.externalAssets[1].document.externalAssets[0].document.path).toBe("shared.gltf");
    });
});

describe("cycle detection", () => {
    it("rejects an asset that references itself", async () => {
        serve({ "self.gltf": { files: [gltfFile("self.gltf")], externalAssets: [{ file: 0 }] } });
        const { loader } = makeLoader();
        const root = fakeDocument(
            { files: [gltfFile("self.gltf")], externalAssets: [{ file: 0 }] },
            "root.gltf"
        );

        await expect(
            loader.loadFor(root, new FileResolver(), new Set(["root.gltf"]))
        ).rejects.toThrow(/Cyclical/);
    });

    it("rejects a cycle that goes through another asset", async () => {
        serve({
            "a.gltf": { files: [gltfFile("b.gltf")], externalAssets: [{ file: 0 }] },
            "b.gltf": { files: [gltfFile("a.gltf")], externalAssets: [{ file: 0 }] }
        });
        const { loader } = makeLoader();
        const root = fakeDocument(
            { files: [gltfFile("a.gltf")], externalAssets: [{ file: 0 }] },
            "root.gltf"
        );

        await expect(
            loader.loadFor(root, new FileResolver(), new Set(["root.gltf"]))
        ).rejects.toThrow(/Cyclical/);
    });

    it("names the chain so the cycle can be found", async () => {
        serve({
            "a.gltf": { files: [gltfFile("b.gltf")], externalAssets: [{ file: 0 }] },
            "b.gltf": { files: [gltfFile("a.gltf")], externalAssets: [{ file: 0 }] }
        });
        const { loader } = makeLoader();
        const root = fakeDocument(
            { files: [gltfFile("a.gltf")], externalAssets: [{ file: 0 }] },
            "root.gltf"
        );

        await expect(
            loader.loadFor(root, new FileResolver(), new Set(["root.gltf"]))
        ).rejects.toThrow(/a\.gltf -> b\.gltf -> a\.gltf/);
    });
});

describe("validation", () => {
    it("reports an external asset pointing at a missing file entry", async () => {
        const { loader } = makeLoader();
        const root = fakeDocument({ files: [], externalAssets: [{ file: 3 }] }, "root.gltf");

        await loader.loadFor(root, new FileResolver(), new Set());

        expect(errorSpy.mock.calls.flat().join(" ")).toMatch(/does not exist/);
    });

    it("refuses a file whose media type is not glTF", async () => {
        const { loader, built } = makeLoader();
        const root = fakeDocument(
            {
                files: [{ uri: "data.bin", mimeType: "application/gltf-buffer" }],
                externalAssets: [{ file: 0 }]
            },
            "root.gltf"
        );

        await loader.loadFor(root, new FileResolver(), new Set());

        expect(built).toHaveLength(0);
        expect(errorSpy.mock.calls.flat().join(" ")).toMatch(/only glTF media types/);
    });
});

describe("alias scoping", () => {
    it("gives a child the aliases its files entry declares", async () => {
        serve({ "child.gltf": { asset: { version: "2.1" } } });
        const { loader, built } = makeLoader();
        const root = fakeDocument(
            {
                files: [
                    {
                        uri: "child.gltf",
                        mimeType: "model/gltf+json",
                        aliases: [{ alias: "child.bin", file: 1 }]
                    },
                    { uri: "packaged.bin", mimeType: "application/gltf-buffer" }
                ],
                externalAssets: [{ file: 0 }]
            },
            "root.gltf"
        );

        await loader.loadFor(root, new FileResolver(), new Set(["root.gltf"]));

        expect(built[0].resolver.aliases.has("child.bin")).toBe(true);
    });

    // An asset's URIs are resolved by whoever declared its files entry, and by nobody
    // else, so a grandchild must not inherit the root's aliases.
    it("does not pass aliases on to a grandchild", async () => {
        serve({
            "child.gltf": { files: [gltfFile("grandchild.gltf")], externalAssets: [{ file: 0 }] },
            "grandchild.gltf": { asset: { version: "2.1" } }
        });
        const { loader, built } = makeLoader();
        const root = fakeDocument(
            {
                files: [
                    {
                        uri: "child.gltf",
                        mimeType: "model/gltf+json",
                        aliases: [{ alias: "shared.bin", file: 1 }]
                    },
                    { uri: "packaged.bin", mimeType: "application/gltf-buffer" }
                ],
                externalAssets: [{ file: 0 }]
            },
            "root.gltf"
        );

        await loader.loadFor(root, new FileResolver(), new Set(["root.gltf"]));

        const grandchild = built.find((entry) => entry.path === "grandchild.gltf");
        expect(grandchild.resolver.aliases).toBeUndefined();
    });

    it("reports an alias pointing at a missing file entry", async () => {
        serve({ "child.gltf": { asset: { version: "2.1" } } });
        const { loader } = makeLoader();
        const root = fakeDocument(
            {
                files: [
                    {
                        uri: "child.gltf",
                        mimeType: "model/gltf+json",
                        aliases: [{ alias: "x.bin", file: 9 }]
                    }
                ],
                externalAssets: [{ file: 0 }]
            },
            "root.gltf"
        );

        await loader.loadFor(root, new FileResolver(), new Set(["root.gltf"]));

        expect(errorSpy.mock.calls.flat().join(" ")).toMatch(/does not exist/);
    });
});

describe("resolver inheritance", () => {
    it("gives a child loaded by uri a base of its own", async () => {
        serve({ "parts/child.gltf": { asset: { version: "2.1" } } });
        const { loader, built } = makeLoader();
        const root = fakeDocument(
            { files: [gltfFile("parts/child.gltf")], externalAssets: [{ file: 0 }] },
            "root.gltf"
        );

        await loader.loadFor(root, new FileResolver({ baseUri: "" }), new Set(["root.gltf"]));

        expect(built[0].resolver.baseUri).toBe("parts/");
    });

    // Embedded data has no location, so its relative URIs resolve against the parent.
    it("lends the parent's base to an embedded child", async () => {
        const childJson = encode({ asset: { version: "2.1" } });
        const { loader, built } = makeLoader();
        const root = {
            path: "models/root.glb",
            buffers: [{ buffer: childJson.buffer }],
            bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: childJson.length }],
            files: [{ bufferView: 0, mimeType: "model/gltf+json" }],
            externalAssets: [{ file: 0 }]
        };

        await loader.loadFor(
            root,
            new FileResolver({ baseUri: "models/" }),
            new Set(["models/root.glb"])
        );

        expect(built[0].resolver.baseUri).toBe("models/");
    });
});
