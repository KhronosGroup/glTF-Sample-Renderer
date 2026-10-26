import { defineConfig } from "rolldown";
import glslify from "rollup-plugin-glslify";
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

function copyAssets() {
    return {
        name: "copy-assets",
        buildEnd() {
            mkdirSync("dist/assets", { recursive: true });
            for (const lut of ["lut_charlie.png", "lut_ggx.png", "lut_sheen_E.png"]) {
                cpSync(`assets/images/${lut}`, `dist/assets/${lut}`);
            }
            // hdrpng.js is imported by the renderer and bundled, not loaded at runtime
            cpSync("source/libs", "dist/libs", {
                recursive: true,
                filter: (src) => !src.endsWith("hdrpng.js")
            });
        }
    };
}

export default defineConfig({
    input: ["source/gltf-sample-renderer.js"],
    platform: "browser",
    // Node built-ins are only reached in Node-only branches of the wasm helper, PhysX and mikktspace
    external: ["gl-matrix", "fs", "path", "url"],
    output: {
        file: "dist/gltf-viewer.module.js",
        format: "esm",
        sourcemap: true,
        banner: licenseBanner
    },
    plugins: [wasm({ fileName: "libs/[name][extname]", publicPath: "./" }), glslify(), copyAssets()]
});
