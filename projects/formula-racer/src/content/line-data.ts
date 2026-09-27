import { array, ContentError, fetchJson, inRange, object, positive, text } from "./validate.ts";

/**
 * A track's racing line as the AI runs tuned it (`tools/tune-lines.ts`): the stretches
 * where the line plans on less grip than the car's figures, and the laps that measured.
 * It lives in `assets/lines/<track>.json`; a track without one uses the plain line.
 */
export interface LineData {
  version: 1;
  track: string;

  /** Centreline samples of the track it was tuned on. */
  samples: number;

  /** Stretches of samples, `from` to `to` inclusive, whose grip scale is not 1. */
  lowered: { from: number; to: number; scale: number }[];

  /** The Ace driver's mean flying lap on this line, and on the plain line. */
  lapS: number;
  baselineLapS: number;
}

// Four decimals is finer than any step the tuning takes.
const round = (v: number) => Math.round(v * 1e4) / 1e4;

export function lineDataFrom(
  track: string,
  gripScale: Float64Array,
  laps: { lapS: number; baselineLapS: number },
): LineData {
  const lowered: LineData["lowered"] = [];
  gripScale.forEach((raw, i) => {
    const scale = round(raw);
    const last = lowered.at(-1);
    if (scale === 1) {
      return;
    }

    if (last?.to === i - 1 && last.scale === scale) {
      last.to = i;
    } else {
      lowered.push({ from: i, to: i, scale });
    }
  });

  return { version: 1, track, samples: gripScale.length, lowered, ...laps };
}

export function parseLineData(value: unknown, source = "line"): LineData {
  const root = object(value, source);
  if (root.version !== 1) {
    throw new ContentError(`${source}.version must be 1`);
  }

  const track = text(root.track, `${source}.track`);
  if (!/^[a-z0-9-]+$/u.test(track)) {
    throw new ContentError(`${source}.track must use only a-z, 0-9 and -`);
  }

  const samples = positive(root.samples, `${source}.samples`);
  const lowered = array(root.lowered, `${source}.lowered`).map((entry, i) => {
    const path = `${source}.lowered[${String(i)}]`;
    const v = object(entry, path);
    const from = inRange(v.from, `${path}.from`, 0, samples - 1);
    const to = inRange(v.to, `${path}.to`, from, samples - 1);
    if (!Number.isInteger(from) || !Number.isInteger(to)) {
      throw new ContentError(`${path} must span whole samples`);
    }

    return { from, to, scale: inRange(v.scale, `${path}.scale`, 0.1, 2) };
  });

  return {
    version: 1,
    track,
    samples,
    lowered,
    lapS: positive(root.lapS, `${source}.lapS`),
    baselineLapS: positive(root.baselineLapS, `${source}.baselineLapS`),
  };
}

/** The grip scale per sample, or undefined when the track has changed since the tuning. */
export function lineGripScale(data: LineData, samples: number): Float64Array | undefined {
  if (data.samples !== samples) {
    return undefined;
  }

  const scale = new Float64Array(samples).fill(1);
  for (const { from, to, scale: s } of data.lowered) {
    scale.fill(s, from, to + 1);
  }

  return scale;
}

/** The saved line at `url`, or undefined when the track has none; it must be for `track` when given. */
export async function fetchLineData(
  url: URL,
  fetchImpl: (url: URL) => Promise<Response> = fetch,
  track?: string,
): Promise<LineData | undefined> {
  const response = await fetchImpl(url);
  if (response.status === 404) {
    return undefined;
  }

  const data = parseLineData(await fetchJson(url, () => Promise.resolve(response)), url.pathname);
  if (track !== undefined && data.track !== track) {
    throw new ContentError(`${url.pathname} is for ${data.track}, not ${track}`);
  }

  return data;
}
