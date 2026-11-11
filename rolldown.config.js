import { defineConfig } from "rolldown";
import { wasm } from "@rollup/plugin-wasm";
import { cpSync, mkdirSync, readdirSync, readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));

function readPackage(dir) {
    const { name, version, license } = JSON.parse(readFileSync(`${dir}/package.json`, "utf8"));
    const licenseFile = readdirSync(dir).find((file) => /^(licen[cs]e|copying)/i.test(file));
    const licenseText = licenseFile ? readFileSync(`${dir}/${licenseFile}`, "utf8").trim() : "";
    return { name, version, license, licenseText };
}

// "/*!" marks a legal comment, so the banner survives when the webapp minifies the bundle
function licenseBanner(chunk) {
    const dependencies = new Map();
    for (const id of chunk.moduleIds) {
        const dir = id
            .replaceAll("\\", "/")
            .match(/^(.*\/node_modules\/(?:@[^/]+\/)?[^/]+)\//)?.[1];
        if (dir && !dependencies.has(dir)) {
            dependencies.set(dir, readPackage(dir));
        }
    }
    const lines = [
        `Bundle of ${pkg.name}`,
        `Generated: ${new Date().toISOString().slice(0, 10)}`,
        `Version: ${pkg.version}`,
        `License: ${pkg.license}`,
        "Dependencies:",
        "",
        ...[...dependencies.values()].flatMap((dep) => [
            `${dep.name} -- ${dep.version} -- ${dep.license}`,
            ...dep.licenseText.split(/\r?\n/),
            ""
        ])
    ];
    const body = lines.map((line) => ` * ${line.replaceAll("*/", "*\\/")}`.trimEnd());
    return ["/*!", ...body, " */"].join("\n");
}

// Imports shaders as strings; #include is resolved at runtime by shader_cache.js
function shaders() {
    return {
        name: "shaders",
        transform(code, id) {
            if (!/\.(glsl|vert|frag)$/.test(id)) {
                return null;
            }
            const stripped = code
                .replace(/\/\*[\s\S]*?\*\//g, "")
                .replace(/\/\/.*$/gm, "")
                .split(/\r?\n/)
                .map((line) => line.trim())
                .filter((line) => line !== "")
                .join("\n");
            return { code: `export default ${JSON.stringify(stripped)};`, map: null };
        }
    };
}

function copyAssets() {
    return {
        name: "copy-assets",
        buildEnd() {
            mkdirSync("dist/assets", { recursive: true });
            cpSync("assets/images/lut_sheen_E.png", "dist/assets/lut_sheen_E.png");
            // hdrpng.js and libktx.js are imported by the renderer and bundled,
            // not loaded at runtime
            cpSync("source/libs", "dist/libs", {
                recursive: true,
                filter: (src) => !src.endsWith("hdrpng.js") && !src.endsWith("libktx.js")
            });
        }
    };
}

export default defineConfig({
    input: ["source/gltf-sample-renderer.js"],
    platform: "browser",
    // Node built-ins are only reached in Node-only branches of the wasm helper, PhysX, mikktspace and libktx
    external: ["gl-matrix", "crypto", "fs", "path", "url"],
    output: {
        file: "dist/gltf-viewer.module.js",
        format: "esm",
        sourcemap: true,
        banner: licenseBanner
    },
    plugins: [wasm({ fileName: "libs/[name][extname]", publicPath: "./" }), shaders(), copyAssets()]
});
