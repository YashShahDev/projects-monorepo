import { parseBenchOptions } from "./bench.ts";
import type { BenchReport } from "./bench.ts";
import { startGameApp } from "./game-app.ts";
import { installTestHooks } from "./test-hooks.ts";
import { installTuningPanel } from "./tuning-panel.ts";

function element<T extends HTMLElement>(selector: string, type: new () => T): T;
function element(selector: string): HTMLElement;
function element(selector: string, type: new () => HTMLElement = HTMLElement): HTMLElement {
  const found = document.querySelector(selector);
  if (!(found instanceof type)) {
    throw new Error(`index.html is missing ${selector}`);
  }

  return found;
}

const canvas = element("#view", HTMLCanvasElement);
const status = element("#status");
const hud = {
  speed: element("#speed"),
  gear: element("#gear"),
  paused: element("#paused"),
  countdown: element("#countdown"),
  lapTime: element("#lap-time"),
  lastLap: element("#last-lap"),
  energyMode: element("#energy-mode"),
  charge: element("#charge"),
  chargeMeter: element("#charge-meter", HTMLMeterElement),
  ers: element("#ers"),
  wing: element("#wing"),
  bestLap: element("#best-lap"),
  storageNote: element("#storage-note"),
  trackName: element("#track-name"),
  telemetry: element("#telemetry"),
  map: document.querySelector<SVGSVGElement>("#track-map") ?? undefined,
  preview: element("#corner-preview"),
};
const menu = {
  resume: element("#resume", HTMLButtonElement),
  restart: element("#restart", HTMLButtonElement),
  steering: element("#assist-steering", HTMLInputElement),
  abs: element("#assist-abs", HTMLInputElement),
  traction: element("#assist-traction", HTMLInputElement),
  livery: element("#livery", HTMLSelectElement),
  quality: element("#quality", HTMLSelectElement),
  gearbox: element("#gearbox", HTMLSelectElement),
  racingLine: element("#racing-line", HTMLSelectElement),
  sound: element("#sound", HTMLInputElement),
  controls: element("#controls", HTMLButtonElement),
  help: element("#help"),
  helpTable: element("#help-table", HTMLTableElement),
  helpClose: element("#help-close", HTMLButtonElement),
};

function showFatal(message: string): void {
  status.setAttribute("role", "alert");
  status.hidden = false;
  status.replaceChildren();
  const text = document.createElement("p");
  text.textContent = message;
  const reload = document.createElement("button");
  reload.type = "button";
  reload.textContent = "Reload";
  reload.addEventListener("click", () => {
    location.reload();
  });
  status.append(text, reload);
}

/** `?bench` runs the benchmark route and prints its report on the page and the console. */
function bench() {
  const options = parseBenchOptions(location.search);
  if (!options) {
    return undefined;
  }

  return {
    options,
    onDone(report: BenchReport) {
      const json = JSON.stringify(report, null, 2);
      const pre = document.createElement("pre");
      pre.id = "bench-report";
      pre.textContent = json;
      document.body.append(pre);
      console.info("formula-racer:bench", json);
    },
  };
}

try {
  const app = await startGameApp(
    canvas,
    hud,
    menu,
    showFatal,
    new URLSearchParams(location.search).get("track"),
    bench(),
  );
  status.hidden = true;

  // A persisted page may be restored from the back/forward cache and keep running.
  addEventListener("pagehide", (event) => {
    if (!event.persisted) {
      app.dispose();
    }
  });
  if (process.env.NODE_ENV !== "production") {
    installTestHooks(app);
    installTuningPanel(app);
  }
} catch (error) {
  showFatal(error instanceof Error ? error.message : String(error));
}
