/**
 * Turning a Single's pending change into the values a write persists.
 *
 * Two callers need this and must not answer differently: publishing one
 * language folds its pending change into that write, and publishing every
 * language applies each of them. A second copy of the mapping is how the two
 * would drift, and the drift would be quiet — a translated value routed to the
 * main table fails loudly with `no such column`, but one routed to the wrong
 * locale's companion row simply publishes the wrong translation.
 *
 * @module domains/singles/services/apply-pending-change
 */

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import { keysToSnakeCase } from "../../../lib/case-conversion";
import { stripImmutableSystemFields } from "../../../lib/immutable-system-fields";
import type { CompanionSchema } from "../../i18n/runtime/companion-io";
import {
  splitLocalizedWrite,
  upsertCompanionRow,
} from "../../i18n/runtime/companion-io";

/** The column-shaped halves a pending change persists to. */
export interface PendingChangeParts {
  /** Values belonging on the Single's own row. */
  main: Record<string, unknown>;
  /** Values belonging on the write locale's companion row. */
  companion: Record<string, unknown>;
}

/**
 * Split a stored pending change into main-row and companion-row values.
 *
 * The snapshot is in read shape (field names, camelCased timestamps), so it is
 * mapped to columns before the split — and the split runs LAST, because it is
 * what moves translated values out of the document. Anything merged in
 * afterwards would land on the main row, which has no column for it.
 *
 * `overrides` are the caller's own values, applied on top: a publish that also
 * sets a field is saying something about that field now, and outranks what the
 * pending change said earlier.
 */
export function splitPendingChange(
  snapshot: unknown,
  companion: CompanionSchema | null,
  overrides?: Record<string, unknown>
): PendingChangeParts {
  const payload = stripImmutableSystemFields(
    {
      ...(keysToSnakeCase(snapshot) as Record<string, unknown>),
      ...(overrides ?? {}),
    },
    "single"
  );
  if (!companion) return { main: payload, companion: {} };
  const { main, companion: companionValues } = splitLocalizedWrite(
    payload,
    companion.localizedFields
  );
  return { main, companion: companionValues };
}

/** The transaction surface a companion write needs. */
export interface CompanionWriteTx {
  execute<T = unknown>(sql: string, params?: unknown[]): Promise<T[]>;
}

/**
 * Write one language's values to its companion row, on the caller's
 * transaction.
 *
 * The adapter shim is built here rather than at each call site: it binds the
 * write to the transaction's own connection, and a site that forgot it would
 * take a second pooled connection the transaction is holding and stall.
 */
export async function writeCompanionValues(args: {
  tx: CompanionWriteTx;
  dialect: SupportedDialect;
  companionTableName: string;
  entryId: string;
  locale: string;
  values: Record<string, unknown>;
  /** The per-locale lifecycle to stamp, when this write sets one. */
  status?: string;
}): Promise<void> {
  const txWriteAdapter = {
    dialect: args.dialect,
    executeQuery: <T = unknown>(sql: string, params?: unknown[]) =>
      args.tx.execute<T>(sql, params),
  };
  await upsertCompanionRow(
    txWriteAdapter,
    args.companionTableName,
    args.entryId,
    args.locale,
    args.values,
    args.status
  );
}
