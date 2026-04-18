# AGENTS.md

This repo is deliberately narrow. Keep it that way unless the user explicitly expands scope.

## Product Boundaries

- MemLedger v0.2 is a local CLI for structured, append-only memory claims plus explicit outcome logging.
- Do not add LLM features, web UI, AgentGate integration, retrieval systems, embeddings, vector search, auditor agents, autonomous review loops, causal attribution, blame logic, or per-author reliability scoring.
- v0.2 is only about outcome logging and deterministic confidence recalculation from logged outcomes.

## Design Rules

- Claims are structured records, not free-form memory blobs.
- Claim rows are append-only.
- Event rows are immutable.
- Outcome rows are immutable.
- Existing claim text must never be edited in place.
- Corrections must create new claims that supersede older ones.
- Manual outcome logging must not create `superseded` outcomes; structural supersession remains the source of truth.
- Every mutation must append an event.
- Current confidence must be derivable from stored claim data plus logged outcomes.

## Engineering Style

- Prefer explicit SQL over clever abstractions.
- Validate external inputs with Zod before they hit the ledger.
- Keep the CLI thin and the ledger logic centralized.
- Keep comments sparse and factual.
- Be honest about scope in docs and code.

## Testing Expectations

- Preserve coverage for schema validation, DB append-only guarantees, ledger behavior, and CLI edge cases.
- When changing mutation behavior, verify claim lineage, direct outcome history, and the immutable event log.
