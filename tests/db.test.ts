import { describe, expect, it } from "vitest";

import { CURRENT_SCHEMA_VERSION, openDatabase } from "../src/db.js";
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
      expect(tableNames).toContain("events");
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
    } finally {
      close();
    }
  });
});
