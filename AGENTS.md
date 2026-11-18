## Where to look

- **Verifying a change** (pictures, address switches, the tour, ports, measuring): `docs/agents/verify.md`.
- **Anything drawn** (materials, lights, shaders, the HUD, the Babylon.js reference): `docs/agents/rendering.md`.

## Visible game UI

Draw everything a player sees with Babylon.js: Babylon GUI on `stage.hud`, built with `Overlay` from `src/features/hud/overlay.ts`. The stream's panels around the game are composed in OBS.

## Stations

New player-facing behavior gets a playable station in `src/features/tour/stations/`. Play it with `?play&tour=fast&station=Name`. A station with an activity name joins that activity in the live tour; one without becomes its own activity.

## Agent skills

### Issue tracker

Issues and specs live in GitHub Issues on `ai-beavers/game`, via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.
