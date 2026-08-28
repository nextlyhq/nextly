/**
 * Repository for `nextly_versions`, the global content-version store.
 *
 * Built on the adapter DB API (VersionsDbApi) so the same class can be
 * constructed with either the adapter or a transaction context. All reads go
 * through the Drizzle-backed adapter select (the transaction context binds its
 * executor to the same path), so `createdAt`/`snapshot` are decoded (JSON
 * parsed, timestamps become `Date`) whichever handle is used. Column names are
 * the Drizzle property names (camelCase); the adapter maps them to snake_case.
 *
 * @module domains/versions/versions-repository
 */

import { toDbError } from "../../database/errors";
import { NextlyError } from "../../errors";
import type {
  VersionScopeKind,
  VersionStatus,
} from "../../schemas/versions/types";
import { VERSIONS_TABLE } from "../../schemas/versions/types";

import type {
  VersionsDbApi,
  VersionsWhere,
  VersionsWhereCondition,
} from "./db-api";
import type { PrunableVersion } from "./retention";
import { workingDraftKey } from "./working-draft-key";

const TABLE = VERSIONS_TABLE;

// Ids deleted per statement. Each id binds one parameter and SQLite's default
// SQLITE_MAX_VARIABLE_NUMBER is 999 (the lowest across supported dialects), so
// this stays well under it rather than tracking per-dialect capabilities.
const DELETE_CHUNK_SIZE = 500;

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

/**
 * What an autosave write reports back.
 *
 * Taken from the values the write itself used rather than re-read afterwards:
 * autosave runs while somebody is typing, so a confirmation SELECT on every
 * keystroke-batch would be real cost for data the write already holds.
 */
