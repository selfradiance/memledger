import { describe, expect, it } from "vitest";

import { recalculateCurrentConfidence } from "../src/confidence.js";
import type { MemoryOutcome } from "../src/types.js";

function createOutcome(
  id: string,
  eventType: MemoryOutcome["eventType"],
  createdAt: string,
  relatedClaimId: string | null = null
): MemoryOutcome {
  return {
    id,
    claimId: "clm_1",
    eventType,
    source: "operator",
    notes: null,
    relatedClaimId,
    createdAt
  };
}

describe("confidence", () => {
  it("increases after multiple observed_hold outcomes", () => {
    const currentConfidence = recalculateCurrentConfidence(0.6, [
      createOutcome("out_1", "observed_hold", "2026-04-18T12:00:00.000Z"),
      createOutcome("out_2", "observed_hold", "2026-04-18T12:00:01.000Z")
    ]);

    expect(currentConfidence).toBe(0.68);
  });

  it("decreases after multiple observed_fail outcomes", () => {
    const currentConfidence = recalculateCurrentConfidence(0.8, [
      createOutcome("out_1", "observed_fail", "2026-04-18T12:00:00.000Z"),
      createOutcome("out_2", "observed_fail", "2026-04-18T12:00:01.000Z")
    ]);

    expect(currentConfidence).toBe(0.56);
  });

  it("is stable and deterministic for mixed outcome history", () => {
    const outcomes = [
      createOutcome("out_1", "observed_hold", "2026-04-18T12:00:00.000Z"),
      createOutcome("out_2", "observed_fail", "2026-04-18T12:00:01.000Z"),
      createOutcome(
        "out_3",
        "manual_correction",
        "2026-04-18T12:00:02.000Z"
      )
    ];

    expect(recalculateCurrentConfidence(0.7, outcomes)).toBe(0.44);
    expect(recalculateCurrentConfidence(0.7, outcomes)).toBe(0.44);
  });

  it("drops sharply after superseded even with prior holds", () => {
    const currentConfidence = recalculateCurrentConfidence(0.7, [
      createOutcome("out_1", "observed_hold", "2026-04-18T12:00:00.000Z"),
      createOutcome("out_2", "observed_hold", "2026-04-18T12:00:01.000Z"),
      createOutcome(
        "out_3",
        "superseded",
        "2026-04-18T12:00:02.000Z",
        "clm_2"
      )
    ]);

    expect(currentConfidence).toBe(0.25);
  });

  it("reduces confidence for manual_correction without requiring linkage", () => {
    const currentConfidence = recalculateCurrentConfidence(0.65, [
      createOutcome(
        "out_1",
        "manual_correction",
        "2026-04-18T12:00:00.000Z"
      )
    ]);

    expect(currentConfidence).toBe(0.47);
  });
});
