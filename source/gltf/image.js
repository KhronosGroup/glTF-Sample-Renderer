import { GltfObject } from './gltf_object.js';
import { getExtension } from './utils.js';
import { AsyncFileReader } from '../ResourceLoader/async_file_reader.js';
import { GL } from "../Renderer/webgl";
import { ImageMimeType } from "./image_mime_type.js";
import * as jpeg  from "jpeg-js";
import * as png from 'fast-png';

class gltfImage extends GltfObject
{
    static animatedProperties = [];
    constructor(
        uri = undefined,
        type = GL.TEXTURE_2D,
        miplevel = 0,
        bufferView = undefined,
        name = undefined,
        mimeType = undefined,
        image = undefined)
    {
        super();
        this.uri = uri;
        this.bufferView = bufferView;
        this.mimeType = mimeType;
        this.image = image; // javascript image
        this.name = name;
        this.type = type; // nonstandard
        this.miplevel = miplevel; // nonstandard
    }

    resolveRelativePath(basePath)
    {
        if (typeof this.uri === 'string' || this.uri instanceof String) {
            if (this.uri.startsWith('data:')) {
                return;
            }
            if (this.uri.startsWith('./')) {
                this.uri = this.uri.substring(2);
            }
            this.uri = basePath + this.uri;
        }
    }

    async load(gltf, additionalFiles = undefined)
    {
        if (this.image !== undefined)
        {
            if (this.mimeType !== ImageMimeType.GLTEXTURE)
            {
                console.error("image has already been loaded");
            }
            return;
        }

        if (!await this.setImageFromBufferView(gltf) &&
            !await this.setImageFromFiles(gltf, additionalFiles) &&
            !await this.setImageFromUri(gltf) &&
            !await this.setImageFromBase64(gltf))
        {
            return;
        }

        return;
    }

    static loadHTMLImage(url)
    {
        return new Promise( (resolve, reject) => {
            const image = new Image();
            image.addEventListener('load', () => resolve(image) );
            image.addEventListener('error', () => reject());
            image.src = url;
            image.crossOrigin = "";
        });
    }

    setMimetypeFromFilename(filename)
    {

        let extension = getExtension(filename);
        if(extension == "ktx2" || extension == "ktx")
        {
            this.mimeType = ImageMimeType.KTX2;
        }
        else if(extension == "jpg" || extension == "jpeg")
        {
            this.mimeType = ImageMimeType.JPEG;
        }
        else if(extension == "png" )
        {
            this.mimeType = ImageMimeType.PNG;
        }
        else if(extension == "webp" )
        {
            this.mimeType = ImageMimeType.WEBP;
        }
        else
        {
            console.warn("MimeType not defined");
            // assume jpeg encoding as best guess
            this.mimeType = ImageMimeType.JPEG;
        }

    }

    async setImageFromBytes(gltf, array)
    {
        if (this.mimeType === ImageMimeType.KTX2)
        {
            if (gltf.ktxDecoder !== undefined)
            {
                this.image = await gltf.ktxDecoder.loadKtxFromBuffer(array);
            }
            else
            {
                console.warn('Loading of ktx images failed: KtxDecoder not initalized');
            }
        }
        else if(typeof(Image) !== 'undefined' && (this.mimeType === ImageMimeType.JPEG || this.mimeType === ImageMimeType.PNG || this.mimeType === ImageMimeType.WEBP))
        {
            const blob = new Blob([array], { "type": this.mimeType });
            const objectURL = URL.createObjectURL(blob);
            try {
                this.image = await gltfImage.loadHTMLImage(objectURL);
            } catch {
                throw new Error(`Could not load image "${this.name}" from buffer`);
            }
        }
        else if(this.mimeType === ImageMimeType.JPEG)
        {
            this.image = jpeg.decode(array, {useTArray: true});
        }
        else if(this.mimeType === ImageMimeType.PNG)
        {
            this.image = png.decode(array);
        }
        else
        {
            console.error("Unsupported image type " + this.mimeType);
            return false;
        }

        return true;
    }

