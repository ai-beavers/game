// Tests for the message checks the server runs on everything players send, for who is host, the rate limit,
// and the smoothing between updates.
import { describe, expect, test } from "bun:test";
import { newMotion } from "../../player/state.ts";
import { LODGE, newState, SLOTS, type BuildChange } from "../build/rules.ts";
import {
  admit, bucket, changesOf, clean, clientAddress, hostOf, MAX_BITES, MAX_CHANGES, MAX_MESSAGE, MAX_THINGS, packMotion, parseChange,
  parseClient, replay, restore, sameWorld, shouldReload, stickId, unpackMotion, woodId,
} from "./protocol.ts";
import { Track } from "./track.ts";

const state = (change: Record<string, unknown> = {}) =>
  JSON.stringify({ t: "state", p: [1, 0.5, -2], f: 0.3, m: packMotion(newMotion()), c: -1, ...change });

describe("parseClient", () => {
  test("takes a good state, chat, name, things and drop", () => {
    expect(parseClient(state())?.t).toBe("state");
    expect(parseClient(state({ c: 4, u: [2, 0.6, -0.8, 1.2] }))).toMatchObject({ c: 4, u: [2, 0.6, -0.8, 1.2] });
    expect(parseClient(JSON.stringify({ t: "chat", text: "hi" }))).toEqual({ t: "chat", text: "hi" });
    expect(parseClient(JSON.stringify({ t: "away", away: true }))).toEqual({ t: "away", away: true });
    expect(parseClient(JSON.stringify({ t: "away", away: 1 }))).toBeUndefined();
    expect(parseClient(JSON.stringify({ t: "hello", name: "Mia" }))).toEqual({ t: "hello", name: "Mia" });
    expect(parseClient(JSON.stringify({ t: "things", l: [[0, 1, 2, 3, 0, 0, 0, 1]] }))?.t).toBe("things");
    expect(parseClient(JSON.stringify({ t: "drop", s: [3, 1, 2, 3, 0, 0, 0, 1], v: [0, 0, 1] }))?.t).toBe("drop");
  });

  test("drops what is not JSON, not known, or too big", () => {
    for (const bad of ["", "nope", "[]", "null", "1", '{"t":"admin"}', '{"t":"state"}', JSON.stringify({ t: "chat", text: "x".repeat(MAX_MESSAGE) })]) {
      expect(parseClient(bad)).toBeUndefined();
    }
    expect(parseClient(42)).toBeUndefined();
  });

  test("drops numbers that are not finite or out of range", () => {
    expect(parseClient(state({ p: [1e9, 0, 0] }))).toBeUndefined();
    expect(parseClient(state({ p: [0, 0] }))).toBeUndefined();
    expect(parseClient(state({ p: ["1", 0, 0] }))).toBeUndefined();
    expect(parseClient(state({ f: null }))).toBeUndefined(); // NaN and Infinity become null in JSON
    expect(parseClient(state({ c: 1.5 }))).toBeUndefined();
    expect(parseClient(state({ c: 10_000 }))).toBeUndefined();
    const m = packMotion(newMotion());
    expect(parseClient(state({ m: m.slice(1) }))).toBeUndefined();
    expect(parseClient(state({ m: m.map((v, i) => (i === 8 ? 2 : v)) }))).toBeUndefined(); // swimming over 1
    expect(parseClient(state({ m: m.map((v, i) => (i === 9 ? 0.5 : v)) }))).toBeUndefined(); // half an action
    expect(parseClient(state({ u: [0, 0, 0] }))).toBeUndefined();
    expect(parseClient(state({ u: [0, 1, 0, 99] }))).toBeUndefined();
    expect(parseClient(JSON.stringify({ t: "things", l: [[0, 1, 2, 3, 0, 0, 0, 7]] }))).toBeUndefined();
    expect(parseClient(JSON.stringify({ t: "things", l: [[-1, 1, 2, 3, 0, 0, 0, 1]] }))).toBeUndefined();
    expect(parseClient(JSON.stringify({ t: "things", l: Array(500).fill([0, 1, 2, 3, 0, 0, 0, 1]) }))).toBeUndefined();
    expect(parseClient(JSON.stringify({ t: "drop", s: [3, 1, 2, 3, 0, 0, 0, 1], v: [0, 0, 100] }))).toBeUndefined();
  });

  test("never passes an id or extra fields along", () => {
    const m = parseClient(state({ id: 7, evil: true })) as Record<string, unknown>;
    expect(m.id).toBeUndefined();
    expect(m.evil).toBeUndefined();
  });

  test("cuts names and chat, strips control characters, keeps markup as plain text", () => {
    expect(parseClient(JSON.stringify({ t: "hello", name: "  A\u0000very\nlong   name that goes on and on " }))).toEqual({ t: "hello", name: "A very long name tha" });
    expect(parseClient(JSON.stringify({ t: "hello", name: " ​\t" }))).toBeUndefined();
    expect(clean("<img src=x onerror=alert(1)>", 140)).toBe("<img src=x onerror=alert(1)>"); // shown with textContent
    expect(clean("🦫".repeat(30), 20)).toBe("🦫".repeat(20)); // whole characters, not halves
    expect(clean(5, 20)).toBe("");
    expect(clean("e" + "́".repeat(50) + "x", 140)).toBe("é́́x"); // no zalgo towers
    expect(clean("Tiếng Việt", 20)).toBe("Tiếng Việt");
  });
});

