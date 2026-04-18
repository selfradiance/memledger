import type {
  ClaimHistory,
  ClaimParts,
  ClaimState,
  LedgerEvent,
  MemoryOutcome
} from "./types.js";

export function formatClaimStatement(claim: ClaimParts): string {
  return `${claim.subject} ${claim.predicate} ${claim.object}`;
}

export function formatClaimStatus(claim: ClaimState): string {
  const statuses: string[] = [];

  if (claim.contested) {
    statuses.push(`contested x${claim.contestCount}`);
  }

  if (claim.supersededByClaimId) {
    statuses.push(`superseded by ${claim.supersededByClaimId}`);
  }

  if (statuses.length === 0) {
    statuses.push("active");
  }

  return statuses.join(", ");
}

export function formatClaim(claim: ClaimState): string {
  const links: string[] = [];

  if (claim.supersedesClaimId) {
    links.push(`supersedes=${claim.supersedesClaimId}`);
  }

  if (claim.supersededByClaimId) {
    links.push(`supersededBy=${claim.supersededByClaimId}`);
  }

  return [
    `${claim.id} [${formatClaimStatus(claim)}]`,
    `  claim: ${formatClaimStatement(claim)}`,
    `  author: ${claim.author}`,
    `  session: ${claim.sessionId}`,
    `  trigger: ${claim.trigger}`,
    `  baseConfidence: ${claim.confidence.toFixed(2)}`,
    `  currentConfidence: ${claim.currentConfidence.toFixed(2)}`,
    `  created: ${claim.createdAt}`,
    links.length > 0 ? `  links: ${links.join(" ")}` : null
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}

export function formatClaimList(claims: ClaimState[]): string {
  if (claims.length === 0) {
    return "No claims found.";
  }

  return claims.map((claim) => formatClaim(claim)).join("\n\n");
}

export function formatEvent(event: LedgerEvent): string {
  if (event.payload.eventType === "claim_added") {
    const links = event.payload.supersedesClaimId
      ? ` supersedes=${event.payload.supersedesClaimId}`
      : "";

    return `${event.createdAt} ${event.eventType} claim=${event.claimId} actor=${event.actor} statement="${formatClaimStatement(
      event.payload.claim
    )}" trigger=${event.payload.trigger} confidence=${event.payload.confidence.toFixed(2)}${links}`;
  }

  if (event.payload.eventType === "claim_contested") {
    return `${event.createdAt} ${event.eventType} claim=${event.claimId} actor=${event.actor} reason="${event.payload.reason}"`;
  }

  const reason = event.payload.reason
    ? ` reason="${event.payload.reason}"`
    : "";

  return `${event.createdAt} ${event.eventType} claim=${event.claimId} actor=${event.actor} replacement=${event.payload.supersedingClaimId}${reason}`;
}

export function formatClaimHistory(history: ClaimHistory): string {
  return [
    formatClaim(history.claim),
    "Local Events:",
    formatHistoryLines(history.events)
  ].join("\n");
}

export function formatLedgerHistory(events: LedgerEvent[]): string {
  if (events.length === 0) {
    return "No history yet.";
  }

  return formatHistoryLines(events);
}

export function formatMemoryOutcome(outcome: MemoryOutcome): string {
  const relatedClaim = outcome.relatedClaimId
    ? ` relatedClaim=${outcome.relatedClaimId}`
    : "";
  const notes = outcome.notes ? ` notes="${outcome.notes}"` : "";

  return `${outcome.createdAt} ${outcome.eventType} claim=${outcome.claimId} source=${outcome.source}${relatedClaim}${notes}`;
}

export function formatClaimReport(history: ClaimHistory): string {
  return [
    formatClaim(history.claim),
    "Local Events:",
    formatHistoryLines(history.events),
    "Outcomes:",
    formatOutcomeLines(history.outcomes)
  ].join("\n");
}

function formatHistoryLines(events: LedgerEvent[]): string {
  if (events.length === 0) {
    return "  (none)";
  }

  return events.map((event) => `  - ${formatEvent(event)}`).join("\n");
}

function formatOutcomeLines(outcomes: MemoryOutcome[]): string {
  if (outcomes.length === 0) {
    return "  (none)";
  }

  return outcomes.map((outcome) => `  - ${formatMemoryOutcome(outcome)}`).join("\n");
}
