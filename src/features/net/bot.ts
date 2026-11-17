// Bots: players without a browser that join over the WebSocket, walk in circles near the spawn, run now and then,
// jump and chat. To fill the world when trying the game alone, and for tests.
//
//   bun src/features/net/bot.ts                                   one bot on ws://localhost:5180/net
//   bun src/features/net/bot.ts ws://192.168.1.20:5180/net --count 3 --name Bot --radius 3 --at -1.5,-3 --quiet
//
// Each bot keeps its own circle (around --at, spread out) and says a line from LINES after a few seconds, then every 12–25 s (--quiet: never).
// Ctrl-C ends them.
import { RUN_SPEED, WALK_SPEED } from "../../contracts.ts";
import { heightAt } from "../../world/terrain.ts";
import { newMotion } from "../../player/state.ts";
import { packMotion, SEND_RATE, type ClientMessage, type ServerMessage } from "./protocol.ts";

const LINES = ["Hello!", "Nice pond.", "Anyone seen a good stick?", "I am building a dam.", "Race you to the hill!", "Brr, the water is cold."];
const JUMP_SPEED = 4.8, GRAVITY = 18;

const args = process.argv.slice(2);
const option = (name: string, fallback: string) => {
  const at = args.indexOf(`--${name}`);
  return at < 0 ? fallback : args.splice(at, 2)[1]!;
};
const quiet = args.includes("--quiet") ? (args.splice(args.indexOf("--quiet"), 1), true) : false;
const count = Number(option("count", "1")), base = option("name", "Bot"), radius = Number(option("radius", "3"));
const [cx, cz] = option("at", "-1.5,-3").split(",").map(Number) as [number, number];
const url = args[0] ?? "ws://localhost:5180/net";

function bot(n: number) {
  const name = count > 1 ? `${base} ${n + 1}` : base;
  const ring = radius + n * 0.8, centre = { x: cx + Math.cos(n * 2.1) * 0.5, z: cz + Math.sin(n * 2.1) * 0.5 };
  const motion = newMotion(), dt = 1 / SEND_RATE;
  let angle = n * 1.3, y = 0, vy = 0, nextJump = 3 + n, nextLine = 3 + Math.random() * 5 + n * 4, running = false, socket: WebSocket | undefined;

  const connect = () => {
    const ws = socket = new WebSocket(url);
    ws.onopen = () => { ws.send(JSON.stringify({ t: "hello", name, bot: true } satisfies ClientMessage)); console.log(`${name}: in`); };
    ws.onmessage = (e) => {
      const m = JSON.parse(String(e.data)) as ServerMessage;
      if (m.t === "chat") console.log(`${name} hears: ${m.text}`);
    };
    ws.onclose = () => { console.log(`${name}: connection closed, again in 2 s`); socket = undefined; setTimeout(connect, 2000); };
    ws.onerror = () => {};
  };
  connect();

  setInterval(() => {
    motion.time += dt;
    if (Math.floor(motion.time / 8) % 3 === 2 !== running) running = !running; // runs a third of the time
    const speed = running ? RUN_SPEED : WALK_SPEED, turn = speed / ring;
    angle += turn * dt;
    const x = centre.x + Math.cos(angle) * ring, z = centre.z + Math.sin(angle) * ring, ground = heightAt(x, z);
    // A jump now and then: up and down on its own, the ground under it as it goes.
    if ((nextJump -= dt) <= 0 && y <= ground + 1e-3) { vy = JUMP_SPEED; nextJump = 4 + Math.random() * 4; }
    const wasGrounded = motion.grounded;
    y = Math.max(ground, y + vy * dt);
    if (vy <= 0 && y - ground < 0.1) y = ground; // walking downhill keeps the feet on the ground
    vy = y <= ground ? 0 : vy - GRAVITY * dt;
    motion.grounded = y <= ground + 1e-3;
    motion.vertical = motion.grounded ? 0 : vy;
    motion.airTime = motion.grounded ? 0 : motion.airTime + dt;
    if (motion.grounded && !wasGrounded) { motion.sinceLanding = 0; motion.landingSpeed = 3; } else motion.sinceLanding += dt;
    motion.speed = speed;
    motion.distance += speed * dt;
    motion.turning = turn;
    // Facing along the circle, counter-clockwise: the tangent (-sin, cos) as an angle from +z.
    const facing = Math.atan2(-Math.sin(angle), Math.cos(angle));
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ t: "state", p: [x, y, z], f: facing, m: packMotion(motion), c: -1 } satisfies ClientMessage));
      if (!quiet && (nextLine -= dt) <= 0) {
        nextLine = 12 + Math.random() * 13;
        socket.send(JSON.stringify({ t: "chat", text: LINES[Math.floor(Math.random() * LINES.length)]! } satisfies ClientMessage));
      }
    }
  }, 1000 * dt);
}

for (let n = 0; n < count; n++) bot(n);
console.log(`${count} bot(s) on ${url}`);
