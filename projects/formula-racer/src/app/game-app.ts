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
import { createGhostView } from "../rendering/ghost-view.ts";
import type { GhostMode } from "../rendering/ghost-view.ts";
import { createGuideView } from "../rendering/guide-view.ts";
import { createTyreMarksView } from "../rendering/tyre-marks-view.ts";
import type { TyreMarksState } from "../rendering/tyre-marks-view.ts";
import { ghostDelta, ghostPoseAt } from "../simulation/ghost.ts";
import type { Ghost } from "../simulation/ghost.ts";
import { createGhostStore } from "./ghost-store.ts";
import type { GuideState, GuideView } from "../rendering/guide-view.ts";
import { buildRacingLine, lineLimits } from "../simulation/racing-line.ts";
import { parseCarModelInterface } from "../content/car-model.ts";
import { loadCarModel } from "../rendering/car-model-loader.ts";
import modelInterface from "../../content/cars/model-interface.json";
import { QUALITY_PRESETS, qualitySettings } from "../rendering/quality.ts";
import { CONTROLS_HELP, createKeyboard } from "./keyboard.ts";
import type { HeldKeys } from "./keyboard.ts";
import { formatGear, formatLapTime } from "./format.ts";
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

  /** Undefined until the racing line is built, shortly after the first frame. */
  guide: GuideState | undefined;
  ghost: { mode: GhostMode; visible: boolean; deltaS: number | undefined };
  marks: TyreMarksState;
}

export interface GameApp {
  /** See `DrivingSession.retune`. */
  retune(patch: Partial<CarDefinition>): void;
  car(): CarDefinition;

  /** Advances whole simulation steps with fixed input and renders once. */
  step(count: number, throttle: boolean): GameAppState;

  /** Drives with the benchmark autopilot for `seconds` of simulation, then renders once. */
  drive(seconds: number): GameAppState;
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
  delta: HTMLElement;
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
  gearbox: HTMLSelectElement;
  racingLine: HTMLSelectElement;
  ghost: HTMLSelectElement;
  sound: HTMLInputElement;
  controls: HTMLButtonElement;
  help: HTMLElement;
  helpTable: HTMLTableElement;
  helpClose: HTMLButtonElement;
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
  // Checked before anything is created, so failing here leaves nothing to dispose.
  const map = hud.map;
  if (!map) {
    throw new StartupError("index.html is missing #track-map");
  }

  const context = canvas.getContext("webgl2", { antialias: true });
  if (!context) {
    throw new StartupError("WebGL2 is not available in this browser");
  }

