import { describe, expect, test } from "bun:test";
import { soundMix, wheelsOnKerb } from "../src/audio/sound-model.ts";
import type { SoundInput } from "../src/audio/sound-model.ts";

const G = 9.81;
const base: SoundInput = {
  paused: false,
  rpm: 4000,
  idleRpm: 4000,
  redlineRpm: 12500,
  throttle: 0,
  speedMps: 0,
  lateralAccelMps2: 0,
  kerbWheels: 0,
};

describe("engine sound", () => {
  test("pitch follows the V6 firing frequency, three pulses per revolution", () => {
    expect(soundMix(base).engineHz).toBeCloseTo(200, 6);
    expect(soundMix({ ...base, rpm: 12500 }).engineHz).toBeCloseTo(625, 6);
  });

  test("is louder on throttle and never silent while running", () => {
    const lift = soundMix(base).engineGain;
    const full = soundMix({ ...base, throttle: 1 }).engineGain;
    expect(lift).toBeGreaterThan(0);
    expect(full).toBeGreaterThan(lift);
    expect(full).toBeLessThanOrEqual(1);
  });

  test("clamps pitch to the rev range", () => {
    expect(soundMix({ ...base, rpm: 0 }).engineHz).toBeCloseTo(200, 6);
    expect(soundMix({ ...base, rpm: 20_000 }).engineHz).toBeCloseTo(625, 6);
  });
});

describe("tyre sound", () => {
  test("is silent in gentle corners and squeals near the grip limit", () => {
    const moving = { ...base, speedMps: 50 };
    expect(soundMix({ ...moving, lateralAccelMps2: G }).tyreGain).toBe(0);
    const hard = soundMix({ ...moving, lateralAccelMps2: 3 * G }).tyreGain;
    const harder = soundMix({ ...moving, lateralAccelMps2: -4 * G }).tyreGain;
    expect(hard).toBeGreaterThan(0);
    expect(harder).toBeGreaterThan(hard);
    expect(harder).toBeLessThanOrEqual(1);
  });

  test("does not squeal when the car is barely moving", () => {
    expect(soundMix({ ...base, speedMps: 1, lateralAccelMps2: 4 * G }).tyreGain).toBe(0);
  });
});

describe("kerb sound", () => {
  test("rumbles with the wheels on the kerb, at the stripe passing rate", () => {
    expect(soundMix({ ...base, speedMps: 40 }).kerbGain).toBe(0);
    const one = soundMix({ ...base, speedMps: 40, kerbWheels: 1 });
    const two = soundMix({ ...base, speedMps: 40, kerbWheels: 2 });
    expect(one.kerbGain).toBeGreaterThan(0);
    expect(two.kerbGain).toBeGreaterThan(one.kerbGain);

    // 5 m stripes at 40 m/s pass 8 times a second.
    expect(one.kerbRateHz).toBeCloseTo(8, 6);
  });

  test("is silent at a standstill on the kerb", () => {
    expect(soundMix({ ...base, kerbWheels: 2 }).kerbGain).toBe(0);
  });

  test("counts wheels whose lateral position lies in the kerb band", () => {
    const band = { halfWidthM: 6, kerbWidthM: 1.5, halfTrackM: 0.8, tyreHalfWidthM: 0.2 };
    expect(wheelsOnKerb({ ...band, lateralM: 0 })).toBe(0);

    // Left wheels at 6.8 m are on the kerb; right wheels at 5.2 m are on the road.
    expect(wheelsOnKerb({ ...band, lateralM: 6 })).toBe(2);
    expect(wheelsOnKerb({ ...band, lateralM: -6 })).toBe(2);

    // Straddling: right wheels at 6.2 m on the kerb, left at 7.8 m on the grass.
    expect(wheelsOnKerb({ ...band, lateralM: 7 })).toBe(2);
    expect(wheelsOnKerb({ ...band, lateralM: 20 })).toBe(0);

    // Wheel centres at 5.9 m are on the road, but the tyres' outer edges reach the kerb.
    expect(wheelsOnKerb({ ...band, lateralM: 5.1 })).toBe(2);

    // Centres at 7.6 m are past the kerb, but the tyres' inner edges still touch it.
    expect(wheelsOnKerb({ ...band, lateralM: 8.4 })).toBe(2);
  });
});

test("pausing silences everything", () => {
  const mix = soundMix({ ...base, paused: true, throttle: 1, speedMps: 50, lateralAccelMps2: 4 * G, kerbWheels: 4 });
  expect([mix.engineGain, mix.tyreGain, mix.kerbGain]).toEqual([0, 0, 0]);
});
