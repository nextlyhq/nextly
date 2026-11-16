/**
 * What a workflow step reads of a document's content, inside the step's transaction: the version
 * (`_rev`) each part holds now, compared with the one the caller was shown, and the newest
 * recorded version of each part, which is what a reviewer is shown and what an approval names.
 *
 * Both are read through the modules that own them (`documentVersionOn` for the version every
 * read and write publishes, `VersionsRepository` for the history), so a step compares exactly
 * what a reader was given.
 *
 * @module domains/workflows/part-versions
 */
import type {
  SupportedDialect,
  TransactionContext,
} from "@nextlyhq/adapter-drizzle/types";

import type { FieldConfig } from "../../collections/fields/types";
import { container } from "../../di/container";
import { NextlyError } from "../../errors";
import type { CollectionRegistryService } from "../collections/services/collection-registry-service";
import {
  liveFieldGroupReadPass,
  type LiveFieldGroupReadPass,
} from "../field-groups/live-read-access";
import type { FieldGroupDataService } from "../field-groups/services/field-group-data-service";
import { resolveLocalizedFieldNames } from "../i18n/classify-fields";
import { appLocalization } from "../i18n/configured-locales";
import { liveColumnNames } from "../schema/pipeline/diff/introspect-live";
import { documentVersionOn } from "../versions/document-revision";
import {
  VersionsRepository,
  type VersionRow,
} from "../versions/versions-repository";

import type { ReviewDocument } from "./review-state-repository";
import { withSharedValuesOf } from "./shared-values";

/**
 * Where a collection's documents live: its table, whether it keeps translations, and for one that
 * does, the fields each language keeps on its own (null for one that does not).
 */
export interface DocumentTable {
  table: string;
  localized: boolean;
  translated: readonly string[] | null;
  /** The collection's fields, as the registry keeps them: what a read of it is judged over. */
  fields: readonly FieldConfig[];
}

/**
 * The table a document lives in, from the collection registry. Read before a step's transaction
 * opens: the registry reads on the pool. A Single is refused: its steps are not offered yet.
 */
export async function documentTableOf(
  document: ReviewDocument
): Promise<DocumentTable> {
  if (document.scopeKind !== "collection") {
    throw NextlyError.validation({
      errors: [
        {
          path: "document",
          code: "WORKFLOW_SINGLES_NOT_SUPPORTED",
          message: "Workflow steps on a Single are not available yet.",
        },
      ],
    });
  }
  const registry = container.get<CollectionRegistryService>(
    "collectionRegistryService"
  );
  const record = await registry.getCollectionBySlug(document.scopeSlug);
  if (!record) {
    throw NextlyError.notFound({
      logContext: {
        reason: "workflow-step-collection",
        slug: document.scopeSlug,
      },
    });
  }
  const localized = Boolean(record.localized);
  return {
    table: record.tableName,
    localized,
    // The registry's fields: what a read of the collection is judged over.
    fields: record.fields ?? [],
    // Named as the collection's own writes name them, so a step reads a language's shared
    // values exactly as a save in place wrote them. A presentational group has no name of its own,
    // so nothing is translated under it and it is left out of the names.
    translated: localized
      ? resolveLocalizedFieldNames(
          (record.fields ?? []).filter(
            (field): field is FieldConfig & { name: string } =>
              typeof field.name === "string"
          ),
          true
        )
      : null,
  };
}

/**
 * The field-group read pass a read of the document's collection makes, the one a reviewer's view
 * of a version is judged with beside the collection's own pass. Built before a step's transaction
 * opens, since the field-group schemas are read on the pool. Undefined where no field group
 * declares a read rule.
 */
export function fieldGroupReadPassOf(
  table: DocumentTable
): Promise<LiveFieldGroupReadPass | undefined> {
  const source = container.has("fieldGroupDataService")
    ? container.get<FieldGroupDataService>("fieldGroupDataService")
    : undefined;
  return liveFieldGroupReadPass(table.fields, source);
}

/**
 * The version a reader of one part holds now, read on `tx`: the version a read in the part's
 * language publishes, or for the shared part a plain read's (the default language). Undefined
 * when the document is gone.
 */
export async function partVersionOn(
  tx: TransactionContext,
  dialect: SupportedDialect,
  document: DocumentTable,
  entryId: string,
  part: string | null
): Promise<string | undefined> {
  const localization = appLocalization();
  let languagesTable: string | null = null;
  if (document.localized && localization) {
    // A translated collection's translation table, when it is there to read: one with no
    // translated field has none, and keeps its values on its own row.
    const candidate = `${document.table}_locales`;
    const live = await liveColumnNames(tx.getDrizzle(), dialect, [candidate]);
    languagesTable = live.has(candidate.toLowerCase()) ? candidate : null;
  }
  return documentVersionOn(tx, {
    dialect,
    table: document.table,
    id: entryId,
    languagesTable,
    localization,
    locale: part ?? undefined,
  });
}

/**
 * The newest recorded version of one part, snapshot included, read on `tx`: in the part's
 * language, or for the shared part, in any (each language's snapshot carries the shared fields).
 * Undefined for a part never saved.
 */
export async function shownVersionOn(
  tx: TransactionContext,
  document: ReviewDocument,
  part: string | null
): Promise<VersionRow | undefined> {
  const repo = new VersionsRepository(tx);
  const ref = {
    scopeKind: document.scopeKind,
    scopeSlug: document.scopeSlug,
    entryId: document.entryId,
  };
  if (part === null) return repo.findNewest(ref);
  const newest = (await repo.newestVersionNoByLocale(ref, [part])).get(part);
  return newest === undefined ? undefined : repo.findByVersionNo(ref, newest);
}

/**
 * What one part shows now, read on `tx`: its newest recorded version, and for a language of a
 * translated document, that version with the shared values of the document's newest version laid
 * over it when a later save in another language wrote them. The version number stays the part's
 * own: an approval names the version its language was saved as.
 */
export async function shownContentOn(
  tx: TransactionContext,
  document: ReviewDocument,
  table: DocumentTable,
  part: string | null
): Promise<VersionRow | undefined> {
  const shown = await shownVersionOn(tx, document, part);
  if (!shown || part === null || table.translated === null) return shown;
  const newest = await new VersionsRepository(tx).findNewest(document);
  if (!laterThan(newest, shown)) return shown;
  return {
    ...shown,
    snapshot: withSharedValuesOf(
      document,
      shown.snapshot,
      newest.snapshot,
      table.translated
    ),
  };
}

/** Whether `newest` was recorded after `shown`, so its shared values are the later ones. */
function laterThan(
  newest: VersionRow | undefined,
  shown: VersionRow
): newest is VersionRow {
  return (
    newest?.versionNo != null &&
    shown.versionNo != null &&
    newest.versionNo > shown.versionNo
  );
}
