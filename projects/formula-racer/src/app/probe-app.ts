import { fetchProbeScene } from "../content/probe-scene.ts";
import { createProbeView } from "../rendering/probe-view.ts";
import { createProbeWorld } from "../simulation/probe-world.ts";
import type { Pose } from "../simulation/probe-world.ts";

export class StartupError extends Error {
  override name = "StartupError";
}

export interface ProbeAppState {
  running: boolean;
  frames: number;
  steps: number;
  box: Pose;
}

export interface ProbeApp {
  pause(): void;
  resume(): void;
  /** Advances physics by whole steps and renders once, independent of the frame loop. */
  step(count: number): ProbeAppState;
  state(): ProbeAppState;
  dispose(): void;
}

async function stage<T>(label: string, work: () => T | Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new StartupError(`${label}: ${reason}`, { cause: error });
  }
}

export async function startProbeApp(
  canvas: HTMLCanvasElement,
  onFatal: (message: string) => void,
): Promise<ProbeApp> {
  const context = canvas.getContext("webgl2", { antialias: true });
  if (!context) throw new StartupError("WebGL2 is not available in this browser");
  // Resolve against the document so the build works from any URL subpath.
  const sceneUrl = new URL("assets/probe/scene.json", document.baseURI);
  const scene = await stage("Could not load game content", () => fetchProbeScene(sceneUrl));
  const world = await stage("Physics engine (WebAssembly) failed to start", () =>
    createProbeWorld(scene),
  );
  const view = await stage("Renderer failed to start", () =>
    createProbeView(canvas, context, scene),
  ).catch((error: unknown) => {
    world.dispose();
    throw error;
  });

  let running = true;
  let disposed = false;
  let frames = 0;
  let frameRequest = 0;

  const state = (): ProbeAppState => ({
    running,
    frames,
    steps: world.steps,
    box: world.boxPose(),
  });
  const fail = (message: string): void => {
    dispose();
    onFatal(message);
  };
  const frame = (): void => {
    frameRequest = requestAnimationFrame(frame);
    try {
      // One step per displayed frame is a P1 probe only; P2-C1 replaces it with a
      // fixed-rate accumulator so physics speed does not depend on refresh rate.
      if (running) world.step();
      view.render(world.boxPose());
      frames += 1;
      if (frames === 1) {
        performance.mark("formula-racer:first-frame");
        performance.measure("formula-racer:startup", { end: "formula-racer:first-frame" });
      }
    } catch (error) {
      fail(`Frame failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  const onContextLost = (event: Event): void => {
    event.preventDefault();
    fail("The graphics context was lost");
  };
  function dispose(): void {
    if (disposed) return;
    disposed = true;
    running = false;
    cancelAnimationFrame(frameRequest);
    canvas.removeEventListener("webglcontextlost", onContextLost);
    view.dispose();
    world.dispose();
  }

  canvas.addEventListener("webglcontextlost", onContextLost);
  frameRequest = requestAnimationFrame(frame);
  return {
    pause() {
      running = false;
    },
    resume() {
      running = !disposed;
    },
    step(count) {
      for (let i = 0; i < count; i += 1) world.step();
      view.render(world.boxPose());
      return state();
    },
    state,
    dispose,
  };
}
