import type { ProbeApp } from "./probe-app.ts";
import { TEST_HOOK_GLOBAL } from "./test-hook-name.ts";

/** Lets browser tests pause and step the simulation deterministically. */
export function installTestHooks(app: ProbeApp): void {
  Object.defineProperty(window, TEST_HOOK_GLOBAL, { value: app, configurable: true });
}
