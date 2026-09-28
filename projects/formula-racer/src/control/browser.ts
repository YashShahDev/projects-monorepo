import type { DrivingSession } from "../app/session.ts";
import { createControlEnvironment } from "./environment.ts";
import type { ControlReply } from "./environment.ts";

/** What `?control` puts on the page as `window.formulaRacer`. */
export interface PageControl {
  control: { send(message: unknown): Promise<ControlReply> };
}

export interface BrowserControl {
  /** Outside software has the car: until it sends close, the keyboard does not drive. */
  driving(): boolean;
  dispose(): void;
}

/**
 * The control messages in the page, over the game's own session: resets restart it,
 * so only the loaded track can be driven. Rendering carries on as the car moves.
 */
export function installBrowserControl(session: DrivingSession, trackId: string): BrowserControl {
  let driving = true;
  const environment = createControlEnvironment({
    trackIds: [trackId],
    open: () => Promise.resolve({ session, release: () => undefined }),
  });
  const page: PageControl = {
    control: {
      async send(message) {
        const reply = await environment.handle(message);
        if (reply.type === "closed") {
          driving = false;
        }

        return reply;
      },
    },
  };
  Object.defineProperty(window, "formulaRacer", { value: page, configurable: true });

  return {
    driving: () => driving,
    dispose() {
      driving = false;
      Reflect.deleteProperty(window, "formulaRacer");
    },
  };
}
