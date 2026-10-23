precision highp float;

// Only the wireframe mask is bound as draw buffer; the tonemap pass inverts the final color where it is set.
layout(location = 2) out float wireframeMask;

void main()
{
    wireframeMask = 1.0;
}
