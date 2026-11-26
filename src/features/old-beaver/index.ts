// The Old Beaver: an old, grey-muzzled beaver who sits hidden at the foot of the bank, among the trees at the
// Clearing's edge, always in the same place (rules.ts PLACE). Nothing on the map shows him. When the player's beaver
// comes within a few metres on land he turns to it and tells a Lore, line by line: each line said from where he sits
// and shown in a speech box in the HUD under his name, with a speaker over his head while he talks (panel.ts). Coming back after walking off, he tells the next
// lore, and after the last the first again. Walking out of earshot mid-lore he stops with a closing word and turns back; going
// into the water near him mid-lore, he only falls quiet.
//
//   import { create as oldBeaver } from "./features/old-beaver/index.ts";
//
// In a shared world he tells once for everyone (docs/adr/0010): the room keeps his visit (telling.ts, run by
// src/features/net/room.ts), this page only says how near its player is (the oldBeaverNear event) and follows what
// the room tells (oldBeaverTold). Where the server speaks (it holds the key; the Bun server is also told to, by
// `bun dev`) he says a lore's lines in his Voice, which the server sends as it is made (voice.ts) and the audio
// feature plays; else, and for his closing word, each page in earshot murmurs them, one slow syllable a word (the
// oldBeaverSpeaks event). Without a server only the local player's beaver drives him, by the same rules, and he
// murmurs. Nothing is kept: the lores start at the first whenever the room, or the page alone, starts. He is no
// Animal: he never flees and is not saved; a small fixed collider keeps beavers from walking through him.
//
// Debug, for bun shot --eval and the tour (window.oldBeaver): .place (where he sits) · .state (idle, telling, away) ·
// .lore · .line (the lore and line told now) · .said (the line in the speech box) · .spoken (lines begun so far) ·
// .facing (radians he faces) · .faces() (how far, radians, he is turned from the player's beaver) · .loaded ·
// .reset() (the speech box cleared; alone, a visit anew too: idle, the first lore next. A room's visit is not this
// page's to start anew).
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import type { CreateFeature } from "../../game.ts";
import { cylinder } from "../../physics.ts";
import { oldBeaver } from "./creature.ts";
import { speechBox } from "./panel.ts";
import { CLOSING, CLOSING_LINE, COLLIDER, EARSHOT, lineTime, LORES, nearOf, NEARS, newVisit, PLACE, REST, SYLLABLE, tell, words, type Happening, type Told } from "./rules.ts";

const HEARD = NEARS.indexOf("heard"); // from here on a player hears him: it reads his lines, and he faces it while he tells

const NEAR = 30; // m: within this he breathes and moves (his fur thins with distance by itself)
const TURN = 2.2; // how fast he turns, 1/s (eased)
const SEAT = 0.35; // m: half his sitting height, the collider's half-height and where his voice comes from above the ground
const HEAD = 1.05; // m over the ground: just over his head, where the speaker floats while he talks
// Cost per frame: one more furred beaver drawn, as Mrs. Beaver is; his pose and fur stepped only within NEAR, and the
// telling a few numbers.

/** The angle from a to b, wrapped to -π … π. */
const turnBetween = (a: number, b: number) => Math.atan2(Math.sin(b - a), Math.cos(b - a));

