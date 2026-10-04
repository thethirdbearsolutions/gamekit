# Linear HDR, tone mapping and bloom: why the order matters

FALLS-49 (bloom and tone mapping in waterfall-falls, reverted) is the common way these pipelines break. I haven't read
waterfall-falls yet (no repo access), so this note covers the mechanism. The specific fix will be confirmed against its code.

## The one correct order

1. Every material writes **scene-linear** radiance into a **half-float** target. Values above 1 are fine and expected:
   sun glints, lamps, the bright lip of a waterfall.
2. Bloom is computed from that linear HDR image and **added in linear**.
3. Exposure, then a tone map (AgX, ACES or Neutral) compresses HDR into display range, **once**.
4. sRGB encoding, **once**, as the last step. Optional dither hides banding in skies.

`HdrPipeline` does exactly this. three helps: when drawing into a render target it skips tone mapping and sRGB encoding
for every material, built-in or custom (the `tonemapping_fragment` and `colorspace_fragment` includes become no-ops).

## How it goes wrong

| Symptom | Cause | What the pipeline or `auditShaders` does |
| --- | --- | --- |
| Custom water/sky looks washed out or flat next to standard materials once post-processing is on | Shader applies `pow(c, 1/2.2)` or its own tone curve, then the output pass encodes again | Audit flags `manual-gamma` and `manual-tonemap`. Write linear. |
| Everything near white blooms; highlights look grey; contrast collapses | Bloom runs after tone mapping, on LDR, so a threshold of 0.8 catches skies and foam | Bloom runs on linear HDR, before tone mapping. Threshold 1 means "brighter than diffuse white". |
| Bloom never triggers on custom shaders | Shader clamps output to [0,1], or renders to an 8-bit target | Audit flags `clamped-output`. Targets are half-float. |
| Selective bloom breaks custom shaders (uniforms lost, wrong look, flicker) | The usual three example swaps every non-bloom material to black and back each frame | Selected objects draw with their own materials over a depth-only pass. Nothing is swapped. |
| Colours shift when post-processing is toggled | Tone mapping on the renderer and again in an output pass | The renderer's `toneMapping` is set to `NoToneMapping`. The final pass alone tone maps. |

## Tests

`packages/render/test/hdr.test.ts` renders the same mid-grey through three's own AgX path, through the pipeline with a
built-in material and through the pipeline with a bare custom shader. All three agree within 2/255. Selective bloom glows
around the selected object, leaves an equally bright unselected one alone, and doesn't change the custom shader's pixels.

## Content that can't go through tone mapping: the display pass

Some content was made for three's direct path and can't survive a tone mapper unchanged:

- **Bright saturated colours.** ACES cannot show pure green above about 70% brightness, or saturated yellow above
  about 60%. A raw shader that skipped tone mapping could, and falls' rainbows were made that way.
  `gkDisplayToScene` picks the closest colour ACES can show along the same hue (green 30,184,17; red 235,0,14).
  That is close, but not the same.
- **Translucent veils.** A 60%-opaque white sheet over dark rock looks one way blended on screen and another way
  blended in linear light. It reads as solid in linear.

`HdrPipeline({ display: { transparent: true } })` (or `display.layer` for chosen objects) draws such content
**after** tone mapping. The opaque scene fills the depth buffer, then three's own direct path draws these objects:
its tone mapping, sRGB, fog, blending and transparent sorting. That is exactly the look they were made for. GPU test:
within 3/255 of three's direct render, saturated bands included.

They can still feed bloom. A shader that ends with `gl_FragColor = gkOverlayOut( col, alpha, glow )` and sits on the
bloom layer contributes `glow` (scene-linear) to the bloom source.

The trade-off: display-pass objects aren't lit or bloomed by the HDR pass beyond their own glow, and they always draw
over transparent HDR-pass objects. Use the display pass for content that was made display-referred. Author new content
in linear.

waterfall-falls uses this (see its `docs/gamekit-adoption/`). The first migration used only the bridge, and an
independent review caught the lost rainbow bands and solid sheets that this pass fixes.
