# Babylon.js renders the world and everything a player sees

The game was started again on Babylon.js with Babylon GUI, in place of Three.js with HTML menus, because agents build and test almost every change: one language (TypeScript) and one renderer for world and interface weighed more than reusing the old game logic (issue #3). All visible game UI is therefore drawn on the fullscreen texture `stage.hud`; the page only hosts the canvas. A picture of the canvas is then the whole game: what an agent's screenshot shows, what the tour checks and what the stream shows are the same thing.

## Consequences

- DOM elements exist only as transparent counterparts of drawn controls, for pointer input, keyboard and gamepad focus and screen readers (`src/features/hud/overlay.ts`). A test fails when another file creates one.
- Panels around the game on the stream (queue, titles, chat) are composed in OBS and stay out of this repository.