    async setImageFromBase64(gltf)
    {
        if (this.uri === undefined || !this.uri.startsWith('data:'))
        {
            return false;
        }
        const parts = this.uri.split(",");
        if (this.mimeType === undefined)
        {
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
                console.warn(`Data URI ${parts[0]} not supported`);
                return false;
            }
        }
        const res = await fetch(this.uri);
        const buffer = await res.arrayBuffer();
        return await this.setImageFromBytes(gltf, new Uint8Array(buffer));
    }

    async setImageFromUri(gltf)
    {
        if (this.uri === undefined || this.uri.startsWith('data:'))
        {
            return false;
        }
        if (this.mimeType === undefined)
        {
            this.setMimetypeFromFilename(this.uri);
        }

        if(this.mimeType === ImageMimeType.KTX2)
        {
            if (gltf.ktxDecoder !== undefined)
            {
                this.image = await gltf.ktxDecoder.loadKtxFromUri(this.uri);
            }
            else
            {
                console.warn('Loading of ktx images failed: KtxDecoder not initalized');
            }
        }
        else if (typeof(Image) !== 'undefined' && (this.mimeType === ImageMimeType.JPEG || this.mimeType === ImageMimeType.PNG || this.mimeType === ImageMimeType.WEBP))
        {
            try {
                this.image = await gltfImage.loadHTMLImage(this.uri);
            } catch {
                throw new Error(`Could not load image from ${this.uri}`);
            }
        }
        else if(this.mimeType === ImageMimeType.JPEG && this.uri instanceof ArrayBuffer)
        {
            this.image = jpeg.decode(this.uri, {useTArray: true});
        }
        else if(this.mimeType === ImageMimeType.PNG && this.uri instanceof ArrayBuffer)
        {
            this.image = png.decode(this.uri);
        }
        else
        {
            console.error("Unsupported image type " + this.mimeType);
            return false;
        }

        return true;
    }

    async setImageFromBufferView(gltf)
    {
        const view = gltf.bufferViews[this.bufferView];
        if (view === undefined)
        {
            return false;
        }

        const buffer = gltf.buffers[view.buffer].buffer;
        const array = new Uint8Array(buffer, view.byteOffset, view.byteLength);
        return await this.setImageFromBytes(gltf, array);
    }

    async setImageFromFiles(gltf, files)
    {
        if (this.uri === undefined || files === undefined)
        {
            return false;
        }

        let foundFile = files.find(file => {
            if (file[0] == "/" + this.uri) {
                return true;
            }
        });

        if (foundFile === undefined)
        {
            return false;
        }

        if (this.mimeType === undefined)
        {
            this.setMimetypeFromFilename(foundFile[0]);
        }


        if(this.mimeType === ImageMimeType.KTX2)
        {
            if (gltf.ktxDecoder !== undefined)
            {
                const data = new Uint8Array(await foundFile[1].arrayBuffer());
                this.image = await gltf.ktxDecoder.loadKtxFromBuffer(data);
            }
            else
            {
                console.warn('Loading of ktx images failed: KtxDecoder not initalized');
            }
        }
        else if (typeof(Image) !== 'undefined' && (this.mimeType === ImageMimeType.JPEG || this.mimeType === ImageMimeType.PNG || this.mimeType === ImageMimeType.WEBP))
        {
            const imageData = await AsyncFileReader.readAsDataURL(foundFile[1]).catch( () => {
                console.error("Could not load image with FileReader");
            });
            try {
                this.image = await gltfImage.loadHTMLImage(imageData);
            } catch {
                console.error("Error while reading image from file " + this.uri);
            }
        }
        else
        {
            console.error("Unsupported image type " + this.mimeType);
            return false;
        }


        return true;
    }
}

export { gltfImage, ImageMimeType };
