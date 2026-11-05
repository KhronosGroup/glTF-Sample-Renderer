precision highp float;

layout(location = 0) out vec4 g_finalColor;

void main()
{
    // Depth-only pass. The framebuffer has no color attachment, so this write is
    // discarded and only the rasterized depth is stored.
    g_finalColor = vec4(1.0);
}
