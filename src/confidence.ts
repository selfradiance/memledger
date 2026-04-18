import type { MemoryOutcome } from "./types.js";

const OUTCOME_DELTAS = {
  observed_hold: 0.04,
  observed_fail: -0.12,
  superseded: -0.2,
  manual_correction: -0.18
} as const;

const SUPERSEDED_CONFIDENCE_CAP = 0.25;

export function recalculateCurrentConfidence(
  baseConfidence: number,
  outcomes: MemoryOutcome[]
): number {
  let currentConfidence = baseConfidence;
  let hasSupersededOutcome = false;

  for (const outcome of outcomes) {
    currentConfidence += OUTCOME_DELTAS[outcome.eventType];

    if (outcome.eventType === "superseded") {
      hasSupersededOutcome = true;
    }
  }

  if (hasSupersededOutcome) {
    currentConfidence = Math.min(
      currentConfidence,
      SUPERSEDED_CONFIDENCE_CAP
    );
  }

  return roundConfidence(clampConfidence(currentConfidence));
}

function clampConfidence(value: number): number {
  if (value < 0) {
    return 0;
  }

  if (value > 1) {
    return 1;
  }

  return value;
}

function roundConfidence(value: number): number {
  return Number(value.toFixed(4));
}
