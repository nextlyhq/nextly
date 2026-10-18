/**
 * Where "You last looked here" sits in each part of a document's history.
 *
 * @module domains/versions/history-dividers
 */

import { and, eq, isNull, lte, max, or } from "drizzle-orm";

import { versionsTables } from "../../schemas/versions";
import { BaseService } from "../../shared/base-service";

import type { VersionRef } from "./versions-repository";

/** Reads the dividers of a document's history. */
export class HistoryDividers extends BaseService {
  /**
   * Each part's divider: the newest version kept at or below the version the
   * person last looked at in that part, which is that version, or the nearest
   * older one when retention removed it. One grouped read for every part, so
   * a document with many languages costs one query, not one per language.
   */
  async nearestKeptByPart(
    ref: VersionRef,
    looked: ReadonlyMap<string | null, number>
  ): Promise<Map<string | null, number>> {
    const dividers = new Map<string | null, number>();
    if (looked.size === 0) return dividers;
    const versions = versionsTables(
      this.adapter.getCapabilities().dialect
    ).nextlyVersions;
    const perPart = [...looked].map(([part, versionNo]) =>
      and(
        part === null ? isNull(versions.locale) : eq(versions.locale, part),
        lte(versions.versionNo, versionNo)
      )
    );
    const rows = (await this.db
      .select({ locale: versions.locale, versionNo: max(versions.versionNo) })
      .from(versions)
      .where(
        and(
          eq(versions.scopeKind, ref.scopeKind),
          eq(versions.scopeSlug, ref.scopeSlug),
          eq(versions.entryId, ref.entryId),
          eq(versions.isAutosave, false),
          or(...perPart)
        )
      )
      .groupBy(versions.locale)) as {
      locale: string | null;
      versionNo: number | string | null;
    }[];
    for (const row of rows) {
      if (row.versionNo !== null) {
        dividers.set(row.locale ?? null, Number(row.versionNo));
      }
    }
    return dividers;
  }
}
