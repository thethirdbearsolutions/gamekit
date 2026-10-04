// Bridge for shaders whose colours were tuned as display values. A raw
// ShaderMaterial drawn straight to the canvas skips tone mapping and sRGB
// encoding: whatever it writes is what the screen shows. Put it through a
// linear-HDR pipeline and it gets tone mapped and encoded like everything
// else, and its look changes (FALLS-14: "flattened to pastel").
//
// gkDisplayToScene( c ) returns the scene-linear colour that the pipeline's
// ACES + sRGB turns back into exactly `c`. Wrap a display-tuned shader's
// result with it and its look survives the move unchanged, while anything
// you add afterwards (glints, glows) is genuine HDR that blooms.
// Inverts three's ACESFilmicToneMapping (r150+) and the sRGB transfer.

const IN = [0.59719, 0.0760, 0.0284, 0.35458, 0.90834, 0.13383, 0.04823, 0.01566, 0.83777]; // column-major, as in three
const OUT = [1.60475, -0.10208, -0.00327, -0.53108, 1.10813, -0.07276, -0.07367, -0.00605, 1.07602];

type M3 = number[]; // column-major 3×3
const mul = (m: M3, v: number[]) => [0, 1, 2].map((r) => m[r] * v[0] + m[3 + r] * v[1] + m[6 + r] * v[2]);
function inv(m: M3): M3 {
  const [a, b, c, d, e, f, g, h, i] = m; // columns: (a b c) (d e f) (g h i)
  const A = e * i - f * h, B = -(b * i - c * h), C = b * f - c * e;
  const D = -(d * i - f * g), E = a * i - c * g, F = -(a * f - c * d);
  const G = d * h - e * g, H = -(a * h - b * g), I = a * e - b * d;
  const det = a * A + d * B + g * C;
  return [A / det, B / det, C / det, D / det, E / det, F / det, G / det, H / det, I / det];
}
const IN_INV = inv(IN);
const OUT_INV = inv(OUT);

const rrt = (v: number) => (v * (v + 0.0245786) - 0.000090537) / (v * (0.983729 * v + 0.432951) + 0.238081);
function rrtInv(y: number): number {
  const A = 0.983729 * y - 1, B = 0.432951 * y - 0.0245786, C = 0.238081 * y + 0.000090537;
  return (-B - Math.sqrt(B * B - 4 * A * C)) / (2 * A);
}
const eotf = (c: number) => (c <= 0.04045 ? c * 0.0773993808 : Math.pow(c * 0.9478672986 + 0.0521327014, 2.4));
const oetf = (c: number) => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));

/** three's ACES + sRGB, as the pipeline applies them (JS, for tests and tools). */
export function acesDisplay(linear: number[], exposure = 1): number[] {
  const v = mul(IN, linear.map((c) => (c * exposure) / 0.6)).map(rrt);
  return mul(OUT, v).map((c) => oetf(clamp(c, 0, 1)));
}

/** Exact inverse, unclamped (may be negative: not every display colour is
 *  something ACES can produce). */
function rawInverse(display: number[], ceiling: number): number[] {
  const y = mul(OUT_INV, display.map((c) => eotf(clamp(c, 0, ceiling))));
  return mul(IN_INV, y.map((c) => rrtInv(clamp(c, 0, ceiling))));
}

/** Darkening factors tried for colours ACES can't reach. */
const SCALES = [1, 0.92, 0.85, 0.78, 0.72, 0.66, 0.6, 0.54];

/** Inverse of acesDisplay. In-gamut colours come back exactly. ACES can't
 *  show some bright saturated colours (pure green tops out near 70%
 *  brightness), so for those it picks, among a few darkenings of the colour
 *  along its own hue, the one whose clamped inverse lands closest on screen.
 *  Simply clamping negatives at full brightness bleaches greens, cyans and
 *  yellows to pastel; darkening alone over-darkens red. */
