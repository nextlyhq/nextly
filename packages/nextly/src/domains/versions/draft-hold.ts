/**
 * Whether one write holds its edit as a working draft, and under which key.
 *
 * Pure and exported so the rule can be tested directly. It composes the two
 * questions that were already separate — is this document eligible for the
 * split, and which locale keys its draft — into the single answer every write
 * path needs, so no caller can arrive at "hold" without also arriving at a key.
 *
 * Holding without a key is the failure this shape makes unrepresentable. A
 * draft written under a slot no later read looks in is lost in the worst
 * possible way: the author is told the save succeeded.
 *
 * @module domains/versions/draft-hold
 */

import type { FieldConfig } from "../../collections/fields/types";

import { isDraftSplitEligible } from "./draft-split-eligibility";
import type { ComponentSchemas } from "./restore-snapshot";
import { workingDraftLocale } from "./working-draft-locale";

export interface DraftHoldInput {
  collectionHasStatus: boolean;
  draftsVersioningEnabled: boolean;
  documentLocalized: boolean;
  fields: FieldConfig[];
  componentSchemas: ComponentSchemas | null;
  /** The status this write names, if any. A write that names one is not held. */
  namedStatus: unknown;
  /** The committed status of the row being written. */
  liveStatus: unknown;
  /**
   * The locale this write is for. A surface with no locale concept passes
   * nothing, which is what makes it decline a localized document rather than
   * key one under the wrong slot.
   */
  requestLocale?: string | null;
}

export interface DraftHoldDecision {
  hold: boolean;
  draftLocale: string | null;
}

/** Decide whether this write holds its edit, and under which locale key. */
export function resolveDraftHold(input: DraftHoldInput): DraftHoldDecision {
  const draftLocale = workingDraftLocale({
    documentLocalized: input.documentLocalized,
    requestLocale: input.requestLocale,
  });
  const eligible = isDraftSplitEligible({
    collectionHasStatus: input.collectionHasStatus,
    draftsVersioningEnabled: input.draftsVersioningEnabled,
    fields: input.fields,
    componentSchemas: input.componentSchemas,
  });
  const hold =
    eligible &&
    input.namedStatus === undefined &&
    input.liveStatus === "published" &&
    // A localized document whose locale this write cannot name is not held.
    !(input.documentLocalized && draftLocale === null);
  return { hold, draftLocale };
}
