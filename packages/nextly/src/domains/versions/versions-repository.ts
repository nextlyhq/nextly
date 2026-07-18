/**
 * Repository for `nextly_versions`, the global content-version store.
 *
 * Built on the adapter DB API (VersionsDbApi) so the same class can be
 * constructed with either the adapter or a transaction context, but the two
 * are not interchangeable for every method. `insertVersion` and
 * `getMaxVersionNo` return plain integers/strings and are safe via either;
 * `listByDoc` and `findByVersionNo` decode `createdAt`/`snapshot` through the
 * Drizzle-backed adapter select (JSON columns are parsed, timestamps become
 * `Date`), so they must be issued via the adapter, not a raw transaction
 * context, which would return the undecoded driver values instead. Column
 * names are the Drizzle property names (camelCase); the adapter maps them to
 * snake_case.
 *
 * @module domains/versions/versions-repository
 */

import { NextlyError } from "../../errors";
import type {
  VersionScopeKind,
  VersionStatus,
} from "../../schemas/versions/types";

import type { VersionsDbApi, VersionsWhereCondition } from "./db-api";

const TABLE = "nextly_versions";

// Every column except `snapshot`, so metadata reads (history lists) can project
// away the potentially large JSON payload instead of transferring then dropping
// it. Keep in sync with VersionRow when adding a metadata column.
const VERSION_META_COLUMNS = [
  "id",
  "scopeKind",
  "scopeSlug",
  "entryId",
  "versionNo",
  "status",
  "isAutosave",
  "label",
  "locale",
  "sourceVersionNo",
  "createdBy",
  "createdAt",
  "updatedAt",
] as const;

/** Identifies the document a version belongs to. */
export interface VersionRef {
  scopeKind: VersionScopeKind;
  scopeSlug: string;
  entryId: string;
}

/** Input to insert one version row. */
export interface InsertVersionInput {
  ref: VersionRef;
  versionNo: number | null;
  status: VersionStatus;
  isAutosave: boolean;
  snapshot: unknown;
  label?: string | null;
  locale?: string | null;
  sourceVersionNo?: number | null;
  createdBy?: string | null;
}

/** A full version row (camelCase, as the adapter returns it). */
export interface VersionRow {
  id: string;
  scopeKind: VersionScopeKind;
  scopeSlug: string;
  entryId: string;
  versionNo: number | null;
  status: VersionStatus;
  isAutosave: boolean;
  snapshot: unknown;
  label: string | null;
  locale: string | null;
  sourceVersionNo: number | null;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Metadata view of a version row (everything except the snapshot). */
export type VersionMeta = Omit<VersionRow, "snapshot">;

export class VersionsRepository {
  private readonly db: VersionsDbApi;

  constructor(db: VersionsDbApi) {
    this.db = db;
  }

  /**
   * The three-column filter that scopes every query to one document.
   * Return type is explicit (`value: unknown`, per VersionsWhereCondition)
   * so callers can push conditions with other value types (e.g. the
   * boolean `isAutosave` filter) without TS narrowing `value` to `string`
   * from the scope columns above.
   */
  private docWhere(ref: VersionRef): VersionsWhereCondition[] {
    return [
      { column: "scopeKind", op: "=" as const, value: ref.scopeKind },
      { column: "scopeSlug", op: "=" as const, value: ref.scopeSlug },
      { column: "entryId", op: "=" as const, value: ref.entryId },
    ];
  }

