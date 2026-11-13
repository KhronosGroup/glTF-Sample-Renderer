import { GlbParser } from "./glb_parser.js";

// Loads the tree of glTF assets reachable through `externalAssets`.
//
// A `files` entry either names a URI or points at a bufferView this asset owns. Either
// way it resolves to bytes, which are then parsed as .gltf or .glb. The two things that
// make this more than a recursive fetch are:
//
//   - Cycles are prohibited and would otherwise hang the loader, so every file on the
//     current chain is tracked and a repeat is an error. A diamond, where two siblings
//     reference the same child, is not a cycle and must still work.
//   - An asset's URIs are resolved by whichever asset declared its `files` entry, using
//     that entry's aliases. Aliases are not inherited further down.

const GLTF_JSON_MEDIA_TYPE = "model/gltf+json";
const GLTF_BINARY_MEDIA_TYPE = "model/gltf-binary";

// Bounds on a malicious or accidentally explosive asset tree.
const MAX_DEPTH = 32;
const MAX_DOCUMENTS = 256;

function isGlb(bytes) {
    return (
        bytes.length >= 4 &&
        bytes[0] === 0x67 &&
        bytes[1] === 0x6c &&
        bytes[2] === 0x54 &&
        bytes[3] === 0x46
    );
}

/**
 * Reads the bytes a `files` entry points at.
 *
 * @param {glTF} gltf The asset that declares the entry.
 * @param {object} file The entry.
 * @param {FileResolver} resolver That asset's resolver.
 */
async function readFileEntry(gltf, file, resolver) {
    if (file.bufferView !== undefined) {
        const view = gltf.bufferViews[file.bufferView];
        if (view === undefined) {
            throw new Error(`File reference uses bufferView ${file.bufferView}, which is missing`);
        }
        const buffer = gltf.buffers[view.buffer]?.buffer;
        if (buffer === undefined) {
            throw new Error(`File reference uses buffer ${view.buffer}, which has no data`);
        }
        return {
            bytes: new Uint8Array(buffer, view.byteOffset ?? 0, view.byteLength),
            mimeType: file.mimeType,
            // Embedded data has no path of its own, so its identity is where it sits.
            identity: `${gltf.path}#bufferView:${file.bufferView}`
        };
    }

    const resolved = await resolver.resolve(file.uri);
    return {
        bytes: resolved.bytes,
        mimeType: file.mimeType ?? resolved.mimeType,
        identity: resolved.identity
    };
}

class ExternalAssetLoader {
    /**
     * @param {object} options
     * @param {Function} options.createDocument Builds and populates one glTF document.
     */
    constructor({ createDocument }) {
        this.createDocument = createDocument;
        // Resolved file identity -> parsed document, so a file reached from several
        // places is parsed once even though each instantiation gets its own clone.
        this.documents = new Map();
        this.documentCount = 0;
    }

    /**
     * Resolves every `externalAssets` entry of `gltf`, recursively.
     *
     * @param {glTF} gltf
     * @param {FileResolver} resolver `gltf`'s own resolver.
     * @param {Set<string>} ancestry Identities of the assets between the root and here.
     * @param {number} depth
     */
    async loadFor(gltf, resolver, ancestry, depth = 0) {
        if (gltf.externalAssets.length === 0) {
            return;
        }
        if (depth >= MAX_DEPTH) {
            throw new Error(`External assets nested deeper than ${MAX_DEPTH} levels`);
        }

        await Promise.all(
            gltf.externalAssets.map((externalAsset) =>
                this.loadOne(gltf, externalAsset, resolver, ancestry, depth)
            )
        );
    }

    async loadOne(gltf, externalAsset, resolver, ancestry, depth) {
        const file = gltf.files[externalAsset.file];
        if (file === undefined) {
            console.error(
                `External asset "${externalAsset.name ?? ""}" refers to file ` +
                    `${externalAsset.file}, which does not exist`
            );
            return;
        }
        if (file.mimeType !== GLTF_JSON_MEDIA_TYPE && file.mimeType !== GLTF_BINARY_MEDIA_TYPE) {
            console.error(
                `External asset "${externalAsset.name ?? ""}" refers to a file of type ` +
                    `"${file.mimeType}"; only glTF media types may be used as external assets`
            );
            return;
        }

        const { bytes, identity } = await readFileEntry(gltf, file, resolver);

        // The chain, not the cache, decides what is a cycle: two siblings referencing
        // one child is a diamond and perfectly legal.
        if (ancestry.has(identity)) {
            throw new Error(
                `Cyclical external asset reference: ${[...ancestry, identity].join(" -> ")}`
            );
        }

        // Aliases belong to this `files` entry and apply only to the asset it names.
        // An entry with a uri gives its child a base of its own; an embedded one lends
        // the child this asset's base, since embedded data has no location.
        const aliases = this.buildAliases(gltf, file, resolver);
        const childResolver =
            file.uri !== undefined
                ? resolver.forLocation(file.uri, aliases)
                : resolver.forEmbedded(aliases);

        externalAsset.document = await this.loadDocument({
            bytes,
            identity,
            resolver: childResolver,
            ancestry: new Set(ancestry).add(identity),
            depth: depth + 1
        });
    }

    buildAliases(gltf, file, resolver) {
        if (file.aliases === undefined || file.aliases.length === 0) {
            return undefined;
        }
        const aliases = new Map();
        for (const alias of file.aliases) {
            const target = gltf.files[alias.file];
            if (target === undefined) {
                console.error(
                    `Alias "${alias.alias}" points at file ${alias.file}, which does not exist`
                );
                continue;
            }
            aliases.set(alias.alias, () => readFileEntry(gltf, target, resolver));
        }
        return aliases;
    }

    async loadDocument({ bytes, identity, resolver, ancestry, depth }) {
        const cached = this.documents.get(identity);
        if (cached !== undefined) {
            return cached;
        }

        if (++this.documentCount > MAX_DOCUMENTS) {
            throw new Error(`Asset tree contains more than ${MAX_DOCUMENTS} documents`);
        }

        const promise = this.parseAndLoad({ bytes, identity, resolver, ancestry, depth });
        this.documents.set(identity, promise);
        return promise;
    }

    async parseAndLoad({ bytes, identity, resolver, ancestry, depth }) {
        let json;
        let glb;
        if (isGlb(bytes)) {
            // The slice is needed because a GLB inside a bufferView does not start at
            // offset zero of its backing ArrayBuffer.
            const parser = new GlbParser(
                bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
            );
            const parsed = parser.extractGlbData();
            if (parsed === undefined) {
                throw new Error(`Could not read the GLB container of ${identity}`);
            }
            json = parsed.json;
            glb = { ...parsed, parser };
        } else {
            json = JSON.parse(new TextDecoder().decode(bytes));
        }

        return this.createDocument({ json, glb, path: identity, resolver, ancestry, depth });
    }
}

export { ExternalAssetLoader, readFileEntry, isGlb, GLTF_JSON_MEDIA_TYPE, GLTF_BINARY_MEDIA_TYPE };
