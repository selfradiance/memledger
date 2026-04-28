# MemLedger

MemLedger is a narrow v0.4.0 TypeScript CLI for structured, append-only memory claims, deterministic context packs, and append-only memory-use receipts.

It is intentionally small:

- It stores structured claims, outcomes, audits, and memory-use receipts locally in SQLite.
- It validates public inputs with Zod.
- It keeps claim, outcome, audit, event, and receipt rows append-only.
- It records every claim mutation in an immutable event log.
- It supports manual contest and supersede workflows.
- It recalculates current confidence deterministically from logged outcomes.
- It assembles assistant context with deterministic keyword retrieval, not embeddings or model calls.

It is intentionally not a general AI memory platform.

## Status

`v0.4.0`

MemLedger v0.4.0 adds deterministic claim search, context-pack generation, and append-only memory-use receipts.

Assistant context can be assembled from inspectable memory claims, while superseded or contested claims are excluded or surfaced, and every context-pack generation emits an append-only memory-use receipt.

v0.3.0 remains the historical append-only claim-audits release.

What v0.4 ships:

- deterministic local search over memory claims
- context-pack generation for assistant workflows
- append-only memory-use receipts showing included and excluded claims
- optional structured `project` and `type` claim metadata for deterministic filters
- existing outcome logging, confidence recalculation, contest, supersede, and audit commands

v0.4 remains local-first, deterministic, CLI-driven, and non-semantic.

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
- Context packs include claims, not guaranteed facts.
- Memory-use receipts record which claims were included, which were excluded, and why.

Memory-use receipts make the invocation of memory auditable. The point is not merely that a system remembers; the point is that a user can inspect which memory claims influenced a given assistant-context bundle.

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

```bash
npm run cli -- add \
  --subject "user.preference" \
  --predicate "prefers" \
  --object "oat milk" \
  --project "prefs" \
  --type "preference" \
  --author "agent.alpha" \
  --session "sess-1" \
  --trigger "assumption" \
  --confidence 0.7
```

Examples below use placeholder claim IDs such as `clm_123`. In real use, capture the actual claim ID printed by `add`.

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
  --project "prefs" \
  --type "preference" \
  --author "agent.alpha" \
  --session "sess-3" \
  --confidence 0.95 \
  --reason "User explicitly corrected the earlier assumption."
```

```bash
npm run cli -- search --query "oat milk" --project "prefs" --type "preference"
```

```bash
npm run cli -- context-pack \
  --query "oat milk" \
  --project "prefs" \
  --type "preference" \
  --limit 10 \
  --format markdown
```

```bash
npm run cli -- receipts-list
```

```bash
npm run cli -- receipts-show --id "rcp_123"
```

Additional local inspection and v0.2 behavior:

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

## Context Packs

`context-pack` uses `deterministic_keyword_v1` retrieval:

- tokenizes the query and claim fields locally
- searches claim text plus relevant metadata
- excludes contested claims from included context
- excludes superseded claims from included context
- reports excluded matching claims with reasons
- writes one append-only memory-use receipt for every successful generation

Markdown context packs contain:

- the query
- generation timestamp
- retrieval method
- included claims
- excluded or warned claims
- the memory-use receipt ID and claim ID lists

Use `--format json` for stable JSON output.

## Data Model

Claims are structured, not raw blobs:

```json
{
  "subject": "user.preference",
  "predicate": "prefers",
  "object": "oat milk",
  "project": "prefs",
  "type": "preference",
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

Claim audits are stored separately as immutable append-only records.

Memory-use receipts are stored separately as immutable append-only records with:

- `receipt_id`
- `timestamp`
- `query`
- `retrieval_method`
- `filters`
- `included_claim_ids`
- `excluded_claim_ids`
- `exclusion_reasons`
- `output_format`
- `retrieval_version`
- `schema_version`

Each receipt also has a corresponding immutable receipt event row.

## Confidence Model

Each claim stores a base confidence at creation time.

MemLedger reports current confidence, recalculated deterministically from direct outcomes logged against that claim:

- `observed_hold` nudges confidence upward
- `observed_fail` nudges confidence downward
- `superseded` sharply reduces confidence for the older claim
- `manual_correction` reduces confidence without implying author blame

This is deterministic bookkeeping, not truth adjudication.

## Release Notes

### v0.4.0 - Context Packs and Memory-Use Receipts

- Adds deterministic local search over memory claims.
- Adds context-pack generation for assistant workflows.
- Adds append-only memory-use receipts showing included and excluded claims.
- Keeps scope local-first, deterministic, and non-semantic.

### v0.3.0 - Append-Only Claim Audits

- Added append-only claim audits attached to existing claims.
- Added CLI support for recording and showing audits.
- Kept audits advisory only, without automatic confidence changes, contests, or supersessions.

## Development

```bash
npm test
npm run typecheck
npm run build
```

## Notes On v0.4 Behavior

- Database triggers block updates and deletes on `claims`, `events`, `memory_outcomes`, `claim_audits`, `memory_use_receipts`, and `memory_use_receipt_events`.
- `contest` appends an event but does not rewrite stored claim text.
- `supersede` creates a new claim row, a supersede event on the original claim, and a linked `superseded` outcome on the older claim.
- Manual `record-outcome` accepts `observed_hold`, `observed_fail`, and `manual_correction`.
- `superseded` outcomes are created by `supersede`, not by manual `record-outcome`.
- `audit-claim` appends one audit row for an existing claim. It does not edit the claim row, create an outcome row, or create a supersession link.
- Audit recommendations are advisory only. They do not automatically contest or supersede a claim.
- `search` and `context-pack` include only matching claims that are not contested and not superseded.
- Matching contested or superseded claims are surfaced as excluded, with reasons.
- `history --id <claim_id>` remains immediate/local lineage inspection only.
- Current confidence is derived from the claim's base confidence plus its direct logged outcomes.
- Audits do not change current confidence.

## Explicit Non-Claims

- This is not a general AI memory platform.
- This is not semantic long-term memory.
- This does not prove retrieved claims are true.
- This does not prove the model obeyed the context pack.
- This does not sync memory across assistants.
- This does not use embeddings, vector search, or external model calls.
- This is not a hosted service.
- This is not a chatbot or general AI assistant.
- This does not add causal attribution, blame logic, or per-author reliability scoring.
