import fs from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";

export type SqliteDatabase = Database.Database;

export const CURRENT_SCHEMA_VERSION = 4;

export function openDatabase(databasePath: string): SqliteDatabase {
  if (databasePath !== ":memory:") {
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  }

  const db = new Database(databasePath);

  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");

  if (databasePath !== ":memory:") {
    db.pragma("journal_mode = WAL");
  }

  migrateDatabase(db);

  return db;
}

export function migrateDatabase(db: SqliteDatabase): void {
  db.transaction(() => {
    let currentVersion = Number(db.pragma("user_version", { simple: true }));

    if (currentVersion > CURRENT_SCHEMA_VERSION) {
      throw new Error(
        `Database schema version ${currentVersion} is newer than this CLI supports.`
      );
    }

    if (currentVersion === 0) {
      createBaseSchema(db);
      createMemoryOutcomesSchema(db);
      db.pragma(`user_version = ${CURRENT_SCHEMA_VERSION}`);
      return;
    }

    if (currentVersion === 1) {
      db.exec(`
        DROP INDEX IF EXISTS idx_claims_supersedes;

        CREATE UNIQUE INDEX idx_claims_single_child_supersede
          ON claims(supersedes_claim_id)
          WHERE supersedes_claim_id IS NOT NULL;
      `);

      currentVersion = 2;
      db.pragma("user_version = 2");
    }

    if (currentVersion === 2) {
      createMemoryOutcomesSchema(db);
      db.pragma(`user_version = ${CURRENT_SCHEMA_VERSION}`);
      return;
    }

    if (currentVersion === 3) {
      assertValidLegacySupersededOutcomes(db);
      createMemoryOutcomesTable(db, "memory_outcomes_v4");
      db.exec(`
        INSERT INTO memory_outcomes_v4 (
          id,
          claim_id,
          event_type,
          source,
          notes,
          related_claim_id,
          created_at
        )
        SELECT
          id,
          claim_id,
          event_type,
          source,
          notes,
          related_claim_id,
          created_at
        FROM memory_outcomes;

        DROP TABLE memory_outcomes;

        ALTER TABLE memory_outcomes_v4 RENAME TO memory_outcomes;
      `);
      createMemoryOutcomesArtifacts(db);
      db.pragma(`user_version = ${CURRENT_SCHEMA_VERSION}`);
    }
  })();

  const finalVersion = Number(db.pragma("user_version", { simple: true }));

  if (finalVersion !== CURRENT_SCHEMA_VERSION) {
    throw new Error(`Database migration failed. Expected version ${CURRENT_SCHEMA_VERSION}, received ${finalVersion}.`);
  }
}

function createBaseSchema(db: SqliteDatabase): void {
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
}

function createMemoryOutcomesSchema(db: SqliteDatabase): void {
  createMemoryOutcomesTable(db, "memory_outcomes");
  createMemoryOutcomesArtifacts(db);
}

function createMemoryOutcomesTable(
  db: SqliteDatabase,
  tableName: "memory_outcomes" | "memory_outcomes_v4"
): void {
  db.exec(`
    CREATE TABLE ${tableName} (
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
  `);
}

function createMemoryOutcomesArtifacts(db: SqliteDatabase): void {
  db.exec(`
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
}

function assertValidLegacySupersededOutcomes(db: SqliteDatabase): void {
  const invalidCount = Number(
    db
      .prepare(
        `
          SELECT COUNT(*)
          FROM memory_outcomes
          WHERE event_type = 'superseded'
            AND related_claim_id IS NULL
        `
      )
      .pluck()
      .get()
  );

  if (invalidCount > 0) {
    throw new Error(
      "Cannot migrate database with superseded outcomes missing related_claim_id."
    );
  }
}
