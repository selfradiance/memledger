import { randomUUID } from "node:crypto";

import type { Database as BetterSqliteDatabase } from "better-sqlite3";

import {
  addClaimAuditInputSchema,
  claimAuditRowSchema,
  claimAuditSchema,
  addClaimInputSchema,
  claimStateRowSchema,
  claimStateSchema,
  contestClaimInputSchema,
  eventRowSchema,
  generateContextPackInputSchema,
  ledgerEventPayloadSchema,
  ledgerEventSchema,
  listClaimsOptionsSchema,
  memoryUseReceiptRowSchema,
  memoryUseReceiptSchema,
  memoryOutcomeRowSchema,
  memoryOutcomeSchema,
  outcomeTrackingStubSchema,
  recordOutcomeInputSchema,
  searchClaimsInputSchema,
  supersedeClaimInputSchema
} from "./schema.js";
import { recalculateCurrentConfidence } from "./confidence.js";
import type {
  AddClaimInput,
  AddClaimAuditInput,
  ClaimExclusionReason,
  ClaimAudit,
  ClaimHistory,
  ClaimSearchResult,
  ClaimState,
  ContextPack,
  LedgerEvent,
  LedgerEventPayload,
  ListClaimsOptions,
  GenerateContextPackInput,
  MemoryUseReceipt,
  MemoryOutcome,
  RecordOutcomeInput,
  SearchClaimsInput,
  SupersedeClaimInput
} from "./types.js";

export interface LedgerDependencies {
  now?: () => string;
  createId?: (prefix: LedgerIdPrefix) => string;
}

type SqliteDatabase = BetterSqliteDatabase;
type LedgerIdPrefix = "aud" | "clm" | "evt" | "out" | "rcp";

const RETRIEVAL_METHOD = "deterministic_keyword_v1" as const;
const MEMORY_USE_RECEIPT_SCHEMA_VERSION = 1 as const;

interface ClaimStateRow {
  id: string;
  subject: string;
  predicate: string;
  object: string;
  project: string | null;
  claim_type: string | null;
  author: string;
  session_id: string;
  trigger: ClaimState["trigger"];
  confidence: number;
  created_at: string;
  supersedes_claim_id: string | null;
  outcome_stub_json: string;
  contested: number;
  contest_count: number;
  superseded_by_claim_id: string | null;
}

interface EventRow {
  id: string;
  claim_id: string;
  event_type: LedgerEvent["eventType"];
  actor: string;
  session_id: string;
  created_at: string;
  note: string | null;
  related_claim_id: string | null;
  payload_json: string;
}

interface MemoryOutcomeRow {
  id: string;
  claim_id: string;
  event_type: MemoryOutcome["eventType"];
  source: string;
  notes: string | null;
  related_claim_id: string | null;
  created_at: string;
}

interface ClaimAuditRow {
  id: string;
  claim_id: string;
  auditor: string;
  verdict: ClaimAudit["verdict"];
  reason: string;
  evidence_note: string | null;
  recommended_action: ClaimAudit["recommendedAction"];
  created_at: string;
}

interface MemoryUseReceiptRow {
  id: string;
  created_at: string;
  query: string;
  retrieval_method: "deterministic_keyword_v1";
  retrieval_version: "deterministic_keyword_v1";
  filters_json: string;
  included_claim_ids_json: string;
  excluded_claim_ids_json: string;
  exclusion_reasons_json: string;
  output_format: "markdown" | "json";
  schema_version: 1;
}

export class MemLedger {
  private readonly db: SqliteDatabase;
  private readonly now: () => string;
  private readonly createId: (prefix: LedgerIdPrefix) => string;

  constructor(db: SqliteDatabase, dependencies: LedgerDependencies = {}) {
    this.db = db;
    this.now = dependencies.now ?? (() => new Date().toISOString());
    this.createId =
      dependencies.createId ??
      ((prefix: LedgerIdPrefix) => `${prefix}_${randomUUID()}`);
  }

