import { ResourceLoaderUtils } from "./loader_utils.js";

// Resolves the `uri` properties inside one glTF asset to bytes.
//
// glTF 2.0 only ever needed "join the uri onto the folder the .gltf came from". glTF 2.1
// adds two wrinkles that make a dedicated resolver worth having:
//
//   - A parent asset can alias a URI appearing inside a child, redirecting it to a file
//     the parent holds. Matching is on the exact literal string, with no normalisation,
//     and aliases are not inherited by that child's own children.
//   - An asset embedded in a bufferView or a data URI has no location of its own, so its
//     relative URIs resolve against its parent's base rather than its own.
//
// One resolver instance belongs to one asset. Children get their own.

function decodeDataUri(uri) {
    const comma = uri.indexOf(",");
    if (comma === -1) {
        throw new Error("Malformed data URI");
    }
    const meta = uri.substring(5, comma);
    const payload = uri.substring(comma + 1);
    const mimeType = meta.split(";")[0] || undefined;

    let bytes;
    if (meta.endsWith(";base64")) {
        const binary = atob(payload);
        bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
    } else {
        bytes = new TextEncoder().encode(decodeURIComponent(payload));
    }
    return { bytes, mimeType };
}

function readFileAsArrayBuffer(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = (event) => resolve(event.target.result);
        reader.onerror = () => reject(new Error(`Could not read ${file.name}`));
        reader.readAsArrayBuffer(file);
    });
}

class FileResolver {
    /**
     * @param {object} [options]
     * @param {string} [options.baseUri] Folder the owning asset was loaded from.
     * @param {Map<string, Function>} [options.aliases] Literal URI to a thunk returning
     *   `{ bytes, mimeType }`, supplied by whoever declared the alias.
     * @param {Array} [options.droppedFiles] `[path, File]` pairs from a drag and drop.
     * @param {boolean} [options.allowAbsolutePath]
     * @param {Map} [options.cache] Shared across an asset tree so a file reached from
     *   several places is fetched once.
     */
    constructor({
        baseUri = "",
        aliases = undefined,
        droppedFiles = undefined,
        allowAbsolutePath = true,
        cache = new Map()
    } = {}) {
        this.baseUri = baseUri;
        this.aliases = aliases;
        this.droppedFiles = droppedFiles;
        this.allowAbsolutePath = allowAbsolutePath;
        this.cache = cache;
    }

    /** A resolver for an asset embedded in this one, which borrows this base URI. */
    forEmbedded(aliases) {
        return new FileResolver({
            baseUri: this.baseUri,
            aliases,
            droppedFiles: this.droppedFiles,
            allowAbsolutePath: this.allowAbsolutePath,
            cache: this.cache
        });
    }

    /** A resolver for an asset that has its own location. */
    forLocation(uri, aliases) {
        return new FileResolver({
            baseUri: ResourceLoaderUtils.getContainingFolder(this.absolutePath(uri)),
            aliases,
            droppedFiles: this.droppedFiles,
            allowAbsolutePath: this.allowAbsolutePath,
            cache: this.cache
        });
    }

    absolutePath(uri) {
        if (ResourceLoaderUtils.isAbsoluteUrl(uri)) {
            return uri;
        }
        return ResourceLoaderUtils.cleanRelativePath(this.baseUri + uri);
    }

    /**
     * @param {string} uri As written in the asset, unmodified.
     * @returns {Promise<{bytes: Uint8Array, mimeType: string|undefined, identity: string}>}
     */
    async resolve(uri) {
        if (uri === undefined) {
            throw new Error("Cannot resolve an undefined uri");
        }

        // Aliases win over everything, including the filesystem, because redirecting a
        // child's URI is the whole point of declaring one.
        const alias = this.aliases?.get(uri);
        if (alias !== undefined) {
            const resolved = await alias();
            return { ...resolved, identity: `alias:${uri}` };
        }

        if (uri.startsWith("data:")) {
            const { bytes, mimeType } = decodeDataUri(uri);
            return { bytes, mimeType, identity: `data:${uri.length}:${uri.slice(0, 64)}` };
        }

        if (!this.allowAbsolutePath && ResourceLoaderUtils.isAbsoluteUrl(uri)) {
            throw new Error("Absolute URLs are not allowed for security reasons: " + uri);
        }

        const path = this.absolutePath(uri);

        const cached = this.cache.get(path);
        if (cached !== undefined) {
            return cached;
        }

        const promise = this.read(path).then((result) => ({ ...result, identity: path }));
        this.cache.set(path, promise);
        return promise;
    }

    async read(path) {
        const dropped = this.droppedFiles?.find((entry) => entry[0] === path);
        if (dropped !== undefined) {
            const buffer = await readFileAsArrayBuffer(dropped[1]);
            return { bytes: new Uint8Array(buffer), mimeType: dropped[1].type || undefined };
        }

        const response = await fetch(path);
        if (!response.ok) {
            throw new Error(`Failed to fetch ${path}: ${response.statusText}`);
        }
        return {
            bytes: new Uint8Array(await response.arrayBuffer()),
            mimeType: response.headers.get("content-type")?.split(";")[0] || undefined
        };
    }
}

export { FileResolver };
