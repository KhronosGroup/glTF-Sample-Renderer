import commonjs from '@rollup/plugin-commonjs';
import glslify from 'rollup-plugin-glslify';
import resolve from '@rollup/plugin-node-resolve';
import copy from "rollup-plugin-copy";
import {wasm} from "@rollup/plugin-wasm";
import license from "rollup-plugin-license";


export default {
    strictDeprecations: true,
    onwarn(warning, warn) {
        // Harmless: third-party CJS deps reference top-level `this`, which Rollup rewrites to `undefined`.
        if (warning.code === 'THIS_IS_UNDEFINED') return;
        warn(warning);
    },
    input: ['source/gltf-sample-renderer.js'],
    external: ['gl-matrix'],
    output: [
        {
            file: 'dist/gltf-viewer.js',
            format: 'cjs',
            sourcemap: true
        },
        {
            file: 'dist/gltf-viewer.module.js',
            format: 'esm',
            sourcemap: true,
        }
    ],
    plugins: [
        wasm( {fileName: "libs/[name][extname]", publicPath: "./"} ),
        glslify(),
        resolve({
            browser: true,
            preferBuiltins: false,
            dedupe: ['gl-matrix', 'jpeg-js', 'fast-png', '@khronosgroup/gltf-interactivity-engine']
        }),
        copy({
            targets: [
                {
                    src: [
                        "assets/images/lut_charlie.png",
                        "assets/images/lut_ggx.png",
                        "assets/images/lut_sheen_E.png",
                    ], dest: "dist/assets"
                },
                { src: ["source/libs/*", "!source/libs/hdrpng.js"], dest: "dist/libs" },
                { src: "tests/testApp/*", dest: "dist"}
            ]
        }),
        commonjs(),
        license({
            banner: {
                content: {
                    file: 'LICENSE_BANNER.txt',
                }
            },
            thirdParty:{
                includeSelf: false
            }
        }),
    ]
};
