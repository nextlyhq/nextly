/**
 * An author's unsaved work recorded in one language, forgotten when that
 * language's pending change is discarded.
 *
 * The editor offers to restore unsaved changes from the author's recovery
 * point, one per document and author, which carries the language it was
 * recorded in. Discarding a language's pending change throws that language's
 * work away, so its recovery point goes with it; one recorded in another
 * language is the author's work there and stays.
 *
 * @module domains/i18n/forget-recovery-point
 */

import { VERSIONS_TABLE } from "../../schemas/versions/types";
import type {
  VersionsDbApi,
  VersionsWhere,
  VersionsWhereCondition,
} from "../versions/db-api";
import type { VersionRef } from "../versions/versions-repository";

/**
 * Which recorded languages are the discarded slot's: the slot's own code, and
 * for the default language also no language, which is how the editor records
 * work on its canonical address. An unlocalized document has one slot, so any
 * point of the author's on it is that slot's.
 */
function recordedInSlot(args: {
  slot: string | null;
  documentLocalized: boolean;
  defaultLocale: string | null;
}): (VersionsWhere | VersionsWhereCondition)[] {
  if (!args.documentLocalized) return [];
  const noLanguage: VersionsWhereCondition = {
    column: "locale",
    op: "IS NULL",
  };
  if (args.slot === null) return [noLanguage];
  const named: VersionsWhereCondition = {
    column: "locale",
    op: "=",
    value: args.slot,
  };
  return args.slot === args.defaultLocale
    ? [{ or: [named, noLanguage] }]
    : [named];
}

export async function forgetRecoveryPointIn(
  tx: VersionsDbApi,
  args: {
    ref: VersionRef;
    /** Who discarded; no author, no recovery point of theirs to forget. */
    author: string | undefined;
    /** The slot the discarded pending change was kept under. */
    slot: string | null;
    documentLocalized: boolean;
    defaultLocale: string | null;
  }
): Promise<void> {
  if (args.author === undefined) return;
  // One statement that names the language, never a read and then a delete:
  // the point is one row per document and author, rewritten by each
  // autosave in whichever language that tab is in, so a point read in the
  // discarded language may have been rewritten in another one by the time
  // a separate delete ran, and that work would go with it.
  await tx.delete(VERSIONS_TABLE, {
    and: [
      { column: "scopeKind", op: "=", value: args.ref.scopeKind },
      { column: "scopeSlug", op: "=", value: args.ref.scopeSlug },
      { column: "entryId", op: "=", value: args.ref.entryId },
      { column: "isAutosave", op: "=", value: true },
      { column: "createdBy", op: "=", value: args.author },
      ...recordedInSlot(args),
    ],
  });
}
