// Original CUDA kernel https://github.com/graphdeco-inria/diff-gaussian-rasterization/blob/9c5c2028f6fbee2be239bc4c9421ff894fe4fbe0/cuda_rasterizer/forward.cu

#ifdef USE_CLIPPING
#extension GL_ANGLE_clip_cull_distance : require
#endif

precision highp float;
precision highp int;

in vec2 a_position;
in uint a_instance_sort_index;

out vec4 v_color;
out vec2 v_uv;
out vec3 v_conic;

uniform mat4 u_ProjectionMatrix;
uniform mat4 u_ViewMatrix;
uniform mat4 u_ModelMatrix;
uniform mat3 u_ModelRotationInv;
uniform uint u_TextureWidth;
uniform ivec2 u_FramebufferSize;
uniform vec2 u_FocalLength;
uniform vec3 u_Camera;

#ifdef USE_CLIPPING
// Six half spaces forming a cuboid, each pointing at the part that is kept.
uniform vec4 u_ClippingPlanes[6];
#endif

#ifdef POSITION_IS_INTEGER
uniform mediump isampler2D u_POSITIONSampler;
#elif defined(POSITION_IS_UINTEGER)
uniform mediump usampler2D u_POSITIONSampler;
#else
uniform sampler2D u_POSITIONSampler;
#endif

#ifdef ROTATION_IS_INTEGER
uniform mediump isampler2D u_ROTATIONSampler;
#else
uniform sampler2D u_ROTATIONSampler;
#endif

#ifdef SCALE_IS_UINTEGER
uniform mediump usampler2D u_SCALESampler;
#else
uniform sampler2D u_SCALESampler;
#endif

#ifdef OPACITY_IS_UINTEGER
uniform mediump usampler2D u_OPACITYSampler;
#else
uniform sampler2D u_OPACITYSampler;
#endif

uniform mediump sampler2DArray u_SHCoefficientsSampler;

#define SH_C0 0.28209479177387814

// Gaussian radius multiplier: how many standard deviations to extend the screen-space quad.
// exp(-0.5 * SPLAT_SIGMA²) gives the minimum opacity at the quad boundary.
// 3.33 → 1/255 (mathematically exact),  3.0 → 1/90  (23% smaller quads, ~40% fewer fragments).
#define SPLAT_SIGMA 3.0

#ifdef HAS_GAUSSIAN_SPLATTING_DEGREE_1
#define SH_C1_0 -0.4886025119029199
#define SH_C1_1 0.4886025119029199
#define SH_C1_2 -0.4886025119029199


#ifdef HAS_GAUSSIAN_SPLATTING_DEGREE_2
#define SH_C2_0 1.0925484305920792
#define SH_C2_1 -1.0925484305920792
#define SH_C2_2 0.31539156525252005
#define SH_C2_3 -1.0925484305920792
#define SH_C2_4 0.5462742152960396


#ifdef HAS_GAUSSIAN_SPLATTING_DEGREE_3
#define SH_C3_0 -0.5900435899266435
#define SH_C3_1 2.890611442640554
#define SH_C3_2 -0.4570457994644658
#define SH_C3_3 0.3731763325901154
#define SH_C3_4 -0.4570457994644658
#define SH_C3_5 1.445305721320277
#define SH_C3_6 -0.5900435899266435
#endif

#endif
#endif

mat3 computeC(vec3 scale, vec4 rotation)
{

    float qx = rotation.x;
    float qy = rotation.y;
    float qz = rotation.z;
    float qw = rotation.w;
    float sx = scale.x;
    float sy = scale.y;
    float sz = scale.z;

    mat3 C = mat3(
        sx * (1.0 - 2.0*(qy*qy + qz*qz)),  sx * (2.0*(qx*qy + qw*qz)),        sx * (2.0*(qx*qz - qw*qy)),
        sy * (2.0*(qx*qy - qw*qz)),        sy * (1.0 - 2.0*(qx*qx + qz*qz)),  sy * (2.0*(qy*qz + qw*qx)),
        sz * (2.0*(qx*qz + qw*qy)),        sz * (2.0*(qy*qz - qw*qx)),        sz * (1.0 - 2.0*(qx*qx + qy*qy))
    );
 
    return C;
}

vec3 computeCameraCovariance(mat3 world_covariance, vec3 view_splat_center)
{
    float x = view_splat_center.x;
    float y = view_splat_center.y;
    float z = view_splat_center.z;

    mat3 J = mat3(
        u_FocalLength.x / z, 0.0, -(u_FocalLength.x * x) / (z * z),
		0.0, u_FocalLength.y / z, -(u_FocalLength.y * y) / (z * z),
		0, 0, 0
    );

    mat3 W = transpose(mat3(u_ViewMatrix));

    // Equation 5
    mat3 T = W * J;

    mat3 cov = transpose(T) * transpose(world_covariance) * T;
    
    // Low-pass filter (EWA Splatting)
    cov[0][0] += 0.3;
    cov[1][1] += 0.3;

    return vec3(cov[0][0], cov[0][1], cov[1][1]);
}

