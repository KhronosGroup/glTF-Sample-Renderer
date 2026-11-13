import { describe, expect, it, vi } from "vitest";

import { gltfAsset } from "../../source/gltf/asset.js";
import { parseVersionString, versionAtLeast } from "../../source/gltf/gltf_version.js";

describe("parseVersionString", () => {
    it("parses a well-formed version", () => {
        expect(parseVersionString("2.1")).toEqual({ major: 2, minor: 1 });
    });

    it.each(["2", "2.1.0", "v2.1", "02.1", "", "2.", ".1"])("rejects %o", (version) => {
        expect(parseVersionString(version)).toBeUndefined();
    });

    it("rejects non-strings", () => {
        expect(parseVersionString(undefined)).toBeUndefined();
        expect(parseVersionString(2.1)).toBeUndefined();
    });
});

describe("versionAtLeast", () => {
    it("compares the major component first", () => {
        expect(versionAtLeast({ major: 3, minor: 0 }, 2, 9)).toBe(true);
        expect(versionAtLeast({ major: 1, minor: 9 }, 2, 0)).toBe(false);
    });

    it("compares the minor component when majors match", () => {
        expect(versionAtLeast({ major: 2, minor: 1 }, 2, 1)).toBe(true);
        expect(versionAtLeast({ major: 2, minor: 0 }, 2, 1)).toBe(false);
    });
});

describe("gltfAsset version parsing", () => {
    it("splits the version into major and minor", () => {
        const asset = new gltfAsset();
        asset.fromJson({ version: "2.1" });

        expect(asset.majorVersion).toBe(2);
        expect(asset.minorVersion).toBe(1);
        expect(asset.isAtLeast(2, 1)).toBe(true);
    });

    it("treats a 2.0 asset as below 2.1", () => {
        const asset = new gltfAsset();
        asset.fromJson({ version: "2.0" });

        expect(asset.isAtLeast(2, 1)).toBe(false);
        expect(asset.isAtLeast(2, 0)).toBe(true);
    });

    it("falls back to 2.0 and warns on an unparseable version", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const asset = new gltfAsset();
        asset.fromJson({ version: "nonsense" });

        expect(asset.majorVersion).toBe(2);
        expect(asset.minorVersion).toBe(0);
        expect(warn).toHaveBeenCalled();
        warn.mockRestore();
    });

    it("rejects an asset whose minVersion is beyond what is implemented", () => {
        expect(() => new gltfAsset().fromJson({ version: "3.0", minVersion: "3.0" })).toThrow();
    });

    it("accepts an asset whose minVersion is implemented", () => {
        expect(() => new gltfAsset().fromJson({ version: "2.1", minVersion: "2.1" })).not.toThrow();
        expect(() => new gltfAsset().fromJson({ version: "2.1", minVersion: "2.0" })).not.toThrow();
    });

    it("ignores an unparseable minVersion rather than failing the load", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        expect(() =>
            new gltfAsset().fromJson({ version: "2.1", minVersion: "nonsense" })
        ).not.toThrow();
        expect(warn).toHaveBeenCalled();
        warn.mockRestore();
    });
});
