/**
 * Whether one read surfaces a document's working draft, and which language's.
 *
 * The read-side mirror of {@link resolveDraftHold}, and deliberately the same
 * shape: one call answering both "overlay?" and "under which key?", so no caller
 * can arrive at "overlay" without also arriving at the key it must look under.
 *
 * ## Why this is shared rather than written per domain
 *
 * The write decides whether an edit is HELD; the read decides whether a held
 * edit is SHOWN. When those two disagree the author is told the save succeeded
 * and then shown the old content, which is the worst available outcome — worse
 * than writing live, because nothing tells them their work is elsewhere.
 *
 * That has now happened twice from the same cause: a read carrying an exclusion
 * the write had dropped. Once at the document level (a localized document held
 * an edit no read would surface) and once at the component level (a collection
 * embedding a LOCALIZED component held an edit the read refused to overlay,
 * because the read still tested `schema.localized` after the write stopped).
 * Both were invisible because each side looked correct on its own.
 *
 * Deriving both answers from {@link isDraftSplitEligible} and
 * {@link workingDraftLocale} makes that class of divergence unrepresentable:
 * there is one statement of what is eligible and one of where its draft lives.
 *
 * ## What stays with the caller
 *
 * The capability question — may this caller EDIT this document — is resolved by
 * the domain and passed in, because collections and Singles ask it of different
 * services against different rows. So is the assembly that follows an overlay:
 * relation expansion and component population differ per domain, and are not a
 * rule.
 *
 * @module domains/versions/draft-overlay
 */

import type { FieldConfig } from "../../collections/fields/types";

import { isDraftSplitEligible } from "./draft-split-eligibility";
import type { ComponentSchemas } from "./restore-snapshot";
import { workingDraftLocale } from "./working-draft-locale";

/**
 * The three facts about a document that decide whether the split applies to it.
 *
 * Read through one function rather than cast at each call site: collections and
 * Singles hold the same three properties in the same shape, and each reading
 * them for itself is how the two ended up disagreeing about eligibility in the
 * first place.
 */
export interface DraftDocumentConfig {
  status?: boolean;
  localized?: boolean;
  versions?: { drafts?: { enabled?: boolean } } | null;
}

export interface DraftDocumentFacts {
  collectionHasStatus: boolean;
  draftsVersioningEnabled: boolean;
  documentLocalized: boolean;
}

/** The split-relevant facts a document's config carries. */
export function draftDocumentFacts(
  config: DraftDocumentConfig
): DraftDocumentFacts {
  return {
    collectionHasStatus: config.status === true,
    draftsVersioningEnabled: config.versions?.drafts?.enabled === true,
    documentLocalized: config.localized === true,
  };
}

export interface DraftOverlayInput {
  /** `status === true` — the document has the Draft/Published lifecycle. */
  collectionHasStatus: boolean;
  /** `versions?.drafts?.enabled === true`. */
  draftsVersioningEnabled: boolean;
  /** Whether the document itself is localized. */
  documentLocalized: boolean;
  /** Top-level fields, for the reachable-password check. */
  fields: FieldConfig[];
  /**
   * Reachable component schemas. `null` is permitted for a CHEAP pre-check that
   * skips resolution: with no schemas the eligibility test can only be more
   * permissive, so a `false` answer is final while a `true` one is provisional
   * and must be confirmed with resolved schemas before a draft is exposed.
   */
  componentSchemas: ComponentSchemas | null;
  /**
   * Whether the caller explicitly asked for the draft view.
   *
   * Opt-in on purpose: internal reads (duplicate, reference labels, expansion)
   * issue status-less reads and must keep seeing the published row, so draft
   * visibility follows an editor's intent rather than the absence of a filter.
   */
  includeWorkingDraft: boolean;
  /** The status the request named. An explicit published view suppresses the draft. */
  requestedStatus?: string | undefined;
  /**
   * Whether this caller may UPDATE this document.
   *
   * Resolved by the domain against the LOADED row, never inferred from a route
   * having authorized a READ: an owner-only update rule passes the coarse check
   * pending a row-level predicate, so treating a reader as an editor would leak
   * one author's pending edits to another.
   */
  callerMayEdit: boolean;
  /** The language being read, if the request named one. */
  requestLocale?: string | null;
  /** The app's default locale, for a request that named none. */
  defaultLocale?: string | null;
}

export interface DraftOverlayDecision {
  /** Whether to look for a working draft and overlay it on the live document. */
  overlay: boolean;
  /** The language whose draft to look for. `null` for an unlocalized document. */
  draftLocale: string | null;
}

/**
 * Resolve whether this read surfaces a working draft, and which language's.
 */
export function resolveDraftOverlay(
  input: DraftOverlayInput
): DraftOverlayDecision {
  const draftLocale = workingDraftLocale({
    documentLocalized: input.documentLocalized,
    requestLocale: input.requestLocale ?? null,
    defaultLocale: input.defaultLocale ?? null,
  });

  const eligible = isDraftSplitEligible({
    collectionHasStatus: input.collectionHasStatus,
    draftsVersioningEnabled: input.draftsVersioningEnabled,
    fields: input.fields,
    componentSchemas: input.componentSchemas,
  });

  const overlay =
    eligible &&
    input.includeWorkingDraft &&
    input.callerMayEdit &&
    input.requestedStatus !== "published" &&
    // A localized document whose language this read cannot name has no slot to
    // look in. Reading the unlocalized slot would report "no pending change" for
    // a document that has one, which reads as the author's edit having vanished.
    !(input.documentLocalized && draftLocale === null);

  return { overlay, draftLocale };
}
