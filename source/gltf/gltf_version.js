// The highest glTF version this renderer implements.
const SUPPORTED_GLTF_VERSION = { major: 2, minor: 1 };

function parseVersionString(version) {
    if (typeof version !== "string") {
        return undefined;
    }
    const match = /^(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})$/.exec(version);
    if (match === null) {
        return undefined;
    }
    return { major: parseInt(match[1], 10), minor: parseInt(match[2], 10) };
}

function versionAtLeast(version, major, minor) {
    return version.major > major || (version.major === major && version.minor >= minor);
}

export { SUPPORTED_GLTF_VERSION, parseVersionString, versionAtLeast };
