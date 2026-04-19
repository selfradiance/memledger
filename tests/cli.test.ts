import { afterEach, describe, expect, it } from "vitest";

import { runCli } from "../src/cli.js";
import { createTestLedger } from "./test-helpers.js";

function createCliHarness() {
  const { ledger, close } = createTestLedger();
  const stdout: string[] = [];
  const stderr: string[] = [];

  return {
    stdout,
    stderr,
    close,
    dependencies: {
      io: {
        stdout: (message: string) => {
          stdout.push(message);
        },
        stderr: (message: string) => {
          stderr.push(message);
        }
      },
      createLedger: () => ({
        ledger,
        close: () => {}
      })
    }
  };
}

describe("cli", () => {
  const cleanups: Array<() => void> = [];

  afterEach(() => {
    while (cleanups.length > 0) {
      cleanups.pop()?.();
    }
  });

  it("prints an error for an unknown command", () => {
    const harness = createCliHarness();
    cleanups.push(harness.close);

    const exitCode = runCli(["unknown"], harness.dependencies);

    expect(exitCode).toBe(1);
    expect(harness.stderr.join("")).toContain('Unknown command "unknown"');
  });

  it("prints an error when required add flags are missing", () => {
    const harness = createCliHarness();
    cleanups.push(harness.close);

    const exitCode = runCli(
      [
        "add",
        "--subject",
        "user.preference",
        "--object",
        "oat milk",
        "--author",
        "agent.alpha",
        "--session",
        "sess-1",
        "--trigger",
        "assumption",
        "--confidence",
        "0.7"
      ],
      harness.dependencies
    );

    expect(exitCode).toBe(1);
    expect(harness.stderr.join("")).toContain("Missing required option --predicate");
  });

  it("returns a clean error when history is requested for a missing claim", () => {
    const harness = createCliHarness();
    cleanups.push(harness.close);

    const exitCode = runCli(["history", "--id", "missing"], harness.dependencies);

    expect(exitCode).toBe(1);
    expect(harness.stderr.join("")).toContain("Claim missing was not found");
  });

  it("returns a clean error when contesting a missing claim", () => {
    const harness = createCliHarness();
    cleanups.push(harness.close);

    const exitCode = runCli(
      [
        "contest",
        "--id",
        "missing",
        "--actor",
        "agent.beta",
        "--session",
        "sess-2",
        "--reason",
        "This claim does not exist."
      ],
      harness.dependencies
    );

    expect(exitCode).toBe(1);
    expect(harness.stderr.join("")).toContain("Claim missing was not found");
  });

  it("returns a clean error when superseding a missing claim", () => {
    const harness = createCliHarness();
    cleanups.push(harness.close);

    const exitCode = runCli(
      [
        "supersede",
        "--id",
        "missing",
        "--subject",
        "user.preference",
        "--predicate",
        "prefers",
        "--object",
        "soy milk",
        "--author",
        "agent.alpha",
        "--session",
        "sess-2",
        "--confidence",
        "0.95"
      ],
      harness.dependencies
    );

    expect(exitCode).toBe(1);
    expect(harness.stderr.join("")).toContain("Claim missing was not found");
  });

  it("rejects an invalid trigger at CLI validation time", () => {
    const harness = createCliHarness();
    cleanups.push(harness.close);

    const exitCode = runCli(
      [
        "add",
        "--subject",
        "project.status",
        "--predicate",
        "is",
        "--object",
        "blocked",
        "--author",
        "agent.alpha",
        "--session",
        "sess-1",
        "--trigger",
        "bad_trigger",
        "--confidence",
        "0.4"
      ],
      harness.dependencies
    );

    expect(exitCode).toBe(1);
    expect(harness.stderr.join("")).toContain('Invalid trigger "bad_trigger"');
  });

  it("rejects an out-of-range confidence at CLI validation time", () => {
    const harness = createCliHarness();
    cleanups.push(harness.close);

    const exitCode = runCli(
      [
        "add",
        "--subject",
        "project.status",
        "--predicate",
        "is",
        "--object",
        "blocked",
        "--author",
        "agent.alpha",
        "--session",
        "sess-1",
        "--trigger",
        "inference",
        "--confidence",
        "1.2"
      ],
      harness.dependencies
    );

    expect(exitCode).toBe(1);
    expect(harness.stderr.join("")).toContain('Invalid confidence "1.2"');
  });

  it("rejects an invalid list status at CLI validation time", () => {
    const harness = createCliHarness();
    cleanups.push(harness.close);

    const exitCode = runCli(["list", "--status", "wrong"], harness.dependencies);

    expect(exitCode).toBe(1);
    expect(harness.stderr.join("")).toContain('Invalid status "wrong"');
  });

  it("rejects an invalid outcome event type at CLI validation time", () => {
    const harness = createCliHarness();
    cleanups.push(harness.close);

    const exitCode = runCli(
      [
        "record-outcome",
        "--id",
        "clm_1",
        "--event-type",
        "not_real",
        "--source",
        "operator"
      ],
      harness.dependencies
    );

    expect(exitCode).toBe(1);
    expect(harness.stderr.join("")).toContain('Invalid event type "not_real"');
  });

  it("rejects an invalid audit verdict at CLI validation time", () => {
    const harness = createCliHarness();
    cleanups.push(harness.close);

    const exitCode = runCli(
      [
        "audit-claim",
        "--claim-id",
        "clm_1",
        "--auditor",
        "review.bot",
        "--verdict",
        "approve",
        "--reason",
        "Looks good.",
        "--recommended-action",
        "none"
      ],
      harness.dependencies
    );

    expect(exitCode).toBe(1);
    expect(harness.stderr.join("")).toContain('Invalid verdict "approve"');
  });

  it("rejects an invalid audit recommended action at CLI validation time", () => {
    const harness = createCliHarness();
    cleanups.push(harness.close);

    const exitCode = runCli(
      [
        "audit-claim",
        "--claim-id",
        "clm_1",
        "--auditor",
        "review.bot",
        "--verdict",
        "supports",
        "--reason",
        "Looks good.",
        "--recommended-action",
        "auto_fix"
      ],
      harness.dependencies
    );

    expect(exitCode).toBe(1);
    expect(harness.stderr.join("")).toContain(
      'Invalid recommended action "auto_fix"'
    );
  });

  it("rejects manual superseded outcomes at CLI validation time", () => {
    const harness = createCliHarness();
    cleanups.push(harness.close);

    const exitCode = runCli(
      [
        "record-outcome",
        "--id",
        "clm_1",
        "--event-type",
        "superseded",
        "--source",
        "operator",
        "--related-claim-id",
        "clm_2"
      ],
      harness.dependencies
    );

    expect(exitCode).toBe(1);
    expect(harness.stderr.join("")).toContain('Invalid event type "superseded"');
  });

  it("returns a clean error when auditing a missing claim", () => {
    const harness = createCliHarness();
    cleanups.push(harness.close);

    const exitCode = runCli(
      [
        "audit-claim",
        "--claim-id",
        "missing",
        "--auditor",
        "review.bot",
        "--verdict",
        "questions",
        "--reason",
        "No supporting source found.",
        "--recommended-action",
        "contest"
      ],
      harness.dependencies
    );

    expect(exitCode).toBe(1);
    expect(harness.stderr.join("")).toContain("Claim missing was not found");
  });

  it("rejects an unknown flag instead of ignoring it", () => {
    const harness = createCliHarness();
    cleanups.push(harness.close);

    const exitCode = runCli(
      [
        "add",
        "--subject",
        "project.status",
        "--predicate",
        "is",
        "--object",
        "blocked",
        "--author",
        "agent.alpha",
        "--session",
        "sess-1",
        "--trigger",
        "inference",
        "--confidence",
        "0.4",
        "--unexpected",
        "value"
      ],
      harness.dependencies
    );

    expect(exitCode).toBe(1);
    expect(harness.stderr.join("")).toContain(
      "Unknown option --unexpected for command add"
    );
  });

  it("can add and list claims through the CLI harness", () => {
    const harness = createCliHarness();
    cleanups.push(harness.close);

    const addExitCode = runCli(
      [
        "add",
        "--subject",
        "project.status",
        "--predicate",
        "is",
        "--object",
        "blocked",
        "--author",
        "agent.alpha",
        "--session",
        "sess-1",
        "--trigger",
        "inference",
        "--confidence",
        "0.4"
      ],
      harness.dependencies
    );

    const listExitCode = runCli(["list"], harness.dependencies);

    expect(addExitCode).toBe(0);
    expect(listExitCode).toBe(0);
    expect(harness.stdout.join("")).toContain("project.status is blocked");
  });

  it("records an outcome and shows updated confidence", () => {
    const harness = createCliHarness();
    cleanups.push(harness.close);

    const addExitCode = runCli(
      [
        "add",
        "--subject",
        "project.status",
        "--predicate",
        "is",
        "--object",
        "blocked",
        "--author",
        "agent.alpha",
        "--session",
        "sess-1",
        "--trigger",
        "inference",
        "--confidence",
        "0.4"
      ],
      harness.dependencies
    );

    const claimIdMatch = harness.stdout.join("").match(/added (clm_\d+)/);
    const claimId = claimIdMatch?.[1];

    expect(addExitCode).toBe(0);
    expect(claimId).toBeDefined();

    const outcomeExitCode = runCli(
      [
        "record-outcome",
        "--id",
        claimId as string,
        "--event-type",
        "observed_hold",
        "--source",
        "operator",
        "--notes",
        "Held when checked."
      ],
      harness.dependencies
    );

    const showExitCode = runCli(
      ["show-claim", "--id", claimId as string],
      harness.dependencies
    );

    expect(outcomeExitCode).toBe(0);
    expect(showExitCode).toBe(0);
    expect(harness.stdout.join("")).toContain("observed_hold");
    expect(harness.stdout.join("")).toContain("currentConfidence: 0.44");
    expect(harness.stdout.join("")).toContain("Outcomes:");
  });

  it("adds an audit through the CLI harness", () => {
    const harness = createCliHarness();
    cleanups.push(harness.close);

    const addExitCode = runCli(
      [
        "add",
        "--subject",
        "project.status",
        "--predicate",
        "is",
        "--object",
        "blocked",
        "--author",
        "agent.alpha",
        "--session",
        "sess-1",
        "--trigger",
        "inference",
        "--confidence",
        "0.4"
      ],
      harness.dependencies
    );

    const claimIdMatch = harness.stdout.join("").match(/added (clm_\d+)/);
    const claimId = claimIdMatch?.[1];

    expect(addExitCode).toBe(0);
    expect(claimId).toBeDefined();

    const auditExitCode = runCli(
      [
        "audit-claim",
        "--claim-id",
        claimId as string,
        "--auditor",
        "review.bot",
        "--verdict",
        "questions",
        "--reason",
        "No direct artifact is attached.",
        "--evidence-note",
        "Missing build log.",
        "--recommended-action",
        "contest"
      ],
      harness.dependencies
    );

    expect(auditExitCode).toBe(0);
    expect(harness.stdout.join("")).toContain("audited");
    expect(harness.stdout.join("")).toContain("verdict=questions");
    expect(harness.stdout.join("")).toContain("recommendedAction=contest");
  });

  it("shows audits for a claim through the CLI harness", () => {
    const harness = createCliHarness();
    cleanups.push(harness.close);

    const addExitCode = runCli(
      [
        "add",
        "--subject",
        "project.status",
        "--predicate",
        "is",
        "--object",
        "blocked",
        "--author",
        "agent.alpha",
        "--session",
        "sess-1",
        "--trigger",
        "inference",
        "--confidence",
        "0.4"
      ],
      harness.dependencies
    );

    const claimIdMatch = harness.stdout.join("").match(/added (clm_\d+)/);
    const claimId = claimIdMatch?.[1];

    expect(addExitCode).toBe(0);
    expect(claimId).toBeDefined();

    const auditExitCode = runCli(
      [
        "audit-claim",
        "--claim-id",
        claimId as string,
        "--auditor",
        "review.bot",
        "--verdict",
        "insufficient_evidence",
        "--reason",
        "No artifact is attached.",
        "--recommended-action",
        "manual_correction"
      ],
      harness.dependencies
    );

    const showExitCode = runCli(
      ["show-audits", "--claim-id", claimId as string],
      harness.dependencies
    );

    expect(auditExitCode).toBe(0);
    expect(showExitCode).toBe(0);
    expect(harness.stdout.join("")).toContain("audit=");
    expect(harness.stdout.join("")).toContain("auditor=review.bot");
    expect(harness.stdout.join("")).toContain(
      "verdict=insufficient_evidence"
    );
    expect(harness.stdout.join("")).toContain(
      "recommendedAction=manual_correction"
    );
    expect(harness.stdout.join("")).toContain('reason="No artifact is attached."');
  });

  it("includes audits in show-claim output", () => {
    const harness = createCliHarness();
    cleanups.push(harness.close);

    const addExitCode = runCli(
      [
        "add",
        "--subject",
        "project.status",
        "--predicate",
        "is",
        "--object",
        "blocked",
        "--author",
        "agent.alpha",
        "--session",
        "sess-1",
        "--trigger",
        "inference",
        "--confidence",
        "0.4"
      ],
      harness.dependencies
    );

    const claimIdMatch = harness.stdout.join("").match(/added (clm_\d+)/);
    const claimId = claimIdMatch?.[1];

    expect(addExitCode).toBe(0);
    expect(claimId).toBeDefined();

    const auditExitCode = runCli(
      [
        "audit-claim",
        "--claim-id",
        claimId as string,
        "--auditor",
        "review.bot",
        "--verdict",
        "questions",
        "--reason",
        "Needs a direct source excerpt.",
        "--recommended-action",
        "contest"
      ],
      harness.dependencies
    );

    const showExitCode = runCli(
      ["show-claim", "--id", claimId as string],
      harness.dependencies
    );

    expect(auditExitCode).toBe(0);
    expect(showExitCode).toBe(0);
    expect(harness.stdout.join("")).toContain("Audits:");
    expect(harness.stdout.join("")).toContain("auditor=review.bot");
    expect(harness.stdout.join("")).toContain("verdict=questions");
  });
});
