import { GltfObject } from "./gltf_object.js";
import { AsyncFileReader } from "../ResourceLoader/async_file_reader.js";
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

    async load(gltf, additionalFiles = undefined, allowResourceAbsolutePath) {
        if (this.image !== undefined) {
            if (this.mimeType !== ImageMimeType.GLTEXTURE) {
                console.error("image has already been loaded");
            }
            return;
        }

        if (
            !(await this.setImageFromBufferView(gltf)) &&
            !(await this.setImageFromFiles(gltf, additionalFiles)) &&
            !(await this.setImageFromUri(gltf, allowResourceAbsolutePath)) &&
            !(await this.setImageFromBase64(gltf))
        ) {
            return;
        }

        return;
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

    setMimetypeFromFilename(filename) {
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
            console.warn("MimeType not defined");
            // assume jpeg encoding as best guess
            this.mimeType = ImageMimeType.JPEG;
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

    async setImageFromBase64(gltf) {
        if (this.uri === undefined || !this.uri.startsWith("data:")) {
            return false;
        }
        const parts = this.uri.split(",");
        if (this.mimeType === undefined) {
            switch (parts[0]) {
                case "data:image/jpeg;base64":
                    this.mimeType = ImageMimeType.JPEG;
                    break;
                case "data:image/png;base64":
                    this.mimeType = ImageMimeType.PNG;
                    break;
                case "data:image/webp;base64":
                    this.mimeType = ImageMimeType.WEBP;
                    break;
                case "data:image/ktx2;base64":
                    this.mimeType = ImageMimeType.KTX2;
                    break;
                default:
                    // Left undefined so setImageFromBytes can sniff the payload.
                    break;
            }
        }
        const res = await fetch(this.uri);
        const buffer = await res.arrayBuffer();
        return await this.setImageFromBytes(gltf, new Uint8Array(buffer));
    }

    async setImageFromUri(gltf, allowResourceAbsolutePath) {
        if (this.uri === undefined || this.uri.startsWith("data:")) {
            return false;
        }
        if (!allowResourceAbsolutePath && ResourceLoaderUtils.isAbsoluteUrl(this.uri)) {
            throw new Error("Absolute URLs are not allowed for security reasons: " + this.uri);
        }
        const parentPath = ResourceLoaderUtils.getContainingFolder(gltf.path ?? "");
        const fullPath = parentPath + this.uri;
        if (this.mimeType === undefined) {
            this.setMimetypeFromFilename(this.uri);
        }

        if (this.mimeType === ImageMimeType.KTX2) {
            if (gltf.ktxDecoder !== undefined) {
                this.image = await gltf.ktxDecoder.loadKtxFromUri(fullPath);
            } else {
                console.warn("Loading of ktx images failed: KtxDecoder not initalized");
            }
        } else if (
            typeof Image !== "undefined" &&
            (this.mimeType === ImageMimeType.JPEG ||
                this.mimeType === ImageMimeType.PNG ||
                this.mimeType === ImageMimeType.WEBP)
        ) {
            try {
                this.image = await gltfImage.loadHTMLImage(fullPath);
            } catch {
                throw new Error(`Could not load image from ${fullPath}`);
            }
        } else if (this.mimeType === ImageMimeType.JPEG && this.uri instanceof ArrayBuffer) {
            this.image = jpeg.decode(this.uri, { useTArray: true });
        } else if (this.mimeType === ImageMimeType.PNG && this.uri instanceof ArrayBuffer) {
            this.image = png.decode(this.uri);
        } else {
            console.error("Unsupported image type " + this.mimeType);
            return false;
        }

        return true;
    }

    async setImageFromBufferView(gltf) {
        const view = gltf.bufferViews[this.bufferView];
        if (view === undefined) {
            return false;
        }

        const buffer = gltf.buffers[view.buffer].buffer;
        const array = new Uint8Array(buffer, view.byteOffset, view.byteLength);
        return await this.setImageFromBytes(gltf, array);
    }

    async setImageFromFiles(gltf, files) {
        if (this.uri === undefined || files === undefined) {
            return false;
        }
        let actualPath = this.uri;
        if (!ResourceLoaderUtils.isAbsoluteUrl(this.uri)) {
            const parentPath = ResourceLoaderUtils.getContainingFolder(gltf.path ?? "");
            actualPath = ResourceLoaderUtils.cleanRelativePath(parentPath + this.uri);
        }

        let foundFile = files.find((file) => {
            if (file[0] == actualPath) {
                return true;
            }
        });

        if (foundFile === undefined) {
            return false;
        }

        if (this.mimeType === undefined) {
            this.setMimetypeFromFilename(foundFile[0]);
        }

        if (this.mimeType === ImageMimeType.KTX2) {
            if (gltf.ktxDecoder !== undefined) {
                const data = new Uint8Array(await foundFile[1].arrayBuffer());
                this.image = await gltf.ktxDecoder.loadKtxFromBuffer(data);
            } else {
                console.warn("Loading of ktx images failed: KtxDecoder not initalized");
            }
        } else if (
            typeof Image !== "undefined" &&
            (this.mimeType === ImageMimeType.JPEG ||
                this.mimeType === ImageMimeType.PNG ||
                this.mimeType === ImageMimeType.WEBP)
        ) {
            const imageData = await AsyncFileReader.readAsDataURL(foundFile[1]).catch(() => {
                console.error("Could not load image with FileReader");
            });
            try {
                this.image = await gltfImage.loadHTMLImage(imageData);
            } catch {
                console.error("Error while reading image from file " + this.uri);
            }
        } else {
            console.error("Unsupported image type " + this.mimeType);
            return false;
        }

        return true;
    }
}

export { gltfImage, ImageMimeType };
