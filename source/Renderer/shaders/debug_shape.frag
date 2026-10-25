precision highp float;

layout(location = 0) out vec4 g_finalColor;
layout(location = 1) out uint toneMapFlag;

uniform vec4 u_Color;

void main()
{
    g_finalColor = u_Color;
    // 0 leaves the colour untouched in the final pass: a debug colour is picked to be
    // read off the screen, so tonemapping it would defeat the purpose.
    toneMapFlag = 0u;
}
