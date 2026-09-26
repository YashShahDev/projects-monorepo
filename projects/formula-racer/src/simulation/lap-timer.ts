export interface LapRecord {
  timeS: number;
  valid: boolean;
  sectorsS: number[];
}

export interface CurrentLap {
  elapsedS: number;
  /** 1-based sector the car is in. */
  sector: number;
  valid: boolean;
}

export interface LapTimerOptions {
  lengthM: number;
  sectors: number;
  /**
   * Largest believable change in lap distance between two updates. A bigger jump means
   * the nearest centreline point moved to another part of the track: a shortcut, which
   * invalidates the lap.
   */
  maxStepM?: number;
}

export interface LapTimer {
  /** Starts timing a lap from a standing start at `distanceM`. */
  start(simSeconds: number, distanceM: number): void;
  update(simSeconds: number, distanceM: number, onTrack: boolean): void;
  /** Discards the lap in progress, e.g. after a reset. */
  abort(): void;
  current(): CurrentLap | undefined;
  laps(): LapRecord[];
}

interface Running {
  startT: number;
  lastT: number;
  lastD: number;
  /** Signed distance driven since the lap began; reversing subtracts. */
  progress: number;
  nextSector: number;
  splitT: number;
  sectorsS: number[];
  valid: boolean;
}

export function createLapTimer({ lengthM, sectors, maxStepM = 30 }: LapTimerOptions): LapTimer {
  const records: LapRecord[] = [];
  const sectorM = lengthM / sectors;
  let lap: Running | undefined;

  const fresh = (t: number, d: number): Running => ({
    startT: t,
    lastT: t,
    lastD: d,
    progress: 0,
    nextSector: 1,
    splitT: t,
    sectorsS: [],
    valid: true,
  });

  return {
    start(t, d) {
      lap = fresh(t, d);
    },
    update(t, d, onTrack) {
      if (!lap) return;
      let delta = d - lap.lastD;
      // Wrap across the start of the sampled loop.
      if (delta > lengthM / 2) delta -= lengthM;
      if (delta < -lengthM / 2) delta += lengthM;
      const previous = lap.progress;
      const previousT = lap.lastT;
      lap.lastD = d;
      lap.lastT = t;
      // The jump still counts as distance so lap boundaries stay on the real start line;
      // the lap it happens in can never be valid.
      if (Math.abs(delta) > maxStepM) lap.valid = false;
      if (!onTrack) lap.valid = false;
      lap.progress += delta;
      // Sector boundaries count only when reached driving forward, and only once.
      while (lap.progress >= lap.nextSector * sectorM) {
        const boundary: number = lap.nextSector * sectorM;
        const crossedT: number =
          previousT + ((t - previousT) * (boundary - previous)) / (lap.progress - previous);
        lap.sectorsS.push(crossedT - lap.splitT);
        lap.splitT = crossedT;
        if (lap.nextSector < sectors) {
          lap.nextSector += 1;
          continue;
        }
        records.push({ timeS: crossedT - lap.startT, valid: lap.valid, sectorsS: lap.sectorsS });
        const carried: number = lap.progress - lengthM;
        lap = { ...fresh(crossedT, d), lastT: t, progress: carried, valid: onTrack };
      }
    },
    abort() {
      lap = undefined;
    },
    current() {
      if (!lap) return undefined;
      return { elapsedS: lap.lastT - lap.startT, sector: lap.nextSector, valid: lap.valid };
    },
    laps: () => records.map((r) => ({ ...r, sectorsS: [...r.sectorsS] })),
  };
}
