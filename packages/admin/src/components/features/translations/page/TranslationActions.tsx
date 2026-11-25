"use client";

/**
 * What can be done with the language being written: save it, publish it, take
 * it offline. Each follows its own right, so a reader who may publish and not
 * write is still offered Publish.
 *
 * Drawn in the admin's top bar where it has room: the one main button, with
 * what is done less often under its arrow. What there is to say of them stays
 * on the page, beside the work it is about.
 *
 * Publishing with unsaved work saves it first, where that save changes nothing
 * readers see. Where it would, or might, the work is saved by Save, whose own
 * sentence says so. A save that does not go through opens nothing.
 *
 * @module components/features/translations/page/TranslationActions
 */

import { useQueryClient } from "@tanstack/react-query";
import { useId, useRef, useState, type JSX, type RefObject } from "react";

import { ChevronDown } from "@admin/components/icons";
import {
  TopBarPlace,
  useInTopBar,
  useTopBarWidth,
} from "@admin/components/layout/header/TopBarPlaces";
import {
  Button,
  buttonVariants,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  toast,
} from "@admin/components/ui";
import { Link } from "@admin/components/ui/link";
import type { PartsTarget } from "@admin/hooks/queries/usePublishParts";
import { singleDocumentKeys } from "@admin/hooks/queries/useSingles";
import { useCan } from "@admin/hooks/useCan";
import type { ShownCopy } from "@admin/lib/document-version";
import { cn } from "@admin/lib/utils";
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
  /** The document's editor. */
  editorHref: string;
}

/**
 * The room the bar needs for the trail and these beside each other. Narrower,
 * they are drawn on the page, so none of them is past the screen's edge.
 */
const BAR_ROOM = 640;

/**
 * Focus as a dialog closes: back on what opened it, or on the actions where
 * the action is gone, as Take offline is once the language is.
 */
function useReturnFocus(): {
  actions: RefObject<HTMLDivElement | null>;
  /** The arrow, which the menu's own actions are opened from. */
  arrow: RefObject<HTMLButtonElement | null>;
  onCloseAutoFocus: (event: Event) => void;
  opening: (from?: HTMLElement | null) => void;
} {
  const actions = useRef<HTMLDivElement>(null);
  const arrow = useRef<HTMLButtonElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  return {
    actions,
    arrow,
    opening: from => {
      const active = from ?? globalThis.document.activeElement;
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
  editorHref,
}: TranslationActionsProps): JSX.Element {
  const mayPublish = useCan(`publish-${document.slug}`);
  const mayUnpublish = useCan(`unpublish-${document.slug}`);
  const { actions, arrow, opening, onCloseAutoFocus } = useReturnFocus();
  // Asked from the menu, which would otherwise take focus back as it closes.
  const leavingMenu = useRef(false);
  const room = useTopBarWidth();
  const inBar = useInTopBar() && room !== null && room >= BAR_ROOM;
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

  // A draft only where no reader is shown it: anywhere else a save is not one.
  const saveLabel =
    rules.hasStatus && reach === "nobody" ? "Save draft" : "Save";
  const saveButton = (main: boolean) => (
    <Button
      type="button"
      size="sm"
      variant={main ? "default" : "outline"}
      className={main ? "rounded-r-none" : undefined}
      data-slot="translation-save"
      disabled={!isDirty || isSaving}
      aria-describedby={note === undefined ? undefined : noteId}
      onClick={() => void save()}
    >
      {isSaving ? "Saving…" : saveLabel}
    </Button>
  );
  const main: "publish" | "save" | "open" = offersPublish
    ? "publish"
    : readOnly
      ? "open"
      : "save";
  const buttons = (
    <div
      ref={actions}
      role="group"
      aria-label={`${language.label} actions`}
      tabIndex={-1}
      className="flex min-w-0 flex-wrap items-center justify-end gap-2"
    >
      {/* Save beside the main button, where it is not it. */}
      {main === "publish" && !readOnly ? saveButton(false) : null}
      <div className="flex">
        {main === "publish" ? (
          <Button
            type="button"
            size="sm"
            // Not `disabled`, which would drop focus while the save it starts
            // is on its way.
            aria-disabled={!canPublishNow}
            aria-describedby={isDirty && !savesFirst ? heldId : undefined}
            className="rounded-r-none aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
            onClick={() => void askToPublish()}
          >
            Publish {language.label}
          </Button>
        ) : null}
        {main === "save" ? saveButton(true) : null}
        {main === "open" ? (
          <Link
            href={editorHref}
            className={cn(
              buttonVariants({ variant: "outline", size: "sm" }),
              offersOffline && "rounded-r-none"
            )}
          >
            Open in editor
          </Link>
        ) : null}
        {main === "open" && !offersOffline ? null : (
          <DropdownMenu
            // What it opens is modal, and two would hold the page at once.
            modal={false}
          >
            <DropdownMenuTrigger asChild>
              <Button
                ref={arrow}
                type="button"
                size="sm"
                variant={main === "open" ? "outline" : "default"}
                className={cn(
                  "rounded-l-none px-1.5",
                  main === "open"
                    ? "border-l-0"
                    : "border-l-primary-foreground/25"
                )}
                aria-label={`More actions for ${language.label}`}
              >
                <ChevronDown className="h-4 w-4" aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              onCloseAutoFocus={event => {
                if (leavingMenu.current) event.preventDefault();
                leavingMenu.current = false;
              }}
            >
              {offersOffline ? (
                <DropdownMenuItem
                  disabled={isDirty || isSaving}
                  aria-describedby={waiting === undefined ? undefined : heldId}
                  onSelect={() => {
                    leavingMenu.current = true;
                    opening(arrow.current);
                    ask("offline");
                  }}
                >
                  Take offline…
                </DropdownMenuItem>
              ) : null}
              {main === "open" ? null : (
                <DropdownMenuItem asChild>
                  <Link href={editorHref}>Open in editor</Link>
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </div>
  );

  return (
    <div className="mb-4 flex flex-col gap-2 empty:mb-0">
      {inBar ? <TopBarPlace name="end">{buttons}</TopBarPlace> : buttons}
      {note === undefined ? null : (
        <p
          id={noteId}
          data-slot="translation-save-reach"
          className="text-sm text-muted-foreground"
        >
          {note}
        </p>
      )}
      {!removed && holdsStrandedDraft(rules, standing) ? (
        <p className="text-sm text-muted-foreground">
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
