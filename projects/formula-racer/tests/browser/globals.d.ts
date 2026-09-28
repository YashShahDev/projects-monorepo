import type { GameApp } from "../../src/app/game-app.ts";
import type { PageControl } from "../../src/control/browser.ts";

declare global {
  interface Window {
    /** Installed by development builds only (src/app/test-hooks.ts). */
    __formulaRacerTest?: GameApp;

    /** Installed by `?control` (src/control/browser.ts). */
    formulaRacer?: PageControl;
  }
}
