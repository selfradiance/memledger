# MemLedger

MemLedger is a narrow v0.3.0 TypeScript CLI for structured, append-only agent memory claims.

It is intentionally small:

- It stores structured claims, outcomes, and audits locally in SQLite.
- It validates every public input with Zod.
- It keeps claim rows append-only.
- It records every mutation in an immutable event log.
- It supports manual contest and supersede workflows.
- It recalculates current confidence deterministically from logged outcomes.
- It records append-only claim audits without changing the confidence model.

It is intentionally not a general memory platform. There is no retrieval layer, no embeddings, no vector search, no auditor agent, no autonomous review loop, no blame engine, and no per-author reliability scoring in v0.3.

## Status

`v0.3.0`

MemLedger v0.3 adds append-only claim audits: structured reviewer assessments recorded alongside claims without changing the deterministic confidence model.

What v0.3 ships:

- append-only outcome logging for claim history
- deterministic confidence recalculation from outcome history
- structural supersession support
- append-only claim audits attached to existing claims
- CLI support for recording and showing audits
- CLI support for recording outcomes and viewing claim history/status
- migration and constraint hardening for outcome tracking

What remains deferred:

- no auditor agent
- no autonomous contest review
- no blame or slashing logic
- no per-author reliability scoring
- no recursive full-chain reconstruction

This remains a local, deterministic memory integrity ledger focused on immediate/local claim history.

## Scope

MemLedger treats memory as testimony:

- Every claim has authorship and session provenance.
- Every claim carries an explicit base confidence value.
- Claims can be contested without rewriting history.
- Corrections create new claims that supersede earlier ones.
- Existing claim text is never edited in place.
- Outcomes are append-only records attached to existing claims.
- Audits are append-only records attached to existing claims.
- Current confidence is derived from claim history plus direct logged outcomes.

v0.3 does not try to infer truth. It only performs local, deterministic bookkeeping from explicit events that were recorded.

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

```bash
npm run cli -- record-outcome \
  --id "clm_123" \
  --event-type "observed_hold" \
  --source "operator" \
  --notes "Held when checked."
```

```bash
npm run cli -- audit-claim \
  --claim-id "clm_123" \
  --auditor "review.bot" \
  --verdict "questions" \
  --reason "The transcript does not include a direct quote." \
  --evidence-note "Need a source excerpt for verification." \
  --recommended-action "contest"
```

```bash
npm run cli -- show-audits --claim-id "clm_123"
```

```bash
npm run cli -- show-claim --id "clm_123"
```

By default MemLedger writes to `./memledger.db`. Use `--db :memory:` for tests or `--db ./path/to/file.db` to override it.
If `--trigger` is omitted on `supersede`, it defaults to `correction`.
Manual `record-outcome` accepts `observed_hold`, `observed_fail`, and `manual_correction`.
`superseded` outcomes are emitted by `supersede`, not recorded manually.
`audit-claim` accepts verdict values `supports`, `questions`, `rejects`, and `insufficient_evidence`.
`audit-claim` accepts recommended actions `none`, `contest`, `supersede`, and `manual_correction`.

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
- `outcomeTracking` with the retained stub shape from v0.1

Outcomes are stored separately as immutable append-only records:

- `observed_hold`
- `observed_fail`
- `superseded`
- `manual_correction`

Events are stored separately as immutable append-only records:

- `claim_added`
- `claim_contested`
- `claim_superseded`

Claim audits are stored separately as immutable append-only records with:

- `id`
- `claimId`
- `auditor`
- `verdict`
- `reason`
- `evidenceNote`
- `recommendedAction`
- `createdAt`

Audit verdicts are limited to:

- `supports`
- `questions`
- `rejects`
- `insufficient_evidence`

Audit recommended actions are limited to:

- `none`
- `contest`
- `supersede`
- `manual_correction`

`superseded` outcomes link to a `relatedClaimId` that points at the newer claim.

## Confidence Model

Each claim stores a base confidence at creation time.

MemLedger v0.2 also reports a current confidence, recalculated deterministically from direct outcomes logged against that claim:

- `observed_hold` nudges confidence upward
- `observed_fail` nudges confidence downward
- `superseded` sharply reduces confidence for the older claim
- `manual_correction` reduces confidence without implying author blame

This is deterministic bookkeeping, not truth adjudication.

## Development

```bash
npm test
npm run typecheck
npm run build
```

## Notes On v0.3 Behavior

- Database triggers block updates and deletes on `claims`, `events`, `memory_outcomes`, and `claim_audits`.
- `contest` appends an event but does not rewrite stored claim text.
- `supersede` creates a new claim row, a supersede event on the original claim, and a linked `superseded` outcome on the older claim.
- `record-outcome` appends an outcome row for `observed_hold`, `observed_fail`, or `manual_correction`. It never edits the claim row in place.
- `superseded` outcomes are created by `supersede`, not by manual `record-outcome`.
- `audit-claim` appends one audit row for an existing claim. It does not edit the claim row, create an outcome row, or create a supersession link.
- Audit recommendations are advisory only. They do not automatically contest or supersede a claim.
- `show-audits --claim-id <claim_id>` reports only the direct audits for that claim.
- `show-claim --id <claim_id>` reports the claim, direct local events, direct logged outcomes, direct audits, and the current derived confidence.
- `history --id <claim_id>` is still immediate/local lineage inspection only. It shows direct events on that claim and directly linked supersede events at the nearest parent/child boundary.
- `history --id <claim_id>` does not recursively reconstruct a full multi-hop lineage chain.
- Current confidence is derived from the claim's base confidence plus its direct logged outcomes. It is intentionally local and recomputable.
- Audits do not change current confidence.
- This v0.3 CLI still rejects superseding the same claim twice to keep the lineage model explicit and simple.

## Explicit Non-Goals

- No auditor agent
- No autonomous contest review
- No background scanner or daemon
- No automatic contest creation from audits
- No automatic supersession from audits
- No vector search or embeddings
- No causal attribution chain
- No blame engine or slashing logic
- No per-author reliability scoring yet
