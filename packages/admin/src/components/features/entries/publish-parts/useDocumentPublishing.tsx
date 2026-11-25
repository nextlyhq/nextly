"use client";

/**
 * Publishing as an editor's page offers it, for an entry and a Single alike: what the header's
 * Publish runs, the choice of what goes live behind it and behind "Choose what to publish…", and
 * the notice of the translations a publish left out of date.
 *
 * One hook for both pages, so the two cannot decide differently what a press publishes.
 *
 * @experimental Until publishing per language is complete.
 *
 * @module components/features/entries/publish-parts/useDocumentPublishing
 */

import type { ReactNode } from "react";

import type { ContributedAction } from "@admin/components/features/entries/EntryForm/DocumentActionBar";
import type { PartsTarget } from "@admin/hooks/queries/usePublishParts";
import type { ShownCopy } from "@admin/lib/document-version";
import { entryApi } from "@admin/services/entryApi";
import { singleApi } from "@admin/services/singleApi";

import { anyLocalePublished } from "../EntryForm/entry-address";
import type { EntryData } from "../EntryForm/useEntryForm";
import { languageLabelOf } from "../publishAllOutcomes";

import type { TranslationOverview } from "./out-of-date";
import { OutOfDateNotice } from "./OutOfDateNotice";
import { otherLanguagesChoice } from "./publish-parts-choice";
import { useOutOfDateNotice } from "./useOutOfDateNotice";
import {
  usePublishPartsAction,
  type PublishPartsAction,
} from "./usePublishPartsAction";
import { useSmartPublish, type SmartPublish } from "./useSmartPublish";

/** What the editor's read of the document says about publishing it. */
interface PublishingRead {
  /** Absent where the person may not read every language's state. */
  overview: TranslationOverview | undefined;
  sharedPending: boolean;
  /** Whether any language is live, or may be: see `anyLocalePublished`. */
  live: boolean;
}

/** Reads what publishing needs to know off the document as the editor read it. */
function publishingReadOf(document: unknown): PublishingRead {
  const read = (document ?? {}) as {
    _translations?: TranslationOverview;
    _sharedChangesPending?: unknown;
  };
  return {
    overview: read._translations,
    sharedPending: read._sharedChangesPending === true,
    // Asked only of a translated document, so a missing overview counts as live.
    live: anyLocalePublished(document as EntryData | null | undefined, true),
  };
}

/** Reads afresh what publishing needs to know of the document in `locale`. */
async function readAfresh(
  target: PartsTarget,
  locale: string | undefined,
  asks: { translationStatus?: true; draft?: true }
): Promise<PublishingRead> {
  const options = { locale, fallbackLocale: "none", depth: 0, ...asks };
  const document: unknown =
    target.kind === "collection"
      ? await entryApi.findByID(target.slug, target.id, options)
      : await singleApi.getDocument(target.slug, options);
  return publishingReadOf(document);
}

export interface UseDocumentPublishingOptions {
  /** The document; absent while the page is loading. */
  target: PartsTarget | undefined;
  /** The document as the editor read it. */
  document: unknown;
  /** Whether this document type has a publish lifecycle at all. */
  lifecycleEnabled: boolean | undefined;
  /** Whether the document is translated, on a site with languages. */
  translated: boolean;
  /** The site's languages, in order. */
  locales: readonly { code: string; label: string }[];
  /** The language on screen, or undefined for the default one. */
  currentLocale: string | undefined;
  defaultLocale: string | undefined;
  /** The editor's own address, which the notice's links add a language to. */
  editorPath: string;
  /** The editor's copy, so a part changed since it was read is refused. */
  shown: () => ShownCopy | undefined;
}

export interface DocumentPublishing
  extends Pick<PublishPartsAction, "contributed" | "withoutReview" | "dialog"> {
  /** What the header's Publish runs, or undefined where it stays one click. */
  smartPublish: SmartPublish | undefined;
  /**
   * Opens the choice at the languages not on screen; undefined where there is no other language
   * or the person may not publish.
   */
  publishOthers: (() => void) | undefined;
  /** The notice after a publish, drawn under the editor's header. */
  notice: ReactNode;
}

/**
 * What a page contributes to its editor's actions, in the order the menu offers them: choosing
 * what to publish, then scheduling, then publishing past the review, then pinning.
 */
export function pageActions(
  publishing: Pick<DocumentPublishing, "contributed" | "withoutReview">,
  schedule: ContributedAction | null,
  pin: ContributedAction | null
): ContributedAction[] {
  return [
    publishing.contributed,
    schedule,
    publishing.withoutReview,
    pin,
  ].filter((action): action is ContributedAction => action !== null);
}

/** Whether the document has another language to publish, and the person may publish it. */
function publishesOthers(
  contributed: ContributedAction | null,
  languages: readonly string[]
): boolean {
  return (
    contributed !== null &&
    contributed.action.disabledReason === undefined &&
    languages.length > 1
  );
}

export function useDocumentPublishing({
  target,
  document,
  lifecycleEnabled,
  translated,
  locales,
  currentLocale,
  defaultLocale,
  editorPath,
  shown,
}: UseDocumentPublishingOptions): DocumentPublishing {
  const languages = translated ? locales.map(each => each.code) : [];
  const labelOf = languageLabelOf(locales);
  const onScreen = currentLocale ?? defaultLocale;
  const { overview, sharedPending, live } = publishingReadOf(document);

  const outOfDate = useOutOfDateNotice({
    scope: JSON.stringify([target ?? null, onScreen ?? null]),
    languages,
    labelOf,
    editorPath,
    readOverview: async () =>
      target === undefined
        ? undefined
        : (await readAfresh(target, currentLocale, { translationStatus: true }))
            .overview,
  });
  const onPublished = ({ published }: { published: readonly string[] }) => {
    // Without the overview as it stood, every field already out of date would read as newly so.
    if (overview === undefined || published.length === 0) return;
    void outOfDate.afterPublish({
      before: overview,
      published,
      // The links translate from the language on screen where it was published.
      source:
        onScreen !== undefined && published.includes(onScreen)
          ? onScreen
          : published[0],
    });
  };

  const { contributed, withoutReview, dialog, open } = usePublishPartsAction({
    target,
    shown,
    lifecycleEnabled,
    languages,
    labelOf,
    currentLocale,
    defaultLocale,
    sharedPending,
    overview,
    onPublished,
  });
  const smartPublish = useSmartPublish({
    target: lifecycleEnabled === true ? target : undefined,
    languages,
    currentLocale: onScreen,
    sharedPending,
    live,
    // As the editor reads it, its held changes in place of what is live: only that read says
    // whether shared ones are among them.
    readSharedPending: async () =>
      target !== undefined &&
      (await readAfresh(target, currentLocale, { draft: true })).sharedPending,
    open,
    onPublished,
  });

  const publishOthers = () =>
    open(otherLanguagesChoice({ languages, onScreen, overview }), "menu");

  return {
    contributed,
    withoutReview,
    dialog,
    smartPublish,
    publishOthers: publishesOthers(contributed, languages)
      ? publishOthers
      : undefined,
    notice: (
      <OutOfDateNotice
        notice={outOfDate.notice}
        onDismiss={outOfDate.dismiss}
        // A band across the editor, as the document's other banners are drawn.
        className="rounded-none border-x-0 border-t-0 px-6"
      />
    ),
  };
}
