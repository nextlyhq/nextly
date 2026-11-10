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

import { container } from "../../di/container";
import { NextlyError } from "../../errors";
import type { CollectionRegistryService } from "../collections/services/collection-registry-service";
import { appLocalization } from "../i18n/configured-locales";
import { liveColumnNames } from "../schema/pipeline/diff/introspect-live";
import { documentVersionOn } from "../versions/document-revision";
import {
  VersionsRepository,
  type VersionRow,
} from "../versions/versions-repository";

import type { ReviewDocument } from "./review-state-repository";

/** Where a collection's documents live: its table, and whether it keeps translations. */
export interface DocumentTable {
  table: string;
  localized: boolean;
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
  return { table: record.tableName, localized: Boolean(record.localized) };
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
