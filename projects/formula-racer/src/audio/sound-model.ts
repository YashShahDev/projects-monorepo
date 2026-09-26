/** What the car is doing, reduced to the few numbers the sound depends on. */
export interface SoundInput {
  paused: boolean;
  rpm: number;
  idleRpm: number;
  redlineRpm: number;

  /** Applied throttle, 0–1. */
  throttle: number;
  speedMps: number;

  /** Sideways acceleration of the chassis, either sign. */
  lateralAccelMps2: number;

  /** How many wheels are on a kerb, 0–4. */
  kerbWheels: number;
}

/** Gains are 0–1 and scaled by the master volume later. */
export interface SoundMix {
  engineHz: number;
  engineGain: number;
  tyreGain: number;
  kerbGain: number;

  /** How often kerb stripes pass under a wheel. */
  kerbRateHz: number;
}

const G = 9.81;

// A four-stroke V6 fires three times per crankshaft revolution.
const PULSES_PER_REV = 3;

// The greybox kerb stripe length; one bump per stripe.
const KERB_STRIPE_M = 5;

// Squeal starts well past normal cornering and saturates near the tyres' limit.
const SQUEAL_FROM_MPS2 = 1.8 * G;
const SQUEAL_FULL_MPS2 = 4.5 * G;
const SQUEAL_MIN_SPEED_MPS = 5;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

export function soundMix(input: SoundInput): SoundMix {
  const rpm = Math.min(input.redlineRpm, Math.max(input.idleRpm, input.rpm));
  const engineHz = (rpm / 60) * PULSES_PER_REV;
  const kerbRateHz = Math.abs(input.speedMps) / KERB_STRIPE_M;
  if (input.paused) {
    return { engineHz, engineGain: 0, tyreGain: 0, kerbGain: 0, kerbRateHz };
  }

  const revs = (rpm - input.idleRpm) / (input.redlineRpm - input.idleRpm);
  const moving = Math.abs(input.speedMps) >= SQUEAL_MIN_SPEED_MPS;
  const squeal = (Math.abs(input.lateralAccelMps2) - SQUEAL_FROM_MPS2) / (SQUEAL_FULL_MPS2 - SQUEAL_FROM_MPS2);

  return {
    engineHz,
    engineGain: 0.25 + 0.45 * clamp01(input.throttle) + 0.2 * revs,
    tyreGain: moving ? clamp01(squeal) : 0,
    kerbGain: Math.abs(input.speedMps) > 1 ? clamp01(input.kerbWheels / 4) : 0,
    kerbRateHz,
  };
}

/** Counts wheels whose tyres touch the kerb band, from the car's offset from the centreline. */
export function wheelsOnKerb(car: {
  lateralM: number;
  halfWidthM: number;
  kerbWidthM: number;
  halfTrackM: number;
  tyreHalfWidthM: number;
}) {
  const onKerb = (centre: number) => {
    const d = Math.abs(centre);

    return d + car.tyreHalfWidthM > car.halfWidthM && d - car.tyreHalfWidthM <= car.halfWidthM + car.kerbWidthM;
  };

  // Front and rear wheels share a lateral offset; yaw relative to the track is ignored,
  // which only misplaces the rumble briefly in a slide.
  return 2 * (Number(onKerb(car.lateralM + car.halfTrackM)) + Number(onKerb(car.lateralM - car.halfTrackM)));
}
