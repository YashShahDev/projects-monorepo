import { MAX_LAP_MARKS } from "./tyre-marks.ts";
import type { TyreMark } from "./tyre-marks.ts";

/** One recorded lap, as samples in time order. */
export interface Ghost {
  lapTimeS: number;
  timeS: Float64Array;
  x: Float64Array;
  z: Float64Array;
  heading: Float64Array;

  /** Distance along the lap from its start; never decreases. */
  progressM: Float64Array;

  /** Where its tyres slid, timed by the lap clock. */
  marks: TyreMark[];
}

export interface GhostSample {
  /** Time since the lap started. */
  timeS: number;
  x: number;
  z: number;

  /** Radians about +y; 0 faces +z. */
  heading: number;
  progressM: number;
}

export interface GhostRecorder {
  begin(first: GhostSample): void;

  /** Called every simulation step; keeps one sample per interval. */
  sample(sample: GhostSample): void;

  /** Ends the lap with a sample at its exact finishing time. */
  finish(last: GhostSample, marks?: TyreMark[]): Ghost;
}

const INTERVAL_S = 0.1;

// A 150 s lap at 10 Hz. Samples past the cap are dropped, and a lap over the time cap
// is not stored at all (see `decodeGhost`).
export const MAX_GHOST_SAMPLES = 1500;
export const MAX_GHOST_LAP_S = 150;

export function createGhostRecorder(): GhostRecorder {
  let samples: GhostSample[] = [];
  let nextS = 0;
  let furthestM = 0;

  // First passage: progress counts only new ground, so reversing or passing a nearby
  // stretch of track can never move the ghost's progress back.
  const keep = (s: GhostSample) => {
    furthestM = Math.max(furthestM, s.progressM);
    samples.push({ ...s, progressM: furthestM });
    nextS = s.timeS + INTERVAL_S - 1e-9;
  };

  return {
    begin(first) {
      samples = [];
      furthestM = first.progressM;
      keep(first);
    },
    sample(s) {
      // Leave room for the finishing sample.
      if (s.timeS >= nextS && samples.length < MAX_GHOST_SAMPLES - 1) {
        keep(s);
      }
    },
    finish(last, marks = []) {
      keep(last);
      const column = (pick: (s: GhostSample) => number) => Float64Array.from(samples, pick);

      return {
        lapTimeS: last.timeS,
        timeS: column((s) => s.timeS),
        x: column((s) => s.x),
        z: column((s) => s.z),
        heading: column((s) => s.heading),
        progressM: column((s) => s.progressM),
        marks,
      };
    },
  };
}

/** Index of the last entry at or below `value` in an ascending array, clamped to [0, n − 2]. */
function segment(values: Float64Array, value: number): number {
  let [lo, hi] = [0, values.length - 1];
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if ((values[mid] ?? 0) <= value) {
      lo = mid;
    } else {
      hi = mid;
    }
  }

  return Math.max(0, Math.min(lo, values.length - 2));
}

/** The ghost's pose at a lap time, holding its first and last poses outside the lap. */
export function ghostPoseAt(ghost: Ghost, timeS: number): { x: number; z: number; heading: number } {
  const n = ghost.timeS.length;
  if (n === 1 || timeS <= (ghost.timeS[0] ?? 0)) {
    return { x: ghost.x[0] ?? 0, z: ghost.z[0] ?? 0, heading: ghost.heading[0] ?? 0 };
  }

  if (timeS >= (ghost.timeS[n - 1] ?? 0)) {
    return { x: ghost.x[n - 1] ?? 0, z: ghost.z[n - 1] ?? 0, heading: ghost.heading[n - 1] ?? 0 };
  }

  const i = segment(ghost.timeS, timeS);
  const [t0, t1] = [ghost.timeS[i] ?? 0, ghost.timeS[i + 1] ?? 0];
  const f = t1 > t0 ? (timeS - t0) / (t1 - t0) : 0;
  const lerp = (a: Float64Array) => (a[i] ?? 0) + ((a[i + 1] ?? 0) - (a[i] ?? 0)) * f;
  const h0 = ghost.heading[i] ?? 0;
  let turn = (ghost.heading[i + 1] ?? 0) - h0;
  turn = Math.atan2(Math.sin(turn), Math.cos(turn));

  return { x: lerp(ghost.x), z: lerp(ghost.z), heading: h0 + turn * f };
}

/**
 * Seconds the car is behind the ghost (negative: ahead): its lap time now, minus the
 * time the ghost first reached the same progress.
 */
export function ghostDelta(ghost: Ghost, lapTimeS: number, progressM: number): number {
  const n = ghost.progressM.length;
  const end = ghost.progressM[n - 1] ?? 0;
  if (n === 1 || progressM >= end) {
    return lapTimeS - ghost.lapTimeS;
  }

  const i = segment(ghost.progressM, progressM);
  const [p0, p1] = [ghost.progressM[i] ?? 0, ghost.progressM[i + 1] ?? 0];
  const f = p1 > p0 ? Math.max(0, Math.min(1, (progressM - p0) / (p1 - p0))) : 0;
  const ghostS = (ghost.timeS[i] ?? 0) + ((ghost.timeS[i + 1] ?? 0) - (ghost.timeS[i] ?? 0)) * f;

  return lapTimeS - ghostS;
}

