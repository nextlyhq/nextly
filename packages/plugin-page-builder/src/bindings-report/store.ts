/**
 * Where the "Bindings to fix" report is kept: one row per document judged,
 * in this plugin's own table, and where the check of every document stands
 * (`binding_report_runs`).
 *
 * Kept rather than computed on each read, because the report's count is shown
 * on admin screens many people open, and judging every page there would read
 * every page each time. A document is judged again when it is saved, and every
 * document when the schema it is judged against changes.
 *
 * A document judged whole keeps its row, with no issues: the time it was
 * judged is what stops a slower check of every document, which read the
 * document before a save fixed it, from putting back what the save removed.
 *
 * @module bindings-report/store
 */
import { and, asc, desc, eq, lt } from "@nextlyhq/plugin-sdk/db";
import {
  isUniqueViolation,
  type PluginDatabase,
} from "@nextlyhq/plugin-sdk/schema";

import { bindingIssues, bindingReportRuns } from "../schema/tables";

import type { BindingReportRow } from "./rows";

/** The one row of `binding_report_runs`: the check of every document. */
const FULL_CHECK = "full";

/** How many rows one read of the table takes, while the report is listed whole. */
const LIST_PAGE = 500;

/**
 * How much earlier than a check's read a row must have been judged for the
 * check to replace it: a timestamp column may keep whole seconds, so a save
 * judged in the same second as the read could otherwise read as older.
 */
const CLOCK_GRAIN_MS = 1000;

/** Where the check of every document stands. */
export interface FullCheck {
  /** The schema fingerprint the last complete check was made against. */
  readonly checked: string | null;
  /** When that check completed. */
  readonly completedAt: Date | null;
  /** The fingerprint a check under way is making, if one is. */
  readonly checking: string | null;
  /** The walk's cursor a check under way resumes after. */
  readonly cursor: string | null;
  /** When the check under way started. */
  readonly startedAt: Date | null;
}

/** Which document a row is about, and where it lives. */
export interface ReportedDocument {
  readonly documentKey: string;
  readonly kind: "collection" | "single";
  readonly slug: string;
  readonly documentId?: string;
  /** Pages, components, patterns, layouts, another collection's entries, or a Single. */
  readonly place: string;
}

/** One document's row, as read back. */
export interface StoredDocumentReport extends ReportedDocument {
  readonly rows: readonly BindingReportRow[];
  readonly checkedAt: Date;
}

/** The report's store. */
export interface BindingReportStore {
  /**
   * Record a document's rows, replacing its last. With `readAt`, as a check
   * of every document records: only when the row was judged before that read,
   * so a save judged since is kept.
   */
  record(
    document: ReportedDocument,
    rows: readonly BindingReportRow[],
    readAt?: Date
  ): Promise<void>;
  /** Every document with a broken binding, newest judged first. */
  list(): Promise<StoredDocumentReport[]>;
  /** One document's row, when it has a broken binding. */
  get(documentKey: string): Promise<StoredDocumentReport | undefined>;
  /** Where the check of every document stands. */
  fullCheck(): Promise<FullCheck>;
  /** Record where it stands now. */
  setFullCheck(state: FullCheck): Promise<void>;
  /** Drop the rows judged before `at`: documents a complete check no longer found. */
  dropCheckedBefore(at: Date): Promise<void>;
}

type Dialect = Parameters<typeof isUniqueViolation>[0];

/** A JSON column's value, which SQLite hands back as text. */
function jsonOf(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return [];
  }
}

/** A date an ISO string in a JSON column names, or `null`. */
function dateIn(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const at = new Date(value);
  return Number.isNaN(at.getTime()) ? null : at;
}

/** A stored row as the report reads it; `undefined` for one judged whole. */
function reportOf(row: {
  documentKey: string;
  kind: string;
  slug: string;
  documentId: string | null;
  place: string;
  issues: unknown;
  updatedAt: Date;
}): StoredDocumentReport | undefined {
  const parsed = jsonOf(row.issues);
  const rows = Array.isArray(parsed) ? (parsed as BindingReportRow[]) : [];
  if (rows.length === 0) return undefined;
  return {
    documentKey: row.documentKey,
    kind: row.kind === "single" ? "single" : "collection",
    slug: row.slug,
    ...(row.documentId === null ? {} : { documentId: row.documentId }),
    place: row.place,
    rows,
    checkedAt: row.updatedAt,
  };
}

