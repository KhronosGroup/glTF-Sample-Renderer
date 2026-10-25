import { GltfObject } from "./gltf_object.js";
import { GL } from "../Renderer/webgl";
import { ImageMimeType } from "./image_mime_type.js";
import * as jpeg from "jpeg-js";
import * as png from "fast-png";
import { ResourceLoaderUtils } from "../ResourceLoader/loader_utils.js";

class gltfImage extends GltfObject {
    static animatedProperties = [];
    constructor(
        uri = undefined,
        type = GL.TEXTURE_2D,
        miplevel = 0,
        bufferView = undefined,
        name = undefined,
        mimeType = undefined,
        image = undefined
    ) {
        super();
        this.uri = uri;
        this.bufferView = bufferView;
        this.mimeType = mimeType;
        this.image = image; // javascript image
        this.name = name;
        this.type = type; // nonstandard
        this.miplevel = miplevel; // nonstandard
        this.isThumbnail = false; // nonstandard
        this.usedByTexture = true; // nonstandard
    }

    async load(gltf, resolver) {
        if (this.image !== undefined) {
            if (this.mimeType !== ImageMimeType.GLTEXTURE) {
                console.error("image has already been loaded");
            }
            return;
        }

        if (this.bufferView !== undefined) {
            await this.setImageFromBufferView(gltf);
            return;
        }
        if (this.uri === undefined) {
            console.error(`Image "${this.name}" has neither a uri nor a bufferView`);
            return;
        }

        const { bytes, mimeType } = await resolver.resolve(this.uri);
        // A resolved alias or a Content-Type header can name the media type, but the
        // asset's own mimeType wins, then the filename, then the bytes themselves.
        if (this.mimeType === undefined) {
            this.setMimetypeFromFilename(this.uri, mimeType);
        }
        await this.setImageFromBytes(gltf, bytes);
    }

    static loadHTMLImage(url) {
        return new Promise((resolve, reject) => {
            const image = new Image();
            image.addEventListener("load", () => resolve(image));
            image.addEventListener("error", () => reject());
            image.src = url;
            image.crossOrigin = "";
        });
    }

    setMimetypeFromFilename(filename, fallback = undefined) {
        let extension = ResourceLoaderUtils.getExtension(filename);
        if (extension == "ktx2" || extension == "ktx") {
            this.mimeType = ImageMimeType.KTX2;
        } else if (extension == "jpg" || extension == "jpeg") {
            this.mimeType = ImageMimeType.JPEG;
        } else if (extension == "png") {
            this.mimeType = ImageMimeType.PNG;
        } else if (extension == "webp") {
            this.mimeType = ImageMimeType.WEBP;
        } else {
            // Left undefined when there is no fallback either, so setImageFromBytes can
            // sniff the payload rather than guessing from the name.
            this.mimeType = fallback;
        }
    }

    static sniffMimeType(array) {
        const startsWith = (offset, ...bytes) =>
            array.length >= offset + bytes.length &&
            bytes.every((byte, i) => array[offset + i] === byte);

        // "RIFF" .... "WEBP"
        if (startsWith(0, 0x52, 0x49, 0x46, 0x46) && startsWith(8, 0x57, 0x45, 0x42, 0x50)) {
            return ImageMimeType.WEBP;
        }
        if (startsWith(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) {
            return ImageMimeType.PNG;
        }
        if (startsWith(0, 0xff, 0xd8, 0xff)) {
            return ImageMimeType.JPEG;
        }
        if (startsWith(0, 0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb)) {
            return ImageMimeType.KTX2;
        }
        return undefined;
    }

    async setImageFromBytes(gltf, array) {
        if (this.mimeType === undefined) {
            this.mimeType = gltfImage.sniffMimeType(array);
            if (this.mimeType === undefined) {
                console.error(`Could not determine the media type of image "${this.name}"`);
                return false;
            }
        }
        if (this.mimeType === ImageMimeType.KTX2) {
            if (gltf.ktxDecoder !== undefined) {
                this.image = await gltf.ktxDecoder.loadKtxFromBuffer(array);
            } else {
                console.warn("Loading of ktx images failed: KtxDecoder not initalized");
            }
        } else if (
            typeof Image !== "undefined" &&
            (this.mimeType === ImageMimeType.JPEG ||
                this.mimeType === ImageMimeType.PNG ||
                this.mimeType === ImageMimeType.WEBP)
        ) {
            const blob = new Blob([array], { type: this.mimeType });
            const objectURL = URL.createObjectURL(blob);
            try {
                this.image = await gltfImage.loadHTMLImage(objectURL);
            } catch {
                throw new Error(`Could not load image "${this.name}" from buffer`);
            }
        } else if (this.mimeType === ImageMimeType.JPEG) {
            this.image = jpeg.decode(array, { useTArray: true });
        } else if (this.mimeType === ImageMimeType.PNG) {
            this.image = png.decode(array);
        } else {
            console.error("Unsupported image type " + this.mimeType);
            return false;
        }

        return true;
    }

    async setImageFromBufferView(gltf) {
        const view = gltf.bufferViews[this.bufferView];
        if (view === undefined) {
            console.error(`Image "${this.name}" refers to a bufferView that does not exist`);
            return false;
        }

        const buffer = gltf.buffers[view.buffer].buffer;
        const array = new Uint8Array(buffer, view.byteOffset, view.byteLength);
        return await this.setImageFromBytes(gltf, array);
    }
}

export { gltfImage, ImageMimeType };
