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

import type { VersionsDbApi } from "./db-api";
import {
  VersionsRepository,
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
}

export class VersionsService {
  private readonly repo: VersionsRepository;

  constructor(db: VersionsDbApi) {
    this.repo = new VersionsRepository(db);
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
}
