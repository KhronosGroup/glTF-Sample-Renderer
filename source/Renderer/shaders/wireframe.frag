precision highp float;

layout(location = 0) out vec4 g_finalColor;
layout(location = 1) out uint toneMapFlag;

uniform vec4 u_WireframeColor;

void main()
{
    g_finalColor = u_WireframeColor;
    // Linear color, only converted to sRGB without tone mapping
    toneMapFlag = 1u;
}
