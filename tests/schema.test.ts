import { describe, expect, it } from "vitest";

import {
  addClaimInputSchema,
  claimStateSchema,
  contestClaimInputSchema,
  supersedeClaimInputSchema
} from "../src/schema.js";

describe("schema", () => {
  it("accepts a valid add-claim payload", () => {
    const parsed = addClaimInputSchema.parse({
      subject: "user.preference",
      predicate: "prefers",
      object: "oat milk",
      author: "agent.alpha",
      sessionId: "sess-1",
      trigger: "assumption",
      confidence: 0.7
    });

    expect(parsed.subject).toBe("user.preference");
    expect(parsed.confidence).toBe(0.7);
  });

  it("rejects invalid confidence values", () => {
    expect(() =>
      addClaimInputSchema.parse({
        subject: "user.preference",
        predicate: "prefers",
        object: "oat milk",
        author: "agent.alpha",
        sessionId: "sess-1",
        trigger: "assumption",
        confidence: 1.5
      })
    ).toThrowError(/too big/i);
  });

  it("defaults supersede trigger to correction", () => {
    const parsed = supersedeClaimInputSchema.parse({
      targetClaimId: "clm_1",
      subject: "user.preference",
      predicate: "prefers",
      object: "soy milk",
      author: "agent.alpha",
      sessionId: "sess-2",
      confidence: 0.8
    });

    expect(parsed.trigger).toBe("correction");
  });

  it("rejects blank contest reasons", () => {
    expect(() =>
      contestClaimInputSchema.parse({
        claimId: "clm_1",
        actor: "agent.beta",
        sessionId: "sess-2",
        reason: "   "
      })
    ).toThrowError(/too small/i);
  });

  it("accepts a derived claim state shape", () => {
    const parsed = claimStateSchema.parse({
      id: "clm_1",
      subject: "user.preference",
      predicate: "prefers",
      object: "oat milk",
      author: "agent.alpha",
      sessionId: "sess-1",
      trigger: "assumption",
      confidence: 0.7,
      createdAt: "2026-04-17T12:00:00.000Z",
      supersedesClaimId: null,
      outcomeTracking: {
        status: "stub",
        note: null
      },
      contested: false,
      contestCount: 0,
      supersededByClaimId: null
    });

    expect(parsed.outcomeTracking.status).toBe("stub");
  });
});
