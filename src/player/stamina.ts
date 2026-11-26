// Stamina, as plain logic: how long the beaver can keep running on land. Running drains it in proportion to how far
// the run is pushed; at empty the beaver is tired and may only walk until a third of it is back. It comes back
// whenever the beaver is not running, three times as fast while it gnaws a tree. Swimming, crawling and the canoe never
// use it: whoever steps it says the beaver is not on land. All times are game time.
//
//   const stamina = newStamina();
//   const run = stepStamina(stamina, dt, swimming ? 0 : input.run, { onLand: grounded && !afloat, gnawing });   // the run allowed

export const RUN_TIME = 6; // s a full run takes to empty a full stamina
export const REST_TIME = 8; // s to refill an empty stamina when not running
export const GNAW_RATE = 3; // times as fast as at rest while gnawing
export const RECOVER = 1 / 3; // the stamina back at which a tired beaver may run again

export interface Stamina { level: number; tired: boolean }
export const newStamina = (): Stamina => ({ level: 1, tired: false });

/** Once per step. run: how hard the beaver is asked to run, 0 … 1 (0 where running means nothing: swimming, crawling,
 *  the canoe); onLand: on the ground and not afloat, where a run costs (a run in a jump neither costs nor rests);
 *  gnawing: its action is a gnaw. Returns the run allowed this step: as asked, or 0 while tired. */
export function stepStamina(s: Stamina, dt: number, run: number, { onLand, gnawing }: { onLand: boolean; gnawing: boolean }): number {
  const asked = Math.max(0, Math.min(1, run));
  const allowed = s.tired ? 0 : asked;
  if (allowed > 0) { if (onLand) s.level = Math.max(0, s.level - allowed * dt / RUN_TIME); } // a run in the air holds it
  else s.level = Math.min(1, s.level + (gnawing ? GNAW_RATE : 1) * dt / REST_TIME);
  if (s.level === 0) s.tired = true;
  else if (s.tired && s.level >= RECOVER) s.tired = false;
  return allowed;
}
