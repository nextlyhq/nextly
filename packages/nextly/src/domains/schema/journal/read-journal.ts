// Plan C1 — read-side of the schema journal, now backed by
// `nextly_schema_events` (was `nextly_migration_journal`).
//
// Pure async function: takes a Drizzle db + dialect + cursor pagination
// args, returns { rows, hasMore }. Pagination uses a `started_at`
// timestamp cursor (newer-first); fetching `limit + 1` rows lets us
// compute `hasMore` cheaply without a second COUNT query.
//
// Only journal-equivalent events (dev_push / ui_save / db_sync) appear in
// the admin feed — file_apply / core_apply are migrate/upgrade events, not
// the dev-time apply journal the NotificationCenter shows.
//
// Powers `GET /api/schema/journal`, which drives the admin NotificationBell.

import { and, desc, inArray, lt } from "drizzle-orm";

import { schemaEventsTables } from "../../../schemas/schema-events";

export type Dialect = "postgresql" | "mysql" | "sqlite";

// API-shape scope (server returns this; admin types in
// `packages/admin/src/services/journalApi.ts` mirror it).
export type JournalScopeApi =
  | { kind: "collection"; slug: string }
  | { kind: "single"; slug: string }
  | { kind: "global"; slug?: string }
  | { kind: "fresh-push" };

export interface JournalRowApi {
  id: string;
  source: "ui" | "code";
  status: "in_progress" | "success" | "failed" | "aborted";
  scope: JournalScopeApi | null;
  summary: {
    added: number;
    removed: number;
    renamed: number;
    changed: number;
  } | null;
  startedAt: string;
  endedAt: string | null;
  durationMs: number | null;
  errorCode: string | null;
  errorMessage: string | null;
}

export interface ReadJournalArgs {
  db: unknown;
  dialect: Dialect;
  // Caller-requested page size. Clamped to [1, 100] before use.
  limit: number;
  // Optional ISO 8601 cursor: when set, only rows strictly older than
  // this timestamp are returned. Used for "load more" pagination.
  before?: string;
}

export interface ReadJournalResult {
  rows: JournalRowApi[];
  hasMore: boolean;
}

const MIN_LIMIT = 1;
const MAX_LIMIT = 100;

// Event types that make up the admin "schema journal" feed.
const JOURNAL_EVENT_TYPES = ["dev_push", "ui_save", "db_sync"] as const;

interface DrizzleSelectChain {
  from: (t: unknown) => DrizzleSelectChain;
  where: (clause: unknown) => DrizzleSelectChain;
  orderBy: (clause: unknown) => DrizzleSelectChain;
  limit: (n: number) => Promise<Array<Record<string, unknown>>>;
}

interface DrizzleDbLike {
  select: () => DrizzleSelectChain;
}

export async function readJournal(
  args: ReadJournalArgs
): Promise<ReadJournalResult> {
  const table = schemaEventsTables(args.dialect).nextlySchemaEvents;
  const limit = clamp(args.limit, MIN_LIMIT, MAX_LIMIT);
  const beforeDate = args.before ? new Date(args.before) : undefined;

  // Drizzle's typed db is dialect-specific; accept a structural shape on the
  // caller's `db` arg to avoid leaking dialect types up.
  const db = args.db as DrizzleDbLike;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Drizzle column type is dialect-specific; structural match
  const eventTypeCol = (table as { eventType: any }).eventType;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Drizzle column type is dialect-specific; structural match
  const startedAtCol = (table as { startedAt: any }).startedAt;

  const filter = beforeDate
    ? and(inArray(eventTypeCol, [...JOURNAL_EVENT_TYPES]), lt(startedAtCol, beforeDate))
    : inArray(eventTypeCol, [...JOURNAL_EVENT_TYPES]);

  const chain = db
    .select()
    .from(table)
    .where(filter)
    .orderBy(desc(startedAtCol));

  // Fetch one extra row so we can compute hasMore without a COUNT.
  const raw = await chain.limit(limit + 1);
  const trimmed = raw.slice(0, limit);
  const hasMore = raw.length > limit;
  return { rows: trimmed.map(mapRow), hasMore };
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function mapRow(r: Record<string, unknown>): JournalRowApi {
  const scopeKind = r.scopeKind as string | null | undefined;
  const scopeSlug = r.scopeSlug as string | null | undefined;
  let scope: JournalScopeApi | null = null;
  if (scopeKind === "global" || scopeKind === "core" || scopeKind === "component") {
    // Events-only kinds (core/component) have no admin-facing equivalent;
    // fold them into the generic "global" bucket.
    scope = scopeSlug ? { kind: "global", slug: scopeSlug } : { kind: "global" };
  } else if (
    (scopeKind === "collection" || scopeKind === "single") &&
    typeof scopeSlug === "string"
  ) {
    scope = { kind: scopeKind, slug: scopeSlug };
  }

  return {
    id: String(r.id),
    source: r.eventType === "ui_save" ? "ui" : "code",
    status: mapStatus(r.status as string),
    scope,
    // The events table does not persist per-kind counts (only renames_applied);
    // the admin DTO summary is therefore always null. See Plan C1 scope notes.
    summary: null,
    startedAt: toIso(r.startedAt),
    endedAt: r.endedAt != null ? toIso(r.endedAt) : null,
    durationMs: (r.durationMs as number | null) ?? null,
    errorCode: (r.errorCode as string | null) ?? null,
    errorMessage: (r.errorMessage as string | null) ?? null,
  };
}

function mapStatus(status: string): JournalRowApi["status"] {
  switch (status) {
    case "applied":
      return "success";
    case "failed":
      return "failed";
    case "in_progress":
      return "in_progress";
    default:
      // rolled_back / superseded → "aborted" for the admin feed.
      return "aborted";
  }
}

function toIso(v: unknown): string {
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "number") return new Date(v).toISOString();
  if (typeof v === "string") return new Date(v).toISOString();
  return String(v);
}