describe("motion", () => {
  test("survives packing", () => {
    const m = { ...newMotion(), speed: 1.234, action: "gnaw" as const, carrying: true, grounded: true, swimming: 0.5 };
    expect(unpackMotion(packMotion(m), newMotion())).toEqual(m);
  });
});

describe("hostOf", () => {
  test("is whoever has been in longest, and the next when they leave", () => {
    expect(hostOf([])).toBeUndefined();
    const players = [{ id: 5, joined: 3 }, { id: 2, joined: 1 }, { id: 9, joined: 7 }];
    expect(hostOf(players)).toBe(2);
    expect(hostOf(players.filter((p) => p.id !== 2))).toBe(5);
    expect(hostOf([{ id: 9, joined: 7 }])).toBe(9);
    expect(hostOf([{ id: 1, joined: 0, bot: true }, { id: 9, joined: 7 }])).toBe(9); // bots never
    expect(hostOf([{ id: 1, joined: 0, bot: true }])).toBeUndefined();
    expect(hostOf([{ id: 1, joined: 0, away: true }, { id: 9, joined: 7 }, { id: 4, joined: 9 }])).toBe(9); // a hidden tab is not
    expect(hostOf([{ id: 1, joined: 0, away: true }, { id: 9, joined: 7, away: true }])).toBe(1); // unless all are
  });
});

describe("clientAddress", () => {
  const headers = new Headers({ "cf-connecting-ip": "198.51.100.7", "fly-client-ip": "203.0.113.5" });
  test("trusts a proxy's header only when told to", () => {
    expect(clientAddress(headers, "10.0.0.2")).toBe("10.0.0.2");
    expect(clientAddress(headers, "10.0.0.2", "fly-client-ip")).toBe("203.0.113.5");
    expect(clientAddress(headers, "10.0.0.2", "cf-connecting-ip")).toBe("198.51.100.7");
    expect(clientAddress(new Headers(), "10.0.0.2", "fly-client-ip")).toBe("10.0.0.2"); // not through the proxy
  });
  test("counts IPv6 by its /64 and leaves this machine unlimited", () => {
    const none = new Headers();
    expect(clientAddress(none, "2001:db8:1:2:aaaa::1")).toBe("2001:db8:1:2::/64");
    expect(clientAddress(none, "2001:db8:1:2:bbbb:cccc:dddd:eeee")).toBe("2001:db8:1:2::/64");
    expect(clientAddress(none, "2001:db8::5")).toBe("2001:db8:0:0::/64");
    expect(clientAddress(none, "::ffff:192.0.2.1")).toBe("192.0.2.1");
    for (const self of ["127.0.0.1", "::1", "::ffff:127.0.0.1"]) expect(clientAddress(none, self)).toBeUndefined();
    expect(clientAddress(new Headers({ "fly-client-ip": "127.0.0.1" }), "10.0.0.2", "fly-client-ip")).toBe("127.0.0.1"); // said by the proxy: limited
  });
});

describe("shouldReload", () => {
  test("only for a known, different build, and once", () => {
    expect(shouldReload("abc", "def", null)).toBe(true);
    expect(shouldReload("abc", "def", "def")).toBe(false); // reloaded for it already: a cached page does not loop
    expect(shouldReload("abc", "abc", null)).toBe(false);
    expect(shouldReload("", "def", null)).toBe(false); // the page's server had no GIT_SHA
    expect(shouldReload("abc", "", null)).toBe(false); // development
  });
});

