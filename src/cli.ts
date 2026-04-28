import path from "node:path";
import { fileURLToPath } from "node:url";

import { openDatabase } from "./db.js";
import {
  formatClaimAudit,
  formatClaimAuditList,
  formatClaim,
  formatContextPackJson,
  formatContextPackMarkdown,
  formatClaimReport,
  formatClaimHistory,
  formatClaimList,
  formatEvent,
  formatLedgerHistory,
  formatMemoryOutcome,
  formatMemoryUseReceipt,
  formatMemoryUseReceiptList,
  formatSearchResults,
  formatSearchResultsJson
} from "./formatter.js";
import { MemLedger } from "./ledger.js";
import {
  claimAuditRecommendedActionSchema,
  claimAuditVerdictSchema,
  claimStatusFilterSchema,
  claimTriggerSchema,
  contextPackFormatSchema,
  confidenceSchema,
  claimMetadataSchema,
  manualMemoryOutcomeEventTypeSchema,
  searchOutputFormatSchema
} from "./schema.js";
import {
  CLAIM_AUDIT_RECOMMENDED_ACTIONS,
  CLAIM_AUDIT_VERDICTS,
  CLAIM_STATUS_FILTERS,
  CLAIM_TRIGGERS,
  CONTEXT_PACK_FORMATS,
  MANUAL_MEMORY_OUTCOME_EVENT_TYPES,
  SEARCH_OUTPUT_FORMATS
} from "./types.js";
import type {
  ClaimAuditRecommendedAction,
  ClaimAuditVerdict,
  ClaimStatusFilter,
  ClaimTrigger,
  ContextPackFormat,
  ManualMemoryOutcomeEventType,
  SearchOutputFormat
} from "./types.js";

export interface CliIo {
  stdout: (message: string) => void;
  stderr: (message: string) => void;
}

export interface CliDependencies {
  io?: CliIo;
  createLedger?: (databasePath: string) => {
    ledger: Pick<
      MemLedger,
      | "addClaim"
      | "listClaims"
      | "contestClaim"
      | "supersedeClaim"
      | "recordOutcome"
      | "auditClaim"
      | "searchClaims"
      | "generateContextPack"
      | "listMemoryUseReceipts"
      | "getMemoryUseReceipt"
      | "getClaimHistory"
      | "getClaimAudits"
      | "getLedgerHistory"
    >;
    close: () => void;
  };
}

interface ParsedArgs {
  command: string | null;
  options: Map<string, string | boolean>;
}

const DEFAULT_DB_FILENAME = "memledger.db";

const COMMAND_OPTIONS = {
  add: new Set([
    "subject",
    "predicate",
    "object",
    "project",
    "type",
    "author",
    "session",
    "trigger",
    "confidence",
    "db",
    "help"
  ]),
  list: new Set(["status", "db", "help"]),
  contest: new Set(["id", "actor", "session", "reason", "db", "help"]),
  supersede: new Set([
    "id",
    "subject",
    "predicate",
    "object",
    "project",
    "type",
    "author",
    "session",
    "trigger",
    "confidence",
    "reason",
    "db",
    "help"
  ]),
  "record-outcome": new Set([
    "id",
    "event-type",
    "source",
    "notes",
    "related-claim-id",
    "db",
    "help"
  ]),
  "audit-claim": new Set([
    "claim-id",
    "auditor",
    "verdict",
    "reason",
    "evidence-note",
    "recommended-action",
    "db",
    "help"
  ]),
  "show-audits": new Set(["claim-id", "db", "help"]),
  "show-claim": new Set(["id", "db", "help"]),
  search: new Set([
    "query",
    "project",
    "type",
    "limit",
    "format",
    "db",
    "help"
  ]),
  "context-pack": new Set([
    "query",
    "project",
    "type",
    "limit",
    "format",
    "db",
    "help"
  ]),
  "receipts-list": new Set(["db", "help"]),
  "receipts-show": new Set(["id", "db", "help"]),
  history: new Set(["id", "db", "help"]),
  help: new Set<string>()
} as const;

