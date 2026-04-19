import { z } from "zod";

import {
  CLAIM_AUDIT_RECOMMENDED_ACTIONS,
  CLAIM_AUDIT_VERDICTS,
  CLAIM_STATUS_FILTERS,
  CLAIM_TRIGGERS,
  EVENT_TYPES,
  MANUAL_MEMORY_OUTCOME_EVENT_TYPES,
  MEMORY_OUTCOME_EVENT_TYPES
} from "./types.js";

const trimmedText = z.string().trim().min(1);

export const idSchema = trimmedText.max(128);
export const actorSchema = trimmedText.max(128);
export const sourceSchema = trimmedText.max(128);
export const sessionIdSchema = trimmedText.max(128);
export const reasonSchema = trimmedText.max(500);
export const nullableReasonSchema = z.union([reasonSchema, z.null()]);
export const isoTimestampSchema = z.string().datetime({ offset: true });
export const confidenceSchema = z.number().finite().min(0).max(1);
export const claimTriggerSchema = z.enum(CLAIM_TRIGGERS);
export const eventTypeSchema = z.enum(EVENT_TYPES);
export const memoryOutcomeEventTypeSchema = z.enum(MEMORY_OUTCOME_EVENT_TYPES);
export const manualMemoryOutcomeEventTypeSchema = z.enum(
  MANUAL_MEMORY_OUTCOME_EVENT_TYPES
);
export const claimStatusFilterSchema = z.enum(CLAIM_STATUS_FILTERS);
export const claimAuditVerdictSchema = z.enum(CLAIM_AUDIT_VERDICTS);
export const claimAuditRecommendedActionSchema = z.enum(
  CLAIM_AUDIT_RECOMMENDED_ACTIONS
);

export const claimPartsSchema = z.object({
  subject: trimmedText.max(200),
  predicate: trimmedText.max(120),
  object: trimmedText.max(500)
});

export const outcomeTrackingStubSchema = z.object({
  status: z.literal("stub"),
  note: z.union([trimmedText.max(500), z.null()])
});

export const claimRecordSchema = claimPartsSchema.extend({
  id: idSchema,
  author: actorSchema,
  sessionId: sessionIdSchema,
  trigger: claimTriggerSchema,
  confidence: confidenceSchema,
  createdAt: isoTimestampSchema,
  supersedesClaimId: z.union([idSchema, z.null()]),
  outcomeTracking: outcomeTrackingStubSchema
});

export const claimStateSchema = claimRecordSchema.extend({
  contested: z.boolean(),
  contestCount: z.number().int().min(0),
  supersededByClaimId: z.union([idSchema, z.null()]),
  currentConfidence: confidenceSchema
});

export const claimAddedPayloadSchema = z.object({
  eventType: z.literal("claim_added"),
  claim: claimPartsSchema,
  confidence: confidenceSchema,
  trigger: claimTriggerSchema,
  supersedesClaimId: z.union([idSchema, z.null()])
});

export const claimContestedPayloadSchema = z.object({
  eventType: z.literal("claim_contested"),
  reason: reasonSchema
});

export const claimSupersededPayloadSchema = z.object({
  eventType: z.literal("claim_superseded"),
  supersedingClaimId: idSchema,
  reason: nullableReasonSchema
});

export const ledgerEventPayloadSchema = z.discriminatedUnion("eventType", [
  claimAddedPayloadSchema,
  claimContestedPayloadSchema,
  claimSupersededPayloadSchema
]);

export const ledgerEventSchema = z.object({
  id: idSchema,
  claimId: idSchema,
  eventType: eventTypeSchema,
  actor: actorSchema,
  sessionId: sessionIdSchema,
  createdAt: isoTimestampSchema,
  note: z.union([reasonSchema, z.null()]),
  relatedClaimId: z.union([idSchema, z.null()]),
  payload: ledgerEventPayloadSchema
});

