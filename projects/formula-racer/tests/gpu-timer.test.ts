import { describe, expect, test } from "bun:test";
import { createGpuTimer } from "../src/app/gpu-timer.ts";
import type { TimerGl } from "../src/app/gpu-timer.ts";

const TIME_ELAPSED = 0x88bf;
const GPU_DISJOINT = 0x8fbb;
const AVAILABLE = 0x8867;
const RESULT = 0x8866;

/** A WebGL2 context whose queries finish when the test says, with the given nanoseconds. */
function fakeGl(options: { extension?: boolean } = {}) {
  const queries = new Map<object, { ns: number; ready: boolean }>();
  let disjoint = false;
  let running: object | undefined;
  let nextNs = 0;
  const gl: TimerGl = {
    QUERY_RESULT_AVAILABLE: AVAILABLE,
    QUERY_RESULT: RESULT,
    getExtension: (name: string) =>
      options.extension === false || name !== "EXT_disjoint_timer_query_webgl2"
        ? null
        : { TIME_ELAPSED_EXT: TIME_ELAPSED, GPU_DISJOINT_EXT: GPU_DISJOINT },
    createQuery: () => {
      const query = {};
      queries.set(query, { ns: 0, ready: false });

      return query;
    },
    deleteQuery: (query) => {
      if (query) {
        queries.delete(query);
      }
    },
    beginQuery: (target, query) => {
      expect(target).toBe(TIME_ELAPSED);
      running = query;
    },
    endQuery: (target) => {
      expect(target).toBe(TIME_ELAPSED);
      const state = running && queries.get(running);
      if (state) {
        state.ns = nextNs;
      }

      running = undefined;
    },
    getQueryParameter: (query, pname) => {
      const state = queries.get(query);
      if (!state) {
        throw new Error("unknown query");
      }

      return pname === AVAILABLE ? state.ready : state.ns;
    },
    getParameter: (pname) => {
      expect(pname).toBe(GPU_DISJOINT);

      return disjoint;
    },
  };

  return {
    gl,
    frame(ms: number) {
      nextNs = ms * 1e6;
    },
    finishAll() {
      for (const state of queries.values()) {
        state.ready = true;
      }
    },
    setDisjoint(value: boolean) {
      disjoint = value;
    },
    live: () => queries.size,
  };
}

describe("the GPU timer", () => {
  test("is absent where the browser has no timer queries", () => {
    expect(createGpuTimer(fakeGl({ extension: false }).gl)).toBeUndefined();
  });

  test("reports each frame's GPU time once its query finishes, oldest first", () => {
    const fake = fakeGl();
    const timer = createGpuTimer(fake.gl);
    if (!timer) {
      throw new Error("timer expected");
    }

    for (const ms of [2, 3.5]) {
      fake.frame(ms);
      timer.begin();
      timer.end();
    }

    expect(timer.poll()).toEqual([]);
    fake.finishAll();
    expect(timer.poll()).toEqual([2, 3.5]);
    expect(timer.poll()).toEqual([]);
  });

  test("drops frames the GPU disjointed, whose times are not to be trusted", () => {
    const fake = fakeGl();
    const timer = createGpuTimer(fake.gl);
    if (!timer) {
      throw new Error("timer expected");
    }

    fake.frame(4);
    timer.begin();
    timer.end();
    fake.finishAll();
    fake.setDisjoint(true);
    expect(timer.poll()).toEqual([]);
    fake.setDisjoint(false);
    fake.frame(5);
    timer.begin();
    timer.end();
    fake.finishAll();
    expect(timer.poll()).toEqual([5]);
  });

  test("keeps a bounded number of queries in flight, skipping frames rather than growing", () => {
    const fake = fakeGl();
    const timer = createGpuTimer(fake.gl);
    if (!timer) {
      throw new Error("timer expected");
    }

    for (let i = 0; i < 20; i += 1) {
      fake.frame(1);
      timer.begin();
      timer.end();
    }

    expect(fake.live()).toBeLessThanOrEqual(8);
    fake.finishAll();
    expect(timer.poll().length).toBeLessThanOrEqual(8);
    timer.dispose();
    expect(fake.live()).toBe(0);
  });
});
