import { randomUUID } from "node:crypto";

import type { Database as BetterSqliteDatabase } from "better-sqlite3";

import {
  addClaimInputSchema,
  claimStateRowSchema,
  claimStateSchema,
  contestClaimInputSchema,
  eventRowSchema,
  ledgerEventPayloadSchema,
  ledgerEventSchema,
  listClaimsOptionsSchema,
  outcomeTrackingStubSchema,
  supersedeClaimInputSchema
} from "./schema.js";
import type {
  AddClaimInput,
  ClaimHistory,
  ClaimState,
  LedgerEvent,
  LedgerEventPayload,
  ListClaimsOptions,
  SupersedeClaimInput
} from "./types.js";

export interface LedgerDependencies {
  now?: () => string;
  createId?: (prefix: "clm" | "evt") => string;
}

type SqliteDatabase = BetterSqliteDatabase;

interface ClaimStateRow {
  id: string;
  subject: string;
  predicate: string;
  object: string;
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

export class MemLedger {
  private readonly db: SqliteDatabase;
  private readonly now: () => string;
  private readonly createId: (prefix: "clm" | "evt") => string;

  constructor(db: SqliteDatabase, dependencies: LedgerDependencies = {}) {
    this.db = db;
    this.now = dependencies.now ?? (() => new Date().toISOString());
    this.createId =
      dependencies.createId ??
      ((prefix: "clm" | "evt") => `${prefix}_${randomUUID()}`);
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
      const createdAt = this.now();
      const reason = parsed.reason ?? null;

      this.db
        .prepare(
          `
            INSERT INTO claims (
              id,
              subject,
              predicate,
              object,
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
      events: rows.map((row) => this.mapEventRow(row))
    };
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

  private findClaimState(claimId: string): ClaimState | null {
    const row = this.db
      .prepare(
        `
          SELECT
            c.id,
            c.subject,
            c.predicate,
            c.object,
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

  private mapClaimStateRow(row: unknown): ClaimState {
    const parsedRow = claimStateRowSchema.parse(row);
    const outcomeTracking = outcomeTrackingStubSchema.parse(
      JSON.parse(parsedRow.outcome_stub_json)
    );

    return claimStateSchema.parse({
      id: parsedRow.id,
      subject: parsedRow.subject,
      predicate: parsedRow.predicate,
      object: parsedRow.object,
      author: parsedRow.author,
      sessionId: parsedRow.session_id,
      trigger: parsedRow.trigger,
      confidence: parsedRow.confidence,
      createdAt: parsedRow.created_at,
      supersedesClaimId: parsedRow.supersedes_claim_id,
      outcomeTracking,
      contested: parsedRow.contested === 1,
      contestCount: parsedRow.contest_count,
      supersededByClaimId: parsedRow.superseded_by_claim_id
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
}
