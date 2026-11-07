/**
 * Where the "Bindings to fix" report is kept: one row per document holding a
 * binding that no longer fits, in this plugin's own table, and where the check
 * of every document stands (`binding_report_runs`).
 *
 * Kept rather than computed on each read, because the report's count is shown
 * on admin screens many people open, and judging every page there would read
 * every page each time. A document is judged again when it is saved, and every
 * document when the schema it is judged against changes.
 *
 * @module bindings-report/store
 */
import { desc, eq } from "@nextlyhq/plugin-sdk/db";
import {
  isUniqueViolation,
  type PluginDatabase,
} from "@nextlyhq/plugin-sdk/schema";

import { bindingIssues, bindingReportRuns } from "../schema/tables";

import type { BindingReportRow } from "./rows";

/** The one row of `binding_report_runs`: the check of every document. */
const FULL_CHECK = "full";

/** Where the check of every document stands. */
export interface FullCheck {
  /** The schema fingerprint the last complete check was made against. */
  readonly checked: string | null;
  /** The fingerprint a check under way is making, if one is. */
  readonly checking: string | null;
  /** The walk's cursor a check under way resumes after. */
  readonly cursor: string | null;
  /** When the check last moved. */
  readonly at: Date | null;
}

/**
 * The most documents one read of the report returns. A site with more broken
 * documents than this is told there are at least this many.
 */
export const MAX_REPORTED_DOCUMENTS = 500;

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
  /** Record a document's rows, replacing its last; none removes its row. */
  record(
    document: ReportedDocument,
    rows: readonly BindingReportRow[]
  ): Promise<void>;
  /** Every reported document, newest check first, up to the cap. */
  list(): Promise<StoredDocumentReport[]>;
  /** Where the check of every document stands. */
  fullCheck(): Promise<FullCheck>;
  /** Record where it stands now. */
  setFullCheck(
    state: Pick<FullCheck, "checked" | "checking" | "cursor">
  ): Promise<void>;
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

/** The report's store over this plugin's own tables. */
export function bindingReportStore(
  db: Pick<PluginDatabase, "select" | "insert" | "update" | "delete" | "table">,
  dialect: Dialect
): BindingReportStore {
  const issues = () => db.table(bindingIssues);
  const runs = () => db.table(bindingReportRuns);

  /** Insert, or update the row a concurrent insert won with. */
  const upsert = async (
    insert: () => Promise<unknown>,
    update: () => Promise<number>
  ): Promise<void> => {
    if ((await update()) > 0) return;
    try {
      await insert();
    } catch (error) {
      if (!isUniqueViolation(dialect, error)) throw error;
      await update();
    }
  };

  return {
    record: async (document, rows) => {
      const keyed = eq(issues().documentKey, document.documentKey);
      if (rows.length === 0) {
        await db.delete(bindingIssues).where(keyed);
        return;
      }
      const values = {
        kind: document.kind,
        slug: document.slug,
        documentId: document.documentId ?? null,
        place: document.place,
        issues: rows,
        count: rows.length,
        updatedAt: new Date(),
      };
      await upsert(
        () =>
          db.insert(bindingIssues, {
            documentKey: document.documentKey,
            ...values,
          }),
        () => db.update(bindingIssues, values).where(keyed)
      );
    },

    list: async () => {
      const found = await db
        .select(bindingIssues)
        .orderBy(desc(issues().updatedAt))
        .limit(MAX_REPORTED_DOCUMENTS)
        .all();
      return found.map(row => {
        const parsed = jsonOf(row.issues);
        return {
          documentKey: row.documentKey,
          kind: row.kind === "single" ? "single" : "collection",
          slug: row.slug,
          ...(row.documentId === null ? {} : { documentId: row.documentId }),
          place: row.place,
          rows: Array.isArray(parsed) ? (parsed as BindingReportRow[]) : [],
          checkedAt: row.updatedAt,
        };
      });
    },

    fullCheck: async () => {
      const row = await db
        .select(bindingReportRuns)
        .where(eq(runs().name, FULL_CHECK))
        .first();
      if (row === null) {
        return { checked: null, checking: null, cursor: null, at: null };
      }
      const held = jsonOf(row.cursor);
      const cursor =
        typeof held === "object" && held !== null
          ? (held as { after?: unknown }).after
          : undefined;
      return {
        checked: row.checked,
        checking: row.checking,
        cursor: typeof cursor === "string" ? cursor : null,
        at: row.updatedAt,
      };
    },

    setFullCheck: async state => {
      const keyed = eq(runs().name, FULL_CHECK);
      const values = {
        checked: state.checked,
        checking: state.checking,
        // Wrapped in an object: a bare string in a JSON column reads back
        // decoded on one dialect and as JSON text on another.
        cursor: state.cursor === null ? null : { after: state.cursor },
        updatedAt: new Date(),
      };
      await upsert(
        () => db.insert(bindingReportRuns, { name: FULL_CHECK, ...values }),
        () => db.update(bindingReportRuns, values).where(keyed)
      );
    },
  };
}
