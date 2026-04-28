export const CLAIM_TRIGGERS = [
  "task_completion",
  "correction",
  "assumption",
  "inference"
] as const;

export type ClaimTrigger = (typeof CLAIM_TRIGGERS)[number];

export const EVENT_TYPES = [
  "claim_added",
  "claim_contested",
  "claim_superseded"
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

export const MEMORY_OUTCOME_EVENT_TYPES = [
  "observed_hold",
  "observed_fail",
  "superseded",
  "manual_correction"
] as const;

export type MemoryOutcomeEventType =
  (typeof MEMORY_OUTCOME_EVENT_TYPES)[number];

export const MANUAL_MEMORY_OUTCOME_EVENT_TYPES = [
  "observed_hold",
  "observed_fail",
  "manual_correction"
] as const;

export type ManualMemoryOutcomeEventType =
  (typeof MANUAL_MEMORY_OUTCOME_EVENT_TYPES)[number];

export const CLAIM_STATUS_FILTERS = [
  "all",
  "active",
  "contested",
  "superseded"
] as const;

export type ClaimStatusFilter = (typeof CLAIM_STATUS_FILTERS)[number];

export const CONTEXT_PACK_FORMATS = ["markdown", "json"] as const;

export type ContextPackFormat = (typeof CONTEXT_PACK_FORMATS)[number];

export const SEARCH_OUTPUT_FORMATS = ["text", "json"] as const;

export type SearchOutputFormat = (typeof SEARCH_OUTPUT_FORMATS)[number];

export const CLAIM_EXCLUSION_REASONS = [
  "superseded",
  "contested",
  "project_mismatch",
  "type_mismatch",
  "limit"
] as const;

export type ClaimExclusionReason =
  (typeof CLAIM_EXCLUSION_REASONS)[number];

export const CLAIM_AUDIT_VERDICTS = [
  "supports",
  "questions",
  "rejects",
  "insufficient_evidence"
] as const;

export type ClaimAuditVerdict = (typeof CLAIM_AUDIT_VERDICTS)[number];

export const CLAIM_AUDIT_RECOMMENDED_ACTIONS = [
  "none",
  "contest",
  "supersede",
  "manual_correction"
] as const;

export type ClaimAuditRecommendedAction =
  (typeof CLAIM_AUDIT_RECOMMENDED_ACTIONS)[number];

export interface ClaimParts {
  subject: string;
  predicate: string;
  object: string;
}

export interface OutcomeTrackingStub {
  status: "stub";
  note: string | null;
}

export interface ClaimRecord extends ClaimParts {
  id: string;
  project: string | null;
  type: string | null;
  author: string;
  sessionId: string;
  trigger: ClaimTrigger;
  confidence: number;
  createdAt: string;
  supersedesClaimId: string | null;
  outcomeTracking: OutcomeTrackingStub;
}

export interface ClaimState extends ClaimRecord {
  contested: boolean;
  contestCount: number;
  supersededByClaimId: string | null;
  currentConfidence: number;
}

export interface ClaimAddedPayload {
  eventType: "claim_added";
  claim: ClaimParts;
  confidence: number;
  trigger: ClaimTrigger;
  supersedesClaimId: string | null;
}

export interface ClaimContestedPayload {
  eventType: "claim_contested";
  reason: string;
}

export interface ClaimSupersededPayload {
  eventType: "claim_superseded";
  supersedingClaimId: string;
  reason: string | null;
}

export type LedgerEventPayload =
  | ClaimAddedPayload
  | ClaimContestedPayload
  | ClaimSupersededPayload;

export interface LedgerEvent {
  id: string;
  claimId: string;
  eventType: EventType;
  actor: string;
  sessionId: string;
  createdAt: string;
  note: string | null;
  relatedClaimId: string | null;
  payload: LedgerEventPayload;
}

export interface AddClaimInput extends ClaimParts {
  project?: string | null;
  type?: string | null;
  author: string;
  sessionId: string;
  trigger: ClaimTrigger;
  confidence: number;
}

export interface ContestClaimInput {
  claimId: string;
  actor: string;
  sessionId: string;
  reason: string;
}

export interface SupersedeClaimInput extends ClaimParts {
  targetClaimId: string;
  project?: string | null;
  type?: string | null;
  author: string;
  sessionId: string;
  trigger?: ClaimTrigger;
  confidence: number;
  reason?: string | null;
}

export interface ListClaimsOptions {
  status?: ClaimStatusFilter;
}

export interface MemoryOutcome {
  id: string;
  claimId: string;
  eventType: MemoryOutcomeEventType;
  source: string;
  notes: string | null;
  relatedClaimId: string | null;
  createdAt: string;
}

export interface RecordOutcomeInput {
  claimId: string;
  eventType: ManualMemoryOutcomeEventType;
  source: string;
  notes?: string | null;
  relatedClaimId?: string | null;
}

export interface ClaimAudit {
  id: string;
  claimId: string;
  auditor: string;
  verdict: ClaimAuditVerdict;
  reason: string;
  evidenceNote: string | null;
  recommendedAction: ClaimAuditRecommendedAction;
  createdAt: string;
}

export interface AddClaimAuditInput {
  claimId: string;
  auditor: string;
  verdict: ClaimAuditVerdict;
  reason: string;
  evidenceNote?: string | null;
  recommendedAction: ClaimAuditRecommendedAction;
}

export interface ClaimHistory {
  claim: ClaimState;
  events: LedgerEvent[];
  outcomes: MemoryOutcome[];
  audits: ClaimAudit[];
}

export interface ClaimRetrievalFilters {
  project: string | null;
  type: string | null;
}

export interface SearchClaimsInput {
  query: string;
  project?: string | null;
  type?: string | null;
  limit?: number;
}

export interface ExcludedClaimSearchResult {
  claim: ClaimState;
  reasons: ClaimExclusionReason[];
}

export interface ClaimSearchResult {
  query: string;
  retrievalMethod: "deterministic_keyword_v1";
  filters: ClaimRetrievalFilters;
  limit: number;
  included: ClaimState[];
  excluded: ExcludedClaimSearchResult[];
}

export interface MemoryUseReceipt {
  id: string;
  createdAt: string;
  query: string;
  retrievalMethod: "deterministic_keyword_v1";
  retrievalVersion: "deterministic_keyword_v1";
  filters: ClaimRetrievalFilters;
  includedClaimIds: string[];
  excludedClaimIds: string[];
  exclusionReasons: Record<string, ClaimExclusionReason[]>;
  outputFormat: ContextPackFormat;
  schemaVersion: 1;
}

export interface GenerateContextPackInput extends SearchClaimsInput {
  outputFormat?: ContextPackFormat;
}

export interface ContextPack {
  receipt: MemoryUseReceipt;
  search: ClaimSearchResult;
  outputFormat: ContextPackFormat;
}