export interface AutosaveWriteResult {
  updatedAt: Date;
  locale: string | null;
}

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
    // Enforce the row-shape invariant the input type cannot express: a durable
    // version carries a sequence number, an autosave never does. Either
    // violation would confuse the durable-sequence unique index (which treats a
    // non-null version_no as durable) and the reads that exclude autosaves.
    if (!input.isAutosave && input.versionNo == null) {
      throw NextlyError.internal({
        logContext: { reason: "durable-version-missing-version-no" },
      });
    }
    if (input.isAutosave && input.versionNo != null) {
      throw NextlyError.internal({
        logContext: { reason: "autosave-version-has-version-no" },
      });
    }
    // `snapshot` is `unknown`; serialize defensively (see serializeSnapshot).
    const serializedSnapshot = this.serializeSnapshot(input.snapshot);
    await this.db.insert(
      TABLE,
      {
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
      },
      // The insert result is discarded, so request NO columns back (empty
      // returning). This skips RETURNING on the transaction path and the
      // select-back reread on MySQL, so a large snapshot is never transferred
      // or re-read on a capture.
      { returning: [] }
    );
  }

  /**
   * Serialize a snapshot for the NOT NULL `snapshot` column.
   *
   * `snapshot` is `unknown`; serialize defensively. `JSON.stringify` returns
   * `undefined` for a top-level function/symbol/undefined and THROWS for a
   * circular reference or a BigInt. Either way the column must not receive a
   * bad value, so both cases surface as a NextlyError rather than a driver
   * error or a NULL write.
   */
  private serializeSnapshot(snapshot: unknown): string {
    try {
      const serialized = JSON.stringify(snapshot);
      if (typeof serialized !== "string") {
        throw new TypeError("snapshot did not serialize to a JSON string");
      }
      return serialized;
    } catch (cause) {
      throw NextlyError.internal({
        cause: cause instanceof Error ? cause : undefined,
        logContext: { reason: "version-snapshot-not-serializable" },
      });
    }
  }

  /**
   * A locale match for the working-draft lookup. Unlocalized documents keep a
   * single working draft under `locale IS NULL`; a localized document keeps one
   * per language, so the lookup must match the exact write locale. An `= value`
   * comparison never matches NULL, which is the intended distinction between
   * the two cases.
   */
  private localeCondition(locale: string | null): VersionsWhereCondition {
    return locale == null
      ? { column: "locale", op: "IS NULL" }
      : { column: "locale", op: "=", value: locale };
  }

  /**
   * The predicate identifying THE working draft of a document in one locale:
   * the sidecar draft row holding pending edits to a published document that
   * has not been promoted to the live row. A working draft is the only
   * non-autosave row carrying no version number (durable history rows always
   * take a sequence number; autosave rows set `isAutosave = true`), so this
   * shape is unambiguous and matches the partial unique index that keeps it to
   * one per document per locale.
   */
  private workingDraftWhere(
    ref: VersionRef,
    locale: string | null
  ): VersionsWhere {
    return {
      and: [
        ...this.docWhere(ref),
        { column: "isAutosave", op: "=", value: false },
        { column: "versionNo", op: "IS NULL" },
        { column: "status", op: "=", value: "draft" },
        this.localeCondition(locale),
      ],
    };
  }

  /**
   * Insert or update the coalesced working draft for a document in one locale.
   *
   * There is exactly one working draft per (document, locale): editing a
   * published document repeatedly rewrites this row in place rather than piling
   * up draft rows, so `updatedAt` advances and the snapshot always holds the
   * latest pending edit. The live content row is never touched here — this is
   * the sidecar that lets a published document be edited without changing what
   * the public sees until publish promotes it.
   */
  async upsertWorkingDraft(input: {
    ref: VersionRef;
    locale: string | null;
    snapshot: unknown;
    createdBy?: string | null;
  }): Promise<void> {
    const now = new Date();
    const serializedSnapshot = this.serializeSnapshot(input.snapshot);
    const where = this.workingDraftWhere(input.ref, input.locale);
    // Project only the id: the existence check must not transfer the (possibly
    // large) snapshot of the row it is about to overwrite.
    const existing = await this.db.select<{ id: string }>(TABLE, {
      columns: ["id"],
      where,
      limit: 1,
    });
    if (existing[0]) {
      await this.db.update(
        TABLE,
        {
          snapshot: serializedSnapshot,
          createdBy: input.createdBy ?? null,
          updatedAt: now,
        },
        where
      );
      return;
    }
    const row = {
      id: crypto.randomUUID(),
      scopeKind: input.ref.scopeKind,
      scopeSlug: input.ref.scopeSlug,
      entryId: input.ref.entryId,
      // A working draft is neither a durable history version (no sequence
      // number) nor an autosave row; it is the sidecar draft head.
      versionNo: null,
      status: "draft",
      isAutosave: false,
      // Pre-stringified for the same cross-dialect reason as insertVersion:
      // the transaction insert path binds this value straight into the driver
      // query with no column-type awareness.
      snapshot: serializedSnapshot,
      label: null,
      locale: input.locale ?? null,
      // Carried only by this row class, and unique across it, so the database
      // holds the one-per-document-per-locale rule the read above cannot.
      draftKey: workingDraftKey(input.ref, input.locale ?? null),
      sourceVersionNo: null,
      createdBy: input.createdBy ?? null,
      createdAt: now,
      updatedAt: now,
    };
    // A concurrent writer that committed its own draft between the read above
    // and this insert makes the unique index refuse this row. That refusal is
    // the point: without it both rows land and a later read, which takes the
    // first of an unordered match, picks between them arbitrarily. The
    // violation is left to travel — the write path above this owns turning it
    // into an answer the caller can act on, and a repository has no way to know
    // whether it is inside a caller's transaction, where PostgreSQL has already
    // marked everything after the error unusable.
    await this.db.insert(TABLE, row, { returning: [] });
  }

  /** Fetch the working draft (snapshot included) for a document in one locale. */
  async findWorkingDraft(
    ref: VersionRef,
    locale: string | null
  ): Promise<VersionRow | undefined> {
    const rows = await this.db.select<VersionRow>(TABLE, {
      where: this.workingDraftWhere(ref, locale),
      limit: 1,
    });
    return rows[0];
  }

  /**
   * Which languages hold a pending change, for many documents at once.
   *
   * One query for a whole page of documents rather than one per document: the
   * overview that consumes this is built for a list, and a per-row query there
   * turns a page render into N round trips.
   *
   * Returns only the (document, locale) pairs that HAVE one, so a caller reads
   * absence as absence rather than having to distinguish it from a document it
   * never asked about.
   */
  async findPendingChangeLocales(
    scopeKind: VersionScopeKind,
    scopeSlug: string,
    entryIds: string[]
  ): Promise<Map<string, Set<string | null>>> {
    const byEntry = new Map<string, Set<string | null>>();
    if (entryIds.length === 0) return byEntry;
    const rows = await this.db.select<{
      entryId: string;
      locale: string | null;
    }>(TABLE, {
      columns: ["entryId", "locale"],
      where: {
        and: [
          { column: "scopeKind", op: "=", value: scopeKind },
          { column: "scopeSlug", op: "=", value: scopeSlug },
          { column: "entryId", op: "IN", value: entryIds },
          { column: "isAutosave", op: "=", value: false },
          { column: "versionNo", op: "IS NULL" },
          { column: "status", op: "=", value: "draft" },
        ],
      },
    });
    for (const row of rows) {
      const set = byEntry.get(row.entryId) ?? new Set<string | null>();
      set.add(row.locale ?? null);
      byEntry.set(row.entryId, set);
    }
    return byEntry;
  }

  /**
   * Every working draft this document holds, one per locale.
   *
   * For the operations that act on the whole document at once — publishing all
   * of its languages — rather than on the language in front of the author.
   */
  async findAllWorkingDrafts(ref: VersionRef): Promise<VersionRow[]> {
    return this.db.select<VersionRow>(TABLE, {
      where: {
        and: [
          ...this.docWhere(ref),
          { column: "isAutosave", op: "=", value: false },
          { column: "versionNo", op: "IS NULL" },
          { column: "status", op: "=", value: "draft" },
        ],
      },
    });
  }

  /**
   * Delete EVERY working draft this document has, in every locale, returning
   * the number of rows removed. Called when the document itself goes away.
   *
   * Separate from {@link deleteWorkingDraft} because they answer different
   * questions, and reaching for the wrong one is harmful in both directions:
   * removing one locale's draft on a document delete strands the rest, pointing
   * at a row that no longer exists, while removing all of them on a discard
   * throws away pending work in languages the author never touched.
   */
  async deleteAllWorkingDrafts(ref: VersionRef): Promise<number> {
    return this.db.delete(TABLE, {
      and: [
        ...this.docWhere(ref),
        { column: "isAutosave", op: "=", value: false },
        { column: "versionNo", op: "IS NULL" },
        { column: "status", op: "=", value: "draft" },
      ],
    });
  }

  /**
   * Delete the working draft for a document in one locale, returning the number
   * of rows removed. Called when the draft is promoted (published) or discarded.
   */
  async deleteWorkingDraft(
    ref: VersionRef,
    locale: string | null
  ): Promise<number> {
    return this.db.delete(TABLE, this.workingDraftWhere(ref, locale));
  }

  /**
   * Remove recovery points for a document, returning how many were deleted.
   *
   * Every author's by default; one author's when `createdBy` is given.
   *
   * Autosave rows are excluded from history listings, from version reads and
   * from retention pruning, so nothing else in the system will ever remove
   * one. Without this a deleted document leaves a snapshot per author behind
   * permanently: unreachable, since the live-document gate refuses a document
   * that no longer exists, and never pruned. That is unpublished content
   * outliving the document it belonged to, which is a retention problem rather
   * than only a storage one.
   *
   * Locale is deliberately NOT a parameter. A recovery point is keyed by
   * document and author alone, so there is no per-locale row to address --
   * unlike the working draft, which keeps one per language.
   */
  async deleteAutosaves(
    ref: VersionRef,
    createdBy?: string | null
  ): Promise<number> {
    const and: (VersionsWhereCondition | VersionsWhere)[] = [
      ...this.docWhere(ref),
      { column: "isAutosave", op: "=" as const, value: true },
    ];
    // Only narrows when an author is named. `undefined` means every author,
    // which is what a deleted document needs; `null` is a real author value
    // (the unauthenticated bucket) and must still narrow, so the check is on
    // `undefined` specifically rather than on falsiness.
    if (createdBy !== undefined) {
      and.push(
        createdBy === null
          ? { column: "createdBy", op: "IS NULL" as const }
          : { column: "createdBy", op: "=" as const, value: createdBy }
      );
    }
    return this.db.delete(TABLE, { and });
  }

  /**
   * Highest durable (non-autosave) version_no for a document, or 0 if none.
   * The caller allocates the next number as `getMaxVersionNo(ref) + 1`. When
   * invoked with the transaction context this read runs inside the caller's
   * transaction (the tx context binds its executor), so it sees the doc's own
   * uncommitted rows. Duplicate version_no is still only DB-guarded by the
   * partial unique index on Postgres; a MySQL/SQLite serialization or unique
   * guard is needed before capture is wired into concurrent writes.
   */
  async getMaxVersionNo(ref: VersionRef): Promise<number> {
    // Project only version_no and take a single row (order desc, limit 1), so
    // this never materializes a full version row (which carries the snapshot).
    const rows = await this.db.select<VersionRow>(TABLE, {
      columns: ["versionNo"],
      where: {
        and: [
          ...this.docWhere(ref),
          { column: "isAutosave", op: "=", value: false },
          // Exclude the working draft (a non-autosave row with no version
          // number). Without this it sorts first under `versionNo DESC` (NULLS
          // FIRST on Postgres) and this returns 0 even when durable versions
          // exist, so the next capture allocates a colliding version number.
          { column: "versionNo", op: "IS NOT NULL" },
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
    opts: {
      limit?: number;
      includeAutosave?: boolean;
      cursor?: number;
      locale?: string;
    } = {}
  ): Promise<VersionMeta[]> {
    const and: (VersionsWhereCondition | VersionsWhere)[] = [
      ...this.docWhere(ref),
    ];
    if (opts.includeAutosave) {
      // Include autosave rows, but still exclude the working draft (a
      // non-autosave row with no version number): it is the live pending edit
      // surfaced via findWorkingDraft, not a history entry.
      and.push({
        or: [
          { column: "versionNo", op: "IS NOT NULL" },
          { column: "isAutosave", op: "=", value: true },
        ],
      });
    } else {
      // Durable history only: no autosave rows, and not the working draft.
      and.push({ column: "isAutosave", op: "=", value: false });
      and.push({ column: "versionNo", op: "IS NOT NULL" });
    }
    // Scope to one locale's history when asked. A localized document captures a
    // version per locale, so the list can be narrowed to the language an editor
    // is working in; absent, every locale's versions are returned.
    //
    // Shared (null-locale) snapshots are included: a write touching only fields
    // shared across locales is recorded with `locale: null` yet still changes
    // this locale's document, so excluding it would omit real history and could
    // present an older locale-specific row as the latest state.
    if (opts.locale !== undefined) {
      and.push({
        or: [
          { column: "locale", op: "=", value: opts.locale },
          { column: "locale", op: "IS NULL" },
        ],
      });
    }
    // Keyset pagination: return versions strictly older than the cursor, which
    // is the last versionNo the caller already has. Stable under concurrent
    // inserts in a way offset pagination is not.
    //
    // Autosave rows carry a NULL versionNo, so they can never satisfy a
    // `versionNo < cursor` comparison and would silently vanish from a paged
    // listing that asked for them. Reject the combination instead of returning
    // a quietly incomplete page.
    if (typeof opts.cursor === "number") {
      if (opts.includeAutosave) {
        throw NextlyError.validation({
          errors: [
            {
              path: "cursor",
              code: "INVALID_COMBINATION",
              message:
                "Autosave versions cannot be paged by cursor; they have no version number.",
            },
          ],
          logContext: { reason: "versions-cursor-with-autosave" },
        });
      }
      and.push({ column: "versionNo", op: "<", value: opts.cursor });
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

  /**
   * Durable rows for one document, newest-first, projecting only what the
   * retention rules need. Autosave rows are excluded because they never count
   * toward the cap.
   */
  async listDurableForPrune(ref: VersionRef): Promise<PrunableVersion[]> {
    return this.db.select<PrunableVersion>(TABLE, {
      columns: ["id", "versionNo", "status"],
      where: {
        and: [
          ...this.docWhere(ref),
          { column: "isAutosave", op: "=", value: false },
          // The working draft is not a durable version and must never enter the
          // retention candidate set (it would be counted toward the cap, or
          // pruned as if it were history).
          { column: "versionNo", op: "IS NOT NULL" },
        ],
      },
      orderBy: [
        { column: "versionNo", direction: "desc" },
        { column: "createdAt", direction: "desc" },
      ],
    });
  }

  /** Where the ONE rolling autosave row for a document and author lives. */
  private autosaveWhere(
    ref: VersionRef,
    createdBy: string | null
  ): VersionsWhere {
    return {
      and: [
        ...this.docWhere(ref),
        { column: "isAutosave", op: "=", value: true },
        createdBy === null
          ? { column: "createdBy", op: "IS NULL" }
          : { column: "createdBy", op: "=", value: createdBy },
      ],
    };
  }

  /**
   * Insert or update the rolling autosave snapshot for one document and author.
   *
   * There is exactly ONE such row per (document, author). Editing rewrites it in
   * place, so `updatedAt` advances and the snapshot always holds the newest
   * recovery point. Nothing accumulates: an editing session costs one row, not
   * one row per pause, so history never has to be pruned back.
   *
   * Keyed by AUTHOR as well as document because two people editing the same
   * document have two different recovery points. A single row per document would
   * let one author's snapshot overwrite the other's, and the loser would recover
   * somebody else's work.
   *
   * The live row and the working draft are both untouched. An autosave is a
   * recovery point, never a statement about what should be served or published,
   * so it can hold a half-finished edit safely.
   *
   * Enforced HERE rather than left to the unique index, because that index is
   * declared for Postgres only: it is keyed on `created_by`, which is populated,
   * so it has no nullable column to lean on the way the durable-sequence index
   * does, and neither MySQL nor SQLite can express a partial unique index. The
   * index is a backstop where it exists; this is the mechanism everywhere.
   */
  async upsertAutosave(input: {
    ref: VersionRef;
    status: VersionStatus;
    snapshot: unknown;
    locale?: string | null;
    createdBy?: string | null;
  }): Promise<AutosaveWriteResult> {
    const now = new Date();
    const serializedSnapshot = this.serializeSnapshot(input.snapshot);
    const createdBy = input.createdBy ?? null;
    const where = this.autosaveWhere(input.ref, createdBy);
    // Project only the id: the existence check must not transfer the (possibly
    // large) snapshot of the row it is about to overwrite.
    const existing = await this.db.select<{ id: string; revision: number }>(
      TABLE,
      {
        // `revision` rides along so the update can compare against the value
        // this read OBSERVED rather than against a clock.
        columns: ["id", "revision"],
        where,
        limit: 1,
      }
    );
    if (existing[0]) {
      // Compare-and-set on the timestamp, not a blind overwrite. Two tabs
      // belonging to the same author race here: A can read the row, pause, and
      // then write after B has already stored a NEWER snapshot. An
      // unconditional update would replace B's work with A's older values and
      // stamp them newer, so the next recovery would offer the stale one.
      //
      // A losing write matches no row and is simply dropped, which is correct:
      // the newer snapshot already describes the author's work, and this is a
      // recovery point rather than an acknowledgement anybody is waiting on.
      await this.db.update(
        TABLE,
        {
          snapshot: serializedSnapshot,
          status: input.status,
          locale: input.locale ?? null,
          updatedAt: now,
          // Advancing the token is what makes the next writer's predicate fail.
          // Computed from the OBSERVED value rather than read again, so the
          // value written is the successor of the one being compared against.
          revision: existing[0].revision + 1,
        },
        // Flattened into the same conjunction rather than nested, so the
        // predicate stays one readable list of conditions.
        {
          and: [
            ...(where.and ?? []),
            // EQUALITY against the value this read observed: apply only while
            // the row still holds it, which is what compare-and-set means. A
            // concurrent writer advances it, this matches nothing, and the
            // slower write is dropped rather than overwriting newer work.
            //
            // The token is `revision` rather than `updatedAt` because a
            // timestamp's stored resolution differs per dialect and can run
            // out: SQLite keeps whole epoch SECONDS, so two rewrites inside one
            // second are indistinguishable, and the second writer's read
            // observes exactly what the first wrote. Its predicate then matches
            // and it overwrites newer work believing the row untouched. A
            // counter advances on every write regardless of how close together
            // they fall.
            {
              column: "revision",
              op: "=" as const,
              value: existing[0].revision,
            },
          ],
        }
      );
      return { updatedAt: now, locale: input.locale ?? null };
    }
    try {
      await this.db.insert(
        TABLE,
        {
          id: crypto.randomUUID(),
          scopeKind: input.ref.scopeKind,
          scopeSlug: input.ref.scopeSlug,
          entryId: input.ref.entryId,
          // Null, never a number. The durable-sequence index treats a non-null
          // value as durable, so an autosave carrying one would both consume a
          // sequence slot and appear in history.
          versionNo: null,
          status: input.status,
          isAutosave: true,
          snapshot: serializedSnapshot,
          // Neither applies to a recovery point: a label names a version
          // somebody chose to keep, and a source records what a restore copied
          // from.
          label: null,
          locale: input.locale ?? null,
          sourceVersionNo: null,
          createdBy,
          createdAt: now,
          updatedAt: now,
          // Stated rather than left to the column default, so the first value
          // the compare-and-set will read is fixed by this insert.
          revision: 0,
        },
        { returning: [] }
      );
    } catch (error) {
      // The existence check and this insert are two statements, so one author
      // saving from two tabs can pass the check twice before either row lands.
      // Where the unique index exists the loser is rejected here.
      //
      // The loser then DROPS its write rather than rewriting the winner's row.
      // Losing this race is proof of ordering: this request read an empty
      // result, the winner inserted afterwards, so the stored row is strictly
      // newer than the snapshot in hand. Overwriting it would replace newer
      // work with older and stamp it newer still -- the same inversion the
      // existing-row branch guards against with its compare-and-set, arriving
      // by a different path.
      //
      // Only Postgres reaches this branch at all: MySQL and SQLite cannot
      // express a partial unique index, so there both inserts succeed and the
      // document briefly carries two of one author's recovery points. That is
      // bounded -- both rows are the same author's own work, and `findAutosave`
      // reads the newest.
      // Rethrow when the handle cannot say which engine it is: constraint
      // codes differ per dialect, so classifying without one would be a guess,
      // and a wrong guess here would swallow a real failure as a retry.
      const dialect = this.db.dialect;
      if (!dialect) throw error;
      if (toDbError(dialect, error).kind !== "unique-violation") throw error;
    }
    return { updatedAt: now, locale: input.locale ?? null };
  }

  /**
   * Remove every recovery point belonging to an ENTITY, across all of its
   * documents and authors.
   *
   * For the entity itself going away, where `deleteAutosaves` cannot help
   * because there is no single document id to name.
   *
   * Scoped to autosave rows on purpose. Durable history and working drafts for
   * a deleted entity are a wider question with an archival dimension -- what a
   * deletion owes a document's recorded past -- and answering it here would
   * decide it by accident. A recovery point has no such dimension: it is one
   * author's unsaved work on a document that no longer exists, so nothing can
   * ever read it again.
   */
  async deleteAutosavesForEntity(
    scopeKind: VersionScopeKind,
    scopeSlug: string
  ): Promise<number> {
    return this.db.delete(TABLE, {
      and: [
        { column: "scopeKind", op: "=" as const, value: scopeKind },
        { column: "scopeSlug", op: "=" as const, value: scopeSlug },
        { column: "isAutosave", op: "=" as const, value: true },
      ],
    });
  }

  /**
   * Remove every recovery point belonging to one AUTHOR, across every document.
   *
   * For the account going away. Deliberately a delete rather than the scrub
   * the audit surfaces perform: an audit row is a record, and stripping the
   * person from it keeps a trail worth keeping, whereas a recovery point is
   * that person's unsaved draft. Scrubbing its author would leave the snapshot
   * in the table with nobody able to claim it, which is worse than either
   * keeping or removing it cleanly.
   */
  async deleteAutosavesByAuthor(createdBy: string): Promise<number> {
    return this.db.delete(TABLE, {
      and: [
        { column: "isAutosave", op: "=" as const, value: true },
        { column: "createdBy", op: "=" as const, value: createdBy },
      ],
    });
  }

  /**
   * One author's current recovery point for a document, or null when they have
   * none.
   *
   * Newest first rather than arbitrary: on MySQL and SQLite the insert race
   * above can leave two rows for one author, and the later snapshot is the one
   * that describes their work. Ordering makes that harmless instead of a
   * coin toss.
   */
  async findAutosave(
    ref: VersionRef,
    createdBy: string | null
  ): Promise<VersionRow | undefined> {
    const rows = await this.db.select<VersionRow>(TABLE, {
      where: this.autosaveWhere(ref, createdBy),
      // `id` breaks the tie, and it is not decoration. SQLite stores
      // `updatedAt` as integer epoch SECONDS, so two rows written in the same
      // second compare equal and `LIMIT 1` would return either -- which on the
      // dialects with no autosave uniqueness constraint is exactly when two
      // rows can exist. A deterministic order makes the read repeatable even
      // where the write race is not yet closed.
      orderBy: [
        { column: "updatedAt", direction: "desc" },
        { column: "id", direction: "desc" },
      ],
      limit: 1,
    });
    return rows[0];
  }

  /**
   * Delete the given version rows. No-op for an empty list.
   *
   * Deletes in chunks because each id binds one query parameter and SQLite caps
   * a statement at 999 (the lowest limit across supported dialects). A document
   * can legitimately present far more stale rows than that on the first save
   * after the retention cap starts being enforced, and an over-large statement
   * would fail the whole write transaction rather than trimming.
   */
  /**
   * Set or clear a durable version's label.
   *
   * Scoped by the document as well as the version number, so a caller
   * authorized for one document cannot rename a version of another by number
   * alone. Autosave rows are excluded on the same terms as every other durable
   * read: they are not addressable in history, so they are not nameable either.
   */
  async updateLabel(
    ref: VersionRef,
    versionNo: number,
    label: string | null
  ): Promise<void> {
    await this.db.update(
      TABLE,
      { label },
      {
        and: [
          ...this.docWhere(ref),
          { column: "isAutosave", op: "=", value: false },
          { column: "versionNo", op: "=", value: versionNo },
        ],
      }
    );
  }

  async deleteByIds(ids: string[]): Promise<number> {
    if (ids.length === 0) return 0;
    let deleted = 0;
    for (let i = 0; i < ids.length; i += DELETE_CHUNK_SIZE) {
      const chunk = ids.slice(i, i + DELETE_CHUNK_SIZE);
      deleted += await this.db.delete(TABLE, {
        and: [{ column: "id", op: "IN", value: chunk }],
      });
    }
    return deleted;
  }
}
