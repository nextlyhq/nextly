/**
 * The record of which media items a Single uses, rewritten on a write's own
 * transaction: the one call both of a Single's write services make, so the
 * ordinary save and the publish of every language record it the same way.
 *
 * @module domains/singles/services/single-media-usage
 */

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type { TransactionContext } from "@nextlyhq/adapter-drizzle/types";

import type { FieldConfig } from "../../../collections/fields/types";
import type { FieldGroupDataService } from "../../../services/field-groups/field-group-data-service";
import { markWriteIntegrityFailure } from "../../../shared/write-integrity";
import { transactionTableProbe } from "../../dashboard/table-presence";
import type { SanitizedLocalizationConfig } from "../../i18n/config/types";
import type { CompanionSchema } from "../../i18n/runtime/companion-io";
import { cachedCompanionReadiness } from "../../i18n/runtime/companion-readiness";
import { mediaUsagePresent } from "../../media/usage/media-usage-store";

/** What recording a Single's usage needs from the service that wrote it. */
export interface SingleMediaUsageDeps {
  adapter: DrizzleAdapter;
  logger?: { warn(message: string, context?: Record<string, unknown>): void };
  fieldGroupDataService: FieldGroupDataService | undefined;
  /** The site's languages; absent when it has no localization. */
  localization: SanitizedLocalizationConfig | undefined;
}

/**
 * Rewrite the record of which media items the Single uses from what its
 * tables hold now, on `tx`, once everything the write changes is in it.
 * Nothing is recorded before `nextly migrate` has created the record's table:
 * asked on the transaction's own connection, as a catalogue read that cannot
 * abort it. A failure fails the write, which never stands with a record that
 * disagrees with it.
 */
export async function recordSingleMediaUsage(
  tx: TransactionContext,
  deps: SingleMediaUsageDeps,
  single: {
    slug: string;
    rowId: string;
    tableName: string;
    fields: readonly FieldConfig[];
    companion: CompanionSchema | null;
    /**
     * Whether the write held its change as a working draft: it then stored
     * nothing, so there is nothing to read again.
     */
    heldDraft?: boolean;
  }
): Promise<void> {
  if (single.heldDraft === true) return;
  try {
    const present = await mediaUsagePresent(
      deps.adapter,
      deps.logger,
      transactionTableProbe(deps.adapter, tx)
    );
    if (!present) return;
    // Loaded on the first write that records, not with the services.
    const { recordStoredDocumentUsage } = await import(
      "../../media/usage/stored-document-usage"
    );
    // Read only where they are there; remembered, never resolved, inside a
    // transaction, as every in-transaction translations read is.
    const translations =
      single.companion !== null &&
      cachedCompanionReadiness(
        deps.adapter,
        single.companion.companionTableName
      ) === "ready"
        ? single.companion
        : null;
    await recordStoredDocumentUsage(
      tx,
      {
        fieldGroupDataService: deps.fieldGroupDataService,
        locales: deps.localization?.locales.map(l => l.code) ?? [],
        maxParams: deps.adapter.getCapabilities().maxParamsPerQuery,
      },
      // A Single is one document, so it has no entry id of its own.
      { kind: "single", slug: single.slug, documentId: "" },
      {
        tableName: single.tableName,
        rowId: String(single.rowId),
        fields: single.fields,
        translations,
      }
    );
  } catch (err) {
    throw markWriteIntegrityFailure(err);
  }
}