/** The report's store over this plugin's own tables. */
export function bindingReportStore(
  db: Pick<PluginDatabase, "select" | "insert" | "update" | "delete" | "table">,
  dialect: Dialect
): BindingReportStore {
  const issues = () => db.table(bindingIssues);
  const runs = () => db.table(bindingReportRuns);

  /** Insert; `false` when a row already holds the key. */
  const insert = async (
    values: Parameters<typeof db.insert<typeof bindingIssues>>[1]
  ): Promise<boolean> => {
    try {
      await db.insert(bindingIssues, values);
      return true;
    } catch (error) {
      if (!isUniqueViolation(dialect, error)) throw error;
      return false;
    }
  };

  return {
    record: async (document, rows, readAt) => {
      const keyed = eq(issues().documentKey, document.documentKey);
      const values = {
        kind: document.kind,
        slug: document.slug,
        documentId: document.documentId ?? null,
        place: document.place,
        issues: rows,
        updatedAt: new Date(),
      };
      if (readAt === undefined) {
        if ((await db.update(bindingIssues, values).where(keyed)) > 0) return;
        if (await insert({ documentKey: document.documentKey, ...values })) {
          return;
        }
        await db.update(bindingIssues, values).where(keyed);
        return;
      }
      // Fenced: only a row judged before the read this check made.
      const before = new Date(readAt.getTime() - CLOCK_GRAIN_MS);
      const replaced = await db
        .update(bindingIssues, values)
        .where(and(keyed, lt(issues().updatedAt, before)) ?? keyed);
      if (replaced > 0) return;
      // No row older than the read: none at all, or one a save judged since,
      // which the insert then meets and leaves.
      const held = await db.select(bindingIssues).where(keyed).first();
      if (held === null) {
        await insert({ documentKey: document.documentKey, ...values });
      }
    },

    list: async () => {
      const found: StoredDocumentReport[] = [];
      for (let offset = 0; ; offset += LIST_PAGE) {
        const page = await db
          .select(bindingIssues)
          .orderBy(desc(issues().updatedAt), asc(issues().documentKey))
          .limit(LIST_PAGE)
          .offset(offset)
          .all();
        for (const row of page) {
          const report = reportOf(row);
          if (report !== undefined) found.push(report);
        }
        if (page.length < LIST_PAGE) return found;
      }
    },

    get: async documentKey => {
      const row = await db
        .select(bindingIssues)
        .where(eq(issues().documentKey, documentKey))
        .first();
      return row === null ? undefined : reportOf(row);
    },

    dropCheckedBefore: async at => {
      const before = new Date(at.getTime() - CLOCK_GRAIN_MS);
      await db.delete(bindingIssues).where(lt(issues().updatedAt, before));
    },

    fullCheck: async () => {
      const row = await db
        .select(bindingReportRuns)
        .where(eq(runs().name, FULL_CHECK))
        .first();
      const held = row === null ? null : jsonOf(row.cursor);
      const state =
        typeof held === "object" && held !== null
          ? (held as {
              after?: unknown;
              startedAt?: unknown;
              completedAt?: unknown;
            })
          : {};
      return {
        checked: row?.checked ?? null,
        completedAt: dateIn(state.completedAt),
        checking: row?.checking ?? null,
        cursor: typeof state.after === "string" ? state.after : null,
        startedAt: dateIn(state.startedAt),
      };
    },

    setFullCheck: async state => {
      const keyed = eq(runs().name, FULL_CHECK);
      const values = {
        checked: state.checked,
        checking: state.checking,
        // One JSON object on every dialect: a bare string in a JSON column
        // reads back decoded on one and as JSON text on another.
        cursor: {
          ...(state.cursor === null ? {} : { after: state.cursor }),
          ...(state.startedAt === null
            ? {}
            : { startedAt: state.startedAt.toISOString() }),
          ...(state.completedAt === null
            ? {}
            : { completedAt: state.completedAt.toISOString() }),
        },
        updatedAt: new Date(),
      };
      if ((await db.update(bindingReportRuns, values).where(keyed)) > 0) {
        return;
      }
      try {
        await db.insert(bindingReportRuns, { name: FULL_CHECK, ...values });
      } catch (error) {
        if (!isUniqueViolation(dialect, error)) throw error;
        await db.update(bindingReportRuns, values).where(keyed);
      }
    },
  };
}
