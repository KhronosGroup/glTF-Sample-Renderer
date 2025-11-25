precision highp float;

layout(location = 0) out uint id_color;
layout(location = 1) out uint position;

uniform uint u_PickingColor;

void main() {
    id_color = u_PickingColor;
    position = uint(gl_FragCoord.z * 4294967295.0); // mapping [0, 1] to uint
}