void main()
{
    vec3 splat_center;
    ivec2 texelCoord = ivec2(a_instance_sort_index % u_TextureWidth, a_instance_sort_index / u_TextureWidth);
#if defined(POSITION_IS_INTEGER) || defined(POSITION_IS_UINTEGER)
    splat_center = vec3(texelFetch(u_POSITIONSampler, texelCoord, 0).xyz);
#ifdef POSITION_NEEDS_NORMALIZATION
#ifdef POSITION_IS_UINTEGER
    splat_center = splat_center / 65535.0; // normalize unsigned short
#else
    splat_center = max(splat_center / 32767.0, -1.0); // normalize signed short
#endif
#endif
#else
    splat_center = texelFetch(u_POSITIONSampler, texelCoord, 0).xyz;
#endif

    vec4 rotation;
#if defined(ROTATION_IS_INTEGER)
    rotation = vec4(texelFetch(u_ROTATIONSampler, texelCoord, 0).xyzw);
#ifdef ROTATION_NEEDS_NORMALIZATION
    rotation = max(rotation / 32767.0, -1.0); // normalize signed short
#endif
#else
    rotation = texelFetch(u_ROTATIONSampler, texelCoord, 0);
#endif

    vec3 scale;
#if defined(SCALE_IS_UINTEGER)
    scale = vec3(texelFetch(u_SCALESampler, texelCoord, 0).xyz);
#ifdef SCALE_NEEDS_NORMALIZATION
    scale = scale / 65535.0; // normalize unsigned short
#endif
#else
    scale = texelFetch(u_SCALESampler, texelCoord, 0).xyz;
#endif

    float opacity;
#if defined(OPACITY_IS_UINTEGER)
    opacity = float(texelFetch(u_OPACITYSampler, texelCoord, 0).x);
#ifdef OPACITY_NEEDS_NORMALIZATION
    opacity = opacity / 65535.0; // normalize unsigned short
#endif
#else
    opacity = texelFetch(u_OPACITYSampler, texelCoord, 0).x;
#endif

    splat_center = (u_ModelMatrix * vec4(splat_center, 1.0)).xyz;

#ifdef USE_CLIPPING
    // Clip the whole splat by its centre position. All four quad vertices share
    // the same splat centre, so the clip distance is constant across the quad.
    vec4 clipPosition = vec4(splat_center, 1.0);
    gl_ClipDistance[0] = dot(clipPosition, u_ClippingPlanes[0]);
    gl_ClipDistance[1] = dot(clipPosition, u_ClippingPlanes[1]);
    gl_ClipDistance[2] = dot(clipPosition, u_ClippingPlanes[2]);
    gl_ClipDistance[3] = dot(clipPosition, u_ClippingPlanes[3]);
    gl_ClipDistance[4] = dot(clipPosition, u_ClippingPlanes[4]);
    gl_ClipDistance[5] = dot(clipPosition, u_ClippingPlanes[5]);
#endif

    vec4 view_splat_center = u_ViewMatrix * vec4(splat_center, 1.0);
    vec4 clip_splat_center = u_ProjectionMatrix * view_splat_center;
    clip_splat_center /= clip_splat_center.w; // perspective division

    mat3 C = computeC(scale, rotation);
    mat3 M = mat3(u_ModelMatrix);
    mat3 world_covariance = M * C * transpose(C) * transpose(M);
    vec3 camera_covariance = computeCameraCovariance(world_covariance, view_splat_center.xyz);

    float a = camera_covariance.x; // Variance x
    float b = camera_covariance.y; // Covariance xy
    float c = camera_covariance.z; // Variance y

	float det = (a * c - b * b);
	if (det == 0.0) {
		gl_Position = vec4(0.0);
        return;
    }
    
    float det_inv = 1.0 / det;
    // Calculate the inverse of the covariance matrix
	v_conic = vec3(c * det_inv, -b * det_inv, a * det_inv);
    
    // pow(e, pow(-SPLAT_SIGMA, 2) * -0.5) gives the boundary opacity.
    // sqrt(a) and sqrt(c) are the standard deviations in x and y, so multiplying
    // by SPLAT_SIGMA gives the quad half-size in pixels at that opacity threshold.
    vec2 quad_pixel_size = vec2(SPLAT_SIGMA * sqrt(a), SPLAT_SIGMA * sqrt(c));  // screen space half quad height and width
    vec2 quad_ndc_size = quad_pixel_size / vec2(u_FramebufferSize) * 2.0;  // in ndc space
    clip_splat_center.xy = clip_splat_center.xy + a_position * quad_ndc_size;

    // Discard splats whose projected size exceeds half the screen —
    // they are almost certainly behind or very close to the camera and
    // would cause extreme overdraw with negligible visual contribution.
    float min_screen = float(min(u_FramebufferSize.x, u_FramebufferSize.y));
    float max_quad_size = max(quad_pixel_size.x, quad_pixel_size.y);
    if (max_quad_size > min_screen * 0.5)
    {
        gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
        return;
    }
    v_uv = a_position * quad_pixel_size;
    gl_Position = clip_splat_center;

    // Degree 0
    vec3 sh0 = texelFetch(u_SHCoefficientsSampler, ivec3(texelCoord, 0), 0).rgb;

#ifdef HAS_GAUSSIAN_SPLATTING_DEGREE_1
    // Degree 1
    vec3 sh1_0 = texelFetch(u_SHCoefficientsSampler, ivec3(texelCoord, 1), 0).rgb;
    vec3 sh1_1 = texelFetch(u_SHCoefficientsSampler, ivec3(texelCoord, 2), 0).rgb;
    vec3 sh1_2 = texelFetch(u_SHCoefficientsSampler, ivec3(texelCoord, 3), 0).rgb;

#ifdef HAS_GAUSSIAN_SPLATTING_DEGREE_2
    // Degree 2
    vec3 sh2_0 = texelFetch(u_SHCoefficientsSampler, ivec3(texelCoord, 4), 0).rgb;
    vec3 sh2_1 = texelFetch(u_SHCoefficientsSampler, ivec3(texelCoord, 5), 0).rgb;
    vec3 sh2_2 = texelFetch(u_SHCoefficientsSampler, ivec3(texelCoord, 6), 0).rgb;
    vec3 sh2_3 = texelFetch(u_SHCoefficientsSampler, ivec3(texelCoord, 7), 0).rgb;
    vec3 sh2_4 = texelFetch(u_SHCoefficientsSampler, ivec3(texelCoord, 8), 0).rgb;

#ifdef HAS_GAUSSIAN_SPLATTING_DEGREE_3
    // Degree 3
    vec3 sh3_0 = texelFetch(u_SHCoefficientsSampler, ivec3(texelCoord, 9), 0).rgb;
    vec3 sh3_1 = texelFetch(u_SHCoefficientsSampler, ivec3(texelCoord, 10), 0).rgb;
    vec3 sh3_2 = texelFetch(u_SHCoefficientsSampler, ivec3(texelCoord, 11), 0).rgb;
    vec3 sh3_3 = texelFetch(u_SHCoefficientsSampler, ivec3(texelCoord, 12), 0).rgb;
    vec3 sh3_4 = texelFetch(u_SHCoefficientsSampler, ivec3(texelCoord, 13), 0).rgb;
    vec3 sh3_5 = texelFetch(u_SHCoefficientsSampler, ivec3(texelCoord, 14), 0).rgb;
    vec3 sh3_6 = texelFetch(u_SHCoefficientsSampler, ivec3(texelCoord, 15), 0).rgb;
#endif
#endif
#endif

    vec3 color = sh0 * SH_C0;

#ifdef HAS_GAUSSIAN_SPLATTING_DEGREE_1

    vec3 view_dir_world = normalize(splat_center - u_Camera);
    vec3 view_dir = u_ModelRotationInv * view_dir_world;   // local-frame direction

    float x = view_dir.x;
    float y = view_dir.y;
    float z = view_dir.z;

    color +=    SH_C1_0 * y * sh1_0 + 
                SH_C1_1 * z * sh1_1 +
                SH_C1_2 * x * sh1_2;

#ifdef HAS_GAUSSIAN_SPLATTING_DEGREE_2
    float xx = x * x;
    float yy = y * y;
    float zz = z * z;
    float xy = x * y;
    float yz = y * z;
    float xz = x * z;

    color +=    SH_C2_0 * xy * sh2_0 +
                SH_C2_1 * yz * sh2_1 +
                SH_C2_2 * (2.0 * zz - xx - yy) * sh2_2 +
                SH_C2_3 * xz * sh2_3 + 
                SH_C2_4 * (xx - yy) * sh2_4;

#ifdef HAS_GAUSSIAN_SPLATTING_DEGREE_3
    color +=    SH_C3_0 * y * (3.0 * xx - yy) * sh3_0 +
                SH_C3_1 * xy * z * sh3_1 +
                SH_C3_2 * y * (4.0 * zz - xx - yy) * sh3_2 +
                SH_C3_3 * z * (2.0 * zz - 3.0 * xx - 3.0 * yy) * sh3_3 +
                SH_C3_4 * x * (4.0 * zz - xx - yy) * sh3_4 +
                SH_C3_5 * z * (xx - yy) * sh3_5 +
                SH_C3_6 * x * (xx - 3.0 * yy) * sh3_6;
#endif

#endif
#endif

    color += 0.5;

    v_color = vec4(color, opacity);
}
