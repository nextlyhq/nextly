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
 * Each write to a document marks its row dirty with a fresh token, and one
 * judgement at a time settles it: the row's issues are replaced, and the mark
 * cleared, only while the token is still the one the judgement read. A write
 * made meanwhile, or a judgement that failed, leaves the row dirty to be
 * judged again, so the report never keeps an answer older than the document.
 * The check of every document leaves a dirty row to that judgement.
 *
 * Beside each document's issues, the same judgement writes where it binds a
 * Single (`uses-store.ts`), in one transaction with the row it settles or
 * records and under the same mark, so the index a Single's panel reads is
 * never older than the report.
 *
 * @module bindings-report/store
 */
import {
  and,
  asc,
  desc,
  eq,
  gt,
  isNotNull,
  isNull,
  lt,
} from "@nextlyhq/plugin-sdk/db";
import {
  isUniqueViolation,
  type PluginDatabase,
} from "@nextlyhq/plugin-sdk/schema";

import { bindingIssues, bindingReportRuns } from "../schema/tables";

import type { BindingReportRow } from "./rows";
import {
  dropUsesBefore,
  markUsesFilled,
  replaceUses,
  type DocumentUse,
} from "./uses-store";

/** The one row of `binding_report_runs`: the check of every document. */
const FULL_CHECK = "full";

/** How many rows one read of the table takes, while the report is listed whole. */
const LIST_PAGE = 500;

/**
 * How much earlier than a complete check's start a row must have been judged
 * to count as one the check no longer found: a timestamp column may keep
 * whole seconds.
 */
const CLOCK_GRAIN_MS = 1000;

/**
 * How many marked documents a drop of rows no longer found reads, to keep
 * their uses: one past what one statement names, so more is seen as more.
 */
const DROP_MARKED_MAX = 501;

