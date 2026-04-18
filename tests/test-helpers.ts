import { openDatabase } from "../src/db.js";
import { MemLedger } from "../src/ledger.js";

export function createTestLedger() {
  const db = openDatabase(":memory:");
  let idCounter = 0;
  let tick = 0;
  const baseTime = Date.parse("2026-04-17T12:00:00.000Z");

  const ledger = new MemLedger(db, {
    now: () => new Date(baseTime + tick++).toISOString(),
    createId: (prefix) => {
      idCounter += 1;
      return `${prefix}_${String(idCounter).padStart(4, "0")}`;
    }
  });

  return {
    db,
    ledger,
    close: () => db.close()
  };
}
