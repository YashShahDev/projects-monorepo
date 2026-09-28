import type { WheelState } from "./vehicle.ts";

/** A straight piece of tyre mark on the ground, from a to b. */
export interface TyreMark {
  ax: number;
  az: number;
  bx: number;
  bz: number;

  /** When it was laid: session seconds for live marks, lap time for a lap's marks. */
  timeS: number;
}

export type MarkWheel = Pick<WheelState, "slip" | "contact">;

export interface MarkRecorder {
  /** Called every simulation step; `lapS` is undefined while no lap is timed. */
  step(wheels: readonly MarkWheel[], simS: number, lapS: number | undefined): void;

  /** Ends every trail, so the next mark does not join across a reset. */
  lift(): void;

  /**
   * Marks laid since the `serial`-th, oldest first, and the serial of the next one.
   * Marks that have left the ring are gone, so at most `MAX_MARKS` come back.
   */
  since(serial: number): { serial: number; marks: TyreMark[] };

  /** The marks laid while the lap clock ran since the last call, timed by it. */
  takeLap(): TyreMark[];
}

export const MAX_MARKS = 4000;
export const MAX_LAP_MARKS = 1000;

// Joining every half metre keeps a 4,000-segment ring about 2 km of trail; a longer gap
// between steps is a reset or a teleport, not a slide.
const MIN_SEGMENT_M = 0.5;
const MAX_JOIN_M = 5;

export function createMarkRecorder(): MarkRecorder {
  const ring: TyreMark[] = [];
  let serial = 0;
  let lap: TyreMark[] = [];
  const trail: ({ x: number; z: number } | undefined)[] = [];

  return {
    step(wheels, simS, lapS) {
      wheels.forEach((wheel, i) => {
        const from = trail[i];
        if (wheel.slip === "none" || !wheel.contact) {
          trail[i] = undefined;

          return;
        }

        const to = { x: wheel.contact.x, z: wheel.contact.z };
        const length = from ? Math.hypot(to.x - from.x, to.z - from.z) : 0;
        if (!from || length > MAX_JOIN_M) {
          trail[i] = to;

          return;
        }

        if (length < MIN_SEGMENT_M) {
          return;
        }

        const mark = { ax: from.x, az: from.z, bx: to.x, bz: to.z, timeS: simS };
        ring[serial % MAX_MARKS] = mark;
        serial += 1;
        if (lapS !== undefined && lap.length < MAX_LAP_MARKS) {
          lap.push({ ...mark, timeS: lapS });
        }

        trail[i] = to;
      });
    },
    lift() {
      trail.length = 0;
    },
    since(from) {
      const marks: TyreMark[] = [];
      for (let k = Math.max(from, serial - MAX_MARKS); k < serial; k += 1) {
        const mark = ring[k % MAX_MARKS];
        if (mark) {
          marks.push(mark);
        }
      }

      return { serial, marks };
    },
    takeLap() {
      const taken = lap;
      lap = [];

      return taken;
    },
  };
}