  addClaim(input: AddClaimInput): ClaimState {
    const parsed = addClaimInputSchema.parse(input);

    return this.db.transaction(() => {
      const claimId = this.createId("clm");
      const eventId = this.createId("evt");
      const createdAt = this.now();

      this.db
        .prepare(
          `
            INSERT INTO claims (
              id,
              subject,
              predicate,
              object,
              project,
              claim_type,
              author,
              session_id,
              trigger,
              confidence,
              created_at,
              supersedes_claim_id,
              outcome_stub_json
            ) VALUES (
              @id,
              @subject,
              @predicate,
              @object,
              @project,
              @claim_type,
              @author,
              @session_id,
              @trigger,
              @confidence,
              @created_at,
              @supersedes_claim_id,
              @outcome_stub_json
            )
          `
        )
        .run({
          id: claimId,
          subject: parsed.subject,
          predicate: parsed.predicate,
          object: parsed.object,
          project: parsed.project ?? null,
          claim_type: parsed.type ?? null,
          author: parsed.author,
          session_id: parsed.sessionId,
          trigger: parsed.trigger,
          confidence: parsed.confidence,
          created_at: createdAt,
          supersedes_claim_id: null,
          outcome_stub_json: JSON.stringify({
            status: "stub",
            note: null
          })
        });

      this.insertEvent({
        id: eventId,
        claimId,
        eventType: "claim_added",
        actor: parsed.author,
        sessionId: parsed.sessionId,
        createdAt,
        note: null,
        relatedClaimId: null,
        payload: {
          eventType: "claim_added",
          claim: {
            subject: parsed.subject,
            predicate: parsed.predicate,
            object: parsed.object
          },
          confidence: parsed.confidence,
          trigger: parsed.trigger,
          supersedesClaimId: null
        }
      });

      return this.requireClaimState(claimId);
    })();
  }

  listClaims(options: ListClaimsOptions = {}): ClaimState[] {
    const parsed = listClaimsOptionsSchema.parse({
      status: options.status ?? "all"
    });

    const rows = this.db
      .prepare(
        `
          SELECT
            c.id,
            c.subject,
            c.predicate,
            c.object,
            c.project,
            c.claim_type,
            c.author,
            c.session_id,
            c.trigger,
            c.confidence,
            c.created_at,
            c.supersedes_claim_id,
            c.outcome_stub_json,
            EXISTS(
              SELECT 1
              FROM events e
              WHERE e.claim_id = c.id
                AND e.event_type = 'claim_contested'
            ) AS contested,
            (
              SELECT COUNT(*)
              FROM events e
              WHERE e.claim_id = c.id
                AND e.event_type = 'claim_contested'
            ) AS contest_count,
            (
              SELECT child.id
              FROM claims child
              WHERE child.supersedes_claim_id = c.id
              ORDER BY child.created_at DESC, child.id DESC
              LIMIT 1
            ) AS superseded_by_claim_id
          FROM claims c
          ORDER BY c.created_at DESC, c.id DESC
        `
      )
      .all() as ClaimStateRow[];

    const claims = rows.map((row) => this.mapClaimStateRow(row));

    if (parsed.status === "all") {
      return claims;
    }

    if (parsed.status === "active") {
      return claims.filter((claim) => claim.supersededByClaimId === null);
    }

    if (parsed.status === "contested") {
      return claims.filter((claim) => claim.contested);
    }

    return claims.filter((claim) => claim.supersededByClaimId !== null);
  }

  contestClaim(input: {
    claimId: string;
    actor: string;
    sessionId: string;
    reason: string;
  }): { claim: ClaimState; event: LedgerEvent } {
    const parsed = contestClaimInputSchema.parse(input);

    return this.db.transaction(() => {
      this.requireClaimState(parsed.claimId);

      const eventId = this.createId("evt");
      const createdAt = this.now();

      this.insertEvent({
        id: eventId,
        claimId: parsed.claimId,
        eventType: "claim_contested",
        actor: parsed.actor,
        sessionId: parsed.sessionId,
        createdAt,
        note: parsed.reason,
        relatedClaimId: null,
        payload: {
          eventType: "claim_contested",
          reason: parsed.reason
        }
      });

      return {
        claim: this.requireClaimState(parsed.claimId),
        event: this.requireEvent(eventId)
      };
    })();
  }

