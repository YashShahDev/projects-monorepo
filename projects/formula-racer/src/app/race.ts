import { createAiDriver } from "../ai/driver.ts";
import type { AiDriver, AiLevelName } from "../ai/driver.ts";
import type { CarDefinition } from "../content/car.ts";
import type { EnergyRules } from "../content/energy-rules.ts";
import type { TrackDefinition } from "../content/track.ts";
import { createControlLink } from "../control/link.ts";
import type { ControlLink } from "../control/link.ts";
import type { DigitalInput } from "../simulation/input-smoothing.ts";
import type { RacingLine } from "../simulation/racing-line.ts";
import type { DriverControls, VehicleSnapshot } from "../simulation/vehicle.ts";
import { createDrivingSession, GRID_GAP_M } from "./session.ts";
import type { DrivingSession, FrameView } from "./session.ts";

export interface RaceOptions {
  car: CarDefinition;
  track: TrackDefinition;
  energy?: EnergyRules;
  level: AiLevelName;
  count: number;

  /** The line the opponents drive, built for `car`. */
  line: RacingLine;
}

export interface RaceFrame {
  player: FrameView;

  /** Each opponent as drawn this frame, at the same point between steps as the player. */
  opponents: VehicleSnapshot[];
}

export interface Race {
  readonly opponents: readonly DrivingSession[];

  /** The player's frame, with every opponent stepped once for each step the player takes. */
  frame(frameSeconds: number, held: DigitalInput | (() => DigitalInput), driver?: () => DriverControls): RaceFrame;

  /** The player's position, 1 for the lead, among all the cars. */
  standings(): { position: number; cars: number };
  dispose(): void;
}

interface Opponent {
  session: DrivingSession;
  driver: AiDriver;
  link: ControlLink;
}

const HOLD: DriverControls = { throttle: 0, brake: 0, steer: 0 };

/** Indices of the cars in race order: more laps first, then further round; ties keep grid order. */
export function raceOrder(cars: readonly { laps: number; progressM: number }[]): number[] {
  return cars
    .map((car, i) => ({ ...car, i }))
    .sort((a, b) => b.laps - a.laps || b.progressM - a.progressM || a.i - b.i)
    .map((car) => car.i);
}

/**
 * AI opponents for the player's session, on the grid slots behind it. Each has its own
 * vehicle simulation, so they never touch the player or each other. They step once for
 * every step the player takes, which keeps them in time through any frame rate or pause,
 * and they start again from the grid whenever the player's car does.
 */
export async function createRace(player: DrivingSession, options: RaceOptions): Promise<Race> {
  const { car, track, line } = options;
  const opponents: Opponent[] = await Promise.all(
    Array.from({ length: options.count }, async (_, i) => {
      const session = await createDrivingSession(car, track, {
        ...(options.energy ? { energy: options.energy } : {}),
        gridSlot: i + 1,
      });
      const driver = createAiDriver({
        car,
        track,
        geometry: session.geometry,
        level: options.level,
        seed: i + 1,
        line,
      });

      return { session, driver, link: createControlLink(session, track.id) };
    }),
  );

  const stepOpponents = () => {
    for (const { session, driver, link } of opponents) {
      // Held still through the countdown, where a driver pressing on would think it stuck.
      session.drive(session.state().countdownS > 0 ? HOLD : driver.decide(link.observe()));
    }
  };

  // Sessions keep their laps across a reset, so a race counts from these.
  const sessions = [player, ...opponents.map((o) => o.session)];
  let lapsBefore = sessions.map((s) => s.state().laps.length);

  // The countdown only ever goes up when the player's car goes back to the grid.
  let countdownS = player.state().countdownS;
  const followRestart = () => {
    const now = player.state().countdownS;
    if (now > countdownS) {
      for (const { session, driver } of opponents) {
        session.action("reset");
        driver.reset();
      }

      lapsBefore = sessions.map((s) => s.state().laps.length);
    }

    countdownS = now;
  };

  const progress = (session: DrivingSession, slot: number) => {
    const state = session.state();

    return {
      laps: state.laps.length - (lapsBefore[slot] ?? 0),
      progressM: state.lap?.progressM ?? -slot * GRID_GAP_M,
    };
  };

  return {
    opponents: opponents.map((o) => o.session),
    frame(frameSeconds, held, driver) {
      followRestart();
      const steppedHeld = () => {
        stepOpponents();

        return typeof held === "function" ? held() : held;
      };

      const view = player.frame(
        frameSeconds,
        steppedHeld,
        driver &&
          (() => {
            stepOpponents();

            return driver();
          }),
      );
      countdownS = player.state().countdownS;

      return { player: view, opponents: opponents.map((o) => o.session.look(0, view.alpha).car) };
    },
    standings() {
      const order = raceOrder([progress(player, 0), ...opponents.map((o, i) => progress(o.session, i + 1))]);

      return { position: order.indexOf(0) + 1, cars: order.length };
    },
    dispose() {
      for (const { session } of opponents) {
        session.dispose();
      }
    },
  };
}
