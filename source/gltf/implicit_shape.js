import { GltfObject } from "./gltf_object";

class gltfImplicitShape extends GltfObject {
    static animatedProperties = [];
    constructor() {
        super();
        this.name = undefined;
        this.type = undefined;
        this.plane = undefined;
        this.box = undefined;
        this.capsule = undefined;
        this.cylinder = undefined;
        this.sphere = undefined;
    }

    fromJson(json) {
        super.fromJson(json);

        if (json.plane !== undefined) {
            this.plane = new gltfShapePlane();
            this.plane.fromJson(json.plane);
        }
        if (json.box !== undefined) {
            this.box = new gltfShapeBox();
            this.box.fromJson(json.box);
        }
        if (json.capsule !== undefined) {
            this.capsule = new gltfShapeCapsule();
            this.capsule.fromJson(json.capsule);
        }
        if (json.cylinder !== undefined) {
            this.cylinder = new gltfShapeCylinder();
            this.cylinder.fromJson(json.cylinder);
        }
        if (json.sphere !== undefined) {
            this.sphere = new gltfShapeSphere();
            this.sphere.fromJson(json.sphere);
        }
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
        this.radiusBottom = 0.25;
        this.height = 0.5;
        this.radiusTop = 0.25;
    }
}

class gltfShapeCylinder extends GltfObject {
    static animatedProperties = ["radiusBottom", "height", "radiusTop"];
    constructor() {
        super();
        this.radiusBottom = 0.25;
        this.height = 0.5;
        this.radiusTop = 0.25;
    }
}

class gltfShapePlane extends GltfObject {
    static animatedProperties = ["doubleSided", "sizeX", "sizeZ"];
    constructor() {
        super();
        this.doubleSided = false;
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

export {
    gltfImplicitShape,
    gltfShapeBox,
    gltfShapeCapsule,
    gltfShapeCylinder,
    gltfShapePlane,
    gltfShapeSphere
};
