/**
 * Public surface for content version history.
 *
 * Wraps the repository so callers (HTTP routes, the admin, and plugins via
 * `ctx.services.versions`) never touch `nextly_versions` directly. Listing is
 * metadata-only by construction: snapshots are large and a history list never
 * needs them.
 *
 * Reads, plus the one thing about a stored version that is editable: its label.
 * A snapshot itself is never rewritten — history is append-only, which is what
 * makes a restore recoverable.
 *
 * @experimental The shape may change while versioning is in alpha.
 *
 * @module domains/versions/versions-service
 */

import { NextlyError } from "../../errors";
import type { VersionStatus } from "../../schemas/versions/types";

import type { VersionsDbApi } from "./db-api";
import {
  VersionsRepository,
  type AutosaveWriteResult,
  type PendingEditCursor,
  type PendingEditOrder,
  type VersionMeta,
  type VersionRef,
  type VersionRow,
} from "./versions-repository";

/** Options for a history listing. */
export interface VersionListOptions {
  /** Page size. */
  limit?: number;
  /** Return versions strictly older than this versionNo (keyset pagination). */
  cursor?: number;
  /** Include rolling autosave rows. Defaults to false (durable versions only). */
  includeAutosave?: boolean;
  /** Scope the listing to one locale's versions. Absent lists every locale. */
  locale?: string;
}

export class VersionsService {
  private readonly repo: VersionsRepository;

  constructor(db: VersionsDbApi) {
    this.repo = new VersionsRepository(db);
  }

  /**
   * One page of pending-edit ROWS, newest first.
   *
   * 🔴 Rows rather than documents, and the caller collapses them itself — after
   * it has decided which it may show. A working draft is one row per document
   * per locale, and a localized Single is authorized per language, so collapsing
   * before that decision offers the newest locale alone and loses a readable
   * older one. This service used to take the install's locale count to size a
   * single read; that number does not bound the data, because drafts written
   * under a locale since removed from the configuration are still rows.
   */
  async pendingEditRows(input: {
    readableSlugs: readonly string[];
    limit: number;
    order: PendingEditOrder;
    after?: PendingEditCursor;
  }): Promise<VersionMeta[]> {
    return this.repo.findPendingEditRows({
      slugs: input.readableSlugs,
      limit: input.limit,
      order: input.order,
      ...(input.after ? { after: input.after } : {}),
    });
  }

  /** Version metadata for one document, newest-first. Never loads snapshots. */
  async list(
    ref: VersionRef,
    opts: VersionListOptions = {}
  ): Promise<VersionMeta[]> {
    return this.repo.listByDoc(ref, opts);
  }

  /**
   * Name a version, or clear its name with `null`.
   *
   * The only mutation on a stored version. `get` runs first so an unknown
   * version answers not-found rather than silently updating nothing — the
   * repository's `UPDATE ... WHERE` matches no rows in that case and would
   * otherwise report success.
   */
  async setLabel(
    ref: VersionRef,
    versionNo: number,
    label: string | null
  ): Promise<VersionRow> {
    await this.get(ref, versionNo);
    await this.repo.updateLabel(ref, versionNo, label);
    return this.get(ref, versionNo);
  }

  /** One full version, including its snapshot. */
  async get(ref: VersionRef, versionNo: number): Promise<VersionRow> {
    const row = await this.repo.findByVersionNo(ref, versionNo);
    if (!row) {
      // The public message stays generic; the document and version land in the
      // log context so an operator can trace the miss without the response
      // disclosing which documents exist.
      throw NextlyError.notFound({
        logContext: {
          reason: "version-not-found",
          scopeKind: ref.scopeKind,
          scopeSlug: ref.scopeSlug,
          entryId: ref.entryId,
          versionNo,
        },
      });
    }
    return row;
  }

  /**
   * Discard a document's pending working draft in one locale, returning the
   * number of rows removed (0 when none exists).
   *
   * The working draft is the status-less sidecar the draft/published split
   * writes for edits to a published document. Removing it reverts the editor to
   * the live published row; history is untouched, which is why this discards
   * unpublished edits rather than rewriting a version.
   */
  async deleteWorkingDraft(
    ref: VersionRef,
    locale: string | null
  ): Promise<number> {
    return this.repo.deleteWorkingDraft(ref, locale);
  }

  /**
   * Record one author's rolling recovery point for a document.
   *
   * Outside any transaction, unlike durable capture. A durable version is part
   * of the write that produced it and must land or roll back with it; a
   * recovery point describes work that has not been written at all, so there is
   * no surrounding write for it to join. That also keeps a slow snapshot from
   * holding a transaction open while somebody types.
   *
   * Rewrites the one row this author holds for this document rather than adding
   * to history, so an editing session costs a single row and durable history is
   * untouched.
   */
  async autosave(input: {
    ref: VersionRef;
    status: VersionStatus;
    snapshot: unknown;
    locale?: string | null;
    createdBy?: string | null;
  }): Promise<AutosaveWriteResult> {
    return this.repo.upsertAutosave(input);
  }

  /**
   * One author's current recovery point, or undefined when they have none.
   *
   * Scoped to the caller rather than the document: an autosave is unpublished,
   * unvalidated work in progress, so one author's must never be offered to
   * another. This is the only way a stored autosave can be read back --
   * history listings and version reads both exclude them by construction,
   * since a recovery point carries no version number to be addressed by.
   */
  async getAutosave(
    ref: VersionRef,
    createdBy: string | null
  ): Promise<VersionRow | undefined> {
    return this.repo.findAutosave(ref, createdBy);
  }
}