export const addClaimInputSchema = claimPartsSchema.extend({
  author: actorSchema,
  sessionId: sessionIdSchema,
  trigger: claimTriggerSchema,
  confidence: confidenceSchema
});

export const contestClaimInputSchema = z.object({
  claimId: idSchema,
  actor: actorSchema,
  sessionId: sessionIdSchema,
  reason: reasonSchema
});

export const supersedeClaimInputSchema = claimPartsSchema.extend({
  targetClaimId: idSchema,
  author: actorSchema,
  sessionId: sessionIdSchema,
  trigger: claimTriggerSchema.default("correction"),
  confidence: confidenceSchema,
  reason: z.union([reasonSchema, z.null()]).optional()
});

export const recordOutcomeInputSchema = z.object({
  claimId: idSchema,
  eventType: manualMemoryOutcomeEventTypeSchema,
  source: sourceSchema,
  notes: z.union([reasonSchema, z.null()]).optional(),
  relatedClaimId: z.union([idSchema, z.null()]).optional()
});

export const claimAuditSchema = z.object({
  id: idSchema,
  claimId: idSchema,
  auditor: actorSchema,
  verdict: claimAuditVerdictSchema,
  reason: reasonSchema,
  evidenceNote: z.union([reasonSchema, z.null()]),
  recommendedAction: claimAuditRecommendedActionSchema,
  createdAt: isoTimestampSchema
});

export const addClaimAuditInputSchema = z.object({
  claimId: idSchema,
  auditor: actorSchema,
  verdict: claimAuditVerdictSchema,
  reason: reasonSchema,
  evidenceNote: z.union([reasonSchema, z.null()]).optional(),
  recommendedAction: claimAuditRecommendedActionSchema
});

export const listClaimsOptionsSchema = z.object({
  status: claimStatusFilterSchema.default("all")
});

export const claimRowSchema = z.object({
  id: idSchema,
  subject: trimmedText.max(200),
  predicate: trimmedText.max(120),
  object: trimmedText.max(500),
  author: actorSchema,
  session_id: sessionIdSchema,
  trigger: claimTriggerSchema,
  confidence: confidenceSchema,
  created_at: isoTimestampSchema,
  supersedes_claim_id: z.union([idSchema, z.null()]),
  outcome_stub_json: z.string().min(2)
});

export const claimStateRowSchema = claimRowSchema.extend({
  contested: z.number().int().min(0).max(1),
  contest_count: z.number().int().min(0),
  superseded_by_claim_id: z.union([idSchema, z.null()])
});

export const eventRowSchema = z.object({
  id: idSchema,
  claim_id: idSchema,
  event_type: eventTypeSchema,
  actor: actorSchema,
  session_id: sessionIdSchema,
  created_at: isoTimestampSchema,
  note: z.union([reasonSchema, z.null()]),
  related_claim_id: z.union([idSchema, z.null()]),
  payload_json: z.string().min(2)
});

export const memoryOutcomeSchema = z.object({
  id: idSchema,
  claimId: idSchema,
  eventType: memoryOutcomeEventTypeSchema,
  source: sourceSchema,
  notes: z.union([reasonSchema, z.null()]),
  relatedClaimId: z.union([idSchema, z.null()]),
  createdAt: isoTimestampSchema
});

export const memoryOutcomeRowSchema = z.object({
  id: idSchema,
  claim_id: idSchema,
  event_type: memoryOutcomeEventTypeSchema,
  source: sourceSchema,
  notes: z.union([reasonSchema, z.null()]),
  related_claim_id: z.union([idSchema, z.null()]),
  created_at: isoTimestampSchema
});

export const claimAuditRowSchema = z.object({
  id: idSchema,
  claim_id: idSchema,
  auditor: actorSchema,
  verdict: claimAuditVerdictSchema,
  reason: reasonSchema,
  evidence_note: z.union([reasonSchema, z.null()]),
  recommended_action: claimAuditRecommendedActionSchema,
  created_at: isoTimestampSchema
});