  recordOutcome(
    input: RecordOutcomeInput
  ): { claim: ClaimState; outcome: MemoryOutcome } {
    const parsed = recordOutcomeInputSchema.parse(input);

    return this.db.transaction(() => {
      this.requireClaimState(parsed.claimId);

      if (parsed.relatedClaimId !== undefined && parsed.relatedClaimId !== null) {
        this.requireClaimState(parsed.relatedClaimId);
      }

      if (parsed.relatedClaimId === parsed.claimId) {
        throw new Error("relatedClaimId must be different from claimId.");
      }

      const outcomeId = this.createId("out");
      const createdAt = this.now();

      this.insertOutcome({
        id: outcomeId,
        claimId: parsed.claimId,
        eventType: parsed.eventType,
        source: parsed.source,
        notes: parsed.notes ?? null,
        relatedClaimId: parsed.relatedClaimId ?? null,
        createdAt
      });

      return {
        claim: this.requireClaimState(parsed.claimId),
        outcome: this.requireOutcome(outcomeId)
      };
    })();
  }

  auditClaim(
    input: AddClaimAuditInput
  ): { claim: ClaimState; audit: ClaimAudit } {
    const parsed = addClaimAuditInputSchema.parse(input);

    return this.db.transaction(() => {
      this.requireClaimState(parsed.claimId);

      const auditId = this.createId("aud");
      const createdAt = this.now();

      this.insertClaimAudit({
        id: auditId,
        claimId: parsed.claimId,
        auditor: parsed.auditor,
        verdict: parsed.verdict,
        reason: parsed.reason,
        evidenceNote: parsed.evidenceNote ?? null,
        recommendedAction: parsed.recommendedAction,
        createdAt
      });

      return {
        claim: this.requireClaimState(parsed.claimId),
        audit: this.requireClaimAudit(auditId)
      };
    })();
  }

  supersedeClaim(
    input: SupersedeClaimInput
  ): { previousClaim: ClaimState; newClaim: ClaimState; event: LedgerEvent } {
    const parsed = supersedeClaimInputSchema.parse(input);

    return this.db.transaction(() => {
      const previousClaim = this.requireClaimState(parsed.targetClaimId);

      if (previousClaim.supersededByClaimId !== null) {
        throw new Error(
          `Claim ${previousClaim.id} is already superseded by ${previousClaim.supersededByClaimId}.`
        );
      }

      const newClaimId = this.createId("clm");
      const addEventId = this.createId("evt");
      const supersedeEventId = this.createId("evt");
      const supersedeOutcomeId = this.createId("out");
      const createdAt = this.now();
      const reason = parsed.reason ?? null;
      const project =
        parsed.project !== undefined ? parsed.project : previousClaim.project;
      const type = parsed.type !== undefined ? parsed.type : previousClaim.type;

      this.db
        .prepare(
          `
            INSERT INTO claims (
              id,
              subject,
              predicate,
              object,
              project,
              claim_type,
              author,
              session_id,
              trigger,
              confidence,
              created_at,
              supersedes_claim_id,
              outcome_stub_json
            ) VALUES (
              @id,
              @subject,
              @predicate,
              @object,
              @project,
              @claim_type,
              @author,
              @session_id,
              @trigger,
              @confidence,
              @created_at,
              @supersedes_claim_id,
              @outcome_stub_json
            )
          `
        )
        .run({
          id: newClaimId,
          subject: parsed.subject,
          predicate: parsed.predicate,
          object: parsed.object,
          project,
          claim_type: type,
          author: parsed.author,
          session_id: parsed.sessionId,
          trigger: parsed.trigger,
          confidence: parsed.confidence,
          created_at: createdAt,
          supersedes_claim_id: previousClaim.id,
          outcome_stub_json: JSON.stringify({
            status: "stub",
            note: null
          })
        });

      this.insertEvent({
        id: addEventId,
        claimId: newClaimId,
        eventType: "claim_added",
        actor: parsed.author,
        sessionId: parsed.sessionId,
        createdAt,
        note: null,
        relatedClaimId: previousClaim.id,
        payload: {
          eventType: "claim_added",
          claim: {
            subject: parsed.subject,
            predicate: parsed.predicate,
            object: parsed.object
          },
          confidence: parsed.confidence,
          trigger: parsed.trigger,
          supersedesClaimId: previousClaim.id
        }
      });

      this.insertEvent({
        id: supersedeEventId,
        claimId: previousClaim.id,
        eventType: "claim_superseded",
        actor: parsed.author,
        sessionId: parsed.sessionId,
        createdAt,
        note: reason,
        relatedClaimId: newClaimId,
        payload: {
          eventType: "claim_superseded",
          supersedingClaimId: newClaimId,
          reason
        }
      });

      this.insertOutcome({
        id: supersedeOutcomeId,
        claimId: previousClaim.id,
        eventType: "superseded",
        source: parsed.author,
        notes: reason,
        relatedClaimId: newClaimId,
        createdAt
      });

      return {
        previousClaim: this.requireClaimState(previousClaim.id),
        newClaim: this.requireClaimState(newClaimId),
        event: this.requireEvent(supersedeEventId)
      };
    })();
  }

