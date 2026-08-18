/**
 * The read-shape document a Single's outbox events carry, and the companion
 * read that feeds it.
 *
 * Both were private methods on `SingleMutationService`, reachable only from the
 * update path. Publishing every language records the same events from a second
 * write path, and a second copy of this assembly would let the two payload
 * shapes drift — a consumer diffing `data` against `previous` cannot tell which
 * writer produced them. Neither helper needed the service for anything but one
 * collaborator apiece, so each takes that collaborator as a parameter and the
 * class keeps no claim on it.
 *
 * @module domains/singles/services/single-webhook-doc
 */

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type { TransactionContext } from "@nextlyhq/adapter-drizzle/types";

import type { FieldConfig } from "../../../collections/fields/types";
import type { FieldGroupDataService } from "../../../services/field-groups/field-group-data-service";
import { convertTimestampsToCamelCase } from "../../../shared/lib/case-conversion";
import { readComponentSubtrees } from "../../field-groups/read-component-subtrees";
import { populateCompanionFields } from "../../i18n/companion-join";
import type { CompanionSchema } from "../../i18n/runtime/companion-io";
import { cachedCompanionReadiness } from "../../i18n/runtime/companion-readiness";

import { applyReadShape } from "./single-read-shape";

/**
 * Read a Single's FULL companion translation state for one locale, keyed by
 * companion column — every localized field carries its stored value or is
 * absent (untranslated). Used to assemble the default-locale view for a
 * shared-field event on a localized Single, whose write locale may differ
 * from the default and so is not already in hand.
 */
export async function readCompanionLocaleValues(
  adapter: DrizzleAdapter,
  tx: TransactionContext,
  companion: CompanionSchema,
  entryId: string,
  locale: string
): Promise<Record<string, unknown>> {
  const localeRow: Record<string, unknown> = { id: entryId };
  await populateCompanionFields({
    db: tx.getDrizzle<Parameters<typeof populateCompanionFields>[0]["db"]>(),
    companionTable: companion.table,
    localizedFields: companion.localizedFields,
    rows: [localeRow],
    localeChain: [locale],
    // Inside the caller's transaction, so the remembered verdict is read rather than resolved:
    // resolving would query, and a query against a missing relation aborts the whole transaction
    // on PostgreSQL. Any other failure propagates, which is what this read needs — it feeds a
    // durable webhook payload, and shipping nulled translations because a transient error was
    // swallowed would corrupt it.
    readiness: cachedCompanionReadiness(adapter, companion.companionTableName),
  });
  const values: Record<string, unknown> = {};
  for (const f of companion.localizedFields) {
    if (localeRow[f.name] !== undefined) {
      values[f.column] = localeRow[f.name];
    }
  }
  return values;
}

/**
 * Assemble a Single's main row plus its component subtrees into the read
 * shape the outbox event carries — timestamps camelCased, this locale's
 * translatable values overlaid by field name, password and system-owner
 * columns stripped, JSON-backed fields parsed, and component subtrees
 * populated. UNtagged (unlike the version snapshot, which tags component
 * types): the webhook payload ships the plain read shape.
 *
 * Reused for BOTH the post-write `data` and the pre-write `previous` so the
 * changed-field diff compares like with like. `companionValues` is keyed by
 * companion column and carries the FULL locale state for this side (all
 * stored translations, not only the columns this write touched), so the two
 * documents diff symmetrically and a partial edit still reports untouched
 * translations on both sides. Components are read on the caller's
 * transaction (read-your-writes) so a post-write call sees the subtrees just
 * saved and a pre-write call sees the prior ones. `localeStatus`, when
 * provided, overrides the assembled `status` so a per-locale write reports
 * the write locale's own publish state rather than the main row's.
 */
export async function buildSingleWebhookDoc(
  fieldGroupDataService: FieldGroupDataService | undefined,
  tx: TransactionContext,
  entryId: string,
  parentTable: string,
  row: Record<string, unknown>,
  fieldConfigs: FieldConfig[],
  companion: CompanionSchema | null,
  companionExists: boolean,
  companionValues: Record<string, unknown>,
  snapshotLocale: string | undefined,
  localeStatus?: string
): Promise<Record<string, unknown>> {
  // Keep user field keys (which may contain underscores like `site_title`)
  // exactly; convert only the timestamp columns so the shape matches a read.
  const parentRow = convertTimestampsToCamelCase({ ...row });
  // A localized single's main row omits translatable columns (split to the
  // companion), so overlay this locale's values back on, keyed by field.name.
  // Skip the overlay when the companion table does not physically exist yet
  // (a localized single before its companion migration runs): in that
  // unmigrated state the translatable values still live on the main row, so
  // nulling them here would drop existing translations and report bogus
  // changed fields.
  if (companion && companionExists) {
    // A shared field can legitimately be NAMED like a localized field's
    // physical column (e.g. a shared `meta_title` next to localized
    // `metaTitle` → column `meta_title`); never drop such a real field.
    const mainFieldNames = new Set(
      fieldConfigs
        .map(f => ("name" in f ? f.name : undefined))
        .filter((n): n is string => !!n)
    );
    for (const f of companion.localizedFields) {
      // Every localized field appears in the read shape — its stored/written
      // value or null (untranslated), matching populateCompanionFields — so a
      // partial translation write's payload lists all localized fields, not
      // only the touched ones.
      parentRow[f.name] = Object.prototype.hasOwnProperty.call(
        companionValues,
        f.column
      )
        ? companionValues[f.column]
        : null;
      // The post-write main row may carry the raw snake_case companion column
      // (merged back after the upsert); the read shape keys a translatable
      // value by field name only, so drop the raw column so `data` and
      // `previous` keep an identical key set — unless it is itself a declared
      // shared field, whose value must survive.
      if (
        f.column !== f.name &&
        f.column in parentRow &&
        !mainFieldNames.has(f.column)
      ) {
        delete parentRow[f.column];
      }
    }
  }
  // Redact and normalise: no password hash or system owner column reaches a
  // webhook payload, and JSON-backed fields arrive parsed.
  applyReadShape(parentRow, fieldConfigs);
  // Read the component subtrees on the transaction so the assembly sees the
  // right generation (post-write: just saved; pre-write: prior).
  const components = await readComponentSubtrees({
    fieldGroupDataService,
    tx,
    entryId,
    parentTable,
    fieldConfigs,
    locale: snapshotLocale,
    reason: "webhook-single-component-read",
    logContext: { table: parentTable },
  });
  const doc: Record<string, unknown> = { ...parentRow, ...components };
  // Overlay the resolved per-locale status: for a non-default-locale write the
  // main row keeps the default language's status, so the assembled `status`
  // above is the wrong one for this locale — replace it with the caller's.
  if (localeStatus !== undefined) {
    doc.status = localeStatus;
  }
  return doc;
}