/** A document waiting to be judged, and the mark its judgement must still find. */
export interface DirtyDocument {
  readonly document: ReportedDocument;
  readonly token: string;
}

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
   * Record a document's rows and where it binds a Single, as the check of
   * every document judged them; a row marked dirty is left, with its uses,
   * to the judgement that settles it.
   */
  record(
    document: ReportedDocument,
    rows: readonly BindingReportRow[],
    uses: readonly DocumentUse[]
  ): Promise<void>;
  /** Mark a document to be judged again, with a fresh token. */
  markDirty(document: ReportedDocument): Promise<void>;
  /**
   * Up to `limit` documents marked to be judged again, in key order, after
   * the key `after` when given, so a pass walks them once with a cursor.
   */
  dirty(limit: number, after?: string): Promise<DirtyDocument[]>;
  /**
   * Settle a marked document with its rows and where it binds a Single, in
   * one transaction; `false`, changing nothing, when it was marked again
   * since `token` was read.
   */
  settle(
    marked: DirtyDocument,
    rows: readonly BindingReportRow[],
    uses: readonly DocumentUse[]
  ): Promise<boolean>;
  /**
   * Replace a marked document's uses, leaving it marked, while its mark is
   * still the one read: for a judgement left incomplete, whose uses are
   * whole. `false`, changing nothing, when it was marked again since.
   */
  keepUses(
    marked: DirtyDocument,
    uses: readonly DocumentUse[]
  ): Promise<boolean>;
  /** Every document with a broken binding, newest judged first. */
  list(): Promise<StoredDocumentReport[]>;
  /** One document's row, when it has a broken binding. */
  get(documentKey: string): Promise<StoredDocumentReport | undefined>;
  /** Where the check of every document stands. */
  fullCheck(): Promise<FullCheck>;
  /** Record where it stands now. */
  setFullCheck(state: FullCheck): Promise<void>;
  /**
   * Drop the rows judged before `at`, and their uses: documents a complete
   * check no longer found.
   */
  dropCheckedBefore(at: Date): Promise<void>;
  /** Mark the index of where documents bind Singles filled once. */
  markUsesFilled(): Promise<void>;
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
  db: Pick<
    PluginDatabase,
    "select" | "insert" | "update" | "delete" | "table" | "transaction"
  >,
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
    record: async (document, rows, uses) => {
      const keyed = eq(issues().documentKey, document.documentKey);
      const values = {
        kind: document.kind,
        slug: document.slug,
        documentId: document.documentId ?? null,
        place: document.place,
        issues: rows,
        updatedAt: new Date(),
      };
      // A row a write marked is the judgement's to settle, uses and all.
      const cleanIn = (t: ReturnType<typeof issues>) => {
        const key = eq(t.documentKey, document.documentKey);
        return and(key, isNull(t.dirty)) ?? key;
      };
      const recorded = await db.transaction(async tx => {
        const clean = cleanIn(tx.table(bindingIssues));
        if ((await tx.update(bindingIssues, values).where(clean)) === 0) {
          return false;
        }
        await replaceUses(tx, document, uses);
        return true;
      });
      if (recorded) return;
      const held = await db.select(bindingIssues).where(keyed).first();
      if (held !== null) return;
      if (!(await insert({ documentKey: document.documentKey, ...values }))) {
        return;
      }
      // The new row, still unmarked, holds the fence while its uses go in:
      // a write marking it meanwhile leaves them to its judgement.
      await db.transaction(async tx => {
        const touched = await tx
          .update(bindingIssues, { updatedAt: new Date() })
          .where(cleanIn(tx.table(bindingIssues)));
        if (touched > 0) await replaceUses(tx, document, uses);
      });
    },

    markDirty: async document => {
      const keyed = eq(issues().documentKey, document.documentKey);
      const token = crypto.randomUUID();
      if ((await db.update(bindingIssues, { dirty: token }).where(keyed)) > 0) {
        return;
      }
      if (
        await insert({
          documentKey: document.documentKey,
          kind: document.kind,
          slug: document.slug,
          documentId: document.documentId ?? null,
          place: document.place,
          issues: [],
          dirty: token,
        })
      ) {
        return;
      }
      await db.update(bindingIssues, { dirty: token }).where(keyed);
    },

    dirty: async (limit, after) => {
      const found = await db
        .select(bindingIssues)
        .where(
          after === undefined
            ? isNotNull(issues().dirty)
            : (and(
                isNotNull(issues().dirty),
                gt(issues().documentKey, after)
              ) ?? isNotNull(issues().dirty))
        )
        .orderBy(asc(issues().documentKey))
        .limit(limit)
        .all();
      return found.flatMap(row =>
        row.dirty === null
          ? []
          : [
              {
                document: {
                  documentKey: row.documentKey,
                  kind: row.kind === "single" ? "single" : "collection",
                  slug: row.slug,
                  ...(row.documentId === null
                    ? {}
                    : { documentId: row.documentId }),
                  place: row.place,
                },
                token: row.dirty,
              },
            ]
      );
    },

    settle: async (marked, rows, uses) =>
      // The row's update holds it until the commit, so a write marking it
      // again waits for these uses, and its own judgement replaces them.
      db.transaction(async tx => {
        const t = tx.table(bindingIssues);
        const where =
          and(
            eq(t.documentKey, marked.document.documentKey),
            eq(t.dirty, marked.token)
          ) ?? eq(t.dirty, marked.token);
        const settled = await tx
          .update(bindingIssues, {
            issues: rows,
            dirty: null,
            updatedAt: new Date(),
          })
          .where(where);
        if (settled === 0) return false;
        await replaceUses(tx, marked.document, uses);
        return true;
      }),

    keepUses: async (marked, uses) =>
      db.transaction(async tx => {
        const t = tx.table(bindingIssues);
        const where =
          and(
            eq(t.documentKey, marked.document.documentKey),
            eq(t.dirty, marked.token)
          ) ?? eq(t.dirty, marked.token);
        // Writes the mark it holds, to hold the row until the commit: a
        // write marking it meanwhile waits, then leaves these uses to its
        // own judgement. Every dialect counts the rows matched.
        const held = await tx
          .update(bindingIssues, { dirty: marked.token })
          .where(where);
        if (held === 0) return false;
        await replaceUses(tx, marked.document, uses);
        return true;
      }),

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
      // Not a row a write marked since: that document is there to judge.
      const stale = lt(issues().updatedAt, before);
      await db
        .delete(bindingIssues)
        .where(and(stale, isNull(issues().dirty)) ?? stale);
      // A document still marked keeps its uses for its judgement to replace.
      const marked = await db
        .select(bindingIssues)
        .where(isNotNull(issues().dirty))
        .orderBy(asc(issues().documentKey))
        .limit(DROP_MARKED_MAX)
        .all();
      await dropUsesBefore(
        db,
        before,
        marked.map(row => row.documentKey)
      );
    },

    markUsesFilled: () => markUsesFilled(db, dialect),

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
