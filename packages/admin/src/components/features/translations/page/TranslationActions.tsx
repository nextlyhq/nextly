"use client";

/**
 * What can be done with the language being written: save it, publish it, take
 * it offline. Each follows its own right, so a reader who may publish and not
 * write is still offered Publish.
 *
 * Publishing with unsaved work saves it first, where that save changes nothing
 * readers see. Where it would, or might, the work is saved by Save, whose own
 * sentence says so. A save that does not go through opens nothing.
 *
 * @module components/features/translations/page/TranslationActions
 */

import { useQueryClient } from "@tanstack/react-query";
import { useId, useRef, useState, type JSX, type RefObject } from "react";

import { Button, toast } from "@admin/components/ui";
import type { PartsTarget } from "@admin/hooks/queries/usePublishParts";
import { singleDocumentKeys } from "@admin/hooks/queries/useSingles";
import { useCan } from "@admin/hooks/useCan";
import type { ShownCopy } from "@admin/lib/document-version";
import { entryKeys } from "@admin/services/entryApi";
import { versionApi, type VersionScope } from "@admin/services/versionApi";

import {
  hasSomethingToPublish,
  holdsStrandedDraft,
  offlineApplies,
  publishApplies,
  saveReach,
  saveReachSentence,
  type DraftRules,
  type LanguageStanding,
} from "./language-standing";
import {
  offlineMessage,
  publishedMessage,
  type LabelOf,
} from "./publish-language-words";
import { PublishLanguageDialog } from "./PublishLanguageDialog";
import type { EmptyField } from "./reader-preview";
import { TakeLanguageOfflineDialog } from "./TakeLanguageOfflineDialog";
import type { TranslationForm } from "./useTranslationForm";

export interface TranslationActionsProps {
  document: PartsTarget;
  /** The document's own id, which a Single's address does not carry. */
  documentId: string;
  language: { code: string; label: string };
  defaultLocale: string;
  labelOf: LabelOf;
  rules: DraftRules;
  standing: LanguageStanding;
  /** The other languages a first publish shows; see `languagesGoingLiveToo`. */
  goingLiveToo: readonly string[] | undefined;
  /** Whether the reader may not write here. */
  readOnly: boolean;
  /** Whether nothing of the document may be written at all. */
  removed: boolean;
  editing: Pick<
    TranslationForm,
    "isDirty" | "isSaving" | "save" | "startedFrom"
  >;
  /** The fields the language leaves empty, asked as the dialog is drawn. */
  emptyFields: () => EmptyField[];
  /** Read the language again. */
  reload: () => Promise<unknown>;
}

/**
 * Focus as a dialog closes: back on what opened it, or on the actions where
 * the action is gone, as Take offline is once the language is.
 */
function useReturnFocus(): {
  actions: RefObject<HTMLDivElement | null>;
  onCloseAutoFocus: (event: Event) => void;
  opening: () => void;
} {
  const actions = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  return {
    actions,
    opening: () => {
      const active = globalThis.document.activeElement;
      opener.current = active instanceof HTMLElement ? active : null;
    },
    onCloseAutoFocus: event => {
      event.preventDefault();
      const back = opener.current;
      // Not `isConnected` alone: the body is connected, and is where focus
      // falls when the opener is gone.
      const usable = back?.isConnected === true && back.matches("button");
      (usable ? back : actions.current)?.focus();
    },
  };
}

function scopeOf(document: PartsTarget, documentId: string): VersionScope {
  return document.kind === "collection"
    ? { kind: "collection", slug: document.slug, entryId: document.id }
    : { kind: "single", slug: document.slug, documentId };
}

/** Why Publish or Take offline waits for what is unsaved; undefined if neither does. */
function waitingSentence({
  isDirty,
  readOnly,
  publishWaits,
  offlineWaits,
  language,
}: {
  isDirty: boolean;
  readOnly: boolean;
  publishWaits: boolean;
  offlineWaits: boolean;
  language: string;
}): string | undefined {
  if (!isDirty || (!publishWaits && !offlineWaits)) return undefined;
  if (readOnly) {
    return "Your unsaved changes can't be saved any more. Reload the page to go on.";
  }
  if (!publishWaits) {
    return `Save your changes before taking ${language} offline.`;
  }
  return offlineWaits
    ? `Save your changes before publishing ${language} or taking it offline.`
    : `Save your changes before publishing ${language}.`;
}

