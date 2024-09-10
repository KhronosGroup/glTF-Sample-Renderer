import { mat4, vec3, quat } from 'gl-matrix';
import { GltfObject } from './gltf_object.js';

class gltfCamera extends GltfObject
{
    static animatedProperties = [];
    constructor()
    {
        super();
        this.name = undefined;
        this.node = undefined;
        this.type = "perspective";
        this.perspective = new PerspectiveCamera();
        this.orthographic = new OrthographicCamera();
    }

    fromJson(json)
    {
        super.fromJson(json);

        if (json.perspective !== undefined)
        {
            this.perspective = new PerspectiveCamera();
            this.perspective.fromJson(json.perspective);
        }
        if (json.orthographic !== undefined)
        {
            this.orthographic = new OrthographicCamera();
            this.orthographic.fromJson(json.orthographic);
        }
    }

    initGl(gltf, webGlContext)
    {
        super.initGl(gltf, webGlContext);

        let cameraIndex = undefined;
        for (let i = 0; i < gltf.nodes.length; i++)
        {
            cameraIndex = gltf.nodes[i].camera;
            if (cameraIndex === undefined)
            {
                continue;
            }

            if (gltf.cameras[cameraIndex] === this)
            {
                this.node = i;
                break;
            }
        }

        // cameraIndex stays undefined if camera is not assigned to any node
        if(this.node === undefined && cameraIndex !== undefined)
        {
            console.error("Invalid node for camera " + cameraIndex);
        }
    }

    sortPrimitivesByDepth(gltf, drawables)
    {
        // Precompute the distances to avoid their computation during sorting.
        for (const drawable of drawables)
        {
            const modelView = mat4.create();
            mat4.multiply(modelView, this.getViewMatrix(gltf), drawable.node.worldTransform);

            // Transform primitive centroid to find the primitive's depth.
            const pos = vec3.transformMat4(vec3.create(), vec3.clone(drawable.primitive.centroid), modelView);

            drawable.depth = pos[2];
        }

        // 1. Remove primitives that are behind the camera.
        //    --> They will never be visible and it is cheap to discard them here.
        // 2. Sort primitives so that the furthest nodes are rendered first.
        //    This is required for correct transparency rendering.
        return drawables
            .sort((a, b) => a.depth - b.depth);
    }

    getProjectionMatrix(aspectRatio)
    {
        const projection = mat4.create();

        if (this.type === "perspective")
        {
            mat4.perspective(
                projection,
                this.perspective.yfov,
                this.perspective.aspectRatio ?? aspectRatio,
                this.perspective.znear,
                this.perspective.zfar
            );
        }
        else if (this.type === "orthographic")
        {
            const znear = this.orthographic.znear;
            const zfar = this.orthographic.zfar;
            projection[0]  = 1.0 / this.orthographic.xmag;
            projection[5]  = 1.0 / this.orthographic.ymag;
            projection[10] = 2.0 / (znear - zfar);
            projection[14] = (zfar + znear) / (znear - zfar);
        }

        return projection;
    }

    getViewMatrix(gltf)
    {
        let result = mat4.create();
        mat4.invert(result, this.getTransformMatrix(gltf));
        return result;
    }

    getTarget(gltf)
    {
        const target = vec3.create();
        const position = this.getPosition(gltf);
        const lookDirection = this.getLookDirection(gltf);
        vec3.add(target, lookDirection, position);
        return target;
    }

    getPosition(gltf)
    {
        const position = vec3.create();
        const node = this.getNode(gltf);
        mat4.getTranslation(position, node.worldTransform);
        return position;
    }

    getLookDirection(gltf)
    {
        const direction = vec3.create();
        const rotation = this.getRotation(gltf);
        vec3.transformQuat(direction, vec3.fromValues(0, 0, -1), rotation);
        return direction;
    }

    getRotation(gltf)
    {
        const rotation = quat.create();
        const node = this.getNode(gltf);
        mat4.getRotation(rotation, node.worldTransform);
        return rotation;
    }

    getNode(gltf)
    {
        return gltf.nodes[this.node];
    }

    getTransformMatrix(gltf)
    {
        const node = this.getNode(gltf);
        if (node !== undefined && node.worldTransform !== undefined)
        {
            return node.worldTransform;
        }
        return mat4.create();

    }

    // Returns a JSON object describing the user camera's current values.
    getDescription(gltf)
    {
        const asset = {
            "generator": "gltf-sample-renderer",
            "version": "2.0"
        };

        const camera = {
            "type": this.type
        };

        if (this.name !== undefined)
        {
            camera["name"] = this.name;
        }

        if (this.type === "perspective")
        {
            camera["perspective"] = {};
            if (this.perspective.aspectRatio)
            {
                camera["perspective"]["aspectRatio"] = this.perspective.aspectRatio;
            }
            camera["perspective"]["yfov"] = this.perspective.yfov;
            if (this.perspective.zfar && this.perspective.zfar != Infinity)
            {
                camera["perspective"]["zfar"] = this.perspective.zfar;
            }
            camera["perspective"]["znear"] = this.perspective.znear;
        }
        else if (this.type === "orthographic")
        {
            camera["orthographic"] = {};
            camera["orthographic"]["xmag"] = this.orthographic.xmag;
            camera["orthographic"]["ymag"] = this.orthographic.ymag;
            camera["orthographic"]["zfar"] = this.orthographic.zfar;
            camera["orthographic"]["znear"] = this.orthographic.znear;
        }

        const mat = this.getTransformMatrix(gltf);

        const node = {
            "camera": 0,
            "matrix": [mat[0], mat[1], mat[2], mat[3],
                mat[4], mat[5], mat[6], mat[7],
                mat[8], mat[9], mat[10], mat[11],
                mat[12], mat[13], mat[14], mat[15]]
        };

        if (this.node !== undefined && gltf.nodes[this.node].name !== undefined)
        {
            node["name"] = gltf.nodes[this.node].name;
        }

        return {
            "asset": asset,
            "cameras": [camera],
            "nodes": [node]
        };
    }
}

class PerspectiveCamera extends GltfObject
{
    static animatedProperties = [
        "yfov",
        "aspectRatio",
        "znear",
        "zfar"
    ];
    constructor() {
        super();
        this.yfov = 45 * Math.PI / 180;
        this.aspectRatio = undefined;
        this.znear = 0.01;
        this.zfar = Infinity;
    }
}

class OrthographicCamera extends GltfObject
{
    static animatedProperties = [
        "xmag",
        "ymag",
        "znear",
        "zfar"
    ];
    constructor() {
        super();
        this.xmag = 1;
        this.ymag = 1;
        this.znear = 0.01;
        this.zfar = Infinity;
    }
}

export { gltfCamera };
