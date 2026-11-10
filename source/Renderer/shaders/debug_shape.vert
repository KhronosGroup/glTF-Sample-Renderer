uniform mat4 u_ViewProjectionMatrix;
uniform mat4 u_ModelMatrix;
uniform float u_DepthBias;

in vec3 a_position;

void main()
{
    vec4 clip = u_ViewProjectionMatrix * u_ModelMatrix * vec4(a_position, 1.0);
    // Pull coincident debug shapes towards the viewer so they draw in front of the
    // geometry they describe. Polygon offset is unreliable for line primitives on some
    // drivers, so bias in clip space instead, where it applies to every primitive type.
    clip.z -= u_DepthBias * clip.w;
    gl_Position = clip;
}