  getClaim(claimId: string): ClaimState | null {
    return this.findClaimState(claimId);
  }

  getClaimHistory(claimId: string): ClaimHistory {
    const claim = this.requireClaimState(claimId);

    const rows = this.db
      .prepare(
        `
          SELECT
            id,
            claim_id,
            event_type,
            actor,
            session_id,
            created_at,
            note,
            related_claim_id,
            payload_json
          FROM events
          WHERE claim_id = ?
             OR related_claim_id = ?
          ORDER BY created_at ASC, id ASC
        `
      )
      .all(claimId, claimId) as EventRow[];

    return {
      claim,
      events: rows.map((row) => this.mapEventRow(row)),
      outcomes: this.listOutcomesForClaim(claimId),
      audits: this.listAuditsForClaim(claimId)
    };
  }

  getClaimAudits(claimId: string): ClaimAudit[] {
    this.requireClaimState(claimId);
    return this.listAuditsForClaim(claimId);
  }

  getLedgerHistory(): LedgerEvent[] {
    const rows = this.db
      .prepare(
        `
          SELECT
            id,
            claim_id,
            event_type,
            actor,
            session_id,
            created_at,
            note,
            related_claim_id,
            payload_json
          FROM events
          ORDER BY created_at ASC, id ASC
        `
      )
      .all() as EventRow[];

    return rows.map((row) => this.mapEventRow(row));
  }

  searchClaims(input: SearchClaimsInput): ClaimSearchResult {
    const parsed = searchClaimsInputSchema.parse({
      query: input.query,
      project: input.project ?? null,
      type: input.type ?? null,
      limit: input.limit ?? 10
    });
    const tokens = tokenizeSearchText(parsed.query);

    if (tokens.length === 0) {
      throw new Error("Search query must contain at least one searchable token.");
    }

    const matchedClaims = this.listClaims({ status: "all" })
      .map((claim) => ({
        claim,
        score: scoreClaim(tokens, claim)
      }))
      .filter((match) => match.score > 0)
      .sort((left, right) => {
        if (right.score !== left.score) {
          return right.score - left.score;
        }

        const createdAtComparison = right.claim.createdAt.localeCompare(
          left.claim.createdAt
        );

        if (createdAtComparison !== 0) {
          return createdAtComparison;
        }

        return right.claim.id.localeCompare(left.claim.id);
      });

    const included: ClaimState[] = [];
    const excluded: ClaimSearchResult["excluded"] = [];

    for (const { claim } of matchedClaims) {
      const reasons = getExclusionReasons(claim, {
        project: parsed.project ?? null,
        type: parsed.type ?? null
      });

      if (reasons.length === 0 && included.length >= parsed.limit) {
        reasons.push("limit");
      }

      if (reasons.length === 0) {
        included.push(claim);
      } else {
        excluded.push({
          claim,
          reasons
        });
      }
    }

    return {
      query: parsed.query,
      retrievalMethod: RETRIEVAL_METHOD,
      filters: {
        project: parsed.project ?? null,
        type: parsed.type ?? null
      },
      limit: parsed.limit,
      included,
      excluded
    };
  }

