precision highp float;

out vec4 g_finalColor;

uniform vec4 u_Color;

void main() {
    g_finalColor = vec4(u_Color);
}
