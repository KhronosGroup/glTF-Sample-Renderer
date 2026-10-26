import { defineConfig } from "rolldown";
import glslify from "rollup-plugin-glslify";
import { wasm } from "@rollup/plugin-wasm";
import license from "rollup-plugin-license";
import { cpSync, mkdirSync } from "node:fs";

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
        sourcemap: true
    },
    plugins: [
        wasm({ fileName: "libs/[name][extname]", publicPath: "./" }),
        glslify(),
        copyAssets(),
        license({
            banner: {
                content: {
                    file: "LICENSE_BANNER.txt"
                }
            },
            thirdParty: {
                includeSelf: false
            }
        })
    ]
});
