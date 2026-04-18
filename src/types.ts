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

export const CLAIM_STATUS_FILTERS = [
  "all",
  "active",
  "contested",
  "superseded"
] as const;

export type ClaimStatusFilter = (typeof CLAIM_STATUS_FILTERS)[number];

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
  author: string;
  sessionId: string;
  trigger?: ClaimTrigger;
  confidence: number;
  reason?: string | null;
}

export interface ListClaimsOptions {
  status?: ClaimStatusFilter;
}

export interface ClaimHistory {
  claim: ClaimState;
  events: LedgerEvent[];
}
