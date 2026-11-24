"use client";

/**
 * The editor's Publish on a document with several languages: one click where nothing beyond the
 * language on screen changes for any reader, and otherwise the form's unsaved work stored without
 * publishing it, then the choice of what goes live.
 *
 * Asked of the server on the press: what another language holds can change under an open editor,
 * and an answer kept from earlier would publish past it.
 *
 * It decides only what Publish runs. Whether Publish may run at all (a workflow holding it, a
 * colleague's lock, a past version on screen) stays with the document's actions, which never call
 * this while it is held.
 *
 * @experimental Until publishing per language is complete.
 *
 * @module components/features/entries/publish-parts/useSmartPublish
 */

import { useCallback, useRef } from "react";

import {
  describeParts,
  type PartsTarget,
} from "@admin/hooks/queries/usePublishParts";
import { validationIssues } from "@admin/lib/api/parseApiError";

import { submitMoved, type SubmitOutcome } from "../EntryForm/submit-outcome";
import type { DocumentActionOutcome } from "../EntryForm/useDocumentActionBindings";

import { defaultPartsChoice, type PartsChoice } from "./publish-parts-choice";
import {
  smartPublishPath,
  type EveryLanguageDescription,
} from "./smart-publish";

/** What the editor drawing the document gives its Publish to run. */
export interface SmartPublishHost {
  /** Publishes the form in the language on screen, as Publish always has. */
  publish: () => Promise<SubmitOutcome>;
  /**
   * Stores the form's unsaved work without publishing it; undefined where the document keeps
   * none apart from what is live.
   */
  save: (() => Promise<SubmitOutcome>) | undefined;
  /** Whether the form holds unsaved work, asked when the press is decided. */
  unsaved: () => boolean;
  /** Whether that unsaved work changes a field every language shares. */
  sharedEdited: () => boolean;
}

/** The editor's Publish, for the document the page shows. */
export type SmartPublish = (
  host: SmartPublishHost
) => Promise<DocumentActionOutcome>;

/** Stopped to ask what goes live: not published, and nothing failed. */
const CHOOSING = {
  ok: false,
  reason: "cancelled",
  message: "Choose what to publish.",
} as const satisfies DocumentActionOutcome;

/** What publishing every language would do, as far as the server says. */
async function describeEveryLanguage(
  target: PartsTarget
): Promise<EveryLanguageDescription> {
  try {
    const answer = await describeParts(target, "publish", { locales: "all" });
    return { state: "described", answer };
  } catch (error) {
    return {
      state: validationIssues(error).length > 0 ? "refused" : "unknown",
    };
  }
}

/**
 * Whether the shared fields hold changes nobody has published: stored ones, or unsaved edits to
 * them on a document somebody reads.
 */
function sharedChangesHeld(
  host: SmartPublishHost,
  held: { sharedPending: boolean; live: boolean; unsaved: boolean }
): boolean {
  return (
    held.sharedPending || (held.live && held.unsaved && host.sharedEdited())
  );
}

/**
 * Publishes the language on screen in one click. `onPublished` is told only where it was published
 * and the language is still on screen: what it is told is about that language.
 */
async function publishOnScreen(
  host: SmartPublishHost,
  stillHere: () => boolean,
  onPublished: () => void
): Promise<SubmitOutcome> {
  const outcome = await host.publish();
  if (outcome.ok && stillHere()) onPublished();
  return outcome;
}

export interface UseSmartPublishOptions {
  /** The document; absent while the page is loading. */
  target: PartsTarget | undefined;
  /** The site's languages, in order, where the document is translated; otherwise none. */
  languages: readonly string[];
  /** The language on screen. */
  currentLocale: string | undefined;
  /** Whether the shared fields hold stored changes nobody has published. */
  sharedPending: boolean;
  /**
   * Whether any language of the document is live. Before its first publish nobody reads its
   * shared fields, so edits to them change nothing for anyone.
   */
  live: boolean;
  /** Opens the choice of what goes live. */
  open: (
    choice: PartsChoice,
    openedBy: "publish",
    opening: { sharedPending: boolean }
  ) => void;
  /** Told that the language on screen was published in one click. */
  onPublished: (result: { published: readonly string[] }) => void;
}

/**
 * The editor's Publish, or undefined where it stays the one click it is: while the page loads,
 * and for a document with one language, whose shared fields that language's readers alone read.
 */
export function useSmartPublish({
  target,
  languages,
  currentLocale,
  sharedPending,
  live,
  open,
  onPublished,
}: UseSmartPublishOptions): SmartPublish | undefined {
  const scope = JSON.stringify([target ?? null, currentLocale ?? null]);
  // This visit to the document and language: a new one each time they change, so going away and
  // coming back is a move too, as the form has started afresh in between.
  const visit = useRef({ scope });
  if (visit.current.scope !== scope) visit.current = { scope };

  const smartPublish = useCallback<SmartPublish>(
    async host => {
      if (target === undefined || currentLocale === undefined) {
        return host.publish();
      }
      const startedIn = visit.current;
      const stillHere = () => visit.current === startedIn;
      const everyLanguage = await describeEveryLanguage(target);
      // The form holds another document's or language's values by now: storing or publishing
      // them would write them into the one the press was for.
      if (!stillHere()) return submitMoved;

      const unsaved = host.unsaved();
      const path = smartPublishPath({
        languages,
        currentLocale,
        sharedPending: sharedChangesHeld(host, {
          sharedPending,
          live,
          unsaved,
        }),
        everyLanguage,
      });
      // Unsaved work a document can only store by publishing it (a live one that keeps no
      // drafts) is published as it always was: there is no stored change to choose from.
      if (path.kind === "one-click" || (unsaved && host.save === undefined)) {
        return publishOnScreen(host, stillHere, () =>
          onPublished({ published: [currentLocale] })
        );
      }

      const saved = unsaved ? await host.save?.() : undefined;
      if (saved?.ok === false) return saved;
      // Moved while it was stored: the choice is not opened over another document or language.
      if (stillHere()) {
        open(
          defaultPartsChoice({
            languages,
            currentLocale,
            defaultLocale: undefined,
            sharedPending: path.sharedPending,
          }),
          "publish",
          { sharedPending: path.sharedPending }
        );
      }
      return unsaved ? { ...CHOOSING, stored: true } : CHOOSING;
    },
    [target, languages, currentLocale, sharedPending, live, open, onPublished]
  );

  return target === undefined || languages.length <= 1
    ? undefined
    : smartPublish;
}