describe("bucket", () => {
  test("lets a burst through, then the rate", () => {
    let now = 0;
    const b = bucket(10, 3, () => now);
    expect([b.take(), b.take(), b.take(), b.take()]).toEqual([true, true, true, false]);
    now += 100;
    expect([b.take(), b.take()]).toEqual([true, false]);
  });
});

describe("Track", () => {
  test("blends between samples, holds the ends, wraps angles, keeps steps", () => {
    const t = new Track({ angles: [1], steps: [2] });
    t.push(0, [0, 3.0, 0]);
    t.push(100, [10, -3.0, 1]);
    const mid = t.at(50);
    expect(mid[0]).toBeCloseTo(5);
    expect(Math.abs(mid[1]!)).toBeGreaterThan(3); // 3 → -3 goes the short way, past π
    expect(mid[2]).toBe(0);
    expect(t.at(-50)[0]).toBe(0);
    expect(t.at(500)[0]).toBe(10);
  });

  test("blends quaternions the short way and keeps them unit length", () => {
    const t = new Track({ quaternion: 0 });
    t.push(0, [0, 0, 0, 1]);
    t.push(100, [0, 0, 0, -1]); // the same turn
    const q = t.at(50);
    expect(q[3]).toBeCloseTo(1);
    expect(Math.hypot(...q)).toBeCloseTo(1);
  });
});

