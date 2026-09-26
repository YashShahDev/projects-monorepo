import type { GameApp } from "../../src/app/game-app.ts";

declare global {
  interface Window {
    /** Installed by development builds only (src/app/test-hooks.ts). */
    __formulaRacerTest?: GameApp;
  }
}
