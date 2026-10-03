// Copies each package's build into lib/<package>/ so the repo root installs
// from git as one package: import from 'gamekit/core', 'gamekit/render', ...
// (npm leaves workspace folders out of the root package).
import { cp, rm } from 'node:fs/promises';

await rm('lib', { recursive: true, force: true });
for (const p of ['core', 'render', 'physics', 'playtest']) await cp(`packages/${p}/dist`, `lib/${p}`, { recursive: true });
