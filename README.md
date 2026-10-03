# gamekit

Shared runtime pieces for Third Bear's browser games and simulations (three.js + Rapier), extracted from code that was
being written several times over. Only general-purpose code lives here: no game content, art or assets.

| Package | What | README |
| --- | --- | --- |
| `@gamekit/core` | Fixed-step loop with interpolation, seeded RNG with named streams, input map with latched taps and scripted input, deterministic state hashing. Framework-free. | [core](packages/core/README.md) |
| `@gamekit/playtest` | Closed-loop Playwright bots with real key presses and mp4 video, frame-stepped deterministic capture (sheets, strips), metrics and event logs. | [playtest](packages/playtest/README.md) |
| `@gamekit/render` | Linear-HDR pipeline (AgX/ACES, selective bloom) with a bridge for display-tuned shaders, shared water and sky, curved world with bent culling and shadows, shared waves. | [render](packages/render/README.md) |
| `@gamekit/physics` | Thin Rapier helpers (2D and 3D): fixed-step bridge with interpolation, kinematic character, CCD defaults, buoyancy. | [physics](packages/physics/README.md) |

Install from git and pin a commit: `"gamekit": "github:thethirdbearsolutions/gamekit#<commit>"`, then import from
`gamekit/core`, `gamekit/render`, `gamekit/physics`, `gamekit/playtest`. `prepare` builds the packages into `lib/`.

```sh
npm install
npm test            # vitest: unit tests plus browser tests in the preinstalled Chromium (SwiftShader)
npm run build       # tsc -b into packages/*/dist
npm run examples    # http://127.0.0.1:5199/ — one example page per package
```

Docs: [docs/render/hdr.md](docs/render/hdr.md) covers why tone mapping and bloom order matters (FALLS-49).
[docs/adoption/](docs/adoption/README.md) holds per-game adoption guides.

`seed/` holds reference code the kit was extracted from (not part of the kit).
