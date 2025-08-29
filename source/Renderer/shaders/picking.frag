precision highp float;

layout(location = 0) out vec4 id_color;
uniform vec4 u_PickingColor;
in vec3 v_Position;

void main() {
    id_color = u_PickingColor;
}
