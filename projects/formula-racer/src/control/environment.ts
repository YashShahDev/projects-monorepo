import type { DrivingSession } from "../app/session.ts";
import { ContentError } from "../content/validate.ts";
import { createControlLink } from "./link.ts";
import type { ControlEvent, ControlLink, Observation } from "./link.ts";
import { CONTROL_VERSION, ControlError, parseRequest } from "./protocol.ts";

export type ControlReply =
  | {
      type: "observation";
      controlVersion: number;
      seed: number;
      observation: Observation;
      events: ControlEvent[];
      done: boolean;
    }
  | { type: "error"; controlVersion: number; error: string }
  | { type: "closed"; controlVersion: number };

export interface ControlEnvironment {
  /** Answers one message. Malformed or out-of-order messages get an error reply. */
  handle(message: unknown): Promise<ControlReply>;
  close(): void;
}

/** Where each episode's session comes from: a fresh one headless, the page's own in the browser. */
export interface SessionSource {
  trackIds: readonly string[];

  /** A session on this track for a new episode; `release` is called when it ends. */
  open(trackId: string): Promise<{ session: DrivingSession; release(): void }>;
}

const failure = (error: unknown): ControlReply => ({
  type: "error",
  controlVersion: CONTROL_VERSION,
  error: error instanceof Error ? error.message : String(error),
});

/** A Gym-style environment over driving sessions: reset, step and close messages. */
export function createControlEnvironment(sources: SessionSource): ControlEnvironment {
  let release: (() => void) | undefined;
  let link: ControlLink | undefined;
  let seed = 0;
  let done = false;
  let closed = false;

  const close = () => {
    release?.();
    release = undefined;
    link = undefined;
  };

  const answer = async (message: unknown): Promise<ControlReply> => {
    if (closed) {
      throw new ControlError("the environment is closed");
    }

    const request = parseRequest(message);
    if (request.type === "close") {
      close();
      closed = true;

      return { type: "closed", controlVersion: CONTROL_VERSION };
    }

    if (request.type === "reset") {
      const id = request.track ?? sources.trackIds[0] ?? "";
      if (!sources.trackIds.includes(id)) {
        throw new ControlError(`unknown track ${JSON.stringify(id)}; available: ${sources.trackIds.join(", ")}`);
      }

      close();
      const opened = await sources.open(id);
      release = () => {
        opened.release();
      };

      link = createControlLink(opened.session, id);
      seed = request.seed;
      const result = link.start(request);
      done = result.done;

      return { type: "observation", controlVersion: CONTROL_VERSION, seed, ...result };
    }

    if (!link) {
      throw new ControlError("send reset before step");
    }

    if (done) {
      throw new ControlError("the episode is done; send reset to start another");
    }

    const result = link.step(request.controls, request.steps);
    done = result.done;

    return { type: "observation", controlVersion: CONTROL_VERSION, seed, ...result };
  };

  return {
    async handle(message) {
      try {
        return await answer(message);
      } catch (error) {
        // Content and protocol errors are the client's to fix; anything else is a bug.
        if (error instanceof ControlError || error instanceof ContentError) {
          return failure(error);
        }

        throw error;
      }
    },
    close() {
      close();
      closed = true;
    },
  };
}
