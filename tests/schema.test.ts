import { describe, expect, it } from "vitest";

import {
  addClaimInputSchema,
  addClaimAuditInputSchema,
  claimAuditSchema,
  claimStateSchema,
  contestClaimInputSchema,
  recordOutcomeInputSchema,
  supersedeClaimInputSchema
} from "../src/schema.js";

describe("schema", () => {
  it("accepts a valid add-claim payload", () => {
    const parsed = addClaimInputSchema.parse({
      subject: "user.preference",
      predicate: "prefers",
      object: "oat milk",
      project: null,
      type: null,
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
      project: null,
      type: null,
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
      supersededByClaimId: null,
      currentConfidence: 0.7
    });

    expect(parsed.outcomeTracking.status).toBe("stub");
  });

  it("rejects manual superseded outcomes in recordOutcome input", () => {
    expect(() =>
      recordOutcomeInputSchema.parse({
        claimId: "clm_1",
        eventType: "superseded",
        source: "agent.alpha",
        relatedClaimId: "clm_2"
      })
    ).toThrowError(/invalid option/i);
  });

  it("rejects an invalid outcome event type", () => {
    expect(() =>
      recordOutcomeInputSchema.parse({
        claimId: "clm_1",
        eventType: "not_real",
        source: "agent.alpha"
      })
    ).toThrowError(/invalid option/i);
  });

  it("accepts a valid claim audit payload", () => {
    const parsed = addClaimAuditInputSchema.parse({
      claimId: "clm_1",
      auditor: "review.bot",
      verdict: "questions",
      reason: "The supporting source is ambiguous.",
      evidenceNote: "No timestamp was captured in the transcript.",
      recommendedAction: "contest"
    });

    expect(parsed.verdict).toBe("questions");
    expect(parsed.recommendedAction).toBe("contest");
  });

  it("rejects an invalid audit verdict", () => {
    expect(() =>
      addClaimAuditInputSchema.parse({
        claimId: "clm_1",
        auditor: "review.bot",
        verdict: "approve",
        reason: "No issue.",
        recommendedAction: "none"
      })
    ).toThrowError(/invalid option/i);
  });

  it("rejects an invalid audit recommended action", () => {
    expect(() =>
      addClaimAuditInputSchema.parse({
        claimId: "clm_1",
        auditor: "review.bot",
        verdict: "supports",
        reason: "Source aligns with the claim.",
        recommendedAction: "auto_fix"
      })
    ).toThrowError(/invalid option/i);
  });

  it("accepts a stored claim audit shape", () => {
    const parsed = claimAuditSchema.parse({
      id: "aud_1",
      claimId: "clm_1",
      auditor: "review.bot",
      verdict: "supports",
      reason: "The evidence matches the claim.",
      evidenceNote: null,
      recommendedAction: "none",
      createdAt: "2026-04-17T12:00:00.000Z"
    });

    expect(parsed.auditor).toBe("review.bot");
    expect(parsed.evidenceNote).toBeNull();
  });
});
