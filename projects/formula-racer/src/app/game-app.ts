import { createCarAudio } from "../audio/car-audio.ts";
import type { CarAudio } from "../audio/car-audio.ts";
import { soundMix, wheelsOnKerb } from "../audio/sound-model.ts";
import type { SoundMix } from "../audio/sound-model.ts";
import { fetchCar } from "../content/car.ts";
import type { CarDefinition } from "../content/car.ts";
import { fetchEnergyRules } from "../content/energy-rules.ts";
import { fetchLiveries } from "../content/livery.ts";
import { loadCatalogTrack } from "../content/track-catalog.ts";
import { initPhysics } from "../simulation/physics.ts";
import type { VehicleSnapshot } from "../simulation/vehicle.ts";
import { createTrackView } from "../rendering/track-view.ts";
import { parseCarModelInterface } from "../content/car-model.ts";
import { loadCarModel } from "../rendering/car-model-loader.ts";
import modelInterface from "../../content/cars/model-interface.json";
import { QUALITY_PRESETS, qualitySettings } from "../rendering/quality.ts";
import { createKeyboard } from "./keyboard.ts";
import type { HeldKeys } from "./keyboard.ts";
import { formatLapTime } from "./format.ts";
import { createLapStore, lapKey, storageNotice } from "./lap-store.ts";
import type { StorageLike } from "./lap-store.ts";
import { createPreferences } from "./preferences.ts";
import { createDrivingSession, TYRE_HALF_WIDTH_M } from "./session.ts";
import { autopilot } from "./autopilot.ts";
import { createBenchRecorder } from "./bench.ts";
import { createDashboard } from "./dashboard.ts";
import type { BenchOptions, BenchReport } from "./bench.ts";
import type { SessionState } from "./session.ts";

export class StartupError extends Error {
  override name = "StartupError";
}

export interface GameAppState extends SessionState {
  frames: number;
  held: HeldKeys;

  /** The mix the audio was last given, whether or not sound is on. */
  sound: SoundMix & { enabled: boolean; output: AudioContextState | "none" };
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
  chargeMeter: HTMLMeterElement;
  ers: HTMLElement;
  wing: HTMLElement;
  bestLap: HTMLElement;
  storageNote: HTMLElement;
  trackName: HTMLElement;
  telemetry: HTMLElement;
  map: SVGSVGElement | undefined;
  preview: HTMLElement;
}

