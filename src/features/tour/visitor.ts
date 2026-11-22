// A visitor for the tour: a second beaver, a Bot, that joins the Tour's world from the tour's own page over the same
// WebSocket and messages as any client (src/features/net/protocol.ts). It stands still where it is put, sends its
// standing Motion at the usual rate, turns when told and says a line; it never sends build changes, so it cannot
// touch the Tour's world's work. The Bot program (src/features/net/bot.ts) is a Bun tool and cannot run in the page.
//
//   const visitor = await visit("Visitor");    joined: visitor.id, visitor.name (the name the server gave it)
//   visitor.stand(at, facing)    from now on it stands there, sending its state at SEND_RATE
//   visitor.seen(id)             where another player was last said to be (its state messages), or undefined
//   visitor.face(f) · visitor.say("Hello!") · visitor.close()
import { newMotion } from "../../player/state.ts";
import { PATH, SEND_RATE, TOUR_WORLD, packMotion, uniqueName, type ClientMessage, type ServerMessage } from "../net/protocol.ts";

const JOIN_TIME = 5; // s the server has to welcome it

export interface Visitor {
  /** Its player id and the name the server gave it. */
  id: number; name: string;
  stand(at: { x: number; y: number; z: number }, facing: number): void;
  seen(id: number): { x: number; z: number } | undefined;
  face(facing: number): void;
  say(text: string): void;
  close(): void;
}

export function visit(name: string): Promise<Visitor> {
  const socket = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}${PATH}?world=${TOUR_WORLD}`);
  const send = (m: ClientMessage) => { if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(m)); };
  const others = new Map<number, { x: number; z: number }>(), motion = { ...newMotion(), grounded: true };
  const r = (v: number) => Math.round(v * 1000) / 1000, started = performance.now();
  let timer: ReturnType<typeof setInterval> | undefined;
  const close = () => { clearInterval(timer); socket.close(); };
  return new Promise<Visitor>((done, fail) => {
    const give = setTimeout(() => { close(); fail(new Error(`the server did not welcome the visitor in ${JOIN_TIME} s`)); }, JOIN_TIME * 1000);
    socket.onopen = () => send({ t: "hello", name, bot: true });
    socket.onerror = () => { clearTimeout(give); close(); fail(new Error("the visitor's socket could not open")); };
    socket.onclose = () => { clearTimeout(give); clearInterval(timer); fail(new Error("the server closed the visitor's socket")); };
    socket.onmessage = (e) => {
      if (typeof e.data !== "string") return; // the Old Beaver's voice
      const m = JSON.parse(e.data) as ServerMessage;
      if (m.t === "full") { clearTimeout(give); close(); fail(new Error(`the Tour's world is full (${m.players}/${m.max})`)); return; }
      if (m.t === "state") others.set(m.id, { x: m.p[0], z: m.p[2] });
      if (m.t === "leave") others.delete(m.id);
      if (m.t !== "welcome") return;
      clearTimeout(give);
      // The welcome names the others; the server gave this one its name by the same rule.
      let at = { x: 0, y: 0, z: 0 }, facing = 0;
      const visitor: Visitor = {
        id: m.id, name: uniqueName(name, m.players.map((p) => p.name)),
        stand(place, f) {
          at = place; facing = f;
          timer ??= setInterval(() => {
            motion.time = (performance.now() - started) / 1000; // its clock goes on: not "away"
            send({ t: "state", p: [r(at.x), r(at.y), r(at.z)], f: r(facing), m: packMotion(motion), c: -1 });
          }, 1000 / SEND_RATE);
        },
        seen: (id) => others.get(id),
        face(f) { facing = f; },
        say(text) { send({ t: "chat", text }); },
        close,
      };
      done(visitor);
    };
  });
}
