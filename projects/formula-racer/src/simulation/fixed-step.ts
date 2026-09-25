export interface StepPlan {
  /** Whole fixed steps to run this frame. */
  steps: number;
  /** Fraction of the next step already elapsed, for render interpolation. */
  alpha: number;
  /** Time discarded because the frame exceeded the catch-up budget. */
  droppedSeconds: number;
}

// Frame times are sums of float deltas; without slack, 1/144 s × 144 can yield 59 steps.
const EPSILON = 1e-9;

/**
 * Converts variable frame times into fixed simulation steps. After a stall it runs at
 * most `maxStepsPerFrame` steps and drops the rest, so the game slows instead of
 * spiralling into ever-longer catch-up frames.
 */
export class FixedStepper {
  private accumulator = 0;

  constructor(
    readonly stepSeconds: number,
    readonly maxStepsPerFrame: number,
  ) {}

  advance(frameSeconds: number): StepPlan {
    // rAF timestamps never go backwards, but a tab restore can deliver a huge delta.
    this.accumulator += Math.max(0, frameSeconds);
    let steps = Math.floor(this.accumulator / this.stepSeconds + EPSILON);
    let droppedSeconds = 0;
    if (steps > this.maxStepsPerFrame) {
      droppedSeconds = (steps - this.maxStepsPerFrame) * this.stepSeconds;
      steps = this.maxStepsPerFrame;
    }
    this.accumulator = Math.max(0, this.accumulator - droppedSeconds - steps * this.stepSeconds);
    return { steps, alpha: Math.min(1, this.accumulator / this.stepSeconds), droppedSeconds };
  }

  reset(): void {
    this.accumulator = 0;
  }
}
