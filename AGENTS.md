# AGENTS.md

This repo is deliberately narrow. Keep it that way unless the user explicitly expands scope.

## Product Boundaries

- MemLedger v0.1 is a CLI proof of concept for structured, append-only memory claims.
- Do not add LLM features, web UI, AgentGate integration, retrieval systems, embeddings, vector search, auditor agents, or reliability scoring.
- Outcome tracking may exist only as a stub until a future v0.2.

## Design Rules

- Claims are structured records, not free-form memory blobs.
- Claim rows are append-only.
- Event rows are immutable.
- Existing claim text must never be edited in place.
- Corrections must create new claims that supersede older ones.
- Every mutation must append an event.

## Engineering Style

- Prefer explicit SQL over clever abstractions.
- Validate external inputs with Zod before they hit the ledger.
- Keep the CLI thin and the ledger logic centralized.
- Keep comments sparse and factual.
- Be honest about scope in docs and code.

## Testing Expectations

- Preserve coverage for schema validation, DB append-only guarantees, ledger behavior, and CLI edge cases.
- When changing mutation behavior, verify both the claim lineage and the immutable event log.
