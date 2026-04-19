import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import {
  CURRENT_SCHEMA_VERSION,
  migrateDatabase,
  openDatabase
} from "../src/db.js";
import { createTestLedger } from "./test-helpers.js";

describe("db", () => {
  it("creates the expected schema version and tables", () => {
    const db = openDatabase(":memory:");

    try {
      const version = Number(db.pragma("user_version", { simple: true }));
      const tableNames = (
        db
          .prepare(
            `
              SELECT name
              FROM sqlite_master
              WHERE type = 'table'
              ORDER BY name
            `
          )
          .all() as Array<{ name: string }>
      ).map((row) => row.name);

      expect(version).toBe(CURRENT_SCHEMA_VERSION);
      expect(tableNames).toContain("claims");
      expect(tableNames).toContain("claim_audits");
      expect(tableNames).toContain("events");
      expect(tableNames).toContain("memory_outcomes");
    } finally {
      db.close();
    }
  });

  it("blocks updates and deletes through database triggers", () => {
    const { db, ledger, close } = createTestLedger();

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
        db
          .prepare("UPDATE claims SET object = ? WHERE id = ?")
          .run("soy milk", claim.id)
      ).toThrowError(/append-only/i);

      expect(() =>
        db
          .prepare("DELETE FROM events WHERE claim_id = ?")
          .run(claim.id)
      ).toThrowError(/immutable/i);

      const outcome = ledger.recordOutcome({
        claimId: claim.id,
        eventType: "observed_hold",
        source: "operator"
      });

      db.prepare(`
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
      `).run({
        id: "aud_manual_1",
        claim_id: claim.id,
        auditor: "review.bot",
        verdict: "questions",
        reason: "Needs another review.",
        evidence_note: null,
        recommended_action: "contest",
        created_at: "2026-04-17T12:00:00.200Z"
      });

      expect(() =>
        db
          .prepare("UPDATE memory_outcomes SET notes = ? WHERE id = ?")
          .run("changed", outcome.outcome.id)
      ).toThrowError(/immutable/i);

      expect(() =>
        db
          .prepare("DELETE FROM memory_outcomes WHERE id = ?")
          .run(outcome.outcome.id)
      ).toThrowError(/immutable/i);

      expect(() =>
        db
          .prepare("UPDATE claim_audits SET reason = ? WHERE id = ?")
          .run("changed", "aud_manual_1")
      ).toThrowError(/append-only/i);

      expect(() =>
        db
          .prepare("DELETE FROM claim_audits WHERE id = ?")
          .run("aud_manual_1")
      ).toThrowError(/append-only/i);
    } finally {
      close();
    }
  });

  it("enforces a single superseding child per claim at the database level", () => {
    const { db, ledger, close } = createTestLedger();

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

      const insertClaim = db.prepare(`
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
      `);

      insertClaim.run({
        id: "clm_manual_1",
        subject: "user.preference",
        predicate: "prefers",
        object: "soy milk",
        author: "agent.alpha",
        session_id: "sess-2",
        trigger: "correction",
        confidence: 0.95,
        created_at: "2026-04-17T12:00:00.100Z",
        supersedes_claim_id: original.id,
        outcome_stub_json: JSON.stringify({
          status: "stub",
          note: null
        })
      });

      expect(() =>
        insertClaim.run({
          id: "clm_manual_2",
          subject: "user.preference",
          predicate: "prefers",
          object: "almond milk",
          author: "agent.beta",
          session_id: "sess-3",
          trigger: "correction",
          confidence: 0.6,
          created_at: "2026-04-17T12:00:00.200Z",
          supersedes_claim_id: original.id,
          outcome_stub_json: JSON.stringify({
            status: "stub",
            note: null
          })
        })
      ).toThrowError(/unique/i);
    } finally {
      close();
    }
  });

  it("enforces that superseded outcomes require related_claim_id", () => {
    const { db, ledger, close } = createTestLedger();

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
        db.prepare(`
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
        `).run({
          id: "out_manual_1",
          claim_id: claim.id,
          event_type: "superseded",
          source: "operator",
          notes: null,
          related_claim_id: null,
          created_at: "2026-04-17T12:00:00.100Z"
        })
      ).toThrowError(/check/i);
    } finally {
      close();
    }
  });

  it("enforces claim_audits foreign keys", () => {
    const db = openDatabase(":memory:");

    try {
      expect(() =>
        db.prepare(`
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
        `).run({
          id: "aud_missing_claim",
          claim_id: "clm_missing",
          auditor: "review.bot",
          verdict: "supports",
          reason: "Looks fine.",
          evidence_note: null,
          recommended_action: "none",
          created_at: "2026-04-17T12:00:00.100Z"
        })
      ).toThrowError(/foreign key/i);
    } finally {
      db.close();
    }
  });

  it("enforces valid claim_audits verdict values", () => {
    const { db, ledger, close } = createTestLedger();

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
        db.prepare(`
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
        `).run({
          id: "aud_bad_verdict",
          claim_id: claim.id,
          auditor: "review.bot",
          verdict: "approve",
          reason: "Looks fine.",
          evidence_note: null,
          recommended_action: "none",
          created_at: "2026-04-17T12:00:00.100Z"
        })
      ).toThrowError(/check/i);
    } finally {
      close();
    }
  });

  it("enforces valid claim_audits recommended_action values", () => {
    const { db, ledger, close } = createTestLedger();

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
        db.prepare(`
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
        `).run({
          id: "aud_bad_action",
          claim_id: claim.id,
          auditor: "review.bot",
          verdict: "questions",
          reason: "Needs follow-up.",
          evidence_note: null,
          recommended_action: "auto_fix",
          created_at: "2026-04-17T12:00:00.100Z"
        })
      ).toThrowError(/check/i);
    } finally {
      close();
    }
  });

  it("migrates a version 2 database forward to the current schema", () => {
    const db = createVersion2Database();

    try {
      migrateDatabase(db);

      const version = Number(db.pragma("user_version", { simple: true }));
      const tableNames = (
        db
          .prepare(
            `
              SELECT name
              FROM sqlite_master
              WHERE type = 'table'
              ORDER BY name
            `
          )
          .all() as Array<{ name: string }>
      ).map((row) => row.name);

      expect(version).toBe(CURRENT_SCHEMA_VERSION);
      expect(tableNames).toContain("memory_outcomes");
    } finally {
      db.close();
    }
  });

  it("migrates a version 3 database forward and preserves valid outcomes", () => {
    const db = createVersion3Database();

    try {
      db.prepare(`
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
      `).run({
        id: "clm_legacy_1",
        subject: "project.status",
        predicate: "is",
        object: "blocked",
        author: "agent.alpha",
        session_id: "sess-1",
        trigger: "inference",
        confidence: 0.4,
        created_at: "2026-04-17T12:00:00.000Z",
        supersedes_claim_id: null,
        outcome_stub_json: JSON.stringify({
          status: "stub",
          note: null
        })
      });

      db.prepare(`
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
      `).run({
        id: "out_legacy_1",
        claim_id: "clm_legacy_1",
        event_type: "observed_hold",
        source: "operator",
        notes: "Held during a legacy check.",
        related_claim_id: null,
        created_at: "2026-04-17T12:00:00.100Z"
      });

      migrateDatabase(db);

      const version = Number(db.pragma("user_version", { simple: true }));
      const outcomes = db.prepare(`
        SELECT id, event_type, notes
        FROM memory_outcomes
        ORDER BY created_at ASC, id ASC
      `).all() as Array<{
        id: string;
        event_type: string;
        notes: string | null;
      }>;

      expect(version).toBe(CURRENT_SCHEMA_VERSION);
      expect(outcomes).toEqual([
        {
          id: "out_legacy_1",
          event_type: "observed_hold",
          notes: "Held during a legacy check."
        }
      ]);
    } finally {
      db.close();
    }
  });

  it("rolls back a version 3 migration when invalid superseded outcomes exist", () => {
    const db = createVersion3Database();

    try {
      db.prepare(`
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
      `).run({
        id: "clm_legacy_1",
        subject: "project.status",
        predicate: "is",
        object: "blocked",
        author: "agent.alpha",
        session_id: "sess-1",
        trigger: "inference",
        confidence: 0.4,
        created_at: "2026-04-17T12:00:00.000Z",
        supersedes_claim_id: null,
        outcome_stub_json: JSON.stringify({
          status: "stub",
          note: null
        })
      });

      db.prepare(`
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
      `).run({
        id: "out_legacy_invalid",
        claim_id: "clm_legacy_1",
        event_type: "superseded",
        source: "operator",
        notes: null,
        related_claim_id: null,
        created_at: "2026-04-17T12:00:00.100Z"
      });

      expect(() => migrateDatabase(db)).toThrowError(
        /superseded outcomes missing related_claim_id/i
      );

      expect(Number(db.pragma("user_version", { simple: true }))).toBe(3);
      expect(
        db
          .prepare(
            `
              SELECT COUNT(*)
              FROM sqlite_master
              WHERE type = 'table'
                AND name = 'memory_outcomes_v4'
            `
          )
          .pluck()
          .get()
      ).toBe(0);
    } finally {
      db.close();
    }
  });

  it("migrates a version 4 database forward and adds claim_audits", () => {
    const db = createVersion4Database();

    try {
      db.prepare(`
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
      `).run({
        id: "clm_legacy_1",
        subject: "project.status",
        predicate: "is",
        object: "blocked",
        author: "agent.alpha",
        session_id: "sess-1",
        trigger: "inference",
        confidence: 0.4,
        created_at: "2026-04-17T12:00:00.000Z",
        supersedes_claim_id: null,
        outcome_stub_json: JSON.stringify({
          status: "stub",
          note: null
        })
      });

      migrateDatabase(db);

      const version = Number(db.pragma("user_version", { simple: true }));
      const claimCount = Number(
        db.prepare("SELECT COUNT(*) FROM claims").pluck().get()
      );
      const tableNames = (
        db
          .prepare(
            `
              SELECT name
              FROM sqlite_master
              WHERE type = 'table'
              ORDER BY name
            `
          )
          .all() as Array<{ name: string }>
      ).map((row) => row.name);

      expect(version).toBe(CURRENT_SCHEMA_VERSION);
      expect(claimCount).toBe(1);
      expect(tableNames).toContain("claim_audits");
    } finally {
      db.close();
    }
  });
});

