import commonjs from "@rollup/plugin-commonjs";
import glslify from "rollup-plugin-glslify";
import resolve from "@rollup/plugin-node-resolve";
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

export default {
    strictDeprecations: true,
    onwarn(warning, warn) {
        // Harmless: third-party CJS deps reference top-level `this`, which Rollup rewrites to `undefined`.
        if (warning.code === "THIS_IS_UNDEFINED") return;
        warn(warning);
    },
    input: ["source/gltf-sample-renderer.js"],
    external: ["gl-matrix"],
    output: {
        file: "dist/gltf-viewer.module.js",
        format: "esm",
        sourcemap: true
    },
    plugins: [
        wasm({ fileName: "libs/[name][extname]", publicPath: "./" }),
        glslify(),
        resolve({
            browser: true,
            preferBuiltins: false
        }),
        copyAssets(),
        commonjs(),
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
};