export function displayToScene(display: number[], exposure = 1, ceiling = 0.985): number[] {
  let best = rawInverse(display, ceiling);
  if (Math.min(...best) < -1e-4) {
    let bestErr = Infinity;
    for (const s of SCALES) {
      const x = rawInverse(display.map((c) => c * s), ceiling).map((c) => Math.max(0, c));
      const d = acesDisplay(x.map((c) => c * 0.6), 1);
      const err = d.reduce((e, v, i) => e + (v - display[i]) ** 2, 0);
      if (err < bestErr) { bestErr = err; best = x; }
    }
  }
  return best.map((c) => (Math.max(0, c) * 0.6) / exposure);
}

const f = (n: number) => n.toFixed(7);
const mat = (m: M3) => `mat3( ${m.map(f).join(', ')} )`;

/** GLSL mat3 literals for the inverse ACES matrices (shared with display fog). */
export const ACES_INV_GLSL = { in: mat(IN_INV), out: mat(OUT_INV) };

/** GLSL: `vec3 gkDisplayToScene( vec3 display )`, uses uniform gkExposure
 *  (set it to the pipeline's exposure; displayUniforms() provides it). */
export function displayToSceneGlsl(ceiling = 0.985): string {
  return /* glsl */ `
uniform float gkExposure;
vec3 gkAcesInverseRaw( vec3 display ) {
  vec3 c = clamp( display, 0.0, ${f(ceiling)} );
  c = mix( pow( c * 0.9478672986 + vec3( 0.0521327014 ), vec3( 2.4 ) ), c * 0.0773993808, vec3( lessThanEqual( c, vec3( 0.04045 ) ) ) );
  vec3 y = clamp( ${mat(OUT_INV)} * c, 0.0, ${f(ceiling)} );
  vec3 A = 0.983729 * y - 1.0, B = 0.432951 * y - 0.0245786, C = 0.238081 * y + 0.000090537;
  vec3 v = ( -B - sqrt( B * B - 4.0 * A * C ) ) / ( 2.0 * A );
  return ${mat(IN_INV)} * v;
}
vec3 gkAcesForward( vec3 c ) { // three's ACES + sRGB at exposure 1 (c already scaled by 1/0.6)
  c = mat3( ${IN.map(f).join(', ')} ) * c;
  c = ( c * ( c + 0.0245786 ) - 0.000090537 ) / ( c * ( 0.983729 * c + 0.4329510 ) + 0.238081 );
  c = clamp( mat3( ${OUT.map(f).join(', ')} ) * c, 0.0, 1.0 );
  return mix( pow( c, vec3( 0.41666 ) ) * 1.055 - vec3( 0.055 ), c * 12.92, vec3( lessThanEqual( c, vec3( 0.0031308 ) ) ) );
}
// Colours ACES can't reach (bright saturated primaries): try a few darkenings
// along the hue and keep the one that lands closest on screen, instead of
// bleaching to pastel. Same rule as displayToScene() in JS.
vec3 gkDisplayToScene( vec3 display ) {
  vec3 x = gkAcesInverseRaw( display );
  if ( min( x.r, min( x.g, x.b ) ) < -1e-4 ) {
    float scales[ ${SCALES.length} ] = float[]( ${SCALES.map((v) => v.toFixed(2)).join(', ')} );
    float bestErr = 1e9;
    vec3 best = vec3( 0.0 );
    for ( int i = 0; i < ${SCALES.length}; i++ ) {
      vec3 t = max( gkAcesInverseRaw( display * scales[ i ] ), 0.0 );
      vec3 d = gkAcesForward( t ) - display;
      float e = dot( d, d );
      if ( e < bestErr ) { bestErr = e; best = t; }
    }
    x = best;
  }
  return max( x, 0.0 ) * 0.6 / gkExposure;
}
// Display-tuned shaders often push glints past 1.0, where the screen clipped
// them. Keep the in-range part exact and carry the overflow on as HDR.
vec3 gkDisplayToSceneHdr( vec3 display, float gain ) {
  return gkDisplayToScene( display ) + max( display - 1.0, 0.0 ) * gain;
}
`;
}

export const displayUniforms = (exposure = 1) => ({ gkExposure: { value: exposure } });