describe("build changes", () => {
  const build = (c: unknown[], t = "build") => parseClient(JSON.stringify({ t, c }));
  const rest = { type: "rest", tree: 3, at: [1, 0.2, -4], turn: [0, 0.6, 0, 0.8] };

  test("takes every known change, copied field by field", () => {
    const all = [{ type: "find" }, { type: "bite", tree: 3 }, { type: "fell", tree: 3, direction: 1.2 }, rest,
      { type: "split", tree: 3 }, { type: "place", slot: 0, stick: "t3:4" }, { type: "place", slot: 1, stick: "w12" }];
    expect(build(all)).toEqual({ t: "build", c: all as BuildChange[] });
    expect(build([{ type: "bite", tree: 1, evil: 1 }])).toEqual({ t: "build", c: [{ type: "bite", tree: 1 }] });
    expect(build([{ type: "find" }], "bring")?.t).toBe("bring");
  });

  test("leaves out what is unknown, out of range or malformed", () => {
    for (const bad of [{ type: "admin" }, { type: "bite" }, { type: "bite", tree: -1 }, { type: "bite", tree: 999 }, { type: "bite", tree: 1.5 },
      { type: "fell", tree: 1, direction: null }, { type: "fell", tree: 1, direction: 1e6 }, { ...rest, at: [1e9, 0, 0] }, { ...rest, turn: [0, 0, 2, 0] },
      { ...rest, turn: [0, 0, 1] }, { type: "place", slot: SLOTS + LODGE, stick: "w1" }, { type: "place", slot: 0, stick: "<b>" },
      { type: "place", slot: 0, stick: "w1".repeat(20) }, { type: "place", slot: 0 }, null, 4, "find", ["bite", 1]]) {
      expect(parseChange(bad)).toBeUndefined();
    }
    expect(build([{ type: "admin" }])).toBeUndefined(); // nothing good left
    expect(build([{ type: "admin" }, { type: "find" }])).toEqual({ t: "build", c: [{ type: "find" }] });
    expect(build(Array(MAX_CHANGES + 1).fill({ type: "find" }))).toBeUndefined();
    expect(parseClient(JSON.stringify({ t: "build", c: {} }))).toBeUndefined();
  });

  test("hello carries the world it holds, only when well formed", () => {
    expect(parseClient(JSON.stringify({ t: "hello", name: "Mia", epoch: "k3x9", have: 12 }))).toEqual({ t: "hello", name: "Mia", epoch: "k3x9", have: 12 });
    expect(parseClient(JSON.stringify({ t: "hello", name: "Mia", epoch: "K!", have: 12 }))).toEqual({ t: "hello", name: "Mia" });
    expect(parseClient(JSON.stringify({ t: "hello", name: "Mia", epoch: "k3", have: -1 }))).toEqual({ t: "hello", name: "Mia" });
  });

  test("the server takes changes in order, once, and bounded", () => {
    const world = newState();
    expect(admit(world, { type: "rest", tree: 1, at: [0, 0, 0], turn: [0, 0, 0, 1] })).toBe(false); // not fallen yet
    expect(admit(world, { type: "split", tree: 1 })).toBe(false);
    let bites = 0;
    for (let k = 0; k < 50; k++) if (admit(world, { type: "bite", tree: 1 })) bites++;
    expect(bites).toBe(MAX_BITES); // no more than the thickest trunk needs
    expect(admit(world, { type: "fell", tree: 1, direction: 0.5 })).toBe(true);
    expect(admit(world, { type: "fell", tree: 1, direction: 2 })).toBe(false); // the first fall counts
    expect(admit(world, { type: "rest", tree: 1, at: [0, 0, 0], turn: [0, 0, 0, 1] })).toBe(true);
    let split = 0;
    for (let k = 0; k < 20; k++) if (admit(world, { type: "bite", tree: 1 })) split++;
    expect(split).toBe(4);
    expect(admit(world, { type: "split", tree: 1 })).toBe(true);
    expect(admit(world, { type: "bite", tree: 1 })).toBe(false); // wood now
    expect(admit(world, { type: "place", slot: 0, stick: "w2" })).toBe(true);
    expect(admit(world, { type: "place", slot: 1, stick: "w2" })).toBe(false); // a stick only once
    for (let k = 0; k < SLOTS + LODGE + 5; k++) admit(world, { type: "place", slot: 0, stick: `x${k}` });
    expect(world.dam.length).toBe(SLOTS + LODGE); // the dam, then the lodge, then no more
    expect(parseChange({ type: "place", slot: SLOTS + LODGE - 1, stick: "w3" })).toEqual({ type: "place", slot: SLOTS + LODGE - 1, stick: "w3" });
  });

  test("a state is the changes that make it, and back", () => {
    const changes: BuildChange[] = [{ type: "find" }, ...Array(7).fill({ type: "bite", tree: 2 }), { type: "fell", tree: 2, direction: 1 },
      { type: "rest", tree: 2, at: [1, 2, 3], turn: [0, 0, 0, 1] }, ...Array(4).fill({ type: "bite", tree: 2 }), { type: "split", tree: 2 },
      { type: "bite", tree: 5 }, { type: "place", slot: 0, stick: "t2:3" }, { type: "place", slot: 1, stick: "w0" }];
    const s = replay(changes);
    expect(replay(changesOf(s))).toEqual(s);
    expect(changesOf(s)).toHaveLength(changes.length);
    expect(sameWorld(s, replay(changesOf(s)))).toBe(true);
    expect(sameWorld(s, replay(changes.slice(0, -1)))).toBe(false);
    const touched = replay(changes);
    touched.trees[9] = { bites: 0, splitBites: 0 }; // touched without effect: the same world
    expect(sameWorld(s, touched)).toBe(true);
    expect(changesOf({ ...newState(), trees: { 1: { bites: 1e9, splitBites: 0 } } })).toHaveLength(MAX_BITES); // a broken save
  });

  test("a kept world comes back through the same checks, or not at all", () => {
    const changes: BuildChange[] = [{ type: "find" }, { type: "bite", tree: 2 }, { type: "place", slot: 0, stick: "w1" }];
    const back = restore(JSON.stringify({ epoch: "k3x9", build: changes }))!;
    expect(back).toEqual({ epoch: "k3x9", world: replay(changes), log: changes, whole: true });
    // A change that does not fit (twice, out of order, unknown) is left out, and then the world is not whole.
    const broken = restore(JSON.stringify({ epoch: "k3x9", build: [...changes, { type: "find" }, { type: "split", tree: 7 }, { type: "admin" }] }))!;
    expect(broken.log).toEqual(changes);
    expect(broken.whole).toBe(false);
    for (const bad of ["", "{\"epoch\":", "null", "[]", '{"epoch":"K!","build":[]}', '{"epoch":"k3","build":{}}', '{"build":[]}']) expect(restore(bad)).toBeUndefined();
  });

  test("sticks have the same id everywhere, inside the range a place may name", () => {
    expect(stickId("w3")).toBe(3);
    expect(stickId("t2:1")).toBe(woodId(2, 1));
    expect(stickId("t31:7")).toBeLessThan(MAX_THINGS);
    expect([stickId("d4"), stickId("x1a"), stickId("t2:9"), stickId("w999")]).toEqual([undefined, undefined, undefined, undefined]);
  });
});
