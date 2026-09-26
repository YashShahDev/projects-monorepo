const GRAVITY = 9.81;

// The lights start this far below the upshift point.
const SHIFT_LIGHT_SPAN_RPM = 2000;

// Frame-to-frame speed differences are noisy; this time constant steadies the readout
// without lagging a braking zone noticeably.
const G_SMOOTHING_S = 0.15;

/** How many of `count` shift lights are lit: they fill toward the upshift point. */
export function shiftLights(rpm: number, gearbox: { upshiftRpm: number; redlineRpm: number }, count: number): number {
  const from = gearbox.upshiftRpm - SHIFT_LIGHT_SPAN_RPM;
  const share = (rpm - from) / SHIFT_LIGHT_SPAN_RPM;

  return Math.max(0, Math.min(count, Math.ceil(share * count - 1e-9)));
}

export interface GForce {
  /** Positive toward the driver's left. */
  lateral: number;

  /** Positive accelerating, negative braking. */
  longitudinal: number;
}

/** Smoothed chassis g-forces from forward speed and yaw rate, updated once per frame. */
export function createGMeter() {
  let previousSpeed: number | undefined;
  let g: GForce = { lateral: 0, longitudinal: 0 };

  return {
    update(speedMps: number, yawRateRadS: number, dtS: number): GForce {
      if (dtS <= 0) {
        return g;
      }

      const longitudinal = previousSpeed === undefined ? 0 : (speedMps - previousSpeed) / dtS / GRAVITY;
      previousSpeed = speedMps;

      // Centripetal acceleration of the chassis: forward speed times yaw rate.
      const lateral = (speedMps * yawRateRadS) / GRAVITY;
      const blend = 1 - Math.exp(-dtS / G_SMOOTHING_S);
      g = {
        lateral: g.lateral + (lateral - g.lateral) * blend,
        longitudinal: g.longitudinal + (longitudinal - g.longitudinal) * blend,
      };

      return g;
    },
  };
}
