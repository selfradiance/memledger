import fs from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";

export type SqliteDatabase = Database.Database;

export const CURRENT_SCHEMA_VERSION = 2;

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
  const currentVersion = Number(db.pragma("user_version", { simple: true }));

  if (currentVersion > CURRENT_SCHEMA_VERSION) {
    throw new Error(
      `Database schema version ${currentVersion} is newer than this CLI supports.`
    );
  }

  if (currentVersion === 0) {
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

    db.pragma(`user_version = ${CURRENT_SCHEMA_VERSION}`);
  }

  if (currentVersion === 1) {
    db.exec(`
      DROP INDEX IF EXISTS idx_claims_supersedes;

      CREATE UNIQUE INDEX idx_claims_single_child_supersede
        ON claims(supersedes_claim_id)
        WHERE supersedes_claim_id IS NOT NULL;
    `);

    db.pragma(`user_version = ${CURRENT_SCHEMA_VERSION}`);
  }

  const finalVersion = Number(db.pragma("user_version", { simple: true }));

  if (finalVersion !== CURRENT_SCHEMA_VERSION) {
    throw new Error(`Database migration failed. Expected version ${CURRENT_SCHEMA_VERSION}, received ${finalVersion}.`);
  }
}