export function runCli(
  argv: string[],
  dependencies: CliDependencies = {}
): number {
  const io = dependencies.io ?? {
    stdout: (message: string) => process.stdout.write(message),
    stderr: (message: string) => process.stderr.write(message)
  };

  const parsed = parseArgv(argv);

  if (!parsed.command) {
    io.stderr(`error: Missing command.\n\n${usageText()}\n`);
    return 1;
  }

  if (!isKnownCommand(parsed.command)) {
    io.stderr(
      `error: Unknown command "${parsed.command}".\n\n${usageText()}\n`
    );
    return 1;
  }

  try {
    validateOptions(parsed.command, parsed.options);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    io.stderr(`error: ${message}\n`);
    return 1;
  }

  if (parsed.command === "help" || parsed.options.has("help")) {
    io.stdout(`${usageText()}\n`);
    return 0;
  }

  const databasePath = resolveDatabasePath(parsed.options.get("db"));
  const createLedger =
    dependencies.createLedger ??
    ((resolvedPath: string) => {
      const db = openDatabase(resolvedPath);

      return {
        ledger: new MemLedger(db),
        close: () => db.close()
      };
    });

  const handle = createLedger(databasePath);

  try {
    switch (parsed.command) {
      case "add": {
        const claim = handle.ledger.addClaim({
          subject: requireOption(parsed.options, "subject"),
          predicate: requireOption(parsed.options, "predicate"),
          object: requireOption(parsed.options, "object"),
          ...parseOptionalClaimMetadata(parsed.options),
          author: requireOption(parsed.options, "author"),
          sessionId: requireOption(parsed.options, "session"),
          trigger: parseRequiredTrigger(parsed.options),
          confidence: parseConfidence(parsed.options)
        });

        io.stdout(`added ${claim.id}\n${formatClaim(claim)}\n`);
        return 0;
      }

      case "list": {
        const status = parseStatus(parsed.options.get("status"));
        const claims = handle.ledger.listClaims({ status });

        io.stdout(`${formatClaimList(claims)}\n`);
        return 0;
      }

      case "contest": {
        const result = handle.ledger.contestClaim({
          claimId: requireOption(parsed.options, "id"),
          actor: requireOption(parsed.options, "actor"),
          sessionId: requireOption(parsed.options, "session"),
          reason: requireOption(parsed.options, "reason")
        });

        io.stdout(
          `contested ${result.claim.id}\n${formatEvent(result.event)}\n`
        );
        return 0;
      }

      case "supersede": {
        const trigger = getOptionalString(parsed.options, "trigger");
        const result = handle.ledger.supersedeClaim({
          targetClaimId: requireOption(parsed.options, "id"),
          subject: requireOption(parsed.options, "subject"),
          predicate: requireOption(parsed.options, "predicate"),
          object: requireOption(parsed.options, "object"),
          ...parseOptionalClaimMetadata(parsed.options),
          author: requireOption(parsed.options, "author"),
          sessionId: requireOption(parsed.options, "session"),
          ...(trigger !== undefined
            ? { trigger: parseTrigger(trigger) }
            : {}),
          confidence: parseConfidence(parsed.options),
          reason: getOptionalString(parsed.options, "reason") ?? null
        });

        io.stdout(
          `superseded ${result.previousClaim.id} with ${result.newClaim.id}\n${formatClaim(
            result.newClaim
          )}\n`
        );
        return 0;
      }

      case "record-outcome": {
        const result = handle.ledger.recordOutcome({
          claimId: requireOption(parsed.options, "id"),
          eventType: parseOutcomeEventType(
            requireOption(parsed.options, "event-type")
          ),
          source: requireOption(parsed.options, "source"),
          notes: getOptionalString(parsed.options, "notes") ?? null,
          relatedClaimId:
            getOptionalString(parsed.options, "related-claim-id") ?? null
        });

        io.stdout(
          `recorded ${result.outcome.id} for ${result.claim.id}\n${formatMemoryOutcome(
            result.outcome
          )}\ncurrentConfidence=${result.claim.currentConfidence.toFixed(2)}\n`
        );
        return 0;
      }

      case "audit-claim": {
        const result = handle.ledger.auditClaim({
          claimId: requireOption(parsed.options, "claim-id"),
          auditor: requireOption(parsed.options, "auditor"),
          verdict: parseAuditVerdict(requireOption(parsed.options, "verdict")),
          reason: requireOption(parsed.options, "reason"),
          evidenceNote:
            getOptionalString(parsed.options, "evidence-note") ?? null,
          recommendedAction: parseAuditRecommendedAction(
            requireOption(parsed.options, "recommended-action")
          )
        });

        io.stdout(
          `audited ${result.claim.id} with ${result.audit.id}\n${formatClaimAudit(
            result.audit
          )}\n`
        );
        return 0;
      }

      case "show-audits": {
        const audits = handle.ledger.getClaimAudits(
          requireOption(parsed.options, "claim-id")
        );
        io.stdout(`${formatClaimAuditList(audits)}\n`);
        return 0;
      }

      case "show-claim": {
        const history = handle.ledger.getClaimHistory(
          requireOption(parsed.options, "id")
        );
        io.stdout(`${formatClaimReport(history)}\n`);
        return 0;
      }

      case "search": {
        const result = handle.ledger.searchClaims({
          query: requireOption(parsed.options, "query"),
          ...parseOptionalClaimMetadata(parsed.options),
          limit: parseLimit(parsed.options)
        });
        const format = parseSearchOutputFormat(
          parsed.options.get("format")
        );

        io.stdout(
          format === "json"
            ? formatSearchResultsJson(result)
            : `${formatSearchResults(result)}\n`
        );
        return 0;
      }

      case "context-pack": {
        const format = parseContextPackFormat(parsed.options.get("format"));
        const pack = handle.ledger.generateContextPack({
          query: requireOption(parsed.options, "query"),
          ...parseOptionalClaimMetadata(parsed.options),
          limit: parseLimit(parsed.options),
          outputFormat: format
        });

        io.stdout(
          format === "json"
            ? formatContextPackJson(pack)
            : `${formatContextPackMarkdown(pack)}\n`
        );
        return 0;
      }

      case "receipts-list": {
        const receipts = handle.ledger.listMemoryUseReceipts();
        io.stdout(`${formatMemoryUseReceiptList(receipts)}\n`);
        return 0;
      }

      case "receipts-show": {
        const receipt = handle.ledger.getMemoryUseReceipt(
          requireOption(parsed.options, "id")
        );
        io.stdout(`${formatMemoryUseReceipt(receipt)}\n`);
        return 0;
      }

      case "history": {
        const claimId = getOptionalString(parsed.options, "id");

        if (claimId) {
          const history = handle.ledger.getClaimHistory(claimId);
          io.stdout(`${formatClaimHistory(history)}\n`);
          return 0;
        }

        const events = handle.ledger.getLedgerHistory();
        io.stdout(`${formatLedgerHistory(events)}\n`);
        return 0;
      }

      default:
        return 1;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    io.stderr(`error: ${message}\n`);
    return 1;
  } finally {
    handle.close();
  }
}

function parseArgv(argv: string[]): ParsedArgs {
  const command = argv[0];

  if (command === undefined) {
    return {
      command: null,
      options: new Map()
    };
  }

  const rest = argv.slice(1);
  const options = new Map<string, string | boolean>();

  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];

    if (token === undefined) {
      throw new Error("Unexpected missing argument.");
    }

    if (!token.startsWith("--")) {
      throw new Error(`Unexpected argument "${token}".`);
    }

    const trimmed = token.slice(2);

    if (trimmed.length === 0) {
      throw new Error("Unexpected empty flag.");
    }

    const equalsIndex = trimmed.indexOf("=");

    if (equalsIndex >= 0) {
      const key = trimmed.slice(0, equalsIndex);
      const value = trimmed.slice(equalsIndex + 1);
      options.set(key, value);
      continue;
    }

    const nextToken = rest[index + 1];

    if (!nextToken || nextToken.startsWith("--")) {
      options.set(trimmed, true);
      continue;
    }

    options.set(trimmed, nextToken);
    index += 1;
  }

  return {
    command,
    options
  };
}