// Format "2": the version digit, then base64 of: u16 sample count, f32 lap time, then
// per sample f32 x, z, heading, progress and u16 centiseconds (18 bytes); then u16 mark
// count and per mark f32 ax, az, bx, bz and u16 centiseconds (18 bytes). Format "1" is
// the same without the marks.
const FORMAT = "2";
const MARKLESS_FORMAT = "1";
const HEADER_BYTES = 6;
const SAMPLE_BYTES = 18;
const MARK_BYTES = 18;

const centiseconds = (s: number) => Math.min(0xffff, Math.round(s * 100));

export function encodeGhost(ghost: Ghost): string {
  const n = ghost.timeS.length;
  const marksAt = HEADER_BYTES + n * SAMPLE_BYTES;
  const view = new DataView(new ArrayBuffer(marksAt + 2 + ghost.marks.length * MARK_BYTES));
  view.setUint16(0, n, true);
  view.setFloat32(2, ghost.lapTimeS, true);
  for (let i = 0; i < n; i += 1) {
    const at = HEADER_BYTES + i * SAMPLE_BYTES;
    view.setFloat32(at, ghost.x[i] ?? 0, true);
    view.setFloat32(at + 4, ghost.z[i] ?? 0, true);
    view.setFloat32(at + 8, ghost.heading[i] ?? 0, true);
    view.setFloat32(at + 12, ghost.progressM[i] ?? 0, true);
    view.setUint16(at + 16, centiseconds(ghost.timeS[i] ?? 0), true);
  }

  view.setUint16(marksAt, ghost.marks.length, true);
  ghost.marks.forEach((mark, k) => {
    const at = marksAt + 2 + k * MARK_BYTES;
    [mark.ax, mark.az, mark.bx, mark.bz].forEach((value, j) => {
      view.setFloat32(at + j * 4, value, true);
    });
    view.setUint16(at + 16, centiseconds(mark.timeS), true);
  });

  let binary = "";
  for (const byte of new Uint8Array(view.buffer)) {
    binary += String.fromCodePoint(byte);
  }

  return FORMAT + btoa(binary);
}

/** Undefined for anything that is not a well-formed ghost within the caps. */
export function decodeGhost(text: string): Ghost | undefined {
  const hasMarks = text.startsWith(FORMAT);
  if (!hasMarks && !text.startsWith(MARKLESS_FORMAT)) {
    return undefined;
  }

  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(atob(text.slice(FORMAT.length)), (c) => c.codePointAt(0) ?? 0);
  } catch {
    return undefined;
  }

  if (bytes.length < HEADER_BYTES) {
    return undefined;
  }

  const view = new DataView(bytes.buffer);
  const n = view.getUint16(0, true);
  const lapTimeS = view.getFloat32(2, true);
  const marksAt = HEADER_BYTES + n * SAMPLE_BYTES;
  const markCount = hasMarks && bytes.length >= marksAt + 2 ? view.getUint16(marksAt, true) : 0;
  const expectedBytes = hasMarks ? marksAt + 2 + markCount * MARK_BYTES : marksAt;
  const valid =
    n >= 2 &&
    n <= MAX_GHOST_SAMPLES &&
    markCount <= MAX_LAP_MARKS &&
    bytes.length === expectedBytes &&
    Number.isFinite(lapTimeS) &&
    lapTimeS > 0 &&
    lapTimeS <= MAX_GHOST_LAP_S;
  if (!valid) {
    return undefined;
  }

  const ghost: Ghost = {
    lapTimeS,
    timeS: new Float64Array(n),
    x: new Float64Array(n),
    z: new Float64Array(n),
    heading: new Float64Array(n),
    progressM: new Float64Array(n),
    marks: [],
  };
  for (let i = 0; i < n; i += 1) {
    const at = HEADER_BYTES + i * SAMPLE_BYTES;
    ghost.x[i] = view.getFloat32(at, true);
    ghost.z[i] = view.getFloat32(at + 4, true);
    ghost.heading[i] = view.getFloat32(at + 8, true);
    ghost.progressM[i] = view.getFloat32(at + 12, true);
    ghost.timeS[i] = view.getUint16(at + 16, true) / 100;
  }

  for (let k = 0; k < markCount; k += 1) {
    const at = marksAt + 2 + k * MARK_BYTES;
    const [ax, az, bx, bz] = [0, 1, 2, 3].map((j) => view.getFloat32(at + j * 4, true));
    ghost.marks.push({
      ax: ax ?? 0,
      az: az ?? 0,
      bx: bx ?? 0,
      bz: bz ?? 0,
      timeS: view.getUint16(at + 16, true) / 100,
    });
  }

  // Centiseconds lose the exact finish; the header keeps it.
  ghost.timeS[n - 1] = lapTimeS;
  const finite =
    [ghost.x, ghost.z, ghost.heading, ghost.progressM].every((column) => column.every(Number.isFinite)) &&
    ghost.marks.every((m) => [m.ax, m.az, m.bx, m.bz].every(Number.isFinite));

  return finite ? ghost : undefined;
}
