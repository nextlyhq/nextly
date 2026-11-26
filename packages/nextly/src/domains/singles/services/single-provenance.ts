/**
 * Recording where a Single's translated values came from, on the write's own transaction: the
 * values a translation row stores are keyed by column, and are recorded by field name.
 *
 * @experimental Until per-field provenance is complete.
 *
 * @module domains/singles/services/single-provenance
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type { TransactionContext } from "@nextlyhq/adapter-drizzle/types";

import type { RequestActor } from "../../../auth/request-actor";
import {
  transactionTableProbe,
  type DashboardLogger,
} from "../../dashboard/table-presence";
import {
  forgetRemovedRowsSuggestions,
  translationSuggestionsPresent,
} from "../../i18n/pipeline/suggestion-rows";
import type { ProvenanceClaims } from "../../i18n/provenance/provenance-claims";
import {
  copySourceRevisions,
  forgetRemovedRowsProvenance,
  recordWrittenValues,
  translationProvenancePresent,
} from "../../i18n/provenance/record-provenance";
import {
  sourceReaderOf,
  translationSourcesPresent,
  type SourcePruning,
  type TranslatedColumn,
  type WriteSources,
} from "../../i18n/provenance/source-text";
import {
  type CompanionSchema,
  pruneOverlaysOfRemovedRows,
  type SharedStructureWritten,
  withStructuresBefore,
} from "../../i18n/runtime/companion-io";
import { cachedCompanionReadiness } from "../../i18n/runtime/companion-readiness";
import {
  assembleStoredValue,
  type SharedStructureShape,
} from "../../i18n/shared-structure";
import type { SelectsRows } from "../../versions/document-revision";
import { VersionsRepository } from "../../versions/versions-repository";

/** What recording needs of the service writing. */
export interface SingleProvenanceDeps {
  adapter: DrizzleAdapter;
  logger?: DashboardLogger;
  /** The site's default language, or none for a site without languages. */
  defaultLocale: string | undefined;
}

/** One write of a Single's translated values. */
export interface SingleProvenanceWrite {
  slug: string;
  entryId: string;
  locale: string;
  /**
   * The values written, keyed by column: for a repeater or group with one structure in every
   * language, the language's overlay, read with its structure from `structures`.
   */
  values: Readonly<Record<string, unknown>>;
  /**
   * The structures the same write put on the main row, keyed by column, which a container's
   * overlay in `values` is the language's text of. Absent, a container's overlay is recorded as
   * it is, and no text inside it.
   */
  structures?: Readonly<Record<string, unknown>>;
  /**
   * The Single's translated fields: each one's column, whether its storage is JSON, and the
   * shape of a container with one structure in every language.
   */
  localizedFields: readonly TranslatedColumn[];
  /** The Single's translation table, which holds each language's counter. */
  languagesTable?: string;
  /**
   * That table as it is read, for the values the translations written are made from. A write in
   * the default language, which is made from no other, names none.
   */
  companionTable?: unknown;
  savedBy: RequestActor;
  claims?: ProvenanceClaims;
  partState?: "live" | "draft";
  /** The write puts the language's held draft live: the draft's record moves with it. */
  promotesDraft?: boolean;
}

/**
 * Whether provenance is recorded on `tx`: the table is there, asked on the transaction's own
 * connection (see `translationProvenancePresent`).
 */
export function singleProvenanceRecorded(
  deps: Pick<SingleProvenanceDeps, "adapter" | "logger">,
  tx: TransactionContext
): Promise<boolean> {
  return translationProvenancePresent(
    deps.adapter,
    deps.logger,
    transactionTableProbe(deps.adapter, tx)
  );
}

/**
 * The rows `written` removed from a Single's repeater or group structure take their translations
 * with them, in every language, on `tx`: each language's overlay pruned
 * (`pruneOverlaysOfRemovedRows`), and every language's suggestions for and record of those rows
 * forgotten. The one way every write of a Single's live structure drops a removed row's text: a
 * save, a field rewrite and a publish of every language alike.
 */
export async function dropRemovedRowsText(
  deps: Pick<SingleProvenanceDeps, "adapter" | "logger">,
  tx: TransactionContext,
  args: {
    slug: string;
    entryId: string;
    companion: Pick<CompanionSchema, "table" | "companionTableName">;
    written: SharedStructureWritten[];
    /** The main row before the write, which tells a component instance that changed type. */
    before?: Readonly<Record<string, unknown>>;
    /** The languages whose overlay the write put down itself. */
    writtenLocales?: readonly string[];
  }
): Promise<void> {
  await pruneOverlaysOfRemovedRows(tx, deps.adapter.dialect, {
    companionTable: args.companion.table,
    companionTableName: args.companion.companionTableName,
    parentId: args.entryId,
    written: withStructuresBefore(args.written, args.before),
    writtenLocales: args.writtenLocales,
  });
  await forgetRemovedSingleRows(deps, tx, args, args.written);
}

/**
 * Whether the source text translations are made from is kept on `tx`: the table is there, asked
 * as {@link singleProvenanceRecorded} asks for its own.
 */
function singleSourceTextKept(
  deps: Pick<SingleProvenanceDeps, "adapter" | "logger">,
  tx: TransactionContext
): Promise<boolean> {
  return translationSourcesPresent(
    deps.adapter,
    deps.logger,
    transactionTableProbe(deps.adapter, tx)
  );
}

