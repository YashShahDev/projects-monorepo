import { fetchCar } from "../content/car.ts";
import type { CarDefinition } from "../content/car.ts";
import { fetchEnergyRules } from "../content/energy-rules.ts";
import { fetchLiveries } from "../content/livery.ts";
import { fetchTrack } from "../content/track.ts";
import { initPhysics } from "../simulation/physics.ts";
import { createTrackView } from "../rendering/track-view.ts";
import { createKeyboard } from "./keyboard.ts";
import type { HeldKeys } from "./keyboard.ts";
import { formatLapTime } from "./format.ts";
import { createLapStore, lapKey, storageNotice } from "./lap-store.ts";
import type { StorageLike } from "./lap-store.ts";
import { createPreferences } from "./preferences.ts";
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
  countdown: HTMLElement;
  lapTime: HTMLElement;
  lastLap: HTMLElement;
  energyMode: HTMLElement;
  charge: HTMLElement;
  ers: HTMLElement;
  wing: HTMLElement;
  bestLap: HTMLElement;
  storageNote: HTMLElement;
}

export interface Menu {
  resume: HTMLButtonElement;
  restart: HTMLButtonElement;
  steering: HTMLInputElement;
  abs: HTMLInputElement;
  traction: HTMLInputElement;
  livery: HTMLSelectElement;
}

async function stage<T>(label: string, work: () => T | Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new StartupError(`${label}: ${reason}`, { cause: error });
  }
}

/** `localStorage`, or nothing when the browser refuses access to it. */
function browserStorage(): StorageLike | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

export async function startGameApp(
  canvas: HTMLCanvasElement,
  hud: Hud,
  menu: Menu,
  onFatal: (message: string) => void,
): Promise<GameApp> {
  const context = canvas.getContext("webgl2", { antialias: true });
  if (!context) {
    throw new StartupError("WebGL2 is not available in this browser");
  }

  // Resolve against the document so the build works from any URL subpath.
  const asset = (path: string) => new URL(path, document.baseURI);
  const [car, track, energy, liveries] = await stage("Could not load game content", () =>
    Promise.all([
      fetchCar(asset("assets/cars/fr26.json")),
      fetchTrack(asset("assets/tracks/harbour.json")),
      fetchEnergyRules(asset("assets/rules/energy-2026-c18.json")),
      fetchLiveries(asset("assets/cars/liveries.json")),
    ]),
  );
  await stage("Physics engine (WebAssembly) failed to start", initPhysics);
  const session = await stage("Could not start the simulation", () =>
    createDrivingSession(car, track, { energy }),
  );
  const view = await stage("Renderer failed to start", () =>
    createTrackView(canvas, context, session.geometry, track.startDistanceM, car),
  ).catch((error: unknown) => {
    session.dispose();
    throw error;
  });
  const store = createLapStore(browserStorage());
  const preferences = createPreferences(browserStorage(), liveries);
  menu.livery.replaceChildren(
    ...liveries.map((livery) => new Option(`${livery.name} #${String(livery.number)}`, livery.id)),
  );
  menu.livery.value = preferences.livery().id;
  view.setLivery(preferences.livery());
  let storedLaps = 0;
  const keyOf = (assists: SessionState["assists"], physicsVersion: string) =>
    lapKey({ trackId: track.id, physicsVersion, assists });

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
    if (document.visibilityState === "hidden") {
      onBlur();
    }
  };

  const onResume = () => {
    if (session.state().paused) {
      session.action("pause");
    }

    show();
  };

  const onRestart = () => {
    session.action("reset");
    onResume();
  };

  const onAssists = () => {
    session.setAssists({
      steering: menu.steering.checked,
      abs: menu.abs.checked,
      traction: menu.traction.checked,
    });
    show();
  };

  // A livery is only paint, so changing it keeps the lap running.
  const onLivery = () => {
    preferences.setLivery(menu.livery.value);
    view.setLivery(preferences.livery());
  };

  menu.livery.addEventListener("change", onLivery);
  menu.resume.addEventListener("click", onResume);
  menu.restart.addEventListener("click", onRestart);
  for (const box of [menu.steering, menu.abs, menu.traction]) {
    box.addEventListener("change", onAssists);
  }

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

    // Nudged below whole seconds so 2.0 s left reads "2", not "3".
    const count = Math.ceil(s.countdownS - 1e-9);
    hud.countdown.hidden = count <= 0;
    hud.countdown.textContent = count > 0 ? String(count) : "";
    hud.lapTime.textContent = s.lap ? formatLapTime(s.lap.elapsedS) : "–";
    hud.lapTime.classList.toggle("invalid", s.lap?.valid === false);
    if (s.energy) {
      hud.energyMode.textContent = s.energy.mode === "harvest" ? "Harvest" : "Balanced";
      hud.charge.textContent = `${String(Math.round((100 * s.energy.socJ) / energy.socWindowJ))}%`;
      const netKw = Math.round((s.energy.deployW - s.energy.regenW) / 1000);
      hud.ers.textContent = `${netKw > 0 ? "+" : ""}${String(netKw)} kW`;
    }

    hud.wing.textContent = s.wing.mode === "straight" ? "Straight" : "Corner";
    for (const lap of s.laps.slice(storedLaps)) {
      store.record(keyOf(lap.assists, lap.physicsVersion), lap);
    }

    storedLaps = s.laps.length;

    // Recomputed every frame: a save can fail long after startup (quota).
    const note = storageNotice(store.status);
    hud.storageNote.textContent = note;
    hud.storageNote.hidden = note === "";
    const best = store.best(keyOf(s.assists, s.physicsVersion));
    hud.bestLap.textContent = best ? formatLapTime(best.timeS) : "–";
    menu.steering.checked = s.assists.steering;
    menu.abs.checked = s.assists.abs;
    menu.traction.checked = s.assists.traction;
    const last = s.laps.at(-1);
    hud.lastLap.textContent = last ? `${formatLapTime(last.timeS)}${last.valid ? "" : " ✕"}` : "–";
  };

  const draw = (frameSeconds: number, held: HeldKeys): void => {
    const { car, camera } = session.frame(frameSeconds, held);
    view.render(car, camera);
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
    if (disposed) {
      return;
    }

    disposed = true;
    cancelAnimationFrame(frameRequest);
    canvas.removeEventListener("webglcontextlost", onContextLost);
    removeEventListener("blur", onBlur);
    menu.resume.removeEventListener("click", onResume);
    menu.restart.removeEventListener("click", onRestart);
    menu.livery.removeEventListener("change", onLivery);
    for (const box of [menu.steering, menu.abs, menu.traction]) {
      box.removeEventListener("change", onAssists);
    }

    document.removeEventListener("visibilitychange", onVisibility);
    keyboard.dispose();
    view.dispose();
    session.dispose();
  }

  canvas.addEventListener("webglcontextlost", onContextLost);
  frameRequest = requestAnimationFrame(frame);

  return {
    step(count, throttle) {
      const held = { throttle, brake: false, left: false, right: false, deploy: false };

      // One step's worth of time always yields exactly one fixed step.
      for (let i = 0; i < count; i += 1) {
        session.frame(session.stepSeconds, held);
      }

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
