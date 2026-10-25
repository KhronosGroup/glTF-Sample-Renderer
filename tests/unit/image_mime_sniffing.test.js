import { describe, expect, it } from "vitest";

import { gltfImage } from "../../source/gltf/image.js";
import { ImageMimeType } from "../../source/gltf/image_mime_type.js";

// glTF 2.1 promotes EXT_texture_webp into core, so an image can be WebP without any
// extension declaring it. Images stored in a bufferView are the case where no filename
// extension is available to fall back on.

describe("gltfImage.sniffMimeType", () => {
    const bytes = (...values) => new Uint8Array(values);

    it("recognises WebP by its RIFF container and WEBP form type", () => {
        const webp = bytes(0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50);
        expect(gltfImage.sniffMimeType(webp)).toBe(ImageMimeType.WEBP);
    });

    it("does not mistake a non-WebP RIFF file for WebP", () => {
        const wav = bytes(0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x41, 0x56, 0x45);
        expect(gltfImage.sniffMimeType(wav)).toBeUndefined();
    });

    it("recognises PNG", () => {
        expect(gltfImage.sniffMimeType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe(
            ImageMimeType.PNG
        );
    });

    it("recognises JPEG", () => {
        expect(gltfImage.sniffMimeType(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe(ImageMimeType.JPEG);
    });

    it("recognises KTX2", () => {
        expect(gltfImage.sniffMimeType(bytes(0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb))).toBe(
            ImageMimeType.KTX2
        );
    });

    it("returns undefined for unrecognised data", () => {
        expect(gltfImage.sniffMimeType(bytes(1, 2, 3, 4))).toBeUndefined();
    });

    it("does not read past the end of a short buffer", () => {
        expect(gltfImage.sniffMimeType(bytes(0x52, 0x49))).toBeUndefined();
        expect(gltfImage.sniffMimeType(bytes())).toBeUndefined();
    });
});
