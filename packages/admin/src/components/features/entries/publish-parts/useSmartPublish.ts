"use client";

/**
 * The editor's Publish on a document with several languages: one click where nothing beyond the
 * language on screen changes for any reader, and otherwise the form's unsaved work stored without
 * publishing it, then the choice of what goes live.
 *
 * On a document somebody reads, unsaved work is stored before it is decided: a hook may change a
 * shared field from a save of one language's text, which only what is stored shows. A document
 * that can store it only by publishing is published as it always was.
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

/** Stored, and the editor moved before it was published. */
const STORED_THEN_MOVED = {
  ok: false,
  reason: "cancelled",
  message:
    "You moved to another language or document before this was published. It is saved.",
  stored: true,
} as const satisfies DocumentActionOutcome;

/** What a press finds before it decides. */
interface PressedWork {
  /** Whether the form holds unsaved work. */
  unsaved: boolean;
  /** Whether that work changes a shared field, on a document somebody reads. */
  sharedEdited: boolean;
  /** The save that stored it, where it was stored before deciding. */
  saved: SubmitOutcome | undefined;
}

/**
 * The form's unsaved work, stored without publishing it where somebody reads the document and it
 * keeps unpublished work. Whether it changes a shared field is asked before it is stored, while
 * the form still says so.
 */
async function storedWork(
  host: SmartPublishHost,
  live: boolean
): Promise<PressedWork> {
  const unsaved = host.unsaved();
  const storesFirst = unsaved && live;
  return {
    unsaved,
    sharedEdited: storesFirst && host.sharedEdited(),
    saved: storesFirst ? await host.save?.() : undefined,
  };
}

/** Whether the shared fields hold stored changes, read afresh; unknown where the read fails. */
async function sharedPendingNow(
  read: () => Promise<boolean>
): Promise<boolean | undefined> {
  try {
    return await read();
  } catch {
    return undefined;
  }
}

/** What a press is decided from: what every language holds, and the shared fields. */
async function decidedFrom(args: {
  target: PartsTarget;
  /** Whether unsaved work was stored since the editor read the document. */
  stored: boolean;
  /** What the editor's read says of the shared fields. */
  sharedPending: boolean;
  readSharedPending: () => Promise<boolean>;
}): Promise<{
  everyLanguage: EveryLanguageDescription;
  sharedPending: boolean;
}> {
  const [everyLanguage, pending] = await Promise.all([
    describeEveryLanguage(args.target),
    args.stored
      ? sharedPendingNow(args.readSharedPending)
      : Promise.resolve(args.sharedPending),
  ]);
  return {
    // Shared fields nobody could be told of are not published past.
    everyLanguage: pending === undefined ? { state: "unknown" } : everyLanguage,
    sharedPending: pending ?? args.sharedPending,
  };
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
  /** Reads afresh whether the shared fields hold stored changes nobody has published. */
  readSharedPending: () => Promise<boolean>;
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
  readSharedPending,
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
      const work = await storedWork(host, live);
      if (work.saved?.ok === false) return work.saved;
      const stored = work.saved !== undefined;
      const moved = stored ? STORED_THEN_MOVED : submitMoved;
      // The form holds another document's or language's values by now: storing or publishing
      // them would write them into the one the press was for.
      if (!stillHere()) return moved;
      const found = await decidedFrom({
        target,
        stored,
        sharedPending,
        readSharedPending,
      });
      if (!stillHere()) return moved;

      const path = smartPublishPath({
        languages,
        currentLocale,
        sharedPending: found.sharedPending || work.sharedEdited,
        everyLanguage: found.everyLanguage,
      });
      const unstored = work.unsaved && !stored;
      // Unsaved work a document can only store by publishing it (a live one that keeps no
      // drafts) is published as it always was: there is no stored change to choose from.
      if (path.kind === "one-click" || (unstored && host.save === undefined)) {
        return publishOnScreen(host, stillHere, () =>
          onPublished({ published: [currentLocale] })
        );
      }

      const saved = unstored ? await host.save?.() : undefined;
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
      return work.unsaved ? { ...CHOOSING, stored: true } : CHOOSING;
    },
    [
      target,
      languages,
      currentLocale,
      sharedPending,
      live,
      readSharedPending,
      open,
      onPublished,
    ]
  );

  return target === undefined || languages.length <= 1
    ? undefined
    : smartPublish;
}
