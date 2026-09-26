import { fetchCar } from "../content/car.ts";
import type { CarDefinition } from "../content/car.ts";
import { fetchTrack } from "../content/track.ts";
import { initPhysics } from "../simulation/physics.ts";
import { createTrackView } from "../rendering/track-view.ts";
import { createKeyboard } from "./keyboard.ts";
import type { HeldKeys } from "./keyboard.ts";
import { createDrivingSession } from "./session.ts";
import type { SessionState } from "./session.ts";

export class StartupError extends Error {
  override name = "StartupError";
}

export interface GameAppState extends SessionState {
  frames: number;
  held: HeldKeys;
}

export interface GameApp {
  /** See `DrivingSession.retune`. */
  retune(patch: Partial<CarDefinition>): void;
  car(): CarDefinition;
  /** Advances whole simulation steps with fixed input and renders once. */
  step(count: number, throttle: boolean): GameAppState;
  state(): GameAppState;
  dispose(): void;
}

export interface Hud {
  speed: HTMLElement;
  gear: HTMLElement;
  paused: HTMLElement;
}

async function stage<T>(label: string, work: () => T | Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new StartupError(`${label}: ${reason}`, { cause: error });
  }
}

export async function startGameApp(
  canvas: HTMLCanvasElement,
  hud: Hud,
  onFatal: (message: string) => void,
): Promise<GameApp> {
  const context = canvas.getContext("webgl2", { antialias: true });
  if (!context) throw new StartupError("WebGL2 is not available in this browser");
  // Resolve against the document so the build works from any URL subpath.
  const asset = (path: string) => new URL(path, document.baseURI);
  const [car, track] = await stage("Could not load game content", () =>
    Promise.all([
      fetchCar(asset("assets/cars/fr26.json")),
      fetchTrack(asset("assets/tracks/harbour.json")),
    ]),
  );
  await stage("Physics engine (WebAssembly) failed to start", initPhysics);
  const session = await stage("Could not start the simulation", () =>
    createDrivingSession(car, track),
  );
  const view = await stage("Renderer failed to start", () =>
    createTrackView(canvas, context, session.geometry, track.startDistanceM, car),
  ).catch((error: unknown) => {
    session.dispose();
    throw error;
  });
  const keyboard = createKeyboard(window, document);
  keyboard.onAction((action) => {
    session.action(action);
    // Show pause and reset at once rather than on the next frame.
    show();
  });
  const onBlur = () => {
    session.focusLost();
    show();
  };
  const onVisibility = () => {
    if (document.visibilityState === "hidden") onBlur();
  };
  addEventListener("blur", onBlur);
  document.addEventListener("visibilitychange", onVisibility);

  let disposed = false;
  let frames = 0;
  let frameRequest = 0;
  let lastTime: number | undefined;

  const state = (): GameAppState => ({ ...session.state(), frames, held: keyboard.held() });
  const show = (): void => {
    const s = session.state();
    hud.speed.textContent = String(Math.round(Math.abs(s.speedKmh)));
    hud.gear.textContent = String(s.gear);
    hud.paused.hidden = !s.paused;
  };
  const draw = (frameSeconds: number, held: HeldKeys): void => {
    view.render(session.snapshot(), session.frame(frameSeconds, held));
    show();
    frames += 1;
    if (frames === 1) {
      performance.mark("formula-racer:first-frame");
      performance.measure("formula-racer:startup", { end: "formula-racer:first-frame" });
    }
  };
  const fail = (message: string): void => {
    dispose();
    onFatal(message);
  };
  const frame = (time: number): void => {
    frameRequest = requestAnimationFrame(frame);
    try {
      const frameSeconds = lastTime === undefined ? 0 : (time - lastTime) / 1000;
      lastTime = time;
      draw(frameSeconds, keyboard.held());
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
    cancelAnimationFrame(frameRequest);
    canvas.removeEventListener("webglcontextlost", onContextLost);
    removeEventListener("blur", onBlur);
    document.removeEventListener("visibilitychange", onVisibility);
    keyboard.dispose();
    view.dispose();
    session.dispose();
  }

  canvas.addEventListener("webglcontextlost", onContextLost);
  frameRequest = requestAnimationFrame(frame);
  return {
    step(count, throttle) {
      const held = { throttle, brake: false, left: false, right: false };
      // One step's worth of time always yields exactly one fixed step.
      for (let i = 0; i < count; i += 1) session.frame(session.stepSeconds, held);
      draw(0, held);
      return state();
    },
    retune(patch) {
      session.retune(patch);
      show();
    },
    car: () => session.car(),
    state,
    dispose,
  };
}
