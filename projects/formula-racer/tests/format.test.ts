import { describe, expect, test } from "bun:test";
import { formatGear, formatLapTime } from "../src/app/format.ts";

describe("lap time format", () => {
  test.each([
    [0, "0:00.000"],
    [61.2345, "1:01.234"],
    [9.9999, "0:09.999"],
    [599.9994, "9:59.999"],
    [3600, "60:00.000"],
  ])("%d s reads %s", (seconds, text) => {
    expect(formatLapTime(seconds)).toBe(text);
  });

  test("truncates rather than rounds, like a timing screen", () => {
    expect(formatLapTime(59.9999)).toBe("0:59.999");
  });
});

describe("gear format", () => {
  test.each([
    [1, "automatic", "1"],
    [8, "automatic", "8"],
    [-1, "automatic", "R"],
    [3, "manual", "3 M"],
    [-1, "manual", "R M"],
    [5, "hybrid", "5 H"],
  ] as const)("gear %d in %s reads %s", (gear, mode, text) => {
    expect(formatGear(gear, mode)).toBe(text);
  });
});
