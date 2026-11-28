// Where the Top-ten board stands: plain numbers, so the bots (net/botworld.ts) steer round it as the beaver bumps into
// it. At the south edge of the building site, east of where the worn path comes up to it, its face turned to the
// path's end and the site, so a beaver walking up the path or building at the dam sees it. Clear of the dam and its
// slots, the crates, the Flag, the Campfire, Mrs. Beaver's waiting spot and her ways, and the trading post behind it
// (place.test.ts checks them).
//
//   BOARD                  its middle on the ground, the way its face looks (yaw, as Player.facing: 0 is +z), its size
//   FRONT · ALONG          unit vectors on the ground: out of its face, and along it
//   READ_AT                m out in front of its face where a beaver stands to read it
//   footprint()            circles over its length, for steering
/** x, z: m; yaw: radians; width and height of the face, and its lower edge over the ground, m. */
export const BOARD = { x: 0.0, z: 1.45, yaw: -0.8, width: 1.4, height: 1.2, lift: 0.4 };
export const FRONT = { x: Math.sin(BOARD.yaw), z: Math.cos(BOARD.yaw) };
export const ALONG = { x: FRONT.z, z: -FRONT.x };
/** m from the face to the back of the posts: the board's depth on the ground. */
export const DEPTH = 0.16;
/** m out in front of the face where a beaver stands to read it. */
export const READ_AT = 2.6;

/** Circles over the board along its width, for whatever steers round it. */
export const footprint = () => [-1, -0.5, 0, 0.5, 1].map((d) => ({
  x: BOARD.x + ALONG.x * d * (BOARD.width / 2 - 0.1), z: BOARD.z + ALONG.z * d * (BOARD.width / 2 - 0.1), r: 0.2,
}));
