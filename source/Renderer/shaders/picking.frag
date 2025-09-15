precision highp float;

layout(location = 0) out vec4 id_color;
layout(location = 1) out uint position;

uniform vec4 u_PickingColor;
in vec3 v_Position;

void main() {
    id_color = u_PickingColor;
    position = uint(gl_FragCoord.z * 4294967295.0); // mapping [0, 1] to uint
}
