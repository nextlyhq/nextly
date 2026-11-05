/**
 * What changed in a document since a recovery point began.
 *
 * The editor stores the version its copy started from (`_rev`) in the point's
 * snapshot. Reading the point back compares it with the document as it now
 * is, in the parts the point covers (the document's own row and the point's
 * language), and describes a change exactly as a refused save describes one
 * (`changesSinceVersion`): the current version always, who and when only to
 * a caller who may read the document. A point stored without a version, saved
 * before versions existed, has an unknown starting version.
 *
 * @module domains/versions/recovery-point-changes
 * @experimental
 */
import { getService } from "../../di";
import type { StaleVersionPublicData } from "../../errors/public-data";
import type { CompanionIntrospectAdapter } from "../i18n/runtime/companion-io";
import { isCompanionReady } from "../i18n/runtime/companion-readiness";

import { DOCUMENT_VERSION_KEY } from "./document-revision";
import {
  changesSinceVersion,
  languagesJudged,
  poolRevisionReader,
  storedVersionOf,
  type ChangeSinceArgs,
  type RevisionReader,
} from "./stale-version";

/** What a recovery point's read adds about the version its edits began from. */
export type RecoveryPointChanges =
  | { changedSince: StaleVersionPublicData }
  | { startingVersionUnknown: true };

/**
 * The document's own table and whether it keeps translations, from the
 * registry; null when the collection or Single is gone.
 */
async function documentShape(
  scopeKind: "collection" | "single",
  slug: string
): Promise<{ table: string; localized: boolean } | null> {
  const record: unknown =
    scopeKind === "single"
      ? await getService("singleRegistryService").getSingleBySlug(slug)
      : await getService("collectionRegistryService").getCollectionBySlug(slug);
  const shape = record as { tableName?: unknown; localized?: unknown } | null;
  if (!shape || typeof shape.tableName !== "string") return null;
  return { table: shape.tableName, localized: shape.localized === true };
}

/**
 * What changed since a recovery point began, for its read: the change, when
 * the parts the point covers moved since its starting version; "unknown"
 * when it stored none; undefined when nothing it covers moved, or the
 * document is gone.
 *
 * Its language is judged only when the stored version names it, as a save
 * from that version would be: a version read with no language says nothing
 * about one.
 */
export async function changesSinceRecoveryPoint(
  /** The pool: a revision reader that can also tell whether a table is there. */
  adapter: RevisionReader & CompanionIntrospectAdapter,
  args: {
    scopeKind: "collection" | "single";
    slug: string;
    entryId: string;
    snapshot: unknown;
    /** The point's language; null for a document that keeps none. */
    locale: string | null;
    reader: ChangeSinceArgs["reader"];
  }
): Promise<RecoveryPointChanges | undefined> {
  const raw =
    typeof args.snapshot === "object" && args.snapshot !== null
      ? (args.snapshot as Record<string, unknown>)[DOCUMENT_VERSION_KEY]
      : undefined;
  const given = storedVersionOf(raw);
  if (!given) return { startingVersionUnknown: true };
  const shape = await documentShape(args.scopeKind, args.slug);
  if (!shape) return undefined;
  const languagesTable = `${shape.table}_locales`;
  const locale =
    shape.localized &&
    args.locale !== null &&
    Object.hasOwn(given.languages, args.locale) &&
    (await isCompanionReady(adapter, languagesTable))
      ? args.locale
      : null;
  const changes = await changesSinceVersion(poolRevisionReader(adapter), {
    dialect: adapter.dialect,
    scopeKind: args.scopeKind,
    slug: args.slug,
    id: args.entryId,
    given,
    at: {
      table: shape.table,
      languages: languagesJudged(
        locale === null ? null : languagesTable,
        locale === null ? undefined : [locale]
      ),
    },
    reader: args.reader,
  });
  return changes === null || changes === "gone"
    ? undefined
    : { changedSince: changes };
}
