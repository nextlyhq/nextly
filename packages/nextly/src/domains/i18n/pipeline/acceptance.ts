/**
 * What accepting a suggestion adds to the save that writes it: where the text came from, and the
 * suggestion taken out in the save's own transaction. Stated by server code alone; no body names
 * one.
 *
 * Types only, so the write paths and the operation that calls them do not import each other.
 *
 * @experimental
 *
 * @module domains/i18n/pipeline/acceptance
 */

import type { TransactionContext } from "@nextlyhq/adapter-drizzle/types";

import type { SuggestionClaim } from "../provenance/provenance-claims";

/** One accepted suggestion, as the save that writes it is told. */
export interface SuggestionAcceptance {
  /** Where the text the save writes came from, by its path: a top-level field's is its name. */
  claims: Readonly<Record<string, SuggestionClaim>>;
  /**
   * Run last in the save's transaction, on each try of it: what it throws undoes the save. Never
   * run where the save fails before, and possibly not where a save finds nothing to write.
   */
  onWritten: (tx: TransactionContext) => Promise<void>;
}
