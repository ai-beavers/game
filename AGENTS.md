## Agent skills

### Issue tracker

Issues live in GitHub Issues on `ai-beavers/game`, via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.

## Rendering rule for game UI

Render the world and all visible game UI with Babylon.js. Use the fullscreen Babylon GUI texture `stage.hud` for menus, HUD and touch controls. Use `src/features/hud/overlay.ts` for interactive controls with transparent DOM counterparts for pointer input, keyboard focus and screen readers. The stream composition lives in OBS.

## Playable feature tests

Add a playable station in `src/features/tour/index.ts` for new player-facing behavior. Use `?play&tour=fast&station=Name` to test it in the feature branch. A station with an activity name joins that activity in live mode. A standalone station becomes its own live activity.
