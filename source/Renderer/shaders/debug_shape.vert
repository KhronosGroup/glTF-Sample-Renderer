uniform mat4 u_ViewProjectionMatrix;
uniform mat4 u_ModelMatrix;

in vec3 a_position;

void main()
{
    gl_Position = u_ViewProjectionMatrix * u_ModelMatrix * vec4(a_position, 1.0);
}
