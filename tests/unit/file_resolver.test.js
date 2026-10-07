import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import { FileResolver } from "../../source/ResourceLoader/file_resolver.js";

// The resolver is what makes glTF 2.1 external assets possible: a URI inside an asset
// can be redirected by the parent, and an embedded asset borrows its parent's location.

const utf8 = (bytes) => new TextDecoder().decode(bytes);

let fetchMock;
beforeEach(() => {
    fetchMock = vi.fn(async (path) => ({
        ok: true,
        statusText: "OK",
        headers: { get: () => "application/octet-stream" },
        arrayBuffer: async () => new TextEncoder().encode(`contents of ${path}`).buffer
    }));
    globalThis.fetch = fetchMock;
});
afterEach(() => {
    delete globalThis.fetch;
});

describe("relative resolution", () => {
    it("joins a relative uri onto the base", async () => {
        const resolver = new FileResolver({ baseUri: "models/robot/" });

        const { bytes } = await resolver.resolve("arm.bin");

        expect(utf8(bytes)).toBe("contents of models/robot/arm.bin");
    });

    it("normalises dot segments", async () => {
        const resolver = new FileResolver({ baseUri: "models/robot/" });

        await resolver.resolve("../shared/cat.png");

        expect(fetchMock).toHaveBeenCalledWith("models/shared/cat.png");
    });

    it("leaves an absolute url alone", async () => {
        const resolver = new FileResolver({ baseUri: "models/robot/" });

        await resolver.resolve("https://example.org/cat.png");

        expect(fetchMock).toHaveBeenCalledWith("https://example.org/cat.png");
    });

    it("refuses an absolute url when they are not allowed", async () => {
        const resolver = new FileResolver({ allowAbsolutePath: false });

        await expect(resolver.resolve("https://example.org/cat.png")).rejects.toThrow(
            /Absolute URLs/
        );
    });

    it("reports a failed fetch with the path that failed", async () => {
        globalThis.fetch = async () => ({ ok: false, statusText: "Not Found" });
        const resolver = new FileResolver({ baseUri: "models/" });

        await expect(resolver.resolve("missing.bin")).rejects.toThrow(/models\/missing.bin/);
    });
});

describe("data URIs", () => {
    it("decodes base64 payloads", async () => {
        const resolver = new FileResolver();
        const encoded = Buffer.from("hello").toString("base64");

        const { bytes, mimeType } = await resolver.resolve(
            `data:application/octet-stream;base64,${encoded}`
        );

        expect(utf8(bytes)).toBe("hello");
        expect(mimeType).toBe("application/octet-stream");
    });

    it("decodes percent-encoded payloads", async () => {
        const resolver = new FileResolver();

        const { bytes } = await resolver.resolve("data:text/plain,hello%20world");

        expect(utf8(bytes)).toBe("hello world");
    });

    it("never fetches for a data uri", async () => {
        const resolver = new FileResolver({ baseUri: "models/" });

        await resolver.resolve("data:text/plain,inline");

        expect(fetchMock).not.toHaveBeenCalled();
    });
});

describe("aliases", () => {
    const aliasTo = (text) =>
        new Map([["textures/albedo.png", async () => ({ bytes: new TextEncoder().encode(text) })]]);

    it("redirects a uri the parent has aliased", async () => {
        const resolver = new FileResolver({
            baseUri: "models/",
            aliases: aliasTo("packaged bytes")
        });

        const { bytes } = await resolver.resolve("textures/albedo.png");

        expect(utf8(bytes)).toBe("packaged bytes");
        expect(fetchMock).not.toHaveBeenCalled();
    });

    // The spec requires an exact match on the literal string, with no normalisation,
    // so these two are different aliases even though they name the same file.
    it("does not match a uri that only differs by a dot segment", async () => {
        const resolver = new FileResolver({
            baseUri: "models/",
            aliases: aliasTo("packaged bytes")
        });

        const { bytes } = await resolver.resolve("./textures/albedo.png");

        expect(utf8(bytes)).toBe("contents of models/textures/albedo.png");
    });

    it("takes precedence over the filesystem", async () => {
        const resolver = new FileResolver({
            baseUri: "models/",
            aliases: aliasTo("override")
        });

        expect(utf8((await resolver.resolve("textures/albedo.png")).bytes)).toBe("override");
    });

    it("falls through to a normal fetch for an unaliased uri", async () => {
        const resolver = new FileResolver({
            baseUri: "models/",
            aliases: aliasTo("override")
        });

        const { bytes } = await resolver.resolve("other.png");

        expect(utf8(bytes)).toBe("contents of models/other.png");
    });
});

describe("child resolvers", () => {
    const aliases = new Map([["a", async () => ({ bytes: new Uint8Array() })]]);

    it("gives an embedded asset its parent's base", async () => {
        const parent = new FileResolver({ baseUri: "models/robot/" });

        await parent.forEmbedded().resolve("arm.bin");

        expect(fetchMock).toHaveBeenCalledWith("models/robot/arm.bin");
    });

    it("gives an asset loaded from a uri its own base", async () => {
        const parent = new FileResolver({ baseUri: "models/" });

        await parent.forLocation("parts/arm.gltf").resolve("arm.bin");

        expect(fetchMock).toHaveBeenCalledWith("models/parts/arm.bin");
    });

    // Aliases apply only to the asset whose files entry declared them.
    it("does not pass its own aliases down to a child", async () => {
        const parent = new FileResolver({ baseUri: "models/", aliases });

        expect(parent.forEmbedded().aliases).toBeUndefined();
        expect(parent.forLocation("child.gltf").aliases).toBeUndefined();
    });

    it("shares the cache with its children", async () => {
        const parent = new FileResolver({ baseUri: "models/" });
        const child = parent.forEmbedded();

        await parent.resolve("shared.bin");
        await child.resolve("shared.bin");

        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("carries the absolute path restriction down", async () => {
        const parent = new FileResolver({ allowAbsolutePath: false });

        await expect(parent.forEmbedded().resolve("https://example.org/x.png")).rejects.toThrow(
            /Absolute URLs/
        );
    });
});

describe("caching", () => {
    it("fetches a repeated uri once", async () => {
        const resolver = new FileResolver({ baseUri: "models/" });

        await Promise.all([resolver.resolve("cat.png"), resolver.resolve("cat.png")]);

        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("treats differently spelled paths that normalise alike as one file", async () => {
        const resolver = new FileResolver({ baseUri: "models/" });

        await resolver.resolve("./cat.png");
        await resolver.resolve("cat.png");

        expect(fetchMock).toHaveBeenCalledTimes(1);
    });
});
