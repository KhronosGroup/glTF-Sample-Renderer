import { mat4, vec3, quat } from 'gl-matrix';
import { jsToGl, UniformStruct } from './utils.js';
import { GltfObject } from './gltf_object.js';

class gltfLight extends GltfObject
{
    static animatedProperties = ["color", "intensity", "range"];
    constructor()
    {
        super();
        this.name = undefined;
        this.type = "directional";
        this.color = [1, 1, 1];
        this.intensity = 1;
        this.range = -1;
        this.spot = new gltfLightSpot();

        // Used to override direction from node
        this.direction = undefined;
    }

    fromJson(json)
    {
        super.fromJson(json);
        if (json.spot !== undefined)
        {
            this.spot = new gltfLightSpot();
            this.spot.fromJson(json.spot);
        }
    }

    toUniform(node)
    {
        const matrix = node?.worldTransform ?? mat4.identity;

        // To extract a correct rotation, the scaling component must be eliminated.
        var scale = vec3.fromValues(1, 1, 1);
        mat4.getScaling(scale, matrix);
        const mn = mat4.create();
        for(const col of [0, 1, 2])
        {
            mn[col] = matrix[col] / scale[0];
            mn[col + 4] = matrix[col + 4] / scale[1];
            mn[col + 8] = matrix[col + 8] / scale[2];
        }
        var rotation = quat.create();
        mat4.getRotation(rotation, mn);
        quat.normalize(rotation, rotation);

        const uLight = new UniformLight();

        const alongNegativeZ = vec3.fromValues(0, 0, -1);
        vec3.transformQuat(uLight.direction, alongNegativeZ, rotation);

        var translation = vec3.fromValues(0, 0, 0);
        mat4.getTranslation(translation, matrix);
        uLight.position = translation;

        if (this.direction !== undefined)
        {
            uLight.direction = this.direction;
        }

        uLight.range = this.range;
        uLight.color = jsToGl(this.color);
        uLight.intensity = this.intensity;

        uLight.innerConeCos = Math.cos(this.spot.innerConeAngle);
        uLight.outerConeCos = Math.cos(this.spot.outerConeAngle);

        switch(this.type)
        {
        case "spot":
            uLight.type = Type_Spot;
            break;
        case "point":
            uLight.type = Type_Point;
            break;
        case "directional":
        default:
            uLight.type = Type_Directional;
            break;
        }

        return uLight;
    }
}

const Type_Directional = 0;
const Type_Point = 1;
const Type_Spot = 2;

class UniformLight extends UniformStruct
{
    constructor()
    {
        super();

        const defaultDirection = vec3.fromValues(-0.7399, -0.6428, -0.1983);
        this.direction = defaultDirection;
        this.range = -1;

        this.color = jsToGl([1, 1, 1]);
        this.intensity = 1;

        this.position = jsToGl([0, 0, 0]);
        this.innerConeCos = 0.0;

        this.outerConeCos = Math.PI / 4;
        this.type = Type_Directional;
    }
}

class gltfLightSpot extends GltfObject
{
    static animatedProperties = ["innerConeAngle", "outerConeAngle"];
    constructor()
    {
        super();
        this.innerConeAngle = 0;
        this.outerConeAngle = Math.PI / 4;
    }
}

export { gltfLight };
