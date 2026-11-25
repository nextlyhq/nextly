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
import {
  useId,
  useRef,
  useState,
  type JSX,
  type ReactNode,
  type RefObject,
} from "react";

import type { NarrowMenuItem } from "@admin/components/features/entries/EntryForm/DocumentActionBar";
import { StepRefusalNote } from "@admin/components/features/entries/review/StepRefusalNote";
import {
  TopBarPlace,
  useInTopBar,
  useTopBarWidth,
} from "@admin/components/layout/header/TopBarPlaces";
import { toast } from "@admin/components/ui";
import type { PartsTarget } from "@admin/hooks/queries/usePublishParts";
import { singleDocumentKeys } from "@admin/hooks/queries/useSingles";
import { useCan } from "@admin/hooks/useCan";
import type { ShownCopy } from "@admin/lib/document-version";
import { entryKeys } from "@admin/services/entryApi";
import { versionApi, type VersionScope } from "@admin/services/versionApi";

import { TranslationHeaderActions } from "../workflow/TranslationHeaderActions";
import type { TranslationReview } from "../workflow/useTranslationReview";

import { languageActions, type LanguageActions } from "./language-actions";
import type { DraftRules, LanguageStanding } from "./language-standing";
import { LanguageActionButtons } from "./LanguageActionButtons";
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
  /** Where the language stands in the workflow that holds its publishing. */
  review: TranslationReview;
  /** Whether a past version is on screen, which forbids every write. */
  readingHistory: boolean;
  /** What is drawn around the actions: History, and a version's own actions. */
  around: (actions: ReactNode) => ReactNode;
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

/** The document, as its versions are addressed. */
export function scopeOf(
  document: PartsTarget,
  documentId: string
): VersionScope {
  return document.kind === "collection"
    ? { kind: "collection", slug: document.slug, entryId: document.id }
    : { kind: "single", slug: document.slug, documentId };
}

function detailKey(document: PartsTarget): readonly unknown[] {
  return document.kind === "collection"
    ? entryKeys.detail(document.slug, document.id)
    : singleDocumentKeys.detail(document.slug);
}

/** Takes the live values into the language's changes, and reads what it left. */
function useTakeLiveValues({
  document,
  documentId,
  language,
  editing,
  reload,
}: TranslationActionsProps): () => Promise<void> {
  const queryClient = useQueryClient();
  return async () => {
    let read: unknown;
    try {
      await versionApi.takeLiveSharedValues(
        scopeOf(document, documentId),
        language.code,
        editing.startedFrom()
      );
    } finally {
      // Read again either way: an answer can be lost after the values were
      // taken, and the page would go on from the ones they replaced.
      void queryClient.invalidateQueries({ queryKey: detailKey(document) });
      read = await reload();
    }
    if (read === undefined) {
      throw new Error(
        "The live values were taken, but they couldn't be loaded."
      );
    }
  };
}

/** The language's actions where a workflow holds it: its own step leads. */
function ReviewedActions({
  can,
  onPublish,
  onTakeOffline,
  ...props
}: TranslationActionsProps & {
  can: LanguageActions;
  onPublish: () => void;
  onTakeOffline: () => void;
}): JSX.Element {
  const { language, rules, standing, readOnly, removed, review } = props;
  const { editing, editorHref, readingHistory } = props;
  const { isDirty, isSaving, save } = editing;
  // What the page offers beside the workflow's actions, on the same menu.
  const rows: NarrowMenuItem[] = [
    ...(can.offersOffline
      ? [
          {
            id: "take-offline",
            label: "Take offline…",
            disabled: isDirty || isSaving || readingHistory,
            onSelect: onTakeOffline,
          },
        ]
      : []),
    {
      id: "open-in-editor",
      label: "Open in editor",
      href: editorHref,
      onSelect: () => undefined,
    },
  ];
  return (
    <TranslationHeaderActions
      facts={{
        languageLabel: language.label,
        hasStatus: rules.hasStatus,
        holdsDrafts: rules.holdsDrafts,
        status: standing.published === true ? "published" : "draft",
        pendingChange: standing.pending === true,
        canEdit: !readOnly,
        canPublish: can.main === "publish",
        isDirty,
        readingHistory,
        writesRefused: removed,
      }}
      review={review}
      isSaving={isSaving}
      onSave={() => void save()}
      onPublish={onPublish}
      publishReason={isDirty ? can.waiting : undefined}
      rows={rows}
    />
  );
}

/** Draws the buttons in the top bar, or on the page where it has no room. */
function ActionPlace({ children }: { children: ReactNode }): JSX.Element {
  const room = useTopBarWidth();
  const inBar = useInTopBar() && room !== null && room >= BAR_ROOM;
  return inBar ? (
    <TopBarPlace name="end">{children}</TopBarPlace>
  ) : (
    <>{children}</>
  );
}