export function TranslationActions({
  document,
  documentId,
  language,
  defaultLocale,
  labelOf,
  rules,
  standing,
  goingLiveToo,
  readOnly,
  removed,
  editing,
  emptyFields,
  reload,
}: TranslationActionsProps): JSX.Element {
  const mayPublish = useCan(`publish-${document.slug}`);
  const mayUnpublish = useCan(`unpublish-${document.slug}`);
  const { actions, opening, onCloseAutoFocus } = useReturnFocus();
  // Each opening is a dialog of its own, with no answer left from the last.
  const [openings, setOpenings] = useState(0);
  const [asked, setAsked] = useState<"publish" | "offline" | null>(null);
  const noteId = useId();
  const heldId = useId();
  const { isDirty, isSaving, save, startedFrom } = editing;

  const queryClient = useQueryClient();
  const reach = saveReach(rules, standing);
  // Publish saves first only what no reader is shown by that save.
  const savesFirst = isDirty && !readOnly && reach === "nobody";
  const offersPublish =
    !removed && mayPublish && publishApplies(rules, standing);
  const offersOffline =
    !removed && mayUnpublish && offlineApplies(rules, standing);
  const canPublishNow =
    hasSomethingToPublish(standing, isDirty) &&
    !isSaving &&
    (!isDirty || savesFirst);
  const note = readOnly
    ? undefined
    : saveReachSentence(reach, rules, language.label);
  const waiting = waitingSentence({
    isDirty,
    readOnly,
    publishWaits: offersPublish && !savesFirst,
    offlineWaits: offersOffline,
    language: language.label,
  });

  const shown = (): ShownCopy => ({
    version: startedFrom(),
    locale: language.code,
    draft: rules.readsDraft,
  });
  const ask = (what: "publish" | "offline") => {
    setOpenings(count => count + 1);
    setAsked(what);
  };
  const askToPublish = async (): Promise<void> => {
    if (!canPublishNow) return;
    opening();
    if (savesFirst && !(await save())) return;
    ask("publish");
  };
  const takeLiveValues = async (): Promise<void> => {
    let read: unknown;
    try {
      await versionApi.takeLiveSharedValues(
        scopeOf(document, documentId),
        language.code,
        startedFrom()
      );
    } finally {
      // Read again either way: an answer can be lost after the values were
      // taken, and the page would go on from the ones they replaced.
      void queryClient.invalidateQueries({
        queryKey:
          document.kind === "collection"
            ? entryKeys.detail(document.slug, document.id)
            : singleDocumentKeys.detail(document.slug),
      });
      read = await reload();
    }
    if (read === undefined) {
      throw new Error(
        "The live values were taken, but they couldn't be loaded."
      );
    }
  };
  // Said before the language is read again, so a read that fails can't hide
  // that it was done; read before the dialog closes, so what is written next
  // is written from what the move left.
  const settled = async (message: string): Promise<void> => {
    toast.success(message);
    await reload();
  };

  return (
    <div className="flex flex-col gap-2 sm:items-end">
      <div
        ref={actions}
        role="group"
        aria-label={`${language.label} actions`}
        tabIndex={-1}
        className="flex flex-wrap items-center gap-2"
      >
        {offersOffline ? (
          <Button
            type="button"
            variant="outline"
            disabled={isDirty || isSaving}
            aria-describedby={waiting === undefined ? undefined : heldId}
            onClick={() => {
              opening();
              ask("offline");
            }}
          >
            Take offline
          </Button>
        ) : null}
        {readOnly ? null : (
          <Button
            type="button"
            variant={offersPublish ? "outline" : "default"}
            data-slot="translation-save"
            disabled={!isDirty || isSaving}
            aria-describedby={note === undefined ? undefined : noteId}
            onClick={() => void save()}
          >
            {isSaving ? "Saving…" : `Save ${language.label}`}
          </Button>
        )}
        {offersPublish ? (
          <Button
            type="button"
            // Not `disabled`, which would drop focus while the save it starts
            // is on its way.
            aria-disabled={!canPublishNow}
            aria-describedby={isDirty && !savesFirst ? heldId : undefined}
            className="aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
            onClick={() => void askToPublish()}
          >
            Publish {language.label}
          </Button>
        ) : null}
      </div>
      {note === undefined ? null : (
        <p
          id={noteId}
          data-slot="translation-save-reach"
          className="max-w-md text-sm text-muted-foreground sm:text-right"
        >
          {note}
        </p>
      )}
      {!removed && holdsStrandedDraft(rules, standing) ? (
        <p className="max-w-md text-sm text-muted-foreground sm:text-right">
          {language.label} holds a draft from before drafts stopped being kept
          here. It can&apos;t be published.
        </p>
      ) : null}
      {waiting === undefined ? null : (
        <p id={heldId} className="text-sm text-muted-foreground">
          {waiting}
        </p>
      )}
      {openings > 0 ? (
        <PublishLanguageDialog
          key={`publish-${openings}`}
          open={asked === "publish"}
          onOpenChange={open => {
            if (!open) setAsked(null);
          }}
          target={document}
          language={language}
          labelOf={labelOf}
          empty={asked === "publish" ? emptyFields() : []}
          goingLiveToo={goingLiveToo}
          shown={shown}
          takeLiveValues={readOnly ? undefined : takeLiveValues}
          onFailed={reload}
          onPublished={result =>
            settled(
              publishedMessage({
                result,
                language: language.label,
                defaultLocale,
                goingLiveToo,
                labelOf,
              })
            )
          }
          onCloseAutoFocus={onCloseAutoFocus}
        />
      ) : null}
      {openings > 0 ? (
        <TakeLanguageOfflineDialog
          key={`offline-${openings}`}
          open={asked === "offline"}
          onOpenChange={open => {
            if (!open) setAsked(null);
          }}
          target={document}
          language={language}
          shown={shown}
          onFailed={reload}
          onTakenOffline={() =>
            settled(offlineMessage(language.label, labelOf(defaultLocale)))
          }
          onCloseAutoFocus={onCloseAutoFocus}
        />
      ) : null}
    </div>
  );
}