  generateContextPack(input: GenerateContextPackInput): ContextPack {
    const parsed = generateContextPackInputSchema.parse({
      query: input.query,
      project: input.project ?? null,
      type: input.type ?? null,
      limit: input.limit ?? 10,
      outputFormat: input.outputFormat ?? "markdown"
    });

    return this.db.transaction(() => {
      const search = this.searchClaims({
        query: parsed.query,
        project: parsed.project ?? null,
        type: parsed.type ?? null,
        limit: parsed.limit
      });

      const receipt = this.insertMemoryUseReceipt({
        query: search.query,
        filters: search.filters,
        includedClaimIds: search.included.map((claim) => claim.id),
        excludedClaimIds: search.excluded.map((entry) => entry.claim.id),
        exclusionReasons: Object.fromEntries(
          search.excluded.map((entry) => [entry.claim.id, entry.reasons])
        ),
        outputFormat: parsed.outputFormat
      });

      return {
        receipt,
        search,
        outputFormat: parsed.outputFormat
      };
    })();
  }

  listMemoryUseReceipts(): MemoryUseReceipt[] {
    const rows = this.db
      .prepare(
        `
          SELECT
            id,
            created_at,
            query,
            retrieval_method,
            retrieval_version,
            filters_json,
            included_claim_ids_json,
            excluded_claim_ids_json,
            exclusion_reasons_json,
            output_format,
            schema_version
          FROM memory_use_receipts
          ORDER BY created_at DESC, id DESC
        `
      )
      .all() as MemoryUseReceiptRow[];

    return rows.map((row) => this.mapMemoryUseReceiptRow(row));
  }

  getMemoryUseReceipt(receiptId: string): MemoryUseReceipt {
    const receipt = this.findMemoryUseReceipt(receiptId);

    if (!receipt) {
      throw new Error(`Receipt ${receiptId} was not found.`);
    }

    return receipt;
  }

  private findClaimState(claimId: string): ClaimState | null {
    const row = this.db
      .prepare(
        `
          SELECT
            c.id,
            c.subject,
            c.predicate,
            c.object,
            c.project,
            c.claim_type,
            c.author,
            c.session_id,
            c.trigger,
            c.confidence,
            c.created_at,
            c.supersedes_claim_id,
            c.outcome_stub_json,
            EXISTS(
              SELECT 1
              FROM events e
              WHERE e.claim_id = c.id
                AND e.event_type = 'claim_contested'
            ) AS contested,
            (
              SELECT COUNT(*)
              FROM events e
              WHERE e.claim_id = c.id
                AND e.event_type = 'claim_contested'
            ) AS contest_count,
            (
              SELECT child.id
              FROM claims child
              WHERE child.supersedes_claim_id = c.id
              ORDER BY child.created_at DESC, child.id DESC
              LIMIT 1
            ) AS superseded_by_claim_id
          FROM claims c
          WHERE c.id = ?
        `
      )
      .get(claimId) as ClaimStateRow | undefined;

    if (!row) {
      return null;
    }

    return this.mapClaimStateRow(row);
  }

  private requireClaimState(claimId: string): ClaimState {
    const claim = this.findClaimState(claimId);

    if (!claim) {
      throw new Error(`Claim ${claimId} was not found.`);
    }

    return claim;
  }

  private insertEvent(event: {
    id: string;
    claimId: string;
    eventType: LedgerEvent["eventType"];
    actor: string;
    sessionId: string;
    createdAt: string;
    note: string | null;
    relatedClaimId: string | null;
    payload: LedgerEventPayload;
  }): void {
    this.db
      .prepare(
        `
          INSERT INTO events (
            id,
            claim_id,
            event_type,
            actor,
            session_id,
            created_at,
            note,
            related_claim_id,
            payload_json
          ) VALUES (
            @id,
            @claim_id,
            @event_type,
            @actor,
            @session_id,
            @created_at,
            @note,
            @related_claim_id,
            @payload_json
          )
        `
      )
      .run({
        id: event.id,
        claim_id: event.claimId,
        event_type: event.eventType,
        actor: event.actor,
        session_id: event.sessionId,
        created_at: event.createdAt,
        note: event.note,
        related_claim_id: event.relatedClaimId,
        payload_json: JSON.stringify(event.payload)
      });
  }

