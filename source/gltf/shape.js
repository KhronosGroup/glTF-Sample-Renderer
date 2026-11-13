import { GltfObject } from "./gltf_object";

// glTF 2.1 promotes the draft KHR_implicit_shapes extension into the core `shapes`
// array, and adds mesh-based shapes alongside the implicit ones. Shapes carry no meaning
// by themselves; bounding volumes and physics colliders reference them.
//
// Defaults below follow the 2.1 schema, which differs from the draft extension.
class gltfShape extends GltfObject {
    static animatedProperties = [];
    constructor() {
        super();
        this.name = undefined;
        this.type = undefined;
        this.box = undefined;
        this.capsule = undefined;
        this.convexMesh = undefined;
        this.cylinder = undefined;
        this.mesh = undefined;
        this.plane = undefined;
        this.sphere = undefined;
    }

    fromJson(json) {
        super.fromJson(json);

        const parse = (key, Type) => {
            if (json[key] === undefined) {
                return undefined;
            }
            const value = new Type();
            value.fromJson(json[key]);
            return value;
        };

        this.box = parse("box", gltfShapeBox);
        this.capsule = parse("capsule", gltfShapeCapsule);
        this.convexMesh = parse("convexMesh", gltfShapeConvexMesh);
        this.cylinder = parse("cylinder", gltfShapeCylinder);
        this.mesh = parse("mesh", gltfShapeMesh);
        this.plane = parse("plane", gltfShapePlane);
        this.sphere = parse("sphere", gltfShapeSphere);

        if (this.type !== undefined && this[this.type] === undefined) {
            // A shape with no parameter object is legal; it just uses the defaults. An
            // unknown type is not, and is most likely an extension we do not implement.
            if (!gltfShape.knownTypes.includes(this.type)) {
                console.warn(`Unknown shape type "${this.type}"`);
            }
        }
    }

    static knownTypes = ["box", "capsule", "convexMesh", "cylinder", "mesh", "plane", "sphere"];

    // The parameter object matching this shape's type, if the type is one we know.
    parameters() {
        return gltfShape.knownTypes.includes(this.type) ? this[this.type] : undefined;
    }

    isDirty() {
        return gltfShape.knownTypes.some((type) => this[type]?.isDirty() ?? false);
    }
}

class gltfShapeBox extends GltfObject {
    static animatedProperties = ["size"];
    constructor() {
        super();
        this.size = [1, 1, 1];
    }
}

class gltfShapeCapsule extends GltfObject {
    static animatedProperties = ["radiusBottom", "height", "radiusTop"];
    constructor() {
        super();
        // `height` is the distance between the two cap sphere centres, not the overall
        // extent, so the default capsule is 2.0 tall overall.
        this.height = 1.0;
        this.radiusBottom = 0.5;
        this.radiusTop = 0.5;
    }
}

class gltfShapeCylinder extends GltfObject {
    static animatedProperties = ["radiusBottom", "height", "radiusTop"];
    constructor() {
        super();
        this.height = 2.0;
        this.radiusBottom = 0.5;
        this.radiusTop = 0.5;
    }
}

class gltfShapePlane extends GltfObject {
    static animatedProperties = ["sizeX", "sizeZ"];
    constructor() {
        super();
        // Undefined extents mean the plane is infinite along that axis. The plane is
        // one-sided with its normal along +Y.
        this.sizeX = undefined;
        this.sizeZ = undefined;
    }
}

class gltfShapeSphere extends GltfObject {
    static animatedProperties = ["radius"];
    constructor() {
        super();
        this.radius = 0.5;
    }
}

class gltfShapeMesh extends GltfObject {
    static animatedProperties = [];
    static readOnlyAnimatedProperties = ["mesh"];
    constructor() {
        super();
        this.mesh = undefined;
    }
}

// A convex mesh shape is the convex hull of its mesh. Implementations are expected to
// compute the hull when the source mesh is not already convex.
class gltfShapeConvexMesh extends gltfShapeMesh {
    static animatedProperties = [];
    static readOnlyAnimatedProperties = ["mesh"];
}

export {
    gltfShape,
    gltfShapeBox,
    gltfShapeCapsule,
    gltfShapeConvexMesh,
    gltfShapeCylinder,
    gltfShapeMesh,
    gltfShapePlane,
    gltfShapeSphere
};
