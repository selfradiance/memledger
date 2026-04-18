# MemLedger — Project Context

**Type:** AI Agent Infrastructure  
**Arc:** AgentGate (extension)  
**Status:** Pre-build — begins after AgentGate Arc completion (MCP Firewall v2 → Epistemic Poisoning)  
**Last updated:** April 2026

---

## One-Line Pitch

MemLedger brings signed, auditable, contestable integrity to agent memory — because an agent that writes its own unchecked history is an agent you cannot trust.

---

## The Problem

Current agent memory systems treat memory like a database: write a fact, retrieve it later. This is architecturally naive. Agents write their own memories, which means:

- Errors get logged as facts and compound silently across sessions
- There is no provenance: no record of which agent, which session, or which confidence level produced a given memory entry
- Adversarial inputs can poison the memory store permanently — prompt injection writes a false "fact" that persists and propagates
- There is no mechanism to contest, decay, or invalidate a memory that subsequent outcomes prove wrong

OWASP formally recognizes this as **ASI-06 (Memory & Context Poisoning)** — a top-tier agentic risk for 2026.

**The field is solving storage and retrieval. Nobody has solved memory integrity over time.**

---

## Core Thesis

Agent memory should be treated not as a database but as **testimony** — with authorship, confidence, contestability, and accountability.

---

## What MemLedger Is Not

- A general-purpose memory platform (crowded: Mem0, Zep, LangMem)
- An Obsidian wrapper or vault system
- A retrieval optimization project
- A replacement for Microsoft AGT — it is a complementary layer

## What MemLedger Is

- A **memory integrity layer** — longitudinal accountability that sits above ingestion-time defenses
- A **contestable memory ledger** — append-only, auditable, outcome-tracked confidence
- An extension of the AgentGate thesis: agents without accountability create systemic risk

---

## Market Positioning

### The Critical Distinction

| Tooling | What it does |
|---|---|
| Microsoft AGT (ASI-06) | Defends against poisoned context at ingestion/runtime via CMVK majority voting and VFS policies |
| Mem0 | Actor-aware memory tagging (June 2025) — source provenance, not contestability |
| **MemLedger** | Addresses what happens *after* a memory is written: whether it held, whether it should be contested, and who is accountable |

### The Framing That Works

> "Runtime prevention vs. longitudinal memory accountability."
> AGT and Mem0 ask: *was this memory safe to ingest?*
> MemLedger asks: *should this memory still be trusted — and who is responsible for it?*

### Confirmed Competitive Gap (repo-verified, April 2026)

Verified against Microsoft AGT's public GitHub repo and OWASP-COMPLIANCE.md. Items marked * are absent from all public AGT materials reviewed.

| Capability | Microsoft AGT | Mem0 | MemLedger |
|---|---|---|---|
| Prevent poisoned context at ingestion/runtime | ✅ (CMVK + VFS policies) | Partial | ✅ |
| Actor/source provenance on writes | ❌ Not in scope | ✅ (June 2025) | ✅ |
| Immutable append-only memory log | ✅ (actions only) | ❌ | ✅ (memory entries) |
| Outcome-based confidence decay | ❌ Not present* | ❌ | ✅ |
| Contestability workflow | ❌ Not present* | ❌ | ✅ |
| Per-agent memory reliability scoring | Partial (action trust decay) | ❌ | ✅ |
| Memory-as-testimony framing | ❌ | ❌ | ✅ |

---

## Architecture

### Memory Entry Schema

Memory entries are structured claims, not raw text. Each entry carries:

```json
{
  "author": "which agent or human wrote this entry",
  "session_id": "provenance back to originating context",
  "trigger": "task_completion | correction | assumption | inference",
  "confidence": 0.0,
  "contested": false,
  "outcome_log": []
}
```

### Key Architectural Principles

**Immutable event log**
Memory entries are never edited in place. Corrections create new entries that reference and supersede old ones. The full history is always recoverable.

**Outcome-based confidence scoring**
Confidence is not just time-decay. A memory acted on 10 times without contradiction gains confidence. A memory that leads to a correction loses it. Score is recalculated on each outcome event.

**Memory Auditor Agent**
A dedicated agent role — not the primary task agent — that periodically reviews memory entries against logged outcomes and flags contestable entries. Analogous to AgentGate's red-team logic applied to memory rather than actions.

**Slash events for bad memory writes**
An agent whose memory entry is contested and confirmed wrong receives a logged reliability penalty. This creates an accountability trail for memory quality over time — the bond-and-slash model applied to episodic memory.

---

## Build Sequence

### v0.1 — Schema (START HERE)
Structured memory claim schema with provenance fields, confidence, contested flag, and immutable event log.

> The concept lives or dies on whether the data structure is expressive enough to support the later audit and scoring layers without becoming a bottleneck. Nail the schema before writing any agent logic.

### v0.2 — Outcome Tracking
Log when a memory is acted on, record whether it held, recalculate confidence.

### v0.3 — Auditor Agent
Dedicated agent that reviews entries against outcomes and flags contestable claims.

> **Design risk must be resolved before v0.3:** See "Auditor Circularity" in Open Risks below.

### v0.4 — Slash / Reliability Scoring
Per-agent memory reliability score derived from audit history.

> **Design risk must be resolved before v0.4:** See "Causal Attribution" in Open Risks below.

---

## Open Design Risks

These are known-hard problems. They must be resolved at the design stage indicated — not after.

### 1. Auditor Circularity (resolve before v0.3)
An auditor agent reading from the same memory store it is auditing creates a circularity problem. If the memory store is poisoned, the auditor's priors may also be compromised. Needs an architectural answer — likely a separate read-only audit view or out-of-band verification source.

### 2. Causal Attribution in Slash Scoring (resolve before v0.4)
"Memory led to a correction" is ambiguous. Corrections happen for many reasons — changed context, new information, user preference shift — that are not the memory's fault. A causal attribution model is required to avoid penalizing correct memories that became stale. Without this, the scoring is noise.

### 3. Microsoft Roadmap Risk (monitor ongoing)
AGT shipped v3.0.1 in April 2026 and is actively developed. The confirmed capability gaps (outcome-based decay, contestability) may close. Monitor the AGT repo for new releases before public positioning.

---

## Relationship to AgentGate

MemLedger is not a replacement or pivot. It is an extension of the same thesis.

- **AgentGate** addresses action accountability — what agents *do*
- **MemLedger** addresses memory accountability — what agents *remember and write*
- Together they cover the two primary vectors through which agents cause silent, compounding harm

---

## Name

**MemLedger** — confirmed clean as of April 2026. No conflicting products found in developer tooling, AI, or agent infrastructure spaces.

- Nearest collision: MedLedger (healthcare EHR — different domain, no confusion risk)
- Rejected: MemProof — legacy Borland/Delphi memory debugger with existing footprint; also implies cryptographic proof the architecture does not yet deliver
- *Ledger* earns its name: immutability, append-only, auditability are all on-thesis

---

## Key References

- OWASP Top 10 for Agentic Applications 2026 — ASI-06 (Memory & Context Poisoning)
- Microsoft Agent Governance Toolkit — https://github.com/microsoft/agent-governance-toolkit
- Mem0 State of AI Agent Memory 2026 — https://mem0.ai/blog/state-of-ai-agent-memory-2026
- MINJA research: >95% injection success rates against production agents with persistent memory