  private insertOutcome(outcome: {
    id: string;
    claimId: string;
    eventType: MemoryOutcome["eventType"];
    source: string;
    notes: string | null;
    relatedClaimId: string | null;
    createdAt: string;
  }): void {
    this.db
      .prepare(
        `
          INSERT INTO memory_outcomes (
            id,
            claim_id,
            event_type,
            source,
            notes,
            related_claim_id,
            created_at
          ) VALUES (
            @id,
            @claim_id,
            @event_type,
            @source,
            @notes,
            @related_claim_id,
            @created_at
          )
        `
      )
      .run({
        id: outcome.id,
        claim_id: outcome.claimId,
        event_type: outcome.eventType,
        source: outcome.source,
        notes: outcome.notes,
        related_claim_id: outcome.relatedClaimId,
        created_at: outcome.createdAt
      });
  }

  private insertClaimAudit(audit: {
    id: string;
    claimId: string;
    auditor: string;
    verdict: ClaimAudit["verdict"];
    reason: string;
    evidenceNote: string | null;
    recommendedAction: ClaimAudit["recommendedAction"];
    createdAt: string;
  }): void {
    this.db
      .prepare(
        `
          INSERT INTO claim_audits (
            id,
            claim_id,
            auditor,
            verdict,
            reason,
            evidence_note,
            recommended_action,
            created_at
          ) VALUES (
            @id,
            @claim_id,
            @auditor,
            @verdict,
            @reason,
            @evidence_note,
            @recommended_action,
            @created_at
          )
        `
      )
      .run({
        id: audit.id,
        claim_id: audit.claimId,
        auditor: audit.auditor,
        verdict: audit.verdict,
        reason: audit.reason,
        evidence_note: audit.evidenceNote,
        recommended_action: audit.recommendedAction,
        created_at: audit.createdAt
      });
  }

  private insertMemoryUseReceipt(input: {
    query: string;
    filters: MemoryUseReceipt["filters"];
    includedClaimIds: string[];
    excludedClaimIds: string[];
    exclusionReasons: MemoryUseReceipt["exclusionReasons"];
    outputFormat: MemoryUseReceipt["outputFormat"];
  }): MemoryUseReceipt {
    const receiptId = this.createId("rcp");
    const eventId = this.createId("evt");
    const createdAt = this.now();

    this.db
      .prepare(
        `
          INSERT INTO memory_use_receipts (
            id,
            created_at,
            query,
            retrieval_method,
            retrieval_version,
            filters_json,
            included_claim_ids_json,
            excluded_claim_ids_json,
            exclusion_reasons_json,
            output_format,
            schema_version
          ) VALUES (
            @id,
            @created_at,
            @query,
            @retrieval_method,
            @retrieval_version,
            @filters_json,
            @included_claim_ids_json,
            @excluded_claim_ids_json,
            @exclusion_reasons_json,
            @output_format,
            @schema_version
          )
        `
      )
      .run({
        id: receiptId,
        created_at: createdAt,
        query: input.query,
        retrieval_method: RETRIEVAL_METHOD,
        retrieval_version: RETRIEVAL_METHOD,
        filters_json: JSON.stringify(input.filters),
        included_claim_ids_json: JSON.stringify(input.includedClaimIds),
        excluded_claim_ids_json: JSON.stringify(input.excludedClaimIds),
        exclusion_reasons_json: JSON.stringify(input.exclusionReasons),
        output_format: input.outputFormat,
        schema_version: MEMORY_USE_RECEIPT_SCHEMA_VERSION
      });

    this.db
      .prepare(
        `
          INSERT INTO memory_use_receipt_events (
            id,
            receipt_id,
            event_type,
            created_at,
            payload_json
          ) VALUES (
            @id,
            @receipt_id,
            @event_type,
            @created_at,
            @payload_json
          )
        `
      )
      .run({
        id: eventId,
        receipt_id: receiptId,
        event_type: "memory_use_receipt_created",
        created_at: createdAt,
        payload_json: JSON.stringify({
          eventType: "memory_use_receipt_created",
          receiptId,
          retrievalMethod: RETRIEVAL_METHOD,
          includedClaimIds: input.includedClaimIds,
          excludedClaimIds: input.excludedClaimIds
        })
      });

    return this.getMemoryUseReceipt(receiptId);
  }

