// A query handle: WebGLQuery in the browser, anything in tests.
type Query = object;

/** The parts of WebGL2 that GPU timing uses, so tests can stand in for a real context. */
export interface TimerGl {
  readonly QUERY_RESULT_AVAILABLE: number;
  readonly QUERY_RESULT: number;
  getExtension(name: "EXT_disjoint_timer_query_webgl2"): { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null;
  createQuery(): Query | null;
  deleteQuery(query: Query | null): void;
  beginQuery(target: number, query: Query): void;
  endQuery(target: number): void;
  getQueryParameter(query: Query, pname: number): unknown;
  getParameter(pname: number): unknown;
}

export interface GpuTimer {
  begin(): void;
  end(): void;

  /** GPU milliseconds of the frames whose queries have finished since the last poll. */
  poll(): number[];
  dispose(): void;
}

// Results arrive a few frames late; more than this in flight means the GPU is far behind,
// and skipping a frame's timing is better than piling up queries.
const MAX_IN_FLIGHT = 8;

/**
 * Times the GPU work between `begin` and `end` with timer queries. Absent where the
 * browser does not expose them (Firefox, and Chromium without the flag on some GPUs).
 */
export function createGpuTimer(gl: TimerGl): GpuTimer | undefined {
  const ext = gl.getExtension("EXT_disjoint_timer_query_webgl2");
  if (!ext) {
    return undefined;
  }

  const inFlight: Query[] = [];
  let current: Query | undefined;

  return {
    begin() {
      if (current || inFlight.length >= MAX_IN_FLIGHT) {
        return;
      }

      current = gl.createQuery() ?? undefined;
      if (current) {
        gl.beginQuery(ext.TIME_ELAPSED_EXT, current);
      }
    },
    end() {
      if (!current) {
        return;
      }

      gl.endQuery(ext.TIME_ELAPSED_EXT);
      inFlight.push(current);
      current = undefined;
    },
    poll() {
      const done: number[] = [];

      // A disjoint event (a clock change, a context switch) spoils every query in flight.
      const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT) === true;
      while (inFlight[0] && gl.getQueryParameter(inFlight[0], gl.QUERY_RESULT_AVAILABLE) === true) {
        const query = inFlight.shift();
        if (!query) {
          break;
        }

        const ns = Number(gl.getQueryParameter(query, gl.QUERY_RESULT));
        gl.deleteQuery(query);
        if (!disjoint) {
          done.push(ns / 1e6);
        }
      }

      return done;
    },
    dispose() {
      for (const query of inFlight.splice(0)) {
        gl.deleteQuery(query);
      }

      if (current) {
        gl.endQuery(ext.TIME_ELAPSED_EXT);
        gl.deleteQuery(current);
        current = undefined;
      }
    },
  };
}
