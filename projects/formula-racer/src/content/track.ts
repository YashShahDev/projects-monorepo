import { array, ContentError, fetchJson, finite, inRange, object, positive, text } from "./validate.ts";

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
  surfaceGrip: { road: number; kerb: number; grass: number };

  /** Lap-distance spans where the wings may run in Straight Mode. */
  activeAeroZones: { startM: number; endM: number }[];
}

export function parseTrack(value: unknown, source = "track"): TrackDefinition {
  const root = object(value, source);
  if (root.version !== 1) {
    throw new ContentError(`${source}.version must be 1`);
  }

  const points = array(root.controlPoints, `${source}.controlPoints`, 4).map((point, i) => {
    const pair = array(point, `${source}.controlPoints[${String(i)}]`, 2);

    return {
      x: finite(pair[0], `${source}.controlPoints[${String(i)}][0]`),
      z: finite(pair[1], `${source}.controlPoints[${String(i)}][1]`),
    };
  });
  points.forEach((point, i) => {
    const next = points[(i + 1) % points.length];
    if (next && Math.hypot(next.x - point.x, next.z - point.z) < 1) {
      throw new ContentError(`${source}.controlPoints[${String(i)}] duplicates its neighbour`);
    }
  });
  const grip = object(root.surfaceGrip, `${source}.surfaceGrip`);
  const multiplier = (key: string) => inRange(grip[key], `${source}.surfaceGrip.${key}`, 0.05, 1.5);

  return {
    version: 1,
    id: text(root.id, `${source}.id`),
    name: text(root.name, `${source}.name`),
    widthM: inRange(root.widthM, `${source}.widthM`, 6, 30),
    kerbWidthM: positive(root.kerbWidthM, `${source}.kerbWidthM`),
    controlPoints: points,
    startDistanceM: inRange(root.startDistanceM, `${source}.startDistanceM`, 0, 1e6),
    surfaceGrip: { road: multiplier("road"), kerb: multiplier("kerb"), grass: multiplier("grass") },
    activeAeroZones: array(root.activeAeroZones, `${source}.activeAeroZones`, 0).map((zone, i) => {
      const field = `${source}.activeAeroZones[${String(i)}]`;
      const z = object(zone, field);
      const startM = inRange(z.startM, `${field}.startM`, 0, 1e6);
      const endM = inRange(z.endM, `${field}.endM`, startM + 1, 1e6);

      return { startM, endM };
    }),
  };
}

export async function fetchTrack(
  url: URL,
  fetchImpl: (url: URL) => Promise<Response> = fetch,
): Promise<TrackDefinition> {
  return parseTrack(await fetchJson(url, fetchImpl), url.pathname);
}
