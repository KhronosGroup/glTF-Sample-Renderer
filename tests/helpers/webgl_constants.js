import { gltfWebGl } from "../../source/Renderer/webgl.js";

// The renderer's `GL` binding is the live WebGL context, populated the first time a
// gltfWebGl is constructed. Unit tests have no context, so this installs a stub carrying
// just the enum values. The numbers are from the WebGL 2 specification and are fixed.
const WEBGL_CONSTANTS = {
    BYTE: 0x1400,
    UNSIGNED_BYTE: 0x1401,
    SHORT: 0x1402,
    UNSIGNED_SHORT: 0x1403,
    INT: 0x1404,
    UNSIGNED_INT: 0x1405,
    FLOAT: 0x1406,

    POINTS: 0x0000,
    LINES: 0x0001,
    LINE_LOOP: 0x0002,
    LINE_STRIP: 0x0003,
    TRIANGLES: 0x0004,
    TRIANGLE_STRIP: 0x0005,
    TRIANGLE_FAN: 0x0006,

    TEXTURE_2D: 0x0de1,
    TEXTURE_2D_ARRAY: 0x8c1a,
    TEXTURE_CUBE_MAP: 0x8513,

    NEAREST: 0x2600,
    LINEAR: 0x2601,
    LINEAR_MIPMAP_LINEAR: 0x2703,
    CLAMP_TO_EDGE: 0x812f,
    REPEAT: 0x2901
};

let installed = false;

function installWebGlConstants() {
    if (!installed) {
        new gltfWebGl(WEBGL_CONSTANTS);
        installed = true;
    }
    return WEBGL_CONSTANTS;
}

export { installWebGlConstants, WEBGL_CONSTANTS };
