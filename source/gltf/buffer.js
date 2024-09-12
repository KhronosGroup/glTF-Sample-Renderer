import { getContainingFolder } from './utils.js';
import { GltfObject } from './gltf_object.js';

class gltfBuffer extends GltfObject
{
    static animatedProperties = [];
    constructor()
    {
        super();
        this.uri = undefined;
        this.byteLength = undefined;
        this.name = undefined;

        // non gltf
        this.buffer = undefined; // raw data blob
    }

    load(gltf, additionalFiles = undefined)
    {
        if (this.buffer !== undefined)
        {
            console.error("buffer has already been loaded");
            return;
        }

        const self = this;
        return new Promise(function(resolve)
        {
            if (!self.setBufferFromFiles(additionalFiles, resolve) &&
                !self.setBufferFromUri(gltf, resolve) &&
                !self.setBufferFromBase64(resolve))
            {
                resolve();
            }
        });
    }

    setBufferFromBase64(callback)
    {
        if (this.uri === undefined || !this.uri.startsWith("data:"))
        {
            return false;
        }

        const base64 = this.uri.split(",")[1];
        const binString = atob(base64);
        this.buffer = Uint8Array.from(binString, (ch) => ch.charCodeAt(0)).buffer;
        callback();
        return true;
    }

    setBufferFromUri(gltf, callback)
    {
        if (this.uri === undefined || this.uri.startsWith("data:"))
        {
            return false;
        }

        fetch(getContainingFolder(gltf.path) + this.uri)
            .then(response => response.arrayBuffer())
            .then(buffer => {
                this.buffer = buffer;
                callback();
            });

        return true;
    }

    setBufferFromFiles(files, callback)
    {
        if (this.uri === undefined || files === undefined)
        {
            return false;
        }

        const foundFile = files.find(file => file[1].name === this.uri || file[1].fullPath === this.uri);

        if (foundFile === undefined)
        {
            return false;
        }

        const self = this;
        const reader = new FileReader();
        reader.onloadend = function(event)
        {
            self.buffer = event.target.result;
            callback();
        };
        reader.readAsArrayBuffer(foundFile[1]);

        return true;
    }
}

export { gltfBuffer };
