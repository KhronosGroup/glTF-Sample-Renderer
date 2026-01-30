function hasMeshOptCompression(object) {
    if (object.extensions === undefined) {
        return false;
    }

    let hasExtExtension = object.extensions.EXT_meshopt_compression !== undefined;
    let hasKHRExtension = object.extensions.KHR_meshopt_compression !== undefined;

    return hasExtExtension || hasKHRExtension;
}

function getMeshOptExtensionObject(object) {
    if (object.extensions === undefined) {
        return null;
    }

    if (object.extensions.EXT_meshopt_compression !== undefined) {
        return object.extensions.EXT_meshopt_compression;
    }

    if (object.extensions.KHR_meshopt_compression !== undefined) {
        return object.extensions.KHR_meshopt_compression;
    }
}

export { hasMeshOptCompression, getMeshOptExtensionObject };
