import { describe, expect, it } from "vitest";

import { createTestLedger } from "./test-helpers.js";

function summarizeHistory(claimId: string, ledger: ReturnType<typeof createTestLedger>["ledger"]) {
  return ledger.getClaimHistory(claimId).events.map((event) => ({
    eventType: event.eventType,
    claimId: event.claimId,
    relatedClaimId: event.relatedClaimId
  }));
}

function summarizeOutcomes(
  claimId: string,
  ledger: ReturnType<typeof createTestLedger>["ledger"]
) {
  return ledger.getClaimHistory(claimId).outcomes.map((outcome) => ({
    eventType: outcome.eventType,
    claimId: outcome.claimId,
    relatedClaimId: outcome.relatedClaimId
  }));
}

function summarizeAudits(
  claimId: string,
  ledger: ReturnType<typeof createTestLedger>["ledger"]
) {
  return ledger.getClaimAudits(claimId).map((audit) => ({
    id: audit.id,
    verdict: audit.verdict,
    recommendedAction: audit.recommendedAction,
    evidenceNote: audit.evidenceNote
  }));
}

describe("ledger", () => {
  it("adds claims and appends a claim_added event", () => {
    const { ledger, close } = createTestLedger();

    try {
      const claim = ledger.addClaim({
        subject: "project.status",
        predicate: "is",
        object: "blocked",
        author: "agent.alpha",
        sessionId: "sess-1",
        trigger: "inference",
        confidence: 0.4
      });

      const claims = ledger.listClaims();
      const history = ledger.getLedgerHistory();

      expect(claims).toHaveLength(1);
      expect(claims[0]?.id).toBe(claim.id);
      expect(history).toHaveLength(1);
      expect(history[0]?.eventType).toBe("claim_added");
    } finally {
      close();
    }
  });

  it("contests a claim without editing the original claim row", () => {
    const { ledger, close } = createTestLedger();

    try {
      const claim = ledger.addClaim({
        subject: "user.preference",
        predicate: "prefers",
        object: "oat milk",
        author: "agent.alpha",
        sessionId: "sess-1",
        trigger: "assumption",
        confidence: 0.7
      });

      const result = ledger.contestClaim({
        claimId: claim.id,
        actor: "agent.beta",
        sessionId: "sess-2",
        reason: "User corrected this in a later turn."
      });

      const refreshed = ledger.getClaim(claim.id);
      const history = ledger.getClaimHistory(claim.id);

      expect(result.event.eventType).toBe("claim_contested");
      expect(refreshed?.object).toBe("oat milk");
      expect(refreshed?.contested).toBe(true);
      expect(refreshed?.contestCount).toBe(1);
      expect(history.events.map((event) => event.eventType)).toEqual([
        "claim_added",
        "claim_contested"
      ]);
    } finally {
      close();
    }
  });

  it("fails cleanly when contesting a nonexistent claim", () => {
    const { ledger, close } = createTestLedger();

    try {
      expect(() =>
        ledger.contestClaim({
          claimId: "missing",
          actor: "agent.beta",
          sessionId: "sess-2",
          reason: "This claim does not exist."
        })
      ).toThrowError("Claim missing was not found.");
    } finally {
      close();
    }
  });

  it("records an outcome row and updates current confidence", () => {
    const { ledger, close } = createTestLedger();

    try {
      const claim = ledger.addClaim({
        subject: "project.status",
        predicate: "is",
        object: "blocked",
        author: "agent.alpha",
        sessionId: "sess-1",
        trigger: "inference",
        confidence: 0.4
      });

      const result = ledger.recordOutcome({
        claimId: claim.id,
        eventType: "observed_hold",
        source: "operator",
        notes: "Held when checked."
      });

      const history = ledger.getClaimHistory(claim.id);

      expect(result.outcome.eventType).toBe("observed_hold");
      expect(result.claim.currentConfidence).toBe(0.44);
      expect(history.outcomes).toHaveLength(1);
      expect(history.outcomes[0]?.notes).toBe("Held when checked.");
    } finally {
      close();
    }
  });

  it("rejects recording an outcome for a nonexistent claim", () => {
    const { ledger, close } = createTestLedger();

    try {
      expect(() =>
        ledger.recordOutcome({
          claimId: "missing",
          eventType: "observed_fail",
          source: "operator"
        })
      ).toThrowError("Claim missing was not found.");
    } finally {
      close();
    }
  });

  it("rejects manual superseded outcomes outside structural supersedeClaim", () => {
    const { ledger, close } = createTestLedger();

    try {
      const claim = ledger.addClaim({
        subject: "user.preference",
        predicate: "prefers",
        object: "oat milk",
        author: "agent.alpha",
        sessionId: "sess-1",
        trigger: "assumption",
        confidence: 0.7
      });

      expect(() =>
        ledger.recordOutcome({
          claimId: claim.id,
          eventType: "superseded" as never,
          source: "operator",
          relatedClaimId: "clm_9999"
        })
      ).toThrowError(/invalid option/i);
    } finally {
      close();
    }
  });

  it("supports manual_correction without related claim linkage", () => {
    const { ledger, close } = createTestLedger();

    try {
      const claim = ledger.addClaim({
        subject: "user.preference",
        predicate: "prefers",
        object: "oat milk",
        author: "agent.alpha",
        sessionId: "sess-1",
        trigger: "assumption",
        confidence: 0.7
      });

      const result = ledger.recordOutcome({
        claimId: claim.id,
        eventType: "manual_correction",
        source: "human.review",
        notes: "Operator corrected this."
      });

      expect(result.outcome.relatedClaimId).toBeNull();
      expect(result.claim.currentConfidence).toBe(0.52);
    } finally {
      close();
    }
  });

  it("appends an audit to a valid claim", () => {
    const { ledger, close } = createTestLedger();

    try {
      const claim = ledger.addClaim({
        subject: "user.preference",
        predicate: "prefers",
        object: "oat milk",
        author: "agent.alpha",
        sessionId: "sess-1",
        trigger: "assumption",
        confidence: 0.7
      });

      const result = ledger.auditClaim({
        claimId: claim.id,
        auditor: "review.bot",
        verdict: "questions",
        reason: "The transcript does not include a direct quote.",
        evidenceNote: "Need a source excerpt for verification.",
        recommendedAction: "contest"
      });

      expect(result.audit.claimId).toBe(claim.id);
      expect(result.audit.verdict).toBe("questions");
      expect(result.claim.currentConfidence).toBe(0.7);
      expect(ledger.getClaimAudits(claim.id)).toHaveLength(1);
    } finally {
      close();
    }
  });

  it("preserves multiple audits on one claim in append-only order", () => {
    const { ledger, close } = createTestLedger();

    try {
      const claim = ledger.addClaim({
        subject: "user.preference",
        predicate: "prefers",
        object: "oat milk",
        author: "agent.alpha",
        sessionId: "sess-1",
        trigger: "assumption",
        confidence: 0.7
      });

      ledger.auditClaim({
        claimId: claim.id,
        auditor: "review.bot",
        verdict: "questions",
        reason: "The first source is ambiguous.",
        recommendedAction: "contest"
      });
      ledger.auditClaim({
        claimId: claim.id,
        auditor: "operator",
        verdict: "supports",
        reason: "A second source confirms the statement.",
        recommendedAction: "none"
      });

      expect(summarizeAudits(claim.id, ledger)).toEqual([
        {
          id: "aud_0003",
          verdict: "questions",
          recommendedAction: "contest",
          evidenceNote: null
        },
        {
          id: "aud_0004",
          verdict: "supports",
          recommendedAction: "none",
          evidenceNote: null
        }
      ]);
    } finally {
      close();
    }
  });

  it("returns audits through claim history readback", () => {
    const { ledger, close } = createTestLedger();

    try {
      const claim = ledger.addClaim({
        subject: "project.status",
        predicate: "is",
        object: "blocked",
        author: "agent.alpha",
        sessionId: "sess-1",
        trigger: "inference",
        confidence: 0.4
      });

      ledger.auditClaim({
        claimId: claim.id,
        auditor: "review.bot",
        verdict: "insufficient_evidence",
        reason: "No confirming artifact is attached.",
        evidenceNote: "Missing build log reference.",
        recommendedAction: "manual_correction"
      });

      const history = ledger.getClaimHistory(claim.id);

      expect(history.audits).toHaveLength(1);
      expect(history.audits[0]?.auditor).toBe("review.bot");
      expect(history.audits[0]?.recommendedAction).toBe("manual_correction");
    } finally {
      close();
    }
  });

  it("does not modify claim state when adding an audit", () => {
    const { ledger, close } = createTestLedger();

    try {
      const claim = ledger.addClaim({
        subject: "project.status",
        predicate: "is",
        object: "blocked",
        author: "agent.alpha",
        sessionId: "sess-1",
        trigger: "inference",
        confidence: 0.4
      });

      ledger.auditClaim({
        claimId: claim.id,
        auditor: "review.bot",
        verdict: "rejects",
        reason: "A newer local observation conflicts with the claim.",
        recommendedAction: "supersede"
      });

      const refreshed = ledger.getClaim(claim.id);

      expect(refreshed?.object).toBe("blocked");
      expect(refreshed?.contested).toBe(false);
      expect(refreshed?.supersededByClaimId).toBeNull();
    } finally {
      close();
    }
  });

  it("does not create an outcome row when adding an audit", () => {
    const { ledger, close } = createTestLedger();

    try {
      const claim = ledger.addClaim({
        subject: "project.status",
        predicate: "is",
        object: "blocked",
        author: "agent.alpha",
        sessionId: "sess-1",
        trigger: "inference",
        confidence: 0.4
      });

      ledger.auditClaim({
        claimId: claim.id,
        auditor: "review.bot",
        verdict: "questions",
        reason: "This needs follow-up evidence.",
        recommendedAction: "contest"
      });

      expect(ledger.getClaimHistory(claim.id).outcomes).toEqual([]);
    } finally {
      close();
    }
  });

  it("does not supersede a claim when an audit recommends supersede", () => {
    const { ledger, close } = createTestLedger();

    try {
      const claim = ledger.addClaim({
        subject: "user.preference",
        predicate: "prefers",
        object: "oat milk",
        author: "agent.alpha",
        sessionId: "sess-1",
        trigger: "assumption",
        confidence: 0.7
      });

      ledger.auditClaim({
        claimId: claim.id,
        auditor: "review.bot",
        verdict: "rejects",
        reason: "The latest explicit correction points elsewhere.",
        recommendedAction: "supersede"
      });

      const refreshed = ledger.getClaim(claim.id);
      const events = ledger.getClaimHistory(claim.id).events;

      expect(refreshed?.supersededByClaimId).toBeNull();
      expect(events.map((event) => event.eventType)).toEqual(["claim_added"]);
    } finally {
      close();
    }
  });

  it("leaves currentConfidence unchanged after one audit", () => {
    const { ledger, close } = createTestLedger();

    try {
      const claim = ledger.addClaim({
        subject: "project.status",
        predicate: "is",
        object: "blocked",
        author: "agent.alpha",
        sessionId: "sess-1",
        trigger: "inference",
        confidence: 0.4
      });

      ledger.auditClaim({
        claimId: claim.id,
        auditor: "review.bot",
        verdict: "questions",
        reason: "The evidence is incomplete.",
        recommendedAction: "contest"
      });

      expect(ledger.getClaim(claim.id)?.currentConfidence).toBe(0.4);
    } finally {
      close();
    }
  });

  it("leaves currentConfidence unchanged after multiple audits", () => {
    const { ledger, close } = createTestLedger();

    try {
      const claim = ledger.addClaim({
        subject: "project.status",
        predicate: "is",
        object: "blocked",
        author: "agent.alpha",
        sessionId: "sess-1",
        trigger: "inference",
        confidence: 0.4
      });

      ledger.auditClaim({
        claimId: claim.id,
        auditor: "review.bot",
        verdict: "questions",
        reason: "The evidence is incomplete.",
        recommendedAction: "contest"
      });
      ledger.auditClaim({
        claimId: claim.id,
        auditor: "operator",
        verdict: "supports",
        reason: "A later review still supports the claim.",
        recommendedAction: "none"
      });

      expect(ledger.getClaim(claim.id)?.currentConfidence).toBe(0.4);
    } finally {
      close();
    }
  });

  it("handles mixed hold and fail outcomes deterministically", () => {
    const { ledger, close } = createTestLedger();

    try {
      const claim = ledger.addClaim({
        subject: "project.status",
        predicate: "is",
        object: "blocked",
        author: "agent.alpha",
        sessionId: "sess-1",
        trigger: "inference",
        confidence: 0.6
      });

      ledger.recordOutcome({
        claimId: claim.id,
        eventType: "observed_hold",
        source: "operator"
      });
      ledger.recordOutcome({
        claimId: claim.id,
        eventType: "observed_fail",
        source: "operator"
      });
      ledger.recordOutcome({
        claimId: claim.id,
        eventType: "observed_hold",
        source: "operator"
      });

      const refreshed = ledger.getClaim(claim.id);

      expect(refreshed?.currentConfidence).toBe(0.56);
      expect(ledger.getClaim(claim.id)?.currentConfidence).toBe(0.56);
    } finally {
      close();
    }
  });

  it("searches matching active claims deterministically", () => {
    const { ledger, close } = createTestLedger();

    try {
      const matching = ledger.addClaim({
        subject: "user.preference",
        predicate: "prefers",
        object: "oat milk",
        project: "prefs",
        type: "preference",
        author: "agent.alpha",
        sessionId: "sess-1",
        trigger: "assumption",
        confidence: 0.7
      });
      ledger.addClaim({
        subject: "project.status",
        predicate: "is",
        object: "blocked",
        project: "work",
        type: "status",
        author: "agent.alpha",
        sessionId: "sess-2",
        trigger: "inference",
        confidence: 0.4
      });

      const result = ledger.searchClaims({
        query: "oat",
        project: "prefs",
        type: "preference"
      });

      expect(result.retrievalMethod).toBe("deterministic_keyword_v1");
      expect(result.included.map((claim) => claim.id)).toEqual([matching.id]);
      expect(result.excluded).toEqual([]);
    } finally {
      close();
    }
  });

  it("search does not treat superseded claims as active", () => {
    const { ledger, close } = createTestLedger();

    try {
      const original = ledger.addClaim({
        subject: "user.preference",
        predicate: "prefers",
        object: "oat milk",
        author: "agent.alpha",
        sessionId: "sess-1",
        trigger: "assumption",
        confidence: 0.7
      });

      ledger.supersedeClaim({
        targetClaimId: original.id,
        subject: "user.preference",
        predicate: "prefers",
        object: "soy milk",
        author: "agent.alpha",
        sessionId: "sess-2",
        confidence: 0.95
      });

      const result = ledger.searchClaims({ query: "oat" });

      expect(result.included.map((claim) => claim.id)).not.toContain(original.id);
      expect(result.excluded).toEqual([
        {
          claim: expect.objectContaining({ id: original.id }),
          reasons: ["superseded"]
        }
      ]);
    } finally {
      close();
    }
  });

  it("search does not treat contested claims as active", () => {
    const { ledger, close } = createTestLedger();

    try {
      const claim = ledger.addClaim({
        subject: "user.preference",
        predicate: "prefers",
        object: "oat milk",
        author: "agent.alpha",
        sessionId: "sess-1",
        trigger: "assumption",
        confidence: 0.7
      });

      ledger.contestClaim({
        claimId: claim.id,
        actor: "agent.beta",
        sessionId: "sess-2",
        reason: "User corrected this later."
      });

      const result = ledger.searchClaims({ query: "oat" });

      expect(result.included).toEqual([]);
      expect(result.excluded).toEqual([
        {
          claim: expect.objectContaining({ id: claim.id }),
          reasons: ["contested"]
        }
      ]);
    } finally {
      close();
    }
  });

  it("generates a context pack with active matching claims and exclusions", () => {
    const { ledger, close } = createTestLedger();

    try {
      const active = ledger.addClaim({
        subject: "user.preference",
        predicate: "prefers",
        object: "oat milk",
        project: "prefs",
        type: "preference",
        author: "agent.alpha",
        sessionId: "sess-1",
        trigger: "assumption",
        confidence: 0.7
      });
      const contested = ledger.addClaim({
        subject: "user.preference",
        predicate: "prefers",
        object: "oat biscuits",
        project: "prefs",
        type: "preference",
        author: "agent.alpha",
        sessionId: "sess-2",
        trigger: "assumption",
        confidence: 0.6
      });
      ledger.contestClaim({
        claimId: contested.id,
        actor: "agent.beta",
        sessionId: "sess-3",
        reason: "User corrected this."
      });

      const pack = ledger.generateContextPack({
        query: "oat",
        project: "prefs",
        type: "preference",
        outputFormat: "markdown"
      });

      expect(pack.search.included.map((claim) => claim.id)).toEqual([active.id]);
      expect(pack.search.excluded).toEqual([
        {
          claim: expect.objectContaining({ id: contested.id }),
          reasons: ["contested"]
        }
      ]);
      expect(pack.receipt.includedClaimIds).toEqual([active.id]);
      expect(pack.receipt.excludedClaimIds).toEqual([contested.id]);
      expect(pack.receipt.exclusionReasons).toEqual({
        [contested.id]: ["contested"]
      });
    } finally {
      close();
    }
  });

  it("writes append-only memory-use receipts for context packs", () => {
    const { ledger, close } = createTestLedger();

    try {
      const claim = ledger.addClaim({
        subject: "project.status",
        predicate: "is",
        object: "blocked",
        author: "agent.alpha",
        sessionId: "sess-1",
        trigger: "inference",
        confidence: 0.4
      });

      const pack = ledger.generateContextPack({
        query: "blocked",
        outputFormat: "json"
      });
      const receipts = ledger.listMemoryUseReceipts();
      const receipt = ledger.getMemoryUseReceipt(pack.receipt.id);

      expect(receipts.map((entry) => entry.id)).toEqual([pack.receipt.id]);
      expect(receipt.query).toBe("blocked");
      expect(receipt.outputFormat).toBe("json");
      expect(receipt.includedClaimIds).toEqual([claim.id]);
    } finally {
      close();
    }
  });

  it("supersedes a claim by creating a new claim and a supersede event", () => {
    const { ledger, close } = createTestLedger();

    try {
      const original = ledger.addClaim({
        subject: "user.preference",
        predicate: "prefers",
        object: "oat milk",
        author: "agent.alpha",
        sessionId: "sess-1",
        trigger: "assumption",
        confidence: 0.7
      });

      const result = ledger.supersedeClaim({
        targetClaimId: original.id,
        subject: "user.preference",
        predicate: "prefers",
        object: "soy milk",
        author: "agent.alpha",
        sessionId: "sess-2",
        confidence: 0.95,
        reason: "User explicitly corrected the earlier assumption."
      });

      const originalAfter = ledger.getClaim(original.id);
      const newClaim = ledger.getClaim(result.newClaim.id);
      const originalHistory = ledger.getClaimHistory(original.id);

      expect(result.event.eventType).toBe("claim_superseded");
      expect(originalAfter?.supersededByClaimId).toBe(result.newClaim.id);
      expect(originalAfter?.currentConfidence).toBe(0.25);
      expect(newClaim?.supersedesClaimId).toBe(original.id);
      expect(newClaim?.object).toBe("soy milk");
      expect(originalHistory.outcomes.map((outcome) => outcome.eventType)).toEqual([
        "superseded"
      ]);
    } finally {
      close();
    }
  });

  it("shows immediate local lineage for A -> B", () => {
    const { ledger, close } = createTestLedger();

    try {
      const claimA = ledger.addClaim({
        subject: "user.preference",
        predicate: "prefers",
        object: "oat milk",
        author: "agent.alpha",
        sessionId: "sess-1",
        trigger: "assumption",
        confidence: 0.7
      });

      const { newClaim: claimB } = ledger.supersedeClaim({
        targetClaimId: claimA.id,
        subject: "user.preference",
        predicate: "prefers",
        object: "soy milk",
        author: "agent.alpha",
        sessionId: "sess-2",
        confidence: 0.95,
        reason: "User explicitly corrected the earlier assumption."
      });

      expect(summarizeHistory(claimA.id, ledger)).toEqual([
        {
          eventType: "claim_added",
          claimId: claimA.id,
          relatedClaimId: null
        },
        {
          eventType: "claim_added",
          claimId: claimB.id,
          relatedClaimId: claimA.id
        },
        {
          eventType: "claim_superseded",
          claimId: claimA.id,
          relatedClaimId: claimB.id
        }
      ]);

      expect(summarizeHistory(claimB.id, ledger)).toEqual([
        {
          eventType: "claim_added",
          claimId: claimB.id,
          relatedClaimId: claimA.id
        },
        {
          eventType: "claim_superseded",
          claimId: claimA.id,
          relatedClaimId: claimB.id
        }
      ]);

      expect(summarizeOutcomes(claimA.id, ledger)).toEqual([
        {
          eventType: "superseded",
          claimId: claimA.id,
          relatedClaimId: claimB.id
        }
      ]);

      expect(summarizeOutcomes(claimB.id, ledger)).toEqual([]);
    } finally {
      close();
    }
  });

  it("fails cleanly when superseding a nonexistent claim", () => {
    const { ledger, close } = createTestLedger();

    try {
      expect(() =>
        ledger.supersedeClaim({
          targetClaimId: "missing",
          subject: "user.preference",
          predicate: "prefers",
          object: "soy milk",
          author: "agent.alpha",
          sessionId: "sess-2",
          confidence: 0.95
        })
      ).toThrowError("Claim missing was not found.");
    } finally {
      close();
    }
  });

  it("shows immediate local lineage only for A -> B -> C", () => {
    const { ledger, close } = createTestLedger();

    try {
      const claimA = ledger.addClaim({
        subject: "user.preference",
        predicate: "prefers",
        object: "oat milk",
        author: "agent.alpha",
        sessionId: "sess-1",
        trigger: "assumption",
        confidence: 0.7
      });

      const { newClaim: claimB } = ledger.supersedeClaim({
        targetClaimId: claimA.id,
        subject: "user.preference",
        predicate: "prefers",
        object: "soy milk",
        author: "agent.alpha",
        sessionId: "sess-2",
        confidence: 0.95,
        reason: "User explicitly corrected the earlier assumption."
      });

      const { newClaim: claimC } = ledger.supersedeClaim({
        targetClaimId: claimB.id,
        subject: "user.preference",
        predicate: "prefers",
        object: "almond milk",
        author: "agent.alpha",
        sessionId: "sess-3",
        confidence: 0.9,
        reason: "User corrected the second claim too."
      });

      expect(summarizeHistory(claimA.id, ledger)).toEqual([
        {
          eventType: "claim_added",
          claimId: claimA.id,
          relatedClaimId: null
        },
        {
          eventType: "claim_added",
          claimId: claimB.id,
          relatedClaimId: claimA.id
        },
        {
          eventType: "claim_superseded",
          claimId: claimA.id,
          relatedClaimId: claimB.id
        }
      ]);

      expect(summarizeHistory(claimB.id, ledger)).toEqual([
        {
          eventType: "claim_added",
          claimId: claimB.id,
          relatedClaimId: claimA.id
        },
        {
          eventType: "claim_superseded",
          claimId: claimA.id,
          relatedClaimId: claimB.id
        },
        {
          eventType: "claim_added",
          claimId: claimC.id,
          relatedClaimId: claimB.id
        },
        {
          eventType: "claim_superseded",
          claimId: claimB.id,
          relatedClaimId: claimC.id
        }
      ]);

      expect(summarizeHistory(claimC.id, ledger)).toEqual([
        {
          eventType: "claim_added",
          claimId: claimC.id,
          relatedClaimId: claimB.id
        },
        {
          eventType: "claim_superseded",
          claimId: claimB.id,
          relatedClaimId: claimC.id
        }
      ]);

      expect(summarizeOutcomes(claimA.id, ledger)).toEqual([
        {
          eventType: "superseded",
          claimId: claimA.id,
          relatedClaimId: claimB.id
        }
      ]);

      expect(summarizeOutcomes(claimB.id, ledger)).toEqual([
        {
          eventType: "superseded",
          claimId: claimB.id,
          relatedClaimId: claimC.id
        }
      ]);

      expect(summarizeOutcomes(claimC.id, ledger)).toEqual([]);
    } finally {
      close();
    }
  });

  it("rejects superseding the same claim twice in v0.2", () => {
    const { ledger, close } = createTestLedger();

    try {
      const original = ledger.addClaim({
        subject: "user.preference",
        predicate: "prefers",
        object: "oat milk",
        author: "agent.alpha",
        sessionId: "sess-1",
        trigger: "assumption",
        confidence: 0.7
      });

      ledger.supersedeClaim({
        targetClaimId: original.id,
        subject: "user.preference",
        predicate: "prefers",
        object: "soy milk",
        author: "agent.alpha",
        sessionId: "sess-2",
        confidence: 0.95
      });

      expect(() =>
        ledger.supersedeClaim({
          targetClaimId: original.id,
          subject: "user.preference",
          predicate: "prefers",
          object: "almond milk",
          author: "agent.gamma",
          sessionId: "sess-3",
          confidence: 0.6
        })
      ).toThrowError(/already superseded/i);
    } finally {
      close();
    }
  });
});
