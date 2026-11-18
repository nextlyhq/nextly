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
  recordWrittenValues,
  translationProvenancePresent,
} from "../../i18n/provenance/record-provenance";
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
  /** The values written, keyed by column. */
  values: Readonly<Record<string, unknown>>;
  /** The Single's translated fields: each one's column, and whether its storage is JSON. */
  localizedFields: ReadonlyArray<{
    name: string;
    column: string;
    json?: boolean;
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
  const nameOf = new Map(
    write.localizedFields.map(field => [field.column, field.name])
  );
  const values: Record<string, unknown> = {};
  for (const [column, value] of Object.entries(write.values)) {
    const name = nameOf.get(column);
    if (name !== undefined) values[name] = value;
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