  private findMemoryUseReceipt(receiptId: string): MemoryUseReceipt | null {
    const row = this.db
      .prepare(
        `
          SELECT
            id,
            created_at,
            query,
            retrieval_method,
            retrieval_version,
            filters_json,
            included_claim_ids_json,
            excluded_claim_ids_json,
            exclusion_reasons_json,
            output_format,
            schema_version
          FROM memory_use_receipts
          WHERE id = ?
        `
      )
      .get(receiptId) as MemoryUseReceiptRow | undefined;

    if (!row) {
      return null;
    }

    return this.mapMemoryUseReceiptRow(row);
  }

  private requireEvent(eventId: string): LedgerEvent {
    const row = this.db
      .prepare(
        `
          SELECT
            id,
            claim_id,
            event_type,
            actor,
            session_id,
            created_at,
            note,
            related_claim_id,
            payload_json
          FROM events
          WHERE id = ?
        `
      )
      .get(eventId) as EventRow | undefined;

    if (!row) {
      throw new Error(`Event ${eventId} was not found.`);
    }

    return this.mapEventRow(row);
  }

  private requireOutcome(outcomeId: string): MemoryOutcome {
    const row = this.db
      .prepare(
        `
          SELECT
            id,
            claim_id,
            event_type,
            source,
            notes,
            related_claim_id,
            created_at
          FROM memory_outcomes
          WHERE id = ?
        `
      )
      .get(outcomeId) as MemoryOutcomeRow | undefined;

    if (!row) {
      throw new Error(`Outcome ${outcomeId} was not found.`);
    }

    return this.mapOutcomeRow(row);
  }

  private requireClaimAudit(auditId: string): ClaimAudit {
    const row = this.db
      .prepare(
        `
          SELECT
            id,
            claim_id,
            auditor,
            verdict,
            reason,
            evidence_note,
            recommended_action,
            created_at
          FROM claim_audits
          WHERE id = ?
        `
      )
      .get(auditId) as ClaimAuditRow | undefined;

    if (!row) {
      throw new Error(`Claim audit ${auditId} was not found.`);
    }

    return this.mapClaimAuditRow(row);
  }

  private listOutcomesForClaim(claimId: string): MemoryOutcome[] {
    const rows = this.db
      .prepare(
        `
          SELECT
            id,
            claim_id,
            event_type,
            source,
            notes,
            related_claim_id,
            created_at
          FROM memory_outcomes
          WHERE claim_id = ?
          ORDER BY created_at ASC, id ASC
        `
      )
      .all(claimId) as MemoryOutcomeRow[];

    return rows.map((row) => this.mapOutcomeRow(row));
  }

  private listAuditsForClaim(claimId: string): ClaimAudit[] {
    const rows = this.db
      .prepare(
        `
          SELECT
            id,
            claim_id,
            auditor,
            verdict,
            reason,
            evidence_note,
            recommended_action,
            created_at
          FROM claim_audits
          WHERE claim_id = ?
          ORDER BY created_at ASC, id ASC
        `
      )
      .all(claimId) as ClaimAuditRow[];

    return rows.map((row) => this.mapClaimAuditRow(row));
  }

  private mapClaimStateRow(row: unknown): ClaimState {
    const parsedRow = claimStateRowSchema.parse(row);
    const outcomeTracking = outcomeTrackingStubSchema.parse(
      JSON.parse(parsedRow.outcome_stub_json)
    );
    const outcomes = this.listOutcomesForClaim(parsedRow.id);

    return claimStateSchema.parse({
      id: parsedRow.id,
      subject: parsedRow.subject,
      predicate: parsedRow.predicate,
      object: parsedRow.object,
      project: parsedRow.project,
      type: parsedRow.claim_type,
      author: parsedRow.author,
      sessionId: parsedRow.session_id,
      trigger: parsedRow.trigger,
      confidence: parsedRow.confidence,
      createdAt: parsedRow.created_at,
      supersedesClaimId: parsedRow.supersedes_claim_id,
      outcomeTracking,
      contested: parsedRow.contested === 1,
      contestCount: parsedRow.contest_count,
      supersededByClaimId: parsedRow.superseded_by_claim_id,
      currentConfidence: recalculateCurrentConfidence(
        parsedRow.confidence,
        outcomes
      )
    });
  }

