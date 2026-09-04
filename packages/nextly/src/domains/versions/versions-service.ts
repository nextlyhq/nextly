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
   * How many documents hold a pending edit, within collections the caller reads.
   *
   * 🔴 The allowlist is REQUIRED, not optional, and `undefined` means "every
   * collection" rather than "unfiltered by accident". This service has no
   * authorization of its own -- unlike `ReleasesService`, none of its methods
   * takes an actor -- so the bound has to arrive from the caller, and a
   * parameter that could be forgotten would produce an install-wide number for
   * a reader entitled to part of it. Naming it in the signature makes the
   * decision visible at every call site.
   */
  async countPendingEdits(
    readableSlugs: readonly string[] | undefined
  ): Promise<number> {
    return this.repo.countDocumentsWithPendingEdits(readableSlugs);
  }

  /** The documents most recently left with a pending edit, newest first. */
  async recentPendingEdits(input: {
    readableSlugs: readonly string[] | undefined;
    limit: number;
  }): Promise<VersionMeta[]> {
    return this.repo.findRecentPendingEdits({
      slugs: input.readableSlugs,
      limit: input.limit,
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
