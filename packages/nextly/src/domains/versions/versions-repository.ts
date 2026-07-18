/**
 * Repository for `nextly_versions`, the global content-version store.
 *
 * Built on the adapter DB API (VersionsDbApi) so the same code serves both
 * non-transactional reads (constructed with the adapter) and in-transaction
 * capture (constructed with the transaction context). Column names are the
 * Drizzle property names (camelCase); the adapter maps them to snake_case.
 *
 * @module domains/versions/versions-repository
 */

import type {
  VersionScopeKind,
  VersionStatus,
} from "../../schemas/versions/types";

import type { VersionsDbApi, VersionsWhereCondition } from "./db-api";

const TABLE = "nextly_versions";

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

  /** Insert one version row. Ids/timestamps are filled by the table defaults. */
  async insertVersion(input: InsertVersionInput): Promise<void> {
    await this.db.insert(TABLE, {
      scopeKind: input.ref.scopeKind,
      scopeSlug: input.ref.scopeSlug,
      entryId: input.ref.entryId,
      versionNo: input.versionNo,
      status: input.status,
      isAutosave: input.isAutosave,
      snapshot: input.snapshot,
      label: input.label ?? null,
      locale: input.locale ?? null,
      sourceVersionNo: input.sourceVersionNo ?? null,
      createdBy: input.createdBy ?? null,
    });
  }

  /**
   * Highest durable (non-autosave) version_no for a document, or 0 if none.
   * The caller allocates the next number as `getMaxVersionNo(ref) + 1` inside
   * its write transaction; the partial unique index (PG) / serialized write
   * (MySQL/SQLite) is the race backstop.
   */
  async getMaxVersionNo(ref: VersionRef): Promise<number> {
    const rows = await this.db.select<VersionRow>(TABLE, {
      where: {
        and: [
          ...this.docWhere(ref),
          { column: "isAutosave", op: "=", value: false },
        ],
      },
    });
    let max = 0;
    for (const r of rows) {
      if (typeof r.versionNo === "number" && r.versionNo > max) {
        max = r.versionNo;
      }
    }
    return max;
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
    const rows = await this.db.select<VersionRow>(TABLE, {
      where: { and },
      orderBy: [{ column: "createdAt", direction: "desc" }],
      ...(typeof opts.limit === "number" ? { limit: opts.limit } : {}),
    });
    // Strip the snapshot so a list never carries snapshots.
    return rows.map(({ snapshot: _snapshot, ...meta }) => meta);
  }
}
