# Buildergame

A voxel building game for the browser: Vite, TypeScript (strict), Three.js. Structures and worlds
are shareable JSON files (see `docs/FILE_FORMATS.md`). "Wild worlds" add a simulation: grass,
water, day and night, rabbits and wolves. It lives in `src/sim/`, which is pure and seeded, with no
DOM or Three.js imports.

## Checks

Run these before pushing:

- `npm run typecheck`
- `npm test`: Vitest, `tests/unit`.
- `npm run build`
- `npm run e2e`: Playwright, `tests/e2e`. It falls back to a preinstalled Chromium when downloads
  are unavailable.

CI runs the same steps, and the Pages workflow deploys `main` to GitHub Pages. The site is static,
with no server.

## AI features: use the TypeSafe skill

The project enables the `typesafe@typesafe-ai` plugin in `.claude/settings.json`. When a feature
needs semantic judgment, use the TypeSafe skill (`/typesafe:typesafe-ai`), for example:
- turning a player's natural-language request into a structure choice or placement;
- ranking or tagging shared structures;
- checking a build against a described goal.

Keep rules the code already knows in code: collision, path-finding, needs, safety.

- **Keep the simulation deterministic.** Never call a model inside an `src/sim` tick. A judgment
  enters as an input or event outside the tick, and is saved with the world if it must replay.
- **Keep credentials server-side.** The game ships as static files, so a TypeSafe feature needs a
  small server-side proxy. Never put an API key in the Vite bundle or a `VITE_*` variable.
- **Read the live docs first.** Before writing an integration, read `https://docs.typesafe.ai`,
  starting with `llms.txt`. In Claude Code cloud sessions that host must be allowed in the
  environment's network settings. If it isn't, say so rather than guessing API details.

The Warren Defense test bots in `bots/` are the project's TypeSafe feature (see `bots/README.md`).
They run in Node only. A unit test fails if anything under `src/` imports the SDK or reads
`TYPESAFE_API_KEY`.
