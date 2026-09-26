import { describe, expect, test } from "bun:test";
import { formatLapTime } from "../src/app/format.ts";

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