  private mapEventRow(row: unknown): LedgerEvent {
    const parsedRow = eventRowSchema.parse(row);
    const payload = ledgerEventPayloadSchema.parse(
      JSON.parse(parsedRow.payload_json)
    );

    if (payload.eventType !== parsedRow.event_type) {
      throw new Error(
        `Event payload type mismatch for event ${parsedRow.id}.`
      );
    }

    return ledgerEventSchema.parse({
      id: parsedRow.id,
      claimId: parsedRow.claim_id,
      eventType: parsedRow.event_type,
      actor: parsedRow.actor,
      sessionId: parsedRow.session_id,
      createdAt: parsedRow.created_at,
      note: parsedRow.note,
      relatedClaimId: parsedRow.related_claim_id,
      payload
    });
  }

  private mapOutcomeRow(row: unknown): MemoryOutcome {
    const parsedRow = memoryOutcomeRowSchema.parse(row);

    return memoryOutcomeSchema.parse({
      id: parsedRow.id,
      claimId: parsedRow.claim_id,
      eventType: parsedRow.event_type,
      source: parsedRow.source,
      notes: parsedRow.notes,
      relatedClaimId: parsedRow.related_claim_id,
      createdAt: parsedRow.created_at
    });
  }

  private mapClaimAuditRow(row: unknown): ClaimAudit {
    const parsedRow = claimAuditRowSchema.parse(row);

    return claimAuditSchema.parse({
      id: parsedRow.id,
      claimId: parsedRow.claim_id,
      auditor: parsedRow.auditor,
      verdict: parsedRow.verdict,
      reason: parsedRow.reason,
      evidenceNote: parsedRow.evidence_note,
      recommendedAction: parsedRow.recommended_action,
      createdAt: parsedRow.created_at
    });
  }

  private mapMemoryUseReceiptRow(row: unknown): MemoryUseReceipt {
    const parsedRow = memoryUseReceiptRowSchema.parse(row);

    return memoryUseReceiptSchema.parse({
      id: parsedRow.id,
      createdAt: parsedRow.created_at,
      query: parsedRow.query,
      retrievalMethod: parsedRow.retrieval_method,
      retrievalVersion: parsedRow.retrieval_version,
      filters: JSON.parse(parsedRow.filters_json),
      includedClaimIds: JSON.parse(parsedRow.included_claim_ids_json),
      excludedClaimIds: JSON.parse(parsedRow.excluded_claim_ids_json),
      exclusionReasons: JSON.parse(parsedRow.exclusion_reasons_json),
      outputFormat: parsedRow.output_format,
      schemaVersion: parsedRow.schema_version
    });
  }
}

function tokenizeSearchText(value: string): string[] {
  const tokens = value.toLowerCase().match(/[a-z0-9]+/g);

  if (!tokens) {
    return [];
  }

  return Array.from(new Set(tokens));
}

function scoreClaim(tokens: string[], claim: ClaimState): number {
  const claimTokens = new Set(
    tokenizeSearchText(
      [
        claim.id,
        claim.subject,
        claim.predicate,
        claim.object,
        claim.project,
        claim.type,
        claim.author,
        claim.sessionId,
        claim.trigger
      ]
        .filter((value): value is string => typeof value === "string")
        .join(" ")
    )
  );

  return tokens.reduce(
    (score, token) => score + (claimTokens.has(token) ? 1 : 0),
    0
  );
}

function getExclusionReasons(
  claim: ClaimState,
  filters: { project: string | null; type: string | null }
): ClaimExclusionReason[] {
  const reasons: ClaimExclusionReason[] = [];

  if (claim.supersededByClaimId !== null) {
    reasons.push("superseded");
  }

  if (claim.contested) {
    reasons.push("contested");
  }

  if (
    filters.project !== null &&
    normalizeFilterValue(claim.project) !== normalizeFilterValue(filters.project)
  ) {
    reasons.push("project_mismatch");
  }

  if (
    filters.type !== null &&
    normalizeFilterValue(claim.type) !== normalizeFilterValue(filters.type)
  ) {
    reasons.push("type_mismatch");
  }

  return reasons;
}

function normalizeFilterValue(value: string | null): string | null {
  return value === null ? null : value.toLowerCase();
}