function isKnownCommand(command: string): command is keyof typeof COMMAND_OPTIONS {
  return Object.hasOwn(COMMAND_OPTIONS, command);
}

function validateOptions(
  command: keyof typeof COMMAND_OPTIONS,
  options: Map<string, string | boolean>
): void {
  const allowedOptions = COMMAND_OPTIONS[command];

  for (const optionName of options.keys()) {
    if (!allowedOptions.has(optionName)) {
      throw new Error(
        `Unknown option --${optionName} for command ${command}.`
      );
    }
  }
}

function parseConfidence(options: Map<string, string | boolean>): number {
  const raw = requireOption(options, "confidence");
  const parsed = Number(raw);

  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid confidence "${raw}". Expected a number between 0 and 1.`);
  }

  if (parsed < 0 || parsed > 1) {
    throw new Error(`Invalid confidence "${raw}". Expected a number between 0 and 1.`);
  }

  return confidenceSchema.parse(parsed);
}

function parseRequiredTrigger(
  options: Map<string, string | boolean>
): ClaimTrigger {
  const raw = requireOption(options, "trigger");
  return parseTrigger(raw);
}

function parseTrigger(raw: string): ClaimTrigger {
  const parsed = claimTriggerSchema.safeParse(raw);

  if (!parsed.success) {
    throw new Error(
      `Invalid trigger "${raw}". Expected one of: ${CLAIM_TRIGGERS.join(", ")}.`
    );
  }

  return parsed.data;
}

function parseOutcomeEventType(raw: string): ManualMemoryOutcomeEventType {
  const parsed = manualMemoryOutcomeEventTypeSchema.safeParse(raw);

  if (!parsed.success) {
    throw new Error(
      `Invalid event type "${raw}". Expected one of: ${MANUAL_MEMORY_OUTCOME_EVENT_TYPES.join(", ")}.`
    );
  }

  return parsed.data;
}

function parseAuditVerdict(raw: string): ClaimAuditVerdict {
  const parsed = claimAuditVerdictSchema.safeParse(raw);

  if (!parsed.success) {
    throw new Error(
      `Invalid verdict "${raw}". Expected one of: ${CLAIM_AUDIT_VERDICTS.join(", ")}.`
    );
  }

  return parsed.data;
}

function parseAuditRecommendedAction(
  raw: string
): ClaimAuditRecommendedAction {
  const parsed = claimAuditRecommendedActionSchema.safeParse(raw);

  if (!parsed.success) {
    throw new Error(
      `Invalid recommended action "${raw}". Expected one of: ${CLAIM_AUDIT_RECOMMENDED_ACTIONS.join(", ")}.`
    );
  }

  return parsed.data;
}

function parseStatus(raw: string | boolean | undefined): ClaimStatusFilter {
  if (raw === undefined) {
    return "all";
  }

  if (typeof raw !== "string") {
    throw new Error("Expected --status to have a value.");
  }

  const parsed = claimStatusFilterSchema.safeParse(raw);

  if (!parsed.success) {
    throw new Error(
      `Invalid status "${raw}". Expected one of: ${CLAIM_STATUS_FILTERS.join(", ")}.`
    );
  }

  return parsed.data;
}

function parseOptionalClaimMetadata(
  options: Map<string, string | boolean>
): { project?: string; type?: string } {
  const metadata: { project?: string; type?: string } = {};
  const project = getOptionalString(options, "project");
  const type = getOptionalString(options, "type");

  if (project !== undefined) {
    const parsed = claimMetadataSchema.safeParse(project);

    if (!parsed.success) {
      throw new Error("Invalid project. Expected non-empty text up to 128 characters.");
    }

    metadata.project = parsed.data;
  }

  if (type !== undefined) {
    const parsed = claimMetadataSchema.safeParse(type);

    if (!parsed.success) {
      throw new Error("Invalid type. Expected non-empty text up to 128 characters.");
    }

    metadata.type = parsed.data;
  }

  return metadata;
}

function parseLimit(options: Map<string, string | boolean>): number {
  const raw = getOptionalString(options, "limit");

  if (raw === undefined) {
    return 10;
  }

  const parsedNumber = Number(raw);

  if (!Number.isInteger(parsedNumber) || parsedNumber < 1 || parsedNumber > 100) {
    throw new Error(`Invalid limit "${raw}". Expected an integer between 1 and 100.`);
  }

  return parsedNumber;
}

function parseContextPackFormat(
  raw: string | boolean | undefined
): ContextPackFormat {
  if (raw === undefined) {
    return "markdown";
  }

  if (typeof raw !== "string") {
    throw new Error("Expected --format to have a value.");
  }

  const parsed = contextPackFormatSchema.safeParse(raw);

  if (!parsed.success) {
    throw new Error(
      `Invalid format "${raw}". Expected one of: ${CONTEXT_PACK_FORMATS.join(", ")}.`
    );
  }

  return parsed.data;
}

function parseSearchOutputFormat(
  raw: string | boolean | undefined
): SearchOutputFormat {
  if (raw === undefined) {
    return "text";
  }

  if (typeof raw !== "string") {
    throw new Error("Expected --format to have a value.");
  }

  const parsed = searchOutputFormatSchema.safeParse(raw);

  if (!parsed.success) {
    throw new Error(
      `Invalid format "${raw}". Expected one of: ${SEARCH_OUTPUT_FORMATS.join(", ")}.`
    );
  }

  return parsed.data;
}

function requireOption(
  options: Map<string, string | boolean>,
  name: string
): string {
  const value = options.get(name);

  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Missing required option --${name}.`);
  }

  return value;
}