/** Whether suggestions, which name the text too, are kept on `tx`, asked as its table is. */
function singleSuggestionsKept(
  deps: Pick<SingleProvenanceDeps, "adapter" | "logger">,
  tx: TransactionContext
): Promise<boolean> {
  return translationSuggestionsPresent(
    deps.adapter,
    deps.logger,
    transactionTableProbe(deps.adapter, tx)
  );
}

/** What source text nothing names any more is removed through on `tx`. */
export async function singleSourcePruning(
  deps: Pick<SingleProvenanceDeps, "adapter" | "logger">,
  tx: TransactionContext
): Promise<SourcePruning | undefined> {
  return (await singleSourceTextKept(deps, tx))
    ? { db: tx, suggestionsKept: await singleSuggestionsKept(deps, tx) }
    : undefined;
}

/**
 * Forgets, in every language, the suggestions for and the record of each row a Single's write
 * removed from the structures it put on the main row, on its transaction.
 */
async function forgetRemovedSingleRows(
  deps: Pick<SingleProvenanceDeps, "adapter" | "logger">,
  tx: TransactionContext,
  single: { slug: string; entryId: string },
  written: readonly SharedStructureWritten[]
): Promise<void> {
  if (written.length === 0) return;
  const document = {
    scopeKind: "single" as const,
    scopeSlug: single.slug,
    entryId: single.entryId,
  };
  if (await singleSuggestionsKept(deps, tx)) {
    await forgetRemovedRowsSuggestions(tx, document, written, () =>
      new VersionsRepository(tx).findAllWorkingDrafts(document)
    );
  }
  if (!(await singleProvenanceRecorded(deps, tx))) return;
  await forgetRemovedRowsProvenance(
    tx,
    document,
    written,
    await singleSourcePruning(deps, tx)
  );
}

/**
 * Where a Single's write reads the values its translations are made from, and keeps them, on its
 * transaction; none for a write in the default language.
 */
async function singleWriteSources(
  deps: SingleProvenanceDeps,
  tx: TransactionContext,
  write: SingleProvenanceWrite
): Promise<WriteSources | undefined> {
  if (
    write.locale === deps.defaultLocale ||
    write.companionTable === undefined ||
    write.languagesTable === undefined
  ) {
    return undefined;
  }
  return {
    db: tx,
    kept: await singleSourceTextKept(deps, tx),
    suggestionsKept: await singleSuggestionsKept(deps, tx),
    read: sourceReaderOf({
      db: tx.getDrizzle(),
      companion: {
        table: write.companionTable,
        localizedFields: write.localizedFields,
      },
      // Remembered, never resolved here: the write resolved it, and a probe of
      // a missing table aborts a PostgreSQL transaction.
      readiness: cachedCompanionReadiness(deps.adapter, write.languagesTable),
      entryId: write.entryId,
    }),
  };
}

/**
 * Records where the translated values one write of a Single put down came from (`recordWrittenValues`),
 * on its transaction. Nothing is recorded for a site without languages, or until the table is there.
 *
 * @experimental
 */
export async function recordSingleProvenance(
  deps: SingleProvenanceDeps,
  tx: TransactionContext,
  write: SingleProvenanceWrite
): Promise<void> {
  if (deps.defaultLocale === undefined) return;
  if (!(await singleProvenanceRecorded(deps, tx))) return;
  const fieldOf = new Map(
    write.localizedFields.map(field => [field.column, field])
  );
  const values: Record<string, unknown> = {};
  const shapes = new Map<string, SharedStructureShape>();
  for (const [column, value] of Object.entries(write.values)) {
    const field = fieldOf.get(column);
    if (field === undefined) continue;
    // A container with one structure is recorded as written, its structure with this language's
    // text on it, as a collection's write records it: its rows are what each row's record names.
    const structures = write.structures;
    const key = [column, field.name].find(
      name => structures !== undefined && Object.hasOwn(structures, name)
    );
    if (field.sharedStructure === undefined || key === undefined) {
      values[field.name] = value;
      continue;
    }
    shapes.set(field.name, field.sharedStructure);
    values[field.name] = assembleStoredValue(
      structures?.[key],
      value === null || value === undefined ? [] : [value],
      field.sharedStructure
    );
  }
  await recordWrittenValues(tx, {
    scopeKind: "single",
    scopeSlug: write.slug,
    entryId: write.entryId,
    locale: write.locale,
    partState: write.partState ?? "live",
    values,
    shapes,
    // Each language's counter as it stands, for a copy to be judged against the version of its
    // source it says it read.
    languageRevisions: await copySourceRevisions(tx.getDrizzle<SelectsRows>(), {
      dialect: deps.adapter.dialect,
      languagesTable: write.languagesTable ?? null,
      entryId: write.entryId,
      claims: write.claims,
    }),
    jsonFields: new Set(
      write.localizedFields
        .filter(field => field.json === true)
        .map(field => field.name)
    ),
    promotesDraft: write.promotesDraft,
    defaultLocale: deps.defaultLocale,
    savedBy: write.savedBy,
    claims: write.claims,
    sources: await singleWriteSources(deps, tx, write),
  });
}
