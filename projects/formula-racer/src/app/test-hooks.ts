import type { GameApp } from "./game-app.ts";
import { TEST_HOOK_GLOBAL } from "./test-hook-name.ts";

/** Lets browser tests step the simulation and read game state deterministically. */
export function installTestHooks(app: GameApp): void {
  Object.defineProperty(window, TEST_HOOK_GLOBAL, { value: app, configurable: true });
}
