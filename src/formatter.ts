import type {
  ClaimAudit,
  ClaimHistory,
  ClaimParts,
  ClaimSearchResult,
  ClaimState,
  ContextPack,
  LedgerEvent,
  MemoryUseReceipt,
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
    claim.project ? `  project: ${claim.project}` : null,
    claim.type ? `  type: ${claim.type}` : null,
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

export function formatClaimAudit(audit: ClaimAudit): string {
  const evidenceNote = audit.evidenceNote
    ? ` evidenceNote="${audit.evidenceNote}"`
    : "";

  return `${audit.createdAt} audit=${audit.id} claim=${audit.claimId} auditor=${audit.auditor} verdict=${audit.verdict} recommendedAction=${audit.recommendedAction} reason="${audit.reason}"${evidenceNote}`;
}

export function formatClaimAuditList(audits: ClaimAudit[]): string {
  if (audits.length === 0) {
    return "No audits found.";
  }

  return audits.map((audit) => formatClaimAudit(audit)).join("\n");
}

export function formatClaimReport(history: ClaimHistory): string {
  return [
    formatClaim(history.claim),
    "Local Events:",
    formatHistoryLines(history.events),
    "Outcomes:",
    formatOutcomeLines(history.outcomes),
    "Audits:",
    formatAuditLines(history.audits)
  ].join("\n");
}

export function formatSearchResults(result: ClaimSearchResult): string {
  return [
    `Search: ${result.query}`,
    `Retrieval method: ${result.retrievalMethod}`,
    `Limit: ${result.limit}`,
    formatFilters(result.filters),
    "Included Claims:",
    formatContextClaimLines(result.included),
    "Excluded / Warned Claims:",
    formatExcludedClaimLines(result.excluded)
  ].join("\n");
}

export function formatSearchResultsJson(result: ClaimSearchResult): string {
  return `${JSON.stringify(toSearchJson(result), null, 2)}\n`;
}

export function formatContextPackMarkdown(pack: ContextPack): string {
  return [
    "# MemLedger Context Pack",
    "",
    `Query: ${pack.search.query}`,
    `Generated: ${pack.receipt.createdAt}`,
    `Retrieval method: ${pack.search.retrievalMethod}`,
    "",
    "Memory claims are inspectable records, not guaranteed facts.",
    "",
    "## Included Claims",
    formatContextClaimLines(pack.search.included),
    "",
    "## Excluded / Warned Claims",
    formatExcludedClaimLines(pack.search.excluded),
    "",
    "## Memory-Use Receipt",
    `receipt_id: ${pack.receipt.id}`,
    `claims_included: ${JSON.stringify(pack.receipt.includedClaimIds)}`,
    `claims_excluded: ${JSON.stringify(pack.receipt.excludedClaimIds)}`,
    `exclusion_reasons: ${JSON.stringify(pack.receipt.exclusionReasons)}`,
    `output_format: ${pack.receipt.outputFormat}`,
    `schema_version: ${pack.receipt.schemaVersion}`
  ].join("\n");
}

export function formatContextPackJson(pack: ContextPack): string {
  return `${JSON.stringify(
    {
      query: pack.search.query,
      generated: pack.receipt.createdAt,
      retrievalMethod: pack.search.retrievalMethod,
      note: "Memory claims are inspectable records, not guaranteed facts.",
      includedClaims: pack.search.included.map(toClaimJson),
      excludedClaims: pack.search.excluded.map(toExcludedClaimJson),
      receipt: toReceiptJson(pack.receipt)
    },
    null,
    2
  )}\n`;
}

export function formatMemoryUseReceiptList(
  receipts: MemoryUseReceipt[]
): string {
  if (receipts.length === 0) {
    return "No receipts found.";
  }

  return receipts
    .map(
      (receipt) =>
        `${receipt.createdAt} receipt=${receipt.id} query="${receipt.query}" retrieval=${receipt.retrievalMethod} included=${JSON.stringify(
          receipt.includedClaimIds
        )} excluded=${JSON.stringify(receipt.excludedClaimIds)} format=${receipt.outputFormat}`
    )
    .join("\n");
}

export function formatMemoryUseReceipt(receipt: MemoryUseReceipt): string {
  return [
    `receipt_id: ${receipt.id}`,
    `timestamp: ${receipt.createdAt}`,
    `query: ${receipt.query}`,
    `retrievalMethod: ${receipt.retrievalMethod}`,
    `retrievalVersion: ${receipt.retrievalVersion}`,
    `filters: ${JSON.stringify(receipt.filters)}`,
    `includedClaimIds: ${JSON.stringify(receipt.includedClaimIds)}`,
    `excludedClaimIds: ${JSON.stringify(receipt.excludedClaimIds)}`,
    `exclusionReasons: ${JSON.stringify(receipt.exclusionReasons)}`,
    `outputFormat: ${receipt.outputFormat}`,
    `schemaVersion: ${receipt.schemaVersion}`
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

function formatAuditLines(audits: ClaimAudit[]): string {
  if (audits.length === 0) {
    return "  (none)";
  }

  return audits.map((audit) => `  - ${formatClaimAudit(audit)}`).join("\n");
}

function formatFilters(filters: { project: string | null; type: string | null }): string {
  const activeFilters: string[] = [];

  if (filters.project !== null) {
    activeFilters.push(`project=${filters.project}`);
  }

  if (filters.type !== null) {
    activeFilters.push(`type=${filters.type}`);
  }

  return `Filters: ${activeFilters.length > 0 ? activeFilters.join(" ") : "(none)"}`;
}

function formatContextClaimLines(claims: ClaimState[]): string {
  if (claims.length === 0) {
    return "- (none)";
  }

  return claims
    .map((claim) => {
      const lines = [
        `- ${claim.id} - ${formatClaimStatement(claim)}`,
        `  Status: ${formatClaimStatus(claim)}`,
        claim.type ? `  Type: ${claim.type}` : null,
        claim.project ? `  Project: ${claim.project}` : null,
        `  Trigger: ${claim.trigger}`,
        `  Confidence: base=${claim.confidence.toFixed(2)} current=${claim.currentConfidence.toFixed(2)}`
      ];

      return lines.filter((line): line is string => line !== null).join("\n");
    })
    .join("\n");
}

function formatExcludedClaimLines(
  excluded: ClaimSearchResult["excluded"]
): string {
  if (excluded.length === 0) {
    return "- (none)";
  }

  return excluded
    .map(({ claim, reasons }) => {
      const details = reasons.map((reason) => {
        if (reason === "superseded" && claim.supersededByClaimId) {
          return `superseded by ${claim.supersededByClaimId}`;
        }

        return reason;
      });

      return `- ${claim.id} - excluded: ${details.join(", ")} - ${formatClaimStatement(
        claim
      )}`;
    })
    .join("\n");
}

function toSearchJson(result: ClaimSearchResult): object {
  return {
    query: result.query,
    retrievalMethod: result.retrievalMethod,
    filters: result.filters,
    limit: result.limit,
    includedClaims: result.included.map(toClaimJson),
    excludedClaims: result.excluded.map(toExcludedClaimJson)
  };
}

function toClaimJson(claim: ClaimState): object {
  return {
    id: claim.id,
    statement: formatClaimStatement(claim),
    subject: claim.subject,
    predicate: claim.predicate,
    object: claim.object,
    project: claim.project,
    type: claim.type,
    status: formatClaimStatus(claim),
    trigger: claim.trigger,
    confidence: claim.confidence,
    currentConfidence: claim.currentConfidence,
    supersedesClaimId: claim.supersedesClaimId,
    supersededByClaimId: claim.supersededByClaimId,
    contested: claim.contested
  };
}

function toExcludedClaimJson(
  entry: ClaimSearchResult["excluded"][number]
): object {
  return {
    ...toClaimJson(entry.claim),
    exclusionReasons: entry.reasons
  };
}

function toReceiptJson(receipt: MemoryUseReceipt): object {
  return {
    receipt_id: receipt.id,
    timestamp: receipt.createdAt,
    query: receipt.query,
    retrieval_method: receipt.retrievalMethod,
    filters: receipt.filters,
    included_claim_ids: receipt.includedClaimIds,
    excluded_claim_ids: receipt.excludedClaimIds,
    exclusion_reasons: receipt.exclusionReasons,
    output_format: receipt.outputFormat,
    retrieval_version: receipt.retrievalVersion,
    schema_version: receipt.schemaVersion
  };
}
