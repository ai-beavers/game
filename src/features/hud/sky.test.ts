// Tests for sky.ts: the hour reads as a clock, the icon follows the weather and the dark.
import { expect, test } from "bun:test";
import { skyLabel } from "./sky.ts";

test("the hour is shown in steps of ten minutes, wrapped into one day", () => {
  expect(skyLabel(19.5, "fair", 0).time).toBe("19:30");
  expect(skyLabel(7.29, "fair", 0).time).toBe("07:10");
  expect(skyLabel(24.25, "fair", 0).time).toBe("00:10");
});

test("clear weather is a sun by day and a moon by night; other weather its own sign", () => {
  expect(skyLabel(14, "fair", 0).icon).toBe("sun");
  expect(skyLabel(23, "fair", 0.9).icon).toBe("moon");
  expect(skyLabel(23, "rain", 0.9)).toEqual({ time: "23:00", icon: "rain", text: "Rain" });
  expect(skyLabel(9, "fog", 0).text).toBe("Fog");
});
