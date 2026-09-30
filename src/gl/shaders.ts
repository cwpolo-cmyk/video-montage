/**
 * All shaders use a full-screen triangle pair. `v_uv` is (0,0) at the TOP-LEFT of
 * the image regardless of render target: `u_flipY` = 1 when drawing to the canvas
 * (GL origin bottom-left), 0 when drawing into a texture (row 0 = image top).
 */
export const VERT = /* glsl */ `#version 300 es
in vec2 a_pos;
uniform float u_flipY;
out vec2 v_uv;
void main() {
  float y = mix(a_pos.y * 0.5 + 0.5, 0.5 - a_pos.y * 0.5, u_flipY);
  v_uv = vec2(a_pos.x * 0.5 + 0.5, y);
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

/** Maps an upright display uv to the coded-frame uv for a clockwise rotation. */
const ROTATE = /* glsl */ `
uniform int u_rotation;
vec2 codedUv(vec2 d) {
  if (u_rotation == 90) return vec2(d.y, 1.0 - d.x);
  if (u_rotation == 180) return vec2(1.0 - d.x, 1.0 - d.y);
  if (u_rotation == 270) return vec2(1.0 - d.y, d.x);
  return d;
}`;

/** Pass 1 for anything the browser can decode to RGB itself (SDR video, photos). */
export const FRAG_UPRIGHT_RGB = /* glsl */ `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_tex;
${ROTATE}
out vec4 o;
void main() {
  o = vec4(texture(u_tex, codedUv(v_uv)).rgb, 1.0);
}`;

/**
 * Pass 1 for raw 10/12-bit planar YCbCr with HLG or PQ transfer. Mirrors src/gl/color.ts.
 */
export const FRAG_UPRIGHT_HDR = /* glsl */ `#version 300 es
precision highp float;
precision highp usampler2D;
in vec2 v_uv;
uniform usampler2D u_y;
uniform usampler2D u_u;
uniform usampler2D u_v;
uniform vec2 u_size;       // coded luma size
uniform vec2 u_chromaDiv;  // (2,2) for 4:2:0, (2,1) 4:2:2, (1,1) 4:4:4
uniform float u_codeScale; // converts code values to 10-bit (1.0 for 10-bit, 0.25 for 12-bit)
uniform int u_transfer;    // 1 = HLG, 2 = PQ
${ROTATE}
out vec4 o;

const float HLG_A = 0.17883277;
const float HLG_B = 0.28466892;
const float HLG_C = 0.55991073;
const float KNEE = 0.75;
const float REF_WHITE = 203.0;

float hlgInv(float e) {
  e = max(e, 0.0);
  return e <= 0.5 ? e * e / 3.0 : (exp((e - HLG_C) / HLG_A) + HLG_B) / 12.0;
}
float pqEotf(float e) {
  const float m1 = 2610.0 / 16384.0;
  const float m2 = 2523.0 / 4096.0 * 128.0;
  const float c1 = 3424.0 / 4096.0;
  const float c2 = 2413.0 / 4096.0 * 32.0;
  const float c3 = 2392.0 / 4096.0 * 32.0;
  float p = pow(max(e, 0.0), 1.0 / m2);
  return 10000.0 * pow(max(p - c1, 0.0) / (c2 - c3 * p), 1.0 / m1);
}
float srgb(float x) {
  x = clamp(x, 0.0, 1.0);
  return x <= 0.0031308 ? 12.92 * x : 1.055 * pow(x, 1.0 / 2.4) - 0.055;
}
float fetch(usampler2D t, vec2 px, vec2 size) {
  ivec2 p = ivec2(clamp(px, vec2(0.0), size - 1.0));
  return float(texelFetch(t, p, 0).r) * u_codeScale;
}
float chroma(usampler2D t, vec2 lumaPx) {
  // Bilinear chroma upsampling (co-sited left, centered vertically for 4:2:0).
  vec2 csize = ceil(u_size / u_chromaDiv);
  vec2 c = lumaPx / u_chromaDiv - vec2(0.0, 0.5 * (u_chromaDiv.y - 1.0) / u_chromaDiv.y);
  vec2 f = fract(c);
  vec2 b = floor(c);
  float a00 = fetch(t, b, csize);
  float a10 = fetch(t, b + vec2(1.0, 0.0), csize);
  float a01 = fetch(t, b + vec2(0.0, 1.0), csize);
  float a11 = fetch(t, b + vec2(1.0, 1.0), csize);
  return mix(mix(a00, a10, f.x), mix(a01, a11, f.x), f.y);
}
void main() {
  vec2 px = codedUv(v_uv) * u_size - 0.5;
  float Y = (fetch(u_y, floor(px + 0.5), u_size) - 64.0) / 876.0;
  float U = (chroma(u_u, px) - 512.0) / 896.0;
  float V = (chroma(u_v, px) - 512.0) / 896.0;
  vec3 e = vec3(Y + 1.4746 * V, Y - 0.16455 * U - 0.57135 * V, Y + 1.8814 * U);

  vec3 lin;
  if (u_transfer == 1) {
    vec3 s = vec3(hlgInv(e.r), hlgInv(e.g), hlgInv(e.b));
    float ys = dot(s, vec3(0.2627, 0.678, 0.0593));
    lin = s * pow(max(ys, 1e-6), 0.2) * (1000.0 / REF_WHITE);
  } else {
    lin = vec3(pqEotf(e.r), pqEotf(e.g), pqEotf(e.b)) / REF_WHITE;
  }
  // BT.2020 -> BT.709 (row-major in color.ts; GLSL mat3 is column-major).
  mat3 m = mat3(1.6605, -0.1246, -0.0182,
                -0.5876, 1.1329, -0.1006,
                -0.0728, -0.0083, 1.1187);
  vec3 c = max(m * lin, 0.0);
  float mx = max(c.r, max(c.g, c.b));
  if (mx > KNEE) {
    float r = KNEE + (1.0 - KNEE) * tanh((mx - KNEE) / (1.0 - KNEE));
    c *= r / mx;
  }
  o = vec4(srgb(c.r), srgb(c.g), srgb(c.b), 1.0);
}`;

/** Pass 2: draw an upright source into the output with a source-space crop rect. */
export const FRAG_LAYER = /* glsl */ `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_tex;
uniform vec4 u_rect; // x, y, w, h in normalized source space
uniform float u_opacity;
out vec4 o;
void main() {
  vec2 uv = u_rect.xy + v_uv * u_rect.zw;
  o = vec4(texture(u_tex, uv).rgb, u_opacity);
}`;
