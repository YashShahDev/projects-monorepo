export interface FrameSummary {
  frames: number;
  medianMs: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;

  /**
   * Frames that missed a 60 Hz refresh: at least 1.5 budgets long. rAF intervals are
   * quantised to the refresh and jitter by a few tenths of a millisecond around it, so
   * an exact 16.7 ms cutoff would count on-time frames.
   */
  overBudget: number;
  budgetMs: number;
}

const BUDGET_MS = 16.7;
const MISSED_REFRESH_MS = BUDGET_MS * 1.5;

/** Nearest-rank percentiles, so every reported value is a frame that actually happened. */
export function summarizeFrames(frameMs: readonly number[]): FrameSummary {
  const sorted = [...frameMs].sort((a, b) => a - b);
  const rank = (p: number) => sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)] ?? 0;

  return {
    frames: sorted.length,
    medianMs: rank(0.5),
    p95Ms: rank(0.95),
    p99Ms: rank(0.99),
    maxMs: sorted.at(-1) ?? 0,
    overBudget: sorted.filter((ms) => ms >= MISSED_REFRESH_MS).length,
    budgetMs: BUDGET_MS,
  };
}
