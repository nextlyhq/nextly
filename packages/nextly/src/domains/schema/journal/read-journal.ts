// F10 PR 4 — read-side of the journal.
//
// Pure async function: takes a Drizzle db + dialect + cursor pagination
// args, returns { rows, hasMore }. Pagination uses a `started_at`
// timestamp cursor (newer-first); fetching `limit + 1` rows lets us
// compute `hasMore` cheaply without a second COUNT query.
//
// Powers F10 PR 4's `GET /api/schema/journal` endpoint, which in turn
// drives the F10 PR 5 NotificationBell + Dropdown.

import { desc, lt } from "drizzle-orm";

import {
  nextlyMigrationJournalMysql,
  nextlyMigrationJournalPg,
  nextlyMigrationJournalSqlite,
} from "../../../schemas/migration-journal/index.js";
import type { MigrationJournalScopeKind } from "../../../schemas/migration-journal/types.js";

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
  const table = tableForDialect(args.dialect);
  const limit = clamp(args.limit, MIN_LIMIT, MAX_LIMIT);
  const beforeDate = args.before ? new Date(args.before) : undefined;

  // Drizzle's typed db is dialect-specific; we accept a structural
  // shape on the caller's `db` arg to avoid leaking dialect types up.
  const db = args.db as DrizzleDbLike;
  const startedAtCol = (table as { startedAt: unknown }).startedAt;

  let chain = db.select().from(table);
  if (beforeDate) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Drizzle column type is dialect-specific; structural match
    chain = chain.where(lt(startedAtCol as any, beforeDate));
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Drizzle column type is dialect-specific; structural match
  chain = chain.orderBy(desc(startedAtCol as any));

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
  const scopeKind = r.scopeKind as MigrationJournalScopeKind | null | undefined;
  const scopeSlug = r.scopeSlug as string | null | undefined;
  let scope: JournalScopeApi | null = null;
  if (scopeKind === "fresh-push") {
    scope = { kind: "fresh-push" };
  } else if (scopeKind === "global") {
    scope = scopeSlug ? { kind: "global", slug: scopeSlug } : { kind: "global" };
  } else if (
    (scopeKind === "collection" || scopeKind === "single") &&
    typeof scopeSlug === "string"
  ) {
    scope = { kind: scopeKind, slug: scopeSlug };
  }

  const sa = r.summaryAdded as number | null;
  const sr = r.summaryRemoved as number | null;
  const srn = r.summaryRenamed as number | null;
  const sc = r.summaryChanged as number | null;
  const summary =
    sa !== null && sr !== null && srn !== null && sc !== null
      ? { added: sa, removed: sr, renamed: srn, changed: sc }
      : null;

  return {
    id: String(r.id),
    source: r.source as "ui" | "code",
    status: r.status as "in_progress" | "success" | "failed" | "aborted",
    scope,
    summary,
    startedAt: toIso(r.startedAt),
    endedAt: r.endedAt != null ? toIso(r.endedAt) : null,
    durationMs: (r.durationMs as number | null) ?? null,
    errorCode: (r.errorCode as string | null) ?? null,
    errorMessage: (r.errorMessage as string | null) ?? null,
  };
}

function toIso(v: unknown): string {
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "number") return new Date(v).toISOString();
  if (typeof v === "string") return new Date(v).toISOString();
  return String(v);
}

function tableForDialect(dialect: Dialect): unknown {
  switch (dialect) {
    case "postgresql":
      return nextlyMigrationJournalPg;
    case "mysql":
      return nextlyMigrationJournalMysql;
    case "sqlite":
      return nextlyMigrationJournalSqlite;
    default: {
      const exhaustive: never = dialect;
      throw new Error(`Unsupported dialect: ${String(exhaustive)}`);
    }
  }
}
