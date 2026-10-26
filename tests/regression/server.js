import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import http from "node:http";
import path from "node:path";

const MIME_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json",
    ".gltf": "model/gltf+json",
    ".glb": "model/gltf-binary",
    ".bin": "application/octet-stream",
    ".wasm": "application/wasm",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".ktx2": "image/ktx2",
    ".hdr": "application/octet-stream"
};

/**
 * Serves the render page and the folders it needs on 127.0.0.1.
 * @param {Object<string, string>} mounts URL prefix (e.g. "/dist/") to absolute folder
 * @param {string} indexFile absolute path served for "/"
 * @returns {Promise<{ url: string, close: () => Promise<void> }>}
 */
export async function startServer(mounts, indexFile) {
    const prefixes = Object.keys(mounts).sort((a, b) => b.length - a.length);

    const resolve = (pathname) => {
        if (pathname === "/") {
            return indexFile;
        }
        const prefix = prefixes.find((candidate) => pathname.startsWith(candidate));
        if (prefix === undefined) {
            return undefined;
        }
        const root = mounts[prefix];
        const file = path.resolve(root, "." + pathname.slice(prefix.length - 1));
        return file.startsWith(root + path.sep) ? file : undefined;
    };

    const server = http.createServer(async (request, response) => {
        let file;
        try {
            file = resolve(decodeURIComponent(new URL(request.url, "http://x").pathname));
        } catch {
            file = undefined;
        }
        const info = file && (await stat(file).catch(() => undefined));
        if (!info?.isFile()) {
            response.writeHead(404).end();
            return;
        }
        response.writeHead(200, {
            "Content-Type":
                MIME_TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream",
            "Content-Length": info.size
        });
        createReadStream(file).pipe(response);
    });

    await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
    const { port } = server.address();
    return {
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise((resolveClose) => server.close(resolveClose))
    };
}