/** What there is to say of the actions. */
function ActionNotes({
  language,
  can,
  noteId,
  waitingId,
}: {
  language: string;
  can: LanguageActions;
  noteId: string;
  waitingId: string;
}): JSX.Element {
  const look = "text-sm text-muted-foreground";
  return (
    <>
      {can.note === undefined ? null : (
        <p id={noteId} data-slot="translation-save-reach" className={look}>
          {can.note}
        </p>
      )}
      {can.stranded ? (
        <p className={look}>
          {language} holds a draft from before drafts stopped being kept here.
          It can&apos;t be published.
        </p>
      ) : null}
      {can.waiting === undefined ? null : (
        <p id={waitingId} className={look}>
          {can.waiting}
        </p>
      )}
    </>
  );
}

/** Which dialog is open, each opening one of its own. */
interface Asking {
  asked: "publish" | "offline" | null;
  openings: number;
  ask: (what: "publish" | "offline") => void;
  close: () => void;
}

function useAsking(): Asking {
  const [openings, setOpenings] = useState(0);
  const [asked, setAsked] = useState<Asking["asked"]>(null);
  return {
    asked,
    openings,
    ask: what => {
      setOpenings(count => count + 1);
      setAsked(what);
    },
    close: () => setAsked(null),
  };
}

/** The dialogs, once one has been asked for. */
function ActionDialogs({
  asking,
  onCloseAutoFocus,
  ...props
}: TranslationActionsProps & {
  asking: Asking;
  onCloseAutoFocus: (event: Event) => void;
}): JSX.Element | null {
  const { document, language, labelOf, defaultLocale, rules } = props;
  const { goingLiveToo, reload, readOnly, editing } = props;
  const takeLiveValues = useTakeLiveValues(props);
  const { asked, openings, close } = asking;
  if (openings === 0) return null;

  const shown = (): ShownCopy => ({
    version: editing.startedFrom(),
    locale: language.code,
    draft: rules.readsDraft,
  });
  // Said before the language is read again, so a read that fails can't hide
  // that it was done; read before the dialog closes, so what is written next
  // is written from what the move left.
  const settled = async (message: string): Promise<void> => {
    toast.success(message);
    await reload();
  };
  const shared = {
    target: document,
    language,
    shown,
    onFailed: reload,
    onCloseAutoFocus,
    onOpenChange: (open: boolean) => {
      if (!open) close();
    },
  };
  return (
    <>
      <PublishLanguageDialog
        key={`publish-${openings}`}
        {...shared}
        open={asked === "publish"}
        labelOf={labelOf}
        empty={asked === "publish" ? props.emptyFields() : []}
        goingLiveToo={goingLiveToo}
        takeLiveValues={readOnly ? undefined : takeLiveValues}
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
      />
      <TakeLanguageOfflineDialog
        key={`offline-${openings}`}
        {...shared}
        open={asked === "offline"}
        onTakenOffline={() =>
          settled(offlineMessage(language.label, labelOf(defaultLocale)))
        }
      />
    </>
  );
}

export function TranslationActions(
  props: TranslationActionsProps
): JSX.Element {
  const { document, language, rules, standing, readOnly, removed } = props;
  const { review, around } = props;
  // A workflow holds the language: its step leads, as it does in the editor.
  const inWorkflow = review.binding !== undefined;
  const { isDirty, isSaving, save } = props.editing;
  const can = languageActions({
    language: language.label,
    rules,
    standing,
    mayPublish: useCan(`publish-${document.slug}`),
    mayUnpublish: useCan(`unpublish-${document.slug}`),
    readOnly,
    removed,
    isDirty,
    isSaving,
    inWorkflow,
  });
  const { actions, arrow, opening, onCloseAutoFocus } = useReturnFocus();
  const asking = useAsking();
  const noteId = useId();
  const waitingId = useId();

  const askToPublish = async (): Promise<void> => {
    if (!can.canPublishNow) return;
    opening();
    if (can.savesFirst && !(await save())) return;
    asking.ask("publish");
  };

  return (
    <div className="mb-4 flex flex-col gap-2 empty:mb-0">
      <ActionPlace>
        <LanguageActionButtons
          language={language.label}
          can={can}
          isDirty={isDirty}
          isSaving={isSaving}
          readOnly={readOnly}
          noteId={noteId}
          waitingId={waitingId}
          editorHref={props.editorHref}
          actions={actions}
          arrow={arrow}
          onSave={() => void save()}
          onPublish={() => void askToPublish()}
          onTakeOffline={() => {
            opening(arrow.current);
            asking.ask("offline");
          }}
          reviewed={
            inWorkflow ? (
              <ReviewedActions
                {...props}
                can={can}
                onPublish={() => void askToPublish()}
                onTakeOffline={() => {
                  opening();
                  asking.ask("offline");
                }}
              />
            ) : undefined
          }
          around={around}
        />
      </ActionPlace>
      <ActionNotes
        language={language.label}
        can={can}
        noteId={noteId}
        waitingId={waitingId}
      />
      <StepRefusalNote
        refusal={review.refusal}
        onDismiss={review.clearRefusal}
      />
      <ActionDialogs
        {...props}
        asking={asking}
        onCloseAutoFocus={onCloseAutoFocus}
      />
    </div>
  );
}
