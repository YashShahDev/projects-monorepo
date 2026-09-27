import { array, ContentError, fetchJson, inRange, object, text } from "./validate.ts";

/** Open circuits get run-off by corner; street circuits are walled in close. */
export type TrackSetting = "circuit" | "street";

/** Night tracks get a dark sky and floodlights; see `layoutScenery`. */
export type TrackLighting = "day" | "night";

/** A flat closed circuit described by its centreline, in metres on the x/z ground plane. */
export interface TrackDefinition {
  version: 1;
  id: string;
  name: string;
  widthM: number;
  kerbWidthM: number;

  /** Closed loop of centreline control points, listed in driving direction. */
  controlPoints: { x: number; z: number }[];

  /** Start position as a distance along the sampled centreline. */
  startDistanceM: number;

  /** Multipliers on the car's tyre friction coefficient. */
  surfaceGrip: { road: number; kerb: number; grass: number; gravel: number };

  /** Lap-distance spans where the wings may run in Straight Mode. */
  activeAeroZones: { startM: number; endM: number }[];

  /** Street circuits are walled in close; see `buildTrackside`. */
  setting: TrackSetting;
  lighting: TrackLighting;
}

// Every point stays this far inside the ±3000 m ground (simulated and drawn), which
// leaves room for the road, its run-off and the spline's overshoot between points.
const TRACK_EXTENT_M = 2500;

// Far above any real circuit's needs; the limits keep a runaway file from hanging
// startup or the per-step zone check.
const MAX_CONTROL_POINTS = 2000;
const MAX_KERB_WIDTH_M = 3;
const MAX_AERO_ZONES = 20;

// The spline's length is bounded by a small multiple of its control polygon's, so
// capping the polygon caps the samples built along it. Real laps are under 7 km.
const MAX_LAP_M = 25_000;

export function parseTrack(value: unknown, source = "track"): TrackDefinition {
  const root = object(value, source);
  if (root.version !== 1) {
    throw new ContentError(`${source}.version must be 1`);
  }

  const points = array(root.controlPoints, `${source}.controlPoints`, 4, MAX_CONTROL_POINTS).map((point, i) => {
    const pair = array(point, `${source}.controlPoints[${String(i)}]`, 2);
    const coordinate = (k: number) =>
      inRange(pair[k], `${source}.controlPoints[${String(i)}][${String(k)}]`, -TRACK_EXTENT_M, TRACK_EXTENT_M);

    return { x: coordinate(0), z: coordinate(1) };
  });
  let lapM = 0;
  points.forEach((point, i) => {
    const next = points[(i + 1) % points.length];
    const chordM = next ? Math.hypot(next.x - point.x, next.z - point.z) : 0;
    if (chordM < 1) {
      throw new ContentError(`${source}.controlPoints[${String(i)}] duplicates its neighbour`);
    }

    lapM += chordM;
  });
  if (lapM > MAX_LAP_M) {
    throw new ContentError(`${source}.controlPoints make a lap longer than ${String(MAX_LAP_M)} m`);
  }

  const setting = root.setting ?? "circuit";
  if (setting !== "circuit" && setting !== "street") {
    throw new ContentError(`${source}.setting must be circuit or street`);
  }

  const lighting = root.lighting ?? "day";
  if (lighting !== "day" && lighting !== "night") {
    throw new ContentError(`${source}.lighting must be day or night`);
  }

  const grip = object(root.surfaceGrip, `${source}.surfaceGrip`);
  const multiplier = (key: string) => inRange(grip[key], `${source}.surfaceGrip.${key}`, 0.05, 1.5);

  return {
    version: 1,
    id: text(root.id, `${source}.id`),
    name: text(root.name, `${source}.name`),
    widthM: inRange(root.widthM, `${source}.widthM`, 6, 30),
    kerbWidthM: inRange(root.kerbWidthM, `${source}.kerbWidthM`, 0.1, MAX_KERB_WIDTH_M),
    controlPoints: points,
    startDistanceM: inRange(root.startDistanceM, `${source}.startDistanceM`, 0, 1e6),
    surfaceGrip: {
      road: multiplier("road"),
      kerb: multiplier("kerb"),
      grass: multiplier("grass"),
      gravel: multiplier("gravel"),
    },
    activeAeroZones: array(root.activeAeroZones, `${source}.activeAeroZones`, 0, MAX_AERO_ZONES).map((zone, i) => {
      const field = `${source}.activeAeroZones[${String(i)}]`;
      const z = object(zone, field);
      const startM = inRange(z.startM, `${field}.startM`, 0, 1e6);
      const endM = inRange(z.endM, `${field}.endM`, startM + 1, 1e6);

      return { startM, endM };
    }),
    setting,
    lighting,
  };
}

export async function fetchTrack(
  url: URL,
  fetchImpl: (url: URL) => Promise<Response> = fetch,
): Promise<TrackDefinition> {
  return parseTrack(await fetchJson(url, fetchImpl), url.pathname);
}