  /** Insert one version row. */
  async insertVersion(input: InsertVersionInput): Promise<void> {
    // The transaction-context insert path does not apply Drizzle column
    // defaults, so id and timestamps are set explicitly here (mirrors how the
    // collection mutation service seeds dc_ rows).
    const now = new Date();
    // A durable (non-autosave) version must carry a sequence number; only
    // autosave rows are allowed a null version_no. Reject the invalid
    // combination the input type cannot express, before it reaches the DB.
    if (!input.isAutosave && input.versionNo == null) {
      throw NextlyError.internal({
        logContext: { reason: "durable-version-missing-version-no" },
      });
    }
    // `snapshot` is `unknown`; serialize defensively. JSON.stringify returns
    // `undefined` for a top-level function/symbol/undefined and THROWS for a
    // circular reference or a BigInt. Either way the NOT NULL snapshot column
    // must not receive a bad value, so both cases are wrapped as a NextlyError.
    let serializedSnapshot: string;
    try {
      const serialized = JSON.stringify(input.snapshot);
      if (typeof serialized !== "string") {
        throw new TypeError("snapshot did not serialize to a JSON string");
      }
      serializedSnapshot = serialized;
    } catch (cause) {
      throw NextlyError.internal({
        cause: cause instanceof Error ? cause : undefined,
        logContext: { reason: "version-snapshot-not-serializable" },
      });
    }
    await this.db.insert(TABLE, {
      id: crypto.randomUUID(),
      scopeKind: input.ref.scopeKind,
      scopeSlug: input.ref.scopeSlug,
      entryId: input.ref.entryId,
      versionNo: input.versionNo,
      status: input.status,
      isAutosave: input.isAutosave,
      // Pre-stringify: the raw-SQL transaction insert path binds this value
      // straight into a driver query with no column-type awareness, and
      // mysql2 turns a plain object into invalid `key = value` SQL for a
      // query parameter (it is not stringified for us the way SQLite
      // stringifies a bound object). The non-transactional Drizzle path
      // re-parses a stringified value for JSON columns before handing it to
      // the query builder (mapDataToColumnNames), so this is correct on
      // both paths and matches the JSON-field convention used by the
      // collection mutation service.
      snapshot: serializedSnapshot,
      label: input.label ?? null,
      locale: input.locale ?? null,
      sourceVersionNo: input.sourceVersionNo ?? null,
      createdBy: input.createdBy ?? null,
      createdAt: now,
      updatedAt: now,
    });
  }

  /**
   * Highest durable (non-autosave) version_no for a document, or 0 if none.
   * The caller allocates the next number as `getMaxVersionNo(ref) + 1`.
   * Note this read does not run inside the caller's write transaction: the
   * transaction context's `select` delegates to the adapter's main
   * connection pool, not the transaction's own connection, on Postgres and
   * MySQL. Duplicate version_no is guarded by the partial unique index on
   * Postgres; a MySQL/SQLite serialization or unique guard is needed in a
   * later stage before capture is wired into concurrent writes.
   */
  async getMaxVersionNo(ref: VersionRef): Promise<number> {
    // Order by version_no desc and take a single row so this reads at most one
    // record instead of scanning every durable version (whose rows carry the
    // full snapshot). The adapter select does not project columns, so limiting
    // the row count is how the snapshot payload is kept off this hot path.
    const rows = await this.db.select<VersionRow>(TABLE, {
      columns: ["versionNo"],
      where: {
        and: [
          ...this.docWhere(ref),
          { column: "isAutosave", op: "=", value: false },
        ],
      },
      orderBy: [{ column: "versionNo", direction: "desc" }],
      limit: 1,
    });
    const top = rows[0]?.versionNo;
    return typeof top === "number" ? top : 0;
  }

  /** Fetch one durable version by its number, snapshot included. */
  async findByVersionNo(
    ref: VersionRef,
    versionNo: number
  ): Promise<VersionRow | undefined> {
    const rows = await this.db.select<VersionRow>(TABLE, {
      where: {
        and: [
          ...this.docWhere(ref),
          { column: "isAutosave", op: "=", value: false },
          { column: "versionNo", op: "=", value: versionNo },
        ],
      },
    });
    return rows[0];
  }

  /**
   * Metadata list for a document, newest first. Snapshots are intentionally
   * excluded (history lists never load them). Autosave rows are excluded unless
   * `includeAutosave` is set.
   */
  async listByDoc(
    ref: VersionRef,
    opts: { limit?: number; includeAutosave?: boolean } = {}
  ): Promise<VersionMeta[]> {
    const and = [...this.docWhere(ref)];
    if (!opts.includeAutosave) {
      and.push({ column: "isAutosave", op: "=", value: false });
    }
    const rows = await this.db.select<VersionMeta>(TABLE, {
      // Project metadata columns only, so the snapshot payload is never
      // transferred for a history list (the adapter select honors `columns`).
      columns: [...VERSION_META_COLUMNS],
      where: { and },
      // Secondary versionNo sort: seconds-precision createdAt can tie when two
      // versions are written in the same second (the tx-path SQLite encoding).
      orderBy: [
        { column: "createdAt", direction: "desc" },
        { column: "versionNo", direction: "desc" },
      ],
      ...(typeof opts.limit === "number" ? { limit: opts.limit } : {}),
    });
    return rows;
  }
}
