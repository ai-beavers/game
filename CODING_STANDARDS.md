# Coding standards

Read during review of a change. Only judgement calls live here: what a machine can check is a test or a CI step, and `bun run check` already enforces it. Each rule names where the code shows it done right.

## Structure

- **Rules are plain logic, tested alone.** What the game decides (when a tree falls, what an animal does, which activity the stream shows, where a HUD element sits) is a pure function without rendering or physics, with a test beside it. `index.ts` only wires it to the scene. See `src/features/build/rules.ts`, `src/features/life/brain.ts`, `src/features/hud/style.ts`.
- **Parts meet in `src/contracts.ts`.** A part or feature reaches another through `game`, its events and its settings. A change that imports another feature's internals, or reads its state from `window`, needs a reason a reader can see.
- **One owner per fact.** A number, a colour or a rule that two files need is exported from the file that owns it, not copied.
- **The smallest change that does the whole task.** No option, parameter or abstraction the task did not ask for. No new dependency unless the task names it.

## Reading

- **A file starts by saying what it is for** and shows how it is called. Comments give the reason and the unit (`// s`, `// m`), not a retelling of the code.
- **Words come from `GLOSSARY.md`.** A new concept gets a name there, and one name only.
- **A known limit is marked** where it is: `// shortcut: <the limit>, <when to upgrade>`.

## Picture and cost

- **Light, fog and shadow reach every surface.** A change to them is checked on the grass, the leaves, the water and the animals too (`docs/agents/rendering.md`), at noon, at night and in rain.
- **Cost follows `settings.quality`.** A new effect has an answer for `low`. What no player can see is neither stepped nor drawn. A change that adds work to every frame says what it costs.
- **The HUD is one system.** New interface uses the tokens and regions of `src/features/hud/style.ts` and stays readable at 640x360 and on a phone, upright and sideways.

## Stations

- **A station plays like a player**: it gives input and checks what the game did. It does not call the feature's functions to get there.
- **A station's check is as strict after the change as before.** A check loosened or a station removed is part of the change only when the task changed that behavior.
- **Every player-facing behavior the change adds has a station**, named so a viewer understands it.

## Leaving it true

- `README.md`, `GLOSSARY.md` and `docs/agents/` still describe the game after the change.
- The commit message is one plain sentence saying what a player sees now.
