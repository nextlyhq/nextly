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
import type { ProvenanceClaims } from "../../i18n/provenance/provenance-claims";
import {
  copySourceRevisions,
  forgetRemovedRowsProvenance,
  recordWrittenValues,
  translationProvenancePresent,
} from "../../i18n/provenance/record-provenance";
import {
  type CompanionSchema,
  pruneOverlaysOfRemovedRows,
  type SharedStructureWritten,
  withStructuresBefore,
} from "../../i18n/runtime/companion-io";
import {
  assembleStoredValue,
  type SharedStructureShape,
} from "../../i18n/shared-structure";
import type { SelectsRows } from "../../versions/document-revision";

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
   * it is.
   */
  structures?: Readonly<Record<string, unknown>>;
  /**
   * The Single's translated fields: each one's column, whether its storage is JSON, and the
   * shape of a container with one structure in every language.
   */
  localizedFields: ReadonlyArray<{
    name: string;
    column: string;
    json?: boolean;
    sharedStructure?: SharedStructureShape;
  }>;
  /** The Single's translation table, which holds each language's counter. */
  languagesTable?: string;
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
 * (`pruneOverlaysOfRemovedRows`), and every language's record of those rows forgotten. The one way
 * every write of a Single's live structure drops a removed row's text: a save, a field rewrite and
 * a publish of every language alike.
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
  if (
    args.written.length === 0 ||
    !(await singleProvenanceRecorded(deps, tx))
  ) {
    return;
  }
  await forgetRemovedRowsProvenance(
    tx,
    { scopeKind: "single", scopeSlug: args.slug, entryId: args.entryId },
    args.written.map(entry => ({
      field: entry.field,
      structure: entry.structure,
      kind: entry.shape.kind,
    }))
  );
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
  for (const [column, value] of Object.entries(write.values)) {
    const field = fieldOf.get(column);
    if (field === undefined) continue;
    // A container with one structure is recorded as written, its structure with this language's
    // text on it, as a collection's write records it: its rows are what each row's record names.
    const structures = write.structures;
    values[field.name] =
      field.sharedStructure !== undefined &&
      structures !== undefined &&
      Object.hasOwn(structures, column)
        ? assembleStoredValue(
            structures[column],
            value === null || value === undefined ? [] : [value],
            field.sharedStructure
          )
        : value;
  }
  await recordWrittenValues(tx, {
    scopeKind: "single",
    scopeSlug: write.slug,
    entryId: write.entryId,
    locale: write.locale,
    partState: write.partState ?? "live",
    values,
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
  });
}