function createVersion2Database(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE claims (
      id TEXT PRIMARY KEY,
      subject TEXT NOT NULL,
      predicate TEXT NOT NULL,
      object TEXT NOT NULL,
      author TEXT NOT NULL,
      session_id TEXT NOT NULL,
      trigger TEXT NOT NULL CHECK (
        trigger IN ('task_completion', 'correction', 'assumption', 'inference')
      ),
      confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
      created_at TEXT NOT NULL,
      supersedes_claim_id TEXT REFERENCES claims(id),
      outcome_stub_json TEXT NOT NULL CHECK (json_valid(outcome_stub_json))
    ) STRICT;

    CREATE TABLE events (
      id TEXT PRIMARY KEY,
      claim_id TEXT NOT NULL REFERENCES claims(id),
      event_type TEXT NOT NULL CHECK (
        event_type IN ('claim_added', 'claim_contested', 'claim_superseded')
      ),
      actor TEXT NOT NULL,
      session_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      note TEXT,
      related_claim_id TEXT REFERENCES claims(id),
      payload_json TEXT NOT NULL CHECK (json_valid(payload_json))
    ) STRICT;

    CREATE INDEX idx_claims_created_at
      ON claims(created_at DESC, id DESC);

    CREATE UNIQUE INDEX idx_claims_single_child_supersede
      ON claims(supersedes_claim_id)
      WHERE supersedes_claim_id IS NOT NULL;

    CREATE INDEX idx_events_claim_created
      ON events(claim_id, created_at ASC, id ASC);

    CREATE INDEX idx_events_related_claim
      ON events(related_claim_id);

    CREATE TRIGGER claims_no_update
    BEFORE UPDATE ON claims
    BEGIN
      SELECT RAISE(ABORT, 'claims are append-only');
    END;

    CREATE TRIGGER claims_no_delete
    BEFORE DELETE ON claims
    BEGIN
      SELECT RAISE(ABORT, 'claims are append-only');
    END;

    CREATE TRIGGER events_no_update
    BEFORE UPDATE ON events
    BEGIN
      SELECT RAISE(ABORT, 'events are immutable');
    END;

    CREATE TRIGGER events_no_delete
    BEFORE DELETE ON events
    BEGIN
      SELECT RAISE(ABORT, 'events are immutable');
    END;
  `);

  db.pragma("user_version = 2");

  return db;
}

function createVersion3Database(): Database.Database {
  const db = createVersion2Database();

  db.exec(`
    CREATE TABLE memory_outcomes (
      id TEXT PRIMARY KEY,
      claim_id TEXT NOT NULL REFERENCES claims(id),
      event_type TEXT NOT NULL CHECK (
        event_type IN ('observed_hold', 'observed_fail', 'superseded', 'manual_correction')
      ),
      source TEXT NOT NULL,
      notes TEXT,
      related_claim_id TEXT REFERENCES claims(id),
      created_at TEXT NOT NULL
    ) STRICT;

    CREATE INDEX idx_memory_outcomes_claim_created
      ON memory_outcomes(claim_id, created_at ASC, id ASC);

    CREATE INDEX idx_memory_outcomes_related_claim
      ON memory_outcomes(related_claim_id);

    CREATE TRIGGER memory_outcomes_no_update
    BEFORE UPDATE ON memory_outcomes
    BEGIN
      SELECT RAISE(ABORT, 'memory outcomes are immutable');
    END;

    CREATE TRIGGER memory_outcomes_no_delete
    BEFORE DELETE ON memory_outcomes
    BEGIN
      SELECT RAISE(ABORT, 'memory outcomes are immutable');
    END;
  `);

  db.pragma("user_version = 3");

  return db;
}

function createVersion4Database(): Database.Database {
  const db = createVersion2Database();

  db.exec(`
    CREATE TABLE memory_outcomes (
      id TEXT PRIMARY KEY,
      claim_id TEXT NOT NULL REFERENCES claims(id),
      event_type TEXT NOT NULL CHECK (
        event_type IN ('observed_hold', 'observed_fail', 'superseded', 'manual_correction')
      ),
      source TEXT NOT NULL,
      notes TEXT,
      related_claim_id TEXT REFERENCES claims(id),
      created_at TEXT NOT NULL,
      CHECK (event_type != 'superseded' OR related_claim_id IS NOT NULL)
    ) STRICT;

    CREATE INDEX idx_memory_outcomes_claim_created
      ON memory_outcomes(claim_id, created_at ASC, id ASC);

    CREATE INDEX idx_memory_outcomes_related_claim
      ON memory_outcomes(related_claim_id);

    CREATE TRIGGER memory_outcomes_no_update
    BEFORE UPDATE ON memory_outcomes
    BEGIN
      SELECT RAISE(ABORT, 'memory outcomes are immutable');
    END;

    CREATE TRIGGER memory_outcomes_no_delete
    BEFORE DELETE ON memory_outcomes
    BEGIN
      SELECT RAISE(ABORT, 'memory outcomes are immutable');
    END;
  `);

  db.pragma("user_version = 4");

  return db;
}
