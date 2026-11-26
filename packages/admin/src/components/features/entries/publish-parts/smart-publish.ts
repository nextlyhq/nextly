/**
 * Whether the editor's Publish publishes in one click or first opens the choice of what goes live.
 * Free of React, so every case is tested without rendering anything.
 *
 * One click when nothing beyond the language on screen would change for any reader. The choice
 * opens when the shared fields hold changes nobody has published (they change what readers of
 * every language see), or another language holds changes of its own. What another language holds
 * is read from the publish service's own description of publishing every language, so the editor
 * never publishes in one click past a change the server says is waiting; where that description
 * is missing or refused, the choice opens, and says what the server says there.
 *
 * @experimental Until publishing per language is complete.
 *
 * @module components/features/entries/publish-parts/smart-publish
 */

import type {
  PartsLanguageOutcome,
  PublishPartsResult,
} from "@admin/services/publishParts";

/**
 * The publish service's description of publishing every language, as far as it is known: the
 * answer, a refusal (the server would not publish every language as it stands), or not yet asked.
 */
export type EveryLanguageDescription =
  | { state: "described"; answer: PublishPartsResult }
  | { state: "refused" }
  | { state: "unknown" };

/** What the editor's Publish does when pressed. */
export type SmartPublishPath =
  | { kind: "one-click" }
  | {
      kind: "choose";
      /** Whether the shared fields hold changes nobody has published. */
      sharedPending: boolean;
      /** The other languages holding changes of their own, in the site's order. */
      languages: string[];
      /** Whether the server has not described publishing every language: missing or refused. */
      undescribed: boolean;
    };

/**
 * The outcomes that change what a language's readers see, so a language with one holds changes:
 * a live language's unpublished changes, a language with content of its own that has never been
 * live, and a change made against shared values that have since moved (the server refuses it as
 * it stands, which the choice says). A live language with nothing new, and one with no content of
 * its own, hold nothing.
 */
const HOLDS_CHANGES: ReadonlySet<PartsLanguageOutcome["outcome"]> = new Set<
  PartsLanguageOutcome["outcome"]
>(["goes-live-with-pending-change", "goes-live", "out-of-date"]);

/** Whether publishing `outcome` would change what that language's readers see. */
export function holdsChanges(outcome: PartsLanguageOutcome): boolean {
  return HOLDS_CHANGES.has(outcome.outcome);
}

/**
 * What the editor's Publish does.
 *
 * A document on a site with one language, or one that is not translated, always publishes in one
 * click: its shared fields are read by that one language's readers alone.
 */
export function smartPublishPath(args: {
  /** The site's languages, in order, where the document is translated; otherwise none. */
  languages: readonly string[];
  /** The language on screen. */
  currentLocale: string;
  /**
   * Whether the shared fields hold changes nobody has published: stored ones the editor's read
   * reports, or edits to them in the form not yet saved, which a one-click publish would put live.
   */
  sharedPending: boolean;
  everyLanguage: EveryLanguageDescription;
}): SmartPublishPath {
  if (args.languages.length <= 1) return { kind: "one-click" };
  const { everyLanguage } = args;
  // Another language's waiting change, in the site's order, as the server describes it.
  const languages =
    everyLanguage.state === "described"
      ? args.languages.filter(
          locale =>
            locale !== args.currentLocale &&
            everyLanguage.answer.languages.some(
              language => language.locale === locale && holdsChanges(language)
            )
        )
      : [];
  const undescribed = everyLanguage.state !== "described";
  if (!args.sharedPending && languages.length === 0 && !undescribed) {
    return { kind: "one-click" };
  }
  return {
    kind: "choose",
    sharedPending: args.sharedPending,
    languages,
    undescribed,
  };
}
