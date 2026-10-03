# gamekit

Shared runtime pieces for Third Bear's browser games and simulations (three.js + Rapier), extracted from code
that was being written several times over: fixed-step game loop, seeded randomness, input mapping, closed-loop
playtest bots with video capture, and a rendering kit (water, sky, tone mapping) for the 3D games.

Only general-purpose code lives here — no game content, art or assets.

`seed/` holds reference code to extract from (it is not part of the kit):
- `canopy-playtest-bot.mjs` — the closed-loop Playwright bot that played the three tree-climbing prototypes
  in real time with real key presses and recorded video (game-specific; to be generalised).
