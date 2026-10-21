import { access, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const RAW_BASE = "https://raw.githubusercontent.com";

const exists = (file) =>
    access(file).then(
        () => true,
        () => false
    );

const rawUrl = (repository, commit, relativePath) =>
    `${RAW_BASE}/${repository}/${commit}/` +
    relativePath.split("/").map(encodeURIComponent).join("/");

// Returns the absolute path if it stays inside root, so a crafted uri cannot write elsewhere.
function resolveInside(root, relativePath) {
    const resolved = path.resolve(root, relativePath);
    if (resolved !== root && !resolved.startsWith(root + path.sep)) {
        throw new Error(`Path escapes ${root}: ${relativePath}`);
    }
    return resolved;
}

async function download(url, file) {
    if (await exists(file)) {
        return false;
    }
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText}: ${url}`);
    }
    await mkdir(path.dirname(file), { recursive: true });
    const partial = `${file}.part`;
    await writeFile(partial, Buffer.from(await response.arrayBuffer()));
    await rename(partial, file);
    return true;
}

function externalUris(gltf) {
    const uris = [...(gltf.buffers ?? []), ...(gltf.images ?? [])]
        .map((resource) => resource.uri)
        // Skips data: URIs and absolute URLs.
        .filter((uri) => uri !== undefined && !/^[a-z][a-z0-9+.-]*:/i.test(uri));
    return [...new Set(uris)].map((uri) => decodeURIComponent(uri));
}

/**
 * Downloads the pinned environment map unless it is cached.
 * @returns {Promise<string>} path relative to outputRoot
 */
export async function fetchEnvironment(lock, outputRoot) {
    const { repository, commit, file } = lock.environment;
    const relative = path.posix.join("environments", commit, file);
    await download(rawUrl(repository, commit, file), resolveInside(outputRoot, relative));
    return relative;
}

/**
 * Downloads the pinned model index and the selected models with all external resources.
 * @param {Object} lock parsed assets.lock.json
 * @param {string} outputRoot absolute path of the regression folder
 * @param {string[] | null} names model names, or null for every model shipping the variant
 * @param {(event: Object) => void} onProgress called once per model
 * @returns {Promise<Object[]>} one entry per model: { name, label, tags, file } or { name, error }
 */
export async function fetchModels(lock, outputRoot, names, onProgress = () => {}) {
    const { repository, commit, variant } = lock.sampleAssets;
    const modelsRoot = resolveInside(outputRoot, path.posix.join("models", commit));

    const indexFile = path.join(modelsRoot, "model-index.json");
    await download(rawUrl(repository, commit, "Models/model-index.json"), indexFile);
    const index = JSON.parse(await readFile(indexFile, "utf8"));

    const byName = new Map(index.map((entry) => [entry.name, entry]));
    const selected = names ?? index.map((entry) => entry.name);

    const results = [];
    for (const name of selected) {
        const entry = byName.get(name);
        const mainFile = entry?.variants?.[variant];
        if (mainFile === undefined) {
            const error = entry ? `no ${variant} variant` : "not in model-index.json";
            results.push({ name, error });
            onProgress({ name, error });
            continue;
        }

        try {
            const variantRoot = resolveInside(modelsRoot, path.posix.join(name, variant));
            const remoteDir = `Models/${name}/${variant}`;
            const gltfFile = resolveInside(variantRoot, mainFile);
            let downloaded = await download(
                rawUrl(repository, commit, `${remoteDir}/${mainFile}`),
                gltfFile
            );

            const gltf = JSON.parse(await readFile(gltfFile, "utf8"));
            const resourceBase = path.posix.dirname(mainFile);
            const fetched = await Promise.all(
                externalUris(gltf).map((uri) => {
                    const relative = path.posix.normalize(path.posix.join(resourceBase, uri));
                    return download(
                        rawUrl(repository, commit, `${remoteDir}/${relative}`),
                        resolveInside(variantRoot, relative)
                    );
                })
            );
            downloaded ||= fetched.some(Boolean);

            const file = path.relative(outputRoot, gltfFile).split(path.sep).join("/");
            results.push({ name, label: entry.label, tags: entry.tags, file });
            onProgress({ name, downloaded });
        } catch (error) {
            results.push({ name, error: error.message });
            onProgress({ name, error: error.message });
        }
    }
    return results;
}
