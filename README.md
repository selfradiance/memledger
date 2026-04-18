# MemLedger

MemLedger is a narrow v0.1 TypeScript CLI for structured, append-only agent memory claims.

It is intentionally small:

- It stores structured claims locally in SQLite.
- It validates every public input with Zod.
- It keeps claim rows append-only.
- It records every mutation in an immutable event log.
- It supports manual contest and supersede workflows.

It is intentionally not a general memory platform. There is no retrieval layer, no embeddings, no vector search, no auditor agent, and no reliability scoring in v0.1.

## Scope

MemLedger treats memory as testimony:

- Every claim has authorship and session provenance.
- Every claim carries an explicit confidence value.
- Claims can be contested without rewriting history.
- Corrections create new claims that supersede earlier ones.
- Existing claim text is never edited in place.

Outcome tracking exists only as a schema stub for future v0.2 work. There is no automatic scoring, recalculation, or adjudication yet.

## Stack

- Node.js
- TypeScript
- SQLite via `better-sqlite3`
- Zod
- Vitest

## Install

```bash
npm install
```

## Commands

Run directly in development:

Examples below use placeholder claim IDs such as `clm_123`. In real use, capture the actual claim ID printed by `add`.

```bash
npm run cli -- add \
  --subject "user.preference" \
  --predicate "prefers" \
  --object "oat milk" \
  --author "agent.alpha" \
  --session "sess-1" \
  --trigger "assumption" \
  --confidence 0.7
```

```bash
npm run cli -- list
```

```bash
npm run cli -- contest \
  --id "clm_123" \
  --actor "agent.beta" \
  --session "sess-2" \
  --reason "User corrected this in a later turn."
```

```bash
npm run cli -- supersede \
  --id "clm_123" \
  --subject "user.preference" \
  --predicate "prefers" \
  --object "soy milk" \
  --author "agent.alpha" \
  --session "sess-3" \
  --confidence 0.95 \
  --reason "User explicitly corrected the earlier assumption."
```

```bash
npm run cli -- history --id "clm_123"
```

By default MemLedger writes to `./memledger.db`. Use `--db :memory:` for tests or `--db ./path/to/file.db` to override it.
If `--trigger` is omitted on `supersede`, it defaults to `correction`.

## Data Model

Claims are structured, not raw blobs:

```json
{
  "subject": "user.preference",
  "predicate": "prefers",
  "object": "oat milk",
  "author": "agent.alpha",
  "sessionId": "sess-1",
  "trigger": "assumption",
  "confidence": 0.7
}
```

Each claim row also carries:

- `createdAt`
- `supersedesClaimId`
- `outcomeTracking` with a v0.1 stub shape

Events are stored separately as immutable append-only records:

- `claim_added`
- `claim_contested`
- `claim_superseded`

## Development

```bash
npm test
npm run typecheck
npm run build
```

## Notes On v0.1 Behavior

- Database triggers block updates and deletes on both `claims` and `events`.
- `contest` appends an event but does not rewrite stored claim text.
- `supersede` creates a new claim row and a supersede event on the original claim.
- `history --id <claim_id>` includes both direct events on that claim and linked supersede events needed to reconstruct its local lineage.
- This v0.1 CLI rejects superseding the same claim twice to keep the initial lineage model explicit and simple.