export const create: CreateFeature = (game) => {
  const { stage, world, player, events } = game;
  const ground = world.heightAt(PLACE.x, PLACE.z), place = new Vector3(PLACE.x, ground + SEAT, PLACE.z), head = new Vector3(PLACE.x, ground + HEAD, PLACE.z);
  stage.physics.fixed(cylinder(stage.scene, SEAT, COLLIDER, { x: PLACE.x, y: ground + SEAT, z: PLACE.z }));

  let him: Awaited<ReturnType<typeof oldBeaver>> | undefined, facing = REST;
  void oldBeaver(stage).then((h) => {
    him = h;
    h.beaver.root.position.set(PLACE.x, ground, PLACE.z);
    h.beaver.root.rotation.y = facing;
  });

  const box = speechBox(stage);
  let visit = newVisit(), closing = 0, spoken = 0, line = 0;
  /** In a room: what it told last, how near this page last said its player is (NEARS), and whether this player
   *  heard a line of the lore told now (then his closing word is for it too). */
  let room: Told | undefined, near = -1, heard = false;
  /** He begins a line (or his closing word) from where he sits: murmured, or in his voice when the server sends it.
   *  shown: it shows under his name, for a player in earshot; a player out of earshot hears no murmur either. */
  const speak = (text: string, shown = true, voice = false) => {
    if (shown) box.say(text);
    spoken++;
    events.emit("oldBeaverSpeaks", { place: place.clone(), words: voice || !shown ? 0 : words(text), syllable: SYLLABLE, earshot: EARSHOT });
  };
  /** He falls silent: the speech box clears and the murmur or his voice stops mid-line. */
  const hush = () => {
    closing = 0;
    box.say("");
    events.emit("oldBeaverSpeaks", { place: place.clone(), words: 0, syllable: SYLLABLE, earshot: EARSHOT });
  };
  const act = (h: Happening, land: boolean) => {
    if (h.kind === "line") { closing = 0; line = h.line; speak(h.text); }
    // Walked off, his closing word; gone into the water or the canoe near him, he only falls quiet (and his box
    // never sits on the breath's, which shares its place).
    else if (h.kind === "broke") { if (land) { closing = lineTime(CLOSING); speak(CLOSING); } else hush(); }
    else if (h.kind === "ended") box.say("");
  };
  const away = () => Math.hypot(player.feet.x - PLACE.x, player.feet.z - PLACE.z);
  const towardsPlayer = () => Math.atan2(player.feet.x - PLACE.x, player.feet.z - PLACE.z);
  const onLand = () => !player.afloat && !player.riding;

  // The room tells for everyone in the world (src/features/net passes it on): every page hears him from where he
  // sits, and those in earshot on land read the line. Without the room he tells this page's player alone.
  events.on("oldBeaverTold", ({ told }) => {
    if (!told) { room = undefined; visit = newVisit(); hush(); return; }
    if (!room) { visit = newVisit(); near = -1; } // the room's visit from here on: it hears at once how near this player is
    room = told;
    if (told.say === undefined) { if (told.state !== "telling") { heard = false; hush(); } return; } // a lore ended, or he fell quiet
    const text = told.say === CLOSING_LINE ? CLOSING : LORES[told.lore]?.[told.say];
    if (text === undefined) return; // a server of another build, with other lores
    const shown = told.say === CLOSING_LINE ? heard && onLand() : near >= HEARD;
    closing = told.say === CLOSING_LINE && shown ? lineTime(CLOSING) : 0;
    if (told.say === CLOSING_LINE) heard = false; else { line = told.say; heard ||= shown; }
    speak(text, shown, told.voice);
  });

  Object.assign(window, {
    oldBeaver: {
      place: { x: PLACE.x, z: PLACE.z },
      get state() { return (room ?? visit).state; },
      get lore() { return (room ?? visit).lore; },
      get line() { return line; },
      get said() { return box.said; },
      get spoken() { return spoken; },
      get facing() { return facing; },
      get loaded() { return !!him; },
      faces: () => Math.abs(turnBetween(facing, towardsPlayer())),
      reset() { if (!room) visit = newVisit(); closing = 0; box.say(""); },
    },
  });

  return {
    step(dt) {
      const land = onLand();
      if (room) {
        const now = nearOf(away(), land);
        if (now !== near) events.emit("oldBeaverNear", { near: near = now });
        if (near < HEARD && closing <= 0 && box.said) box.say(""); // out of earshot while he tells the others
      } else for (const h of tell(visit, { distance: away(), land }, dt)) act(h, land);
      if (closing > 0 && (closing -= dt) <= 0) box.say("");
    },
    update(dt) {
      box.update();
      // For a player who hears him: while he tells, and while he says his closing word.
      const telling = room ? room.state === "telling" && near >= HEARD : visit.state === "telling";
      box.speaker(!!him && (telling || closing > 0), head);
      if (!him || stage.paused) return;
      // Turned to the player's beaver while he tells (and says his closing word), back to rest after.
      // shortcut: in a room each page turns him to its own player when that one listens, so two players see him
      // face two ways; send whom he tells to when that is noticed.
      const target = telling || closing > 0 ? towardsPlayer() : REST;
      facing += turnBetween(facing, target) * (1 - Math.exp(-TURN * dt));
      him.beaver.root.rotation.y = facing;
      if (away() < NEAR) him.update(dt);
    },
  };
};
