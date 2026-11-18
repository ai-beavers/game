## Agent skills

### Issue tracker

Issues live in GitHub Issues on `ai-beavers/game`, via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.

## Rendering rule for game UI

All visible game UI, the HUD included, is rendered by Three.js with the game's one `WebGLRenderer`: draw it in the HUD overlay scene (`stage.hud` in `src/engine.ts`, CSS pixels, drawn after the 3D picture). Do not draw game UI with HTML/CSS (no CSS-drawn markers, borders, icons or text). DOM elements may stay as invisible semantic counterparts: they place UI with CSS layout, take clicks, taps and keyboard focus, and carry accessibility labels, while Three.js draws what is seen there (see `src/features/hud/map-display.ts`). Painting a 2D canvas and using it as a Three.js texture is fine. The stream overlay is separate and not game UI. The map is migrated; the rest of the HUD is still HTML and moves over piece by piece, so new or changed game UI goes to Three.js.
