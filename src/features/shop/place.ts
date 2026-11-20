// Where the Shop, its sign and its Calendar board stand, as plain numbers: the world's placement (src/world/place.ts) keeps the far meadow's trees and
// rocks clear of it, and the tests read it without building anything.

/** Where the Shop stands: on flat dry ground near the first clearing's bank, north-west of the building site, its
 *  doorway towards the middle of the Clearing (clear of the Pond, the site and the ways between them and the spawn). */
export const SHOP = { x: -9.5, z: 8.5 };
/** Metres from SHOP that the far meadow's things keep clear of: the hut and its doorway. */
export const SHOP_CLEAR = 6;
/** m: the inside of the hut's wall. */
export const RADIUS = 2.7;
/** Where the HOUSE OF AI sign stands in the shop's frame, beside the path to the doorway, turned a little towards it. */
export const SIGN = { x: 1.6, z: RADIUS + 1.6, yaw: -0.35 }; // m, m, rad
const GROWN = 0.6; // m the board's middle stands further out along its own line than the first 2.4 m board's: its edge nearest the path stayed
/** The Calendar board in the shop's frame: the sign mirrored across the path, further out for its width, turned the
 *  other way; its size, and its lower edge over the ground. */
export const CALENDAR = {
  x: -SIGN.x - 0.85 - GROWN * Math.cos(-SIGN.yaw), z: SIGN.z + GROWN * Math.sin(-SIGN.yaw), yaw: -SIGN.yaw, // m, m, rad
  width: 3.6, height: 2.1, lift: 0.75, // m
};
