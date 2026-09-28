import type { DrivingSession } from "./session.ts";
import type { DigitalInput } from "../simulation/input-smoothing.ts";

const yaw = (q: { y: number; w: number; x: number; z: number }) =>
  Math.atan2(2 * (q.x * q.z + q.w * q.y), 1 - 2 * (q.x * q.x + q.y * q.y));

/**
 * Keyboard-only driver for tests and the benchmark route: steers from lateral offset and heading error, and
 * brakes for the tightest curvature in the next stretch. Deliberately cautious; it
 * proves a layout is drivable end to end, not how fast.
 */
export function autopilot(session: DrivingSession, cornerGripG = 1.0): DigitalInput {
  const g = session.geometry;
  const car = session.snapshot();
  const location = g.locate(car.position.x, car.position.z);
  const i = location.index;
  const heading = yaw(car.rotation);

  // Aim at a point a little ahead so steering leads the corner.
  const ahead = (i + Math.round(8 / g.spacingM)) % g.count;
  const desired = Math.atan2(g.tx[ahead] ?? 0, g.tz[ahead] ?? 1);
  let error = desired - heading;
  error = Math.atan2(Math.sin(error), Math.cos(error));

  // Positive lateral is left of the line: steer right (positive error means turn left).
  const steer = error * 3 - location.lateralM * 0.15;
  const speed = car.speedMps;
  let tightest = 1e-4;
  const look = Math.round(Math.max(40, speed * 2.5) / g.spacingM);
  for (let k = 0; k < look; k += 1) {
    tightest = Math.max(tightest, Math.abs(g.curvature[(i + k) % g.count] ?? 0));
  }

  const target = Math.sqrt((cornerGripG * 9.81) / tightest);

  return {
    throttle: speed < target * 0.95,
    brake: speed > target * 1.05,
    left: steer > 0.03,
    right: steer < -0.03,
    deploy: false,
  };
}