function getOptionalString(
  options: Map<string, string | boolean>,
  name: string
): string | undefined {
  const value = options.get(name);

  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new Error(`Expected --${name} to have a value.`);
  }

  return value;
}

function resolveDatabasePath(raw: string | boolean | undefined): string {
  if (raw === undefined) {
    return path.resolve(process.cwd(), DEFAULT_DB_FILENAME);
  }

  if (typeof raw !== "string") {
    throw new Error("Expected --db to have a value.");
  }

  if (raw === ":memory:") {
    return raw;
  }

  return path.resolve(process.cwd(), raw);
}

function usageText(): string {
  return [
    "MemLedger v0.3",
    "",
    "Usage:",
    "  memledger add --subject <text> --predicate <text> --object <text> --author <id> --session <id> --trigger <task_completion|correction|assumption|inference> --confidence <0..1> [--project <project>] [--type <type>] [--db <path>]",
    "  memledger list [--status <all|active|contested|superseded>] [--db <path>]",
    "  memledger contest --id <claim_id> --actor <id> --session <id> --reason <text> [--db <path>]",
    "  memledger supersede --id <claim_id> --subject <text> --predicate <text> --object <text> --author <id> --session <id> --confidence <0..1> [--project <project>] [--type <type>] [--trigger <trigger>] [--reason <text>] [--db <path>]",
    "  memledger record-outcome --id <claim_id> --event-type <observed_hold|observed_fail|manual_correction> --source <text> [--notes <text>] [--related-claim-id <claim_id>] [--db <path>]",
    "  memledger audit-claim --claim-id <claim_id> --auditor <id> --verdict <supports|questions|rejects|insufficient_evidence> --reason <text> [--evidence-note <text>] --recommended-action <none|contest|supersede|manual_correction> [--db <path>]",
    "  memledger show-audits --claim-id <claim_id> [--db <path>]",
    "  memledger show-claim --id <claim_id> [--db <path>]",
    "  memledger search --query <text> [--project <project>] [--type <type>] [--limit <n>] [--format <text|json>] [--db <path>]",
    "  memledger context-pack --query <text> [--project <project>] [--type <type>] [--limit <n>] [--format <markdown|json>] [--db <path>]",
    "  memledger receipts-list [--db <path>]",
    "  memledger receipts-show --id <receipt_id> [--db <path>]",
    "  memledger history [--id <claim_id>] [--db <path>]"
  ].join("\n");
}

const isMainModule =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isMainModule) {
  process.exitCode = runCli(process.argv.slice(2));
}
