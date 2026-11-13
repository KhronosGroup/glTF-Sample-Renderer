// How many indexed attribute sets the shaders carry.
//
// glTF 2.1 places no limit on texture coordinate or colour set indices, but every set a
// primitive provides costs a vertex attribute and a varying, so the renderer declares a
// budget and drops the rest with a warning. The shaders size their arrays from these, so
// this is the only place to change: raising the number does not need a shader edit.
//
// Clamped down at startup if the GPU reports a smaller budget than this asks for.
const MAX_TEXCOORD_SLOTS = 4;

// One, because nothing in the renderer reads a second colour set.
const MAX_COLOR_SLOTS = 1;

export { MAX_COLOR_SLOTS, MAX_TEXCOORD_SLOTS };
