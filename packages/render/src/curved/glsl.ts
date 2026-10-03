// GLSL for the bend: the same sums as BendPath, generated for its size.

export function bendGlsl(samples: number, step: number): string {
  const N = samples;
  const LAST = (samples - 1).toFixed(1);
  const STEP = step.toFixed(4);
  const RANGE = (step * (samples - 1)).toFixed(4);
  return /* glsl */ `
uniform vec3 uBendPath[ ${N} ];
uniform float uBendCut;
uniform float uBendDrop;
varying float vBendCut;
vec3 bendPathAt( float s ) {
  if ( s <= 0.0 ) return vec3( 0.0, -s, 0.0 );
  if ( s >= ${RANGE} ) {
    vec3 p = uBendPath[ ${N - 1} ];
    float e = s - ${RANGE};
    return vec3( p.x + sin( p.z ) * e, p.y - cos( p.z ) * e, p.z );
  }
  float d = clamp( s / ${STEP}, 0.0, ${LAST} );
  int i = int( floor( d ) );
  vec3 a = uBendPath[ i ];
  vec3 b = uBendPath[ i + 1 ];
  float u = ( d - float( i ) ) * ${STEP};
  float k = ( b.z - a.z ) / ${STEP};
  float h = a.z + k * u;
  if ( abs( k ) < 1e-3 ) {
    return vec3( a.x + sin( a.z ) * u + cos( a.z ) * k * u * u * 0.5, a.y - cos( a.z ) * u + sin( a.z ) * k * u * u * 0.5, h );
  }
  return vec3( a.x + ( cos( a.z ) - cos( h ) ) / k, a.y - ( sin( h ) - sin( a.z ) ) / k, h );
}
#ifdef GAMEKIT_BEND_PRE
vec4 bendPre( vec4 w );
#endif
vec4 bendWorld( vec4 w ) {
  #ifdef GAMEKIT_BEND_PRE
  w = bendPre( w );
  #endif
  #ifndef NO_BEND
  float s = -w.z;
  vec3 p = bendPathAt( s );
  w.xz = vec2( p.x + w.x * cos( p.z ), p.y + w.x * sin( p.z ) );
  w.y -= uBendDrop * dot( w.xz, w.xz );
  vBendCut = step( uBendCut, s );
  #endif
  return w;
}
vec3 bendNormal( vec3 nWorld, float s ) {
  #ifndef NO_BEND
  float bh = bendPathAt( s ).z;
  return vec3( nWorld.x * cos( bh ) - nWorld.z * sin( bh ), nWorld.y, nWorld.x * sin( bh ) + nWorld.z * cos( bh ) );
  #else
  return nWorld;
  #endif
}
`;
}
