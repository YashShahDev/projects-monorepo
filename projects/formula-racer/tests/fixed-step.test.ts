import { describe, expect, test } from "bun:test";
import { FixedStepper } from "../src/simulation/fixed-step.ts";

const step = 1 / 60;

describe("fixed-rate stepping", () => {
  test.each([30, 60, 75, 144, 240])("%d Hz frames yield 60 steps per second", (hz) => {
    const stepper = new FixedStepper(step, 8);
    let steps = 0;
    for (let i = 0; i < hz * 3; i += 1) steps += stepper.advance(1 / hz).steps;
    expect(steps).toBe(180);
  });

  test("a partial step accumulates and is exposed as interpolation alpha", () => {
    const stepper = new FixedStepper(step, 8);
    expect(stepper.advance(step / 4)).toEqual({ steps: 0, alpha: 0.25, droppedSeconds: 0 });
    const next = stepper.advance(step);
    expect(next.steps).toBe(1);
    expect(next.alpha).toBeCloseTo(0.25, 9);
  });

  test("catch-up after a stall is bounded and the excess is reported as dropped", () => {
    const stepper = new FixedStepper(step, 5);
    const plan = stepper.advance(2);
    expect(plan.steps).toBe(5);
    expect(plan.droppedSeconds).toBeCloseTo(2 - 5 * step, 9);
    expect(stepper.advance(0).steps).toBe(0);
  });

  test("zero and negative frame times advance nothing", () => {
    const stepper = new FixedStepper(step, 5);
    expect(stepper.advance(0).steps).toBe(0);
    expect(stepper.advance(-1)).toEqual({ steps: 0, alpha: 0, droppedSeconds: 0 });
  });

  test("reset discards accumulated time", () => {
    const stepper = new FixedStepper(step, 5);
    stepper.advance(step * 0.9);
    stepper.reset();
    expect(stepper.advance(step * 0.2).steps).toBe(0);
  });
});