  // Resolve against the document so the build works from any URL subpath.
  const asset = (path: string) => new URL(path, document.baseURI);
  const [carDefinition, track, energy, liveries] = await stage("Could not load game content", () =>
    Promise.all([
      fetchCar(asset("assets/cars/fr26.json")),
      loadCatalogTrack(asset, requestedTrack),
      fetchEnergyRules(asset("assets/rules/energy-2026-c18.json")),
      fetchLiveries(asset("assets/cars/liveries.json")),
    ]),
  );
  const model = await stage("Could not load the car model", () =>
    loadCarModel(asset("assets/cars/fr26.glb"), parseCarModelInterface(modelInterface), carDefinition),
  );
  const session = await (async () => {
    await stage("Physics engine (WebAssembly) failed to start", initPhysics);

    return stage("Could not start the simulation", () =>
      createDrivingSession(carDefinition, track, { energy, cameraAnchors: model.anchors }),
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
  const dashboard = createDashboard(
    { telemetry: hud.telemetry, map, preview: hud.preview },
    session.geometry,
    carDefinition.powertrain.gearbox,
    track.startDistanceM,
  );
  const store = createLapStore(browserStorage());
  const ghosts = createGhostStore(browserStorage());
  const ghostView = createGhostView(model);
  view.add(ghostView);
  const marksView = createTyreMarksView();
  view.add(marksView);
  let markSerial = 0;
  let marksState: TyreMarksState = { live: 0, ghost: 0 };

  // Decoded once per key; a new best replaces its entry.
  const bestGhosts = new Map<string, Ghost | undefined>();
  const bestGhost = (key: string) => {
    if (!bestGhosts.has(key)) {
      bestGhosts.set(key, ghosts.get(key));
    }

    return bestGhosts.get(key);
  };

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
  menu.gearbox.value = preferences.gearboxMode();
  session.setGearboxMode(preferences.gearboxMode());
  menu.racingLine.value = preferences.racingLine();
  menu.ghost.value = preferences.ghost();
  view.setQuality(qualitySettings(preferences.quality(), window.devicePixelRatio));
  let storedLaps = 0;
  const keyOf = (assists: SessionState["assists"], physicsVersion: string, gearboxMode: SessionState["gearboxMode"]) =>
    lapKey({ trackId: track.id, physicsVersion, assists, gearboxMode });

  const keyboard = createKeyboard(window, document);

  // The help pauses the game and owns the keyboard while open: Esc or H close it, and
  // focus goes back to what had it.
  menu.helpTable.replaceChildren(
    ...CONTROLS_HELP.map((row) => {
      const tr = document.createElement("tr");
      const label = document.createElement("th");
      label.scope = "row";
      label.textContent = row.label;
      const keys = document.createElement("td");
      keys.append(
        ...row.keys.map((key) => {
          const cap = document.createElement("kbd");
          cap.textContent = key;

          return cap;
        }),
      );
      tr.append(label, keys);

      return tr;
    }),
  );
  let focusBeforeHelp: Element | null = null;
  const openHelp = () => {
    if (!session.state().paused) {
      session.action("pause");
    }

    focusBeforeHelp = document.activeElement;
    menu.help.hidden = false;
    menu.helpClose.focus();
    show();
  };

  const closeHelp = () => {
    menu.help.hidden = true;
    if (focusBeforeHelp instanceof HTMLElement) {
      focusBeforeHelp.focus();
    }
  };

  keyboard.onAction((action) => {
    if (menu.help.hidden !== true) {
      if (action === "help" || action === "pause") {
        closeHelp();
      }

      return;
    }

    if (action === "help") {
      openHelp();

      return;
    }

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
  const onGearbox = () => {
    preferences.setGearboxMode(menu.gearbox.value);
    session.setGearboxMode(preferences.gearboxMode());
    show();
  };

  menu.gearbox.addEventListener("change", onGearbox);
  const onRacingLine = () => {
    preferences.setRacingLine(menu.racingLine.value);
  };

  menu.racingLine.addEventListener("change", onRacingLine);
  const onGhost = () => {
    preferences.setGhost(menu.ghost.value);
    show();
  };

  menu.ghost.addEventListener("change", onGhost);

  // Building the line takes a noticeable fraction of a second, so it waits until the
  // game is already on screen.
  let guide: GuideView | undefined;
  let guideState: GuideState | undefined;
  const guideTimer = setTimeout(() => {
    const limits = lineLimits(carDefinition);
    const line = buildRacingLine(session.geometry, limits);
    guide = createGuideView(session.geometry, line, limits);
    view.add(guide);
    dashboard.setRacingLine(line);
  }, 0);
  menu.sound.addEventListener("change", onSound);
  addEventListener("keydown", onGesture);
  addEventListener("pointerdown", onGesture);
  menu.resume.addEventListener("click", onResume);
  menu.controls.addEventListener("click", openHelp);
  menu.helpClose.addEventListener("click", closeHelp);
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
    guide: guideState,
    ghost: { mode: preferences.ghost(), visible: ghostView.object.visible, deltaS },
    marks: marksState,
  });
  let racing: Ghost | undefined;
  let deltaS: number | undefined;
  let furthestM = 0;
  let lapElapsedS = 0;
  const show = (): SessionState => {
    const s = session.state();
    hud.speed.textContent = String(Math.round(Math.abs(s.speedKmh)));
    hud.gear.textContent = formatGear(s.gear, s.gearboxMode);
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
      const key = keyOf(lap.assists, lap.physicsVersion, lap.gearboxMode);
      if (store.record(key, lap).isBest) {
        // A ghost is stored only with its best time, so the two always agree. Encoding
        // and writing it waits until after this frame.
        bestGhosts.set(key, lap.ghost);
        setTimeout(() => {
          ghosts.save(key, lap.ghost);
        }, 0);
      }
    }

    storedLaps = s.laps.length;

    // Recomputed every frame: a save can fail long after startup (quota).
    const note = storageNotice(store.status);
    hud.storageNote.textContent = note;
    hud.storageNote.hidden = note === "";
    const best = store.best(keyOf(s.assists, s.physicsVersion, s.gearboxMode));
    hud.bestLap.textContent = best ? formatLapTime(best.timeS) : "–";
    menu.steering.checked = s.assists.steering;
    menu.abs.checked = s.assists.abs;
    menu.traction.checked = s.assists.traction;
    const last = s.laps.at(-1);
    hud.lastLap.textContent = last ? `${formatLapTime(last.timeS)}${last.valid ? "" : " ✕"}` : "–";

    const mode = preferences.ghost();
    racing = undefined;
    if (mode === "best") {
      racing = bestGhost(keyOf(s.assists, s.physicsVersion, s.gearboxMode));
    } else if (mode === "last") {
      racing = last?.ghost;
    }

    // First passage, as the ghost was recorded: only new ground moves the comparison.
    if (!s.lap || s.lap.elapsedS < lapElapsedS) {
      furthestM = 0;
    }

    lapElapsedS = s.lap?.elapsedS ?? 0;
    furthestM = Math.max(furthestM, s.lap?.progressM ?? 0);
    deltaS = racing && s.lap && furthestM > 0 ? ghostDelta(racing, s.lap.elapsedS, furthestM) : undefined;
    hud.delta.hidden = deltaS === undefined;
    if (deltaS !== undefined) {
      hud.delta.textContent = `${deltaS < 0 ? "−" : "+"}${Math.abs(deltaS).toFixed(2)}`;
      hud.delta.classList.toggle("ahead", deltaS < 0);
      hud.delta.classList.toggle("behind", deltaS >= 0);
    }

    return s;
  };

  let lastCountdownS = Number.POSITIVE_INFINITY;
  const recorder = bench ? createBenchRecorder(bench.options) : undefined;
  let benchReported = false;
  const draw = (frameSeconds: number, held: HeldKeys | (() => HeldKeys)): void => {
    const t0 = performance.now();
    const { car, camera, lapTimeS } = session.frame(frameSeconds, held);
    const t1 = performance.now();
    guideState = guide?.update(car.position, car.speedMps, preferences.racingLine());
    ghostView.update(racing && lapTimeS !== undefined ? ghostPoseAt(racing, lapTimeS) : undefined, car.position.y);
    const laid = session.marks(markSerial);
    markSerial = laid.serial;
    marksView.add(laid.marks);
    marksState = marksView.update(
      car.simSeconds,
      racing && lapTimeS !== undefined ? { marks: racing.marks, lapTimeS } : undefined,
    );
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
        paused: session.state().paused,
      });
      if (phase === "done") {
        benchReported = true;
        const resources = performance
          .getEntriesByType("resource")
          .filter((entry) => entry instanceof PerformanceResourceTiming);
        const navigation = performance
          .getEntriesByType("navigation")
          .filter((entry) => entry instanceof PerformanceNavigationTiming);
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
    menu.controls.removeEventListener("click", openHelp);
    menu.helpClose.removeEventListener("click", closeHelp);
    menu.restart.removeEventListener("click", onRestart);
    menu.livery.removeEventListener("change", onLivery);
    menu.quality.removeEventListener("change", onQuality);
    menu.gearbox.removeEventListener("change", onGearbox);
    menu.racingLine.removeEventListener("change", onRacingLine);
    menu.ghost.removeEventListener("change", onGhost);
    clearTimeout(guideTimer);
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
    drive(seconds) {
      for (let t = 0; t < seconds; t += session.stepSeconds) {
        session.frame(session.stepSeconds, () => autopilot(session));
      }

      draw(0, keyboard.held());

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
