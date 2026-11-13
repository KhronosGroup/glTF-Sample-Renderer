import { describe, expect, it } from "vitest";

import { installWebGlConstants } from "../helpers/webgl_constants.js";
import { gltfAccessor } from "../../source/gltf/accessor.js";

installWebGlConstants();

const FLOAT64 = 5130;
const INT32 = 5124;
const HALF_FLOAT = 5131;
const INT64 = 5134;
const UINT64 = 5135;

// Wraps raw typed data in the minimal glTF structure getTypedView expects.
function accessorOver(componentType, typedArray) {
    const gltf = {
        buffers: [{ buffer: typedArray.buffer }],
        bufferViews: [
            { buffer: 0, byteOffset: 0, byteLength: typedArray.byteLength, byteStride: 0 }
        ]
    };
    const accessor = new gltfAccessor();
    accessor.componentType = componentType;
    accessor.count = typedArray.length;
    accessor.type = "SCALAR";
    accessor.bufferView = 0;
    return accessor.getTypedView(gltf);
}

describe("accessor component types", () => {
    it("decodes int32 (5124)", () => {
        expect(Array.from(accessorOver(INT32, new Int32Array([-7, 0, 7])))).toEqual([-7, 0, 7]);
    });

    it("decodes half float (5131)", () => {
        // 1.0, 2.0, 0.0, -2.0 in IEEE 754 binary16.
        const view = accessorOver(
            HALF_FLOAT,
            new Uint16Array([0x3c00, 0x4000, 0x0000, 0xc000])
        );
        expect(Array.from(view)).toEqual([1, 2, 0, -2]);
    });

    it("decodes int64 (5134)", () => {
        expect(Array.from(accessorOver(INT64, new BigInt64Array([-1n, 0n, 1n])))).toEqual([
            -1n,
            0n,
            1n
        ]);
    });

    it("decodes uint64 (5135)", () => {
        expect(Array.from(accessorOver(UINT64, new BigUint64Array([0n, 1n, 2n])))).toEqual([
            0n,
            1n,
            2n
        ]);
    });

    it("still decodes float64 (5130)", () => {
        expect(Array.from(accessorOver(FLOAT64, new Float64Array([1.5, -2.5])))).toEqual([
            1.5,
            -2.5
        ]);
    });
});
