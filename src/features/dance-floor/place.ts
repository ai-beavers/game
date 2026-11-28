// Where the Dance floor lies: plain numbers, so the world's placement (src/world/place.ts) keeps the far meadow's trees,
// stumps, logs and rocks clear of it and the tests read it without building anything. Out in the east of the far
// meadow, just short of the clearing's bank, on flat dry ground: far from the Pond, the building site and the Shop
// (which stands in the west), and off the ways between them and the spawn.
//
//   FLOOR          its middle, half its width (a square along the world's axes) and its tiles a side
//   FLOOR_CLEAR    m from the middle that the far meadow's things keep clear of
//   TILE_COLOURS   the tiles' colours, in turn along the rows (the floor and the HUD map's mark)

/** The floor: its middle, m; half its side, m; tiles along each side. */
export const FLOOR = { x: 25.4, z: -9.6, half: 2, tiles: 5 };
/** m from FLOOR's middle that the far meadow's things keep clear of: the floor's corners and a step round it. */
export const FLOOR_CLEAR = 4.2;
/** m a tile's side, with its grout. */
export const TILE = (2 * FLOOR.half) / FLOOR.tiles;
/** The tiles' colours (0xrrggbb), in turn along the rows: not the Shop's purple and gold. */
export const TILE_COLOURS = [0xff3d8b, 0x2fd4ff, 0xffd23a, 0x5cff6a, 0xff7a2a, 0xb06bff];