export interface Menu {
  resume: HTMLButtonElement;
  restart: HTMLButtonElement;
  steering: HTMLInputElement;
  abs: HTMLInputElement;
  traction: HTMLInputElement;
  livery: HTMLSelectElement;
  quality: HTMLSelectElement;
  sound: HTMLInputElement;
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
  requestedTrack: string | null = null,
  bench?: { options: BenchOptions; onDone: (report: BenchReport) => void },
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
      loadCatalogTrack(asset, requestedTrack),
      fetchEnergyRules(asset("assets/rules/energy-2026-c18.json")),
      fetchLiveries(asset("assets/cars/liveries.json")),
    ]),
  );
  const model = await stage("Could not load the car model", () =>
    loadCarModel(asset("assets/cars/fr26.glb"), parseCarModelInterface(modelInterface), car),
  );
  const session = await (async () => {
    await stage("Physics engine (WebAssembly) failed to start", initPhysics);

    return stage("Could not start the simulation", () =>
      createDrivingSession(car, track, { energy, cameraAnchors: model.anchors }),
    );
  })().catch((error: unknown) => {
    model.dispose();
    throw error;
  });
  const view = await stage("Renderer failed to start", () =>
    createTrackView(canvas, context, session.geometry, track.startDistanceM, model, session.trackside),
  ).catch((error: unknown) => {
    session.dispose();
    model.dispose();
    throw error;
  });
  if (!hud.map) {
    throw new StartupError("index.html is missing #track-map");
  }

  const dashboard = createDashboard(
    { telemetry: hud.telemetry, map: hud.map, preview: hud.preview },
    session.geometry,
    car.powertrain.gearbox,
    track.startDistanceM,
  );
  const store = createLapStore(browserStorage());
  const preferences = createPreferences(browserStorage(), liveries);
  menu.livery.replaceChildren(
    ...liveries.map((livery) => new Option(`${livery.name} #${String(livery.number)}`, livery.id)),
  );
  menu.livery.value = preferences.livery().id;
  hud.trackName.textContent = track.name;
  view.setLivery(preferences.livery());
  const presetNames = { low: "Low", medium: "Medium", high: "High" };
  menu.quality.replaceChildren(...QUALITY_PRESETS.map((preset) => new Option(presetNames[preset], preset)));
  menu.quality.value = preferences.quality();
  view.setQuality(qualitySettings(preferences.quality(), window.devicePixelRatio));
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

  // Audio is optional: a browser without Web Audio, or one that refuses to create a
  // context, still gets a silent game.
  let audio: CarAudio | undefined;
  try {
    audio = typeof AudioContext === "function" ? createCarAudio() : undefined;
  } catch (error) {
    console.warn("Sound is off:", error);
  }

  menu.sound.checked = preferences.sound();
  audio?.setEnabled(preferences.sound());
  const onSound = () => {
    preferences.setSound(menu.sound.checked);
    audio?.setEnabled(preferences.sound());
    onGesture();
  };

  const onGesture = () => audio?.resume();
  let sound: SoundMix = soundMix({
    paused: true,
    rpm: 0,
    idleRpm: 0,
    redlineRpm: 1,
    throttle: 0,
    speedMps: 0,
    lateralAccelMps2: 0,
    kerbWheels: 0,
  });

  // Starting the lookup from last frame's sample avoids a full centreline scan.
  let soundHint: number | undefined;
  const listen = (car: VehicleSnapshot) => {
    const gearbox = session.car().powertrain.gearbox;
    const location = session.geometry.locate(car.position.x, car.position.z, soundHint);
    soundHint = location.index;
    sound = soundMix({
      paused: session.state().paused,
      rpm: car.rpm,
      idleRpm: gearbox.idleRpm,
      redlineRpm: gearbox.redlineRpm,
      throttle: car.applied.throttle,
      speedMps: car.speedMps,

      // Centripetal acceleration of the chassis: forward speed times yaw rate.
      lateralAccelMps2: car.speedMps * car.angularVelocity.y,
      kerbWheels: wheelsOnKerb({
        lateralM: location.lateralM,
        halfWidthM: session.geometry.halfWidthM,
        kerbWidthM: session.geometry.kerbWidthM,
        halfTrackM: session.car().wheels.halfTrack,
        tyreHalfWidthM: TYRE_HALF_WIDTH_M,
      }),
    });
    audio?.update(sound);
  };

  const onQuality = () => {
    preferences.setQuality(menu.quality.value);
    view.setQuality(qualitySettings(preferences.quality(), window.devicePixelRatio));
  };

  menu.livery.addEventListener("change", onLivery);
  menu.quality.addEventListener("change", onQuality);
  menu.sound.addEventListener("change", onSound);
  addEventListener("keydown", onGesture);
  addEventListener("pointerdown", onGesture);
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

  const state = (): GameAppState => ({
    ...session.state(),
    frames,
    held: keyboard.held(),
    sound: { ...sound, enabled: preferences.sound(), output: audio?.state() ?? "none" },
  });
  const show = (): SessionState => {
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
      const percent = Math.round((100 * s.energy.socJ) / energy.socWindowJ);
      hud.charge.textContent = `${String(percent)}%`;
      hud.chargeMeter.value = percent;
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

    return s;
  };

  let lastCountdownS = Number.POSITIVE_INFINITY;
  const recorder = bench ? createBenchRecorder(bench.options) : undefined;
  let benchReported = false;
  const draw = (frameSeconds: number, held: HeldKeys | (() => HeldKeys)): void => {
    const t0 = performance.now();
    const { car, camera } = session.frame(frameSeconds, held);
    const t1 = performance.now();
    view.render(car, camera);
    if (recorder && bench && !benchReported) {
      const stats = view.stats();
      const phase = recorder.record({
        frameMs: frameSeconds * 1000,
        simMs: t1 - t0,
        renderMs: performance.now() - t1,
        drawCalls: stats.drawCalls,
        triangles: stats.triangles,
        metres: Math.abs(car.speedMps) * frameSeconds,
      });
      if (phase === "done") {
        benchReported = true;
        const resources = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
        const navigation = performance.getEntriesByType("navigation") as PerformanceNavigationTiming[];
        bench.onDone({
          ...recorder.result(),
          route: `${track.id}-autopilot-v1`,
          quality: preferences.quality(),
          pixelRatio: qualitySettings(preferences.quality(), window.devicePixelRatio).pixelRatio,
          drawingBuffer: { width: stats.width, height: stats.height },
          gl: { vendor: stats.glVendor, renderer: stats.glRenderer },
          userAgent: navigator.userAgent,
          transferBytes: [...navigation, ...resources].reduce((sum, entry) => sum + entry.transferSize, 0),
        });
      }
    }

    listen(car);

    // The countdown only ever restarts on a reset (R, Restart, an assist change).
    const { countdownS } = show();
    if (countdownS > lastCountdownS) {
      dashboard.reset();
    }

    lastCountdownS = countdownS;
    dashboard.update(car, frameSeconds);
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

      // The benchmark route drives itself, deciding every simulation step, so every run
      // sees the same inputs whatever its frame rate.
      draw(frameSeconds, recorder && !benchReported ? () => autopilot(session) : keyboard.held());
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
    menu.quality.removeEventListener("change", onQuality);
    menu.sound.removeEventListener("change", onSound);
    removeEventListener("keydown", onGesture);
    removeEventListener("pointerdown", onGesture);
    audio?.dispose();
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
