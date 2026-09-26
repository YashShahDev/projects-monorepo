import { startGameApp } from "./game-app.ts";
import { installTestHooks } from "./test-hooks.ts";
import { installTuningPanel } from "./tuning-panel.ts";

function element<T extends HTMLElement>(selector: string): T {
  const found = document.querySelector<T>(selector);
  if (!found) {
    throw new Error(`index.html is missing ${selector}`);
  }

  return found;
}

const canvas = element<HTMLCanvasElement>("#view");
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
  ers: element("#ers"),
  wing: element("#wing"),
  bestLap: element("#best-lap"),
  storageNote: element("#storage-note"),
  trackName: element("#track-name"),
};
const menu = {
  resume: element<HTMLButtonElement>("#resume"),
  restart: element<HTMLButtonElement>("#restart"),
  steering: element<HTMLInputElement>("#assist-steering"),
  abs: element<HTMLInputElement>("#assist-abs"),
  traction: element<HTMLInputElement>("#assist-traction"),
  livery: element<HTMLSelectElement>("#livery"),
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
  reload.addEventListener("click", () => location.reload());
  status.append(text, reload);
}

try {
  const app = await startGameApp(canvas, hud, menu, showFatal, new URLSearchParams(location.search).get("track"));
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
