# CLAUDE.md — Klynge

Read `AGENTS.md` first; it applies in full.

## Context
- Authority: deterministic engine → agent → user. AI is never a source of market truth or trade signals.
- The engine (`src/klynge/`) is TypeScript run via Node ≥22.18 type stripping. Use `.ts` import extensions, `import type`, and erasable syntax only (no enums or namespaces).
- The landing is static HTML/CSS with a small progressive-enhancement script. There is no framework.

## Working style
- Make surgical edits. Brand assets are generated, so edit `src/brand/tokens.json` or `scripts/brand/*` and run `npm run brand`. Never hand-edit generated SVG/CSS.
- Before finishing, run `npm run check` (typecheck, lint + boundary scan + brand drift, tests, build, QA).
- Check new public copy against `docs/COPY_AND_DISCLOSURE.md` and `docs/policies/public-boundary.md`.
- Get explicit approval before adding frameworks, trackers or external fonts.
