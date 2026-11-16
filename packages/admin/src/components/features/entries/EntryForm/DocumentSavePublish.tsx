"use client";

/**
 * The document's Save and Publish as a builder-density pair that says the
 * document's state on its own controls: Save reads "Save", "Saving…",
 * "Retry save" or "✓ Saved", and Publish reads "Publish", "Publish
 * changes", "Publishing…", "Published" or "Scheduled", with its arrow
 * keeping the other ways to publish and Unpublish.
 *
 * Drawn BY THE ADMIN from the same model as the entry header (the document
 * actions, their reasons, the one save state), for a full-window surface
 * that replaces the header, so the two can't come to disagree. The entry
 * header keeps its own arrangement.
 *
 * Nothing else needs to repeat the state beside it: a pill beside it says
 * only where the document is in its life (`useDocumentLifeStage`).
 *
 * @module components/features/entries/EntryForm/DocumentSavePublish
 */
import {
  Button,
  Popover,
  PopoverAnchor,
  PopoverContent,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@nextlyhq/ui";
import {
  forwardRef,
  useEffect,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type JSX,
  type ReactNode,
} from "react";

import { AlertTriangle, Check, Loader2 } from "@admin/components/icons";
import { useReleasesContaining } from "@admin/hooks/queries/useReleasesContaining";
import { useCan } from "@admin/hooks/useCan";
import { useKeyboardShortcuts } from "@admin/hooks/useKeyboardShortcuts";
import { cn } from "@admin/lib/utils";
import type { Release, ReleaseDocumentRef } from "@admin/types/releases";

import {
  ActionOptionsMenu,
  COMPACT_MENU_CLASS,
  compactRows,
  DOCUMENT_OPTIONS_LABEL,
  PUBLISH_OPTIONS_LABEL,
  type ActionBinding,
} from "./DocumentActionBar";
import {
  useDocumentActionsContext,
  useHostedStored,
  useSaveChipDrawn,
} from "./DocumentActionsContext";
import { useDocumentIdentity } from "./EntryFormContext";
import {
  LIFE_STAGE_LABEL,
  lifeStage,
  type LifeStage,
} from "./panels/pill-state";
import { useHostedRecoveryOffer } from "./RecoveryOfferContext";
import {
  LAST_VISIT_NOTICE,
  NOTHING_TO_SAVE,
  goesLiveText,
  publishButtonView,
  publishShown,
  saveButtonView,
  type PublishButtonView,
  type SaveButtonView,
  type ScheduledPublish,
} from "./save-publish-state";
import { LastVisitChip, RecoveryOfferChip } from "./SaveStateIndicator";
import {
  NOTHING_CHANGED_REASON,
  type DocumentActionBindings,
} from "./useDocumentActionBindings";

/**
 * The soonest publication of this document set for later, from the
 * scheduled releases holding it: the same read, under the same key, as the
 * document's scheduled-release banner, so asking it here sends nothing more.
 * A release that takes the document down is not a publication. Null where
 * none is scheduled, or where the reader may not read releases.
 */
export function useScheduledPublish(): ScheduledPublish | null {
  const identity = useDocumentIdentity();
  const canRead = useCan("read-content-releases");
  const document: ReleaseDocumentRef | undefined =
    identity?.documentId === undefined
      ? undefined
      : {
          scopeKind: identity.kind,
          scopeSlug: identity.slug,
          entryId: identity.documentId,
        };
  const { data } = useReleasesContaining(document, canRead);
  return soonestPublish(data?.items ?? []);
}

/** The soonest scheduled release that publishes the document, if any. */
export function soonestPublish(
  releases: readonly Release[]
): ScheduledPublish | null {
  let soonest: Date | null = null;
  for (const release of releases) {
    if (release.state !== "scheduled" || release.memberAction !== "publish") {
      continue;
    }
    if (release.scheduledAt === null) continue;
    const at = new Date(release.scheduledAt);
    if (Number.isNaN(at.getTime())) continue;
    if (soonest === null || at < soonest) soonest = at;
  }
  return soonest === null ? null : { at: soonest };
}

/** Where the document is in its life, for a pill beside the pair. */
export interface DocumentLifeStage {
  stage: LifeStage;
  /** What the stage is called. */
  label: string;
  /** When a scheduled publication goes live, in words; absent otherwise. */
  detail?: string;
}

/**
 * Where the document is in its life (Draft, Published or Scheduled), from
 * its lifecycle status and its scheduled publications, never from its work:
 * unsaved work is the Save button's to say, and a live page that is behind
 * is the Publish button's. Null outside a document editor, and where the
 * collection has no lifecycle.
 */
export function useDocumentLifeStage(): DocumentLifeStage | null {
  const hosted = useDocumentActionsContext();
  const scheduled = useScheduledPublish();
  if (hosted === null || !hosted.lifecycle.hasStatus) return null;
  const stage = lifeStage(hosted.lifecycle.status, scheduled !== null);
  return {
    stage,
    label: LIFE_STAGE_LABEL[stage],
    ...(stage === "scheduled" && scheduled !== null
      ? { detail: goesLiveText(scheduled.at) }
      : {}),
  };
}

/**
 * The document's Save and, where the collection keeps drafts and this
 * person may publish, its Publish split button beside it. Elsewhere Save
 * leads alone, with its arrow holding what a compact bar keeps there.
 * Nothing outside a document editor.
 */
export function DocumentSaveAndPublish(): JSX.Element | null {
  const hosted = useDocumentActionsContext();
  if (hosted === null) return null;
  return <HostedSaveAndPublish hosted={hosted} />;
}

/** A failure the pair says in its notice, with its Retry when it has one. */
interface Failure {
  title: "Not saved" | "Not published";
  reason: string;
  retry: (() => void) | undefined;
}

function HostedSaveAndPublish({
  hosted,
}: {
  hosted: DocumentActionBindings;
}): JSX.Element {
  const stored = useHostedStored();
  const offer = useHostedRecoveryOffer();
  const scheduled = useScheduledPublish();
  // Drawn, so the document's Save keeps changes from the last visit while
  // they wait: the Save button makes that offer.
  useSaveChipDrawn();

  const { saveState, lifecycle } = hosted;
  const save = saveButtonView({
    saveState,
    storingAction: hosted.storingAction,
    failedAction: hosted.failedAction,
    dirty: hosted.dirty,
    writesPending: hosted.writesPending,
    pendingRecovery: hosted.keepsOffer,
    savedAt:
      (saveState.kind === "saved" ? saveState.at : null) ??
      hosted.lastStoredAt ??
      stored?.at ??
      null,
  });
  const withPublish = publishShown(lifecycle);
  const publish = withPublish
    ? publishButtonView({
        lifecycle,
        dirty: hosted.dirty,
        storingAction: hosted.storingAction,
        scheduled,
      })
    : null;
  const failure = failureOf(hosted);
  // Absent where this person may not change the document: nothing then
  // claims to save it.
  const canSave =
    hosted.bindings.save !== undefined &&
    hosted.actions.some(action => action.id === "save");
  const held = saveHeld(hosted);

  const runSave = () => {
    void (saveState.kind === "failed" && saveState.retry !== undefined
      ? saveState.retry()
      : hosted.run("save"));
  };

  // ⌘S on a document with nothing to save: said, politely, rather than
  // silently declined. The document's own shortcut saves where there is.
  const [nothingToSave, setNothingToSave] = useState(0);
  useKeyboardShortcuts(
    [
      {
        key: "s",
        ctrl: true,
        action: () => setNothingToSave(count => count + 1),
        description: "Save",
        when: () => canSave && save.kind === "saved",
        whenTyping: true,
      },
    ],
    { name: "document-nothing-to-save" }
  );

  const { options, danger } = compactRows(hosted.actions, bindingsOf(hosted), {
    withToolbar: false,
  });
  // An arrow only where it has a row to hold: one that opens empty reads
  // as broken.
  const hasRows = options.length + danger.length > 0;
  const saveLeads = !withPublish;
  const saveArrow =
    saveLeads && hasRows ? (
      <ActionOptionsMenu
        options={options}
        dangerOptions={danger}
        optionsLabel={DOCUMENT_OPTIONS_LABEL}
        menuClassName={COMPACT_MENU_CLASS}
        triggerClassName={
          save.kind === "save" || save.kind === "retry"
            ? undefined
            : ARROW_QUIET
        }
      />
    ) : null;

  return (
    <FailureNotice failure={failure}>
      <div
        className="flex shrink-0 items-center gap-1.5"
        data-testid="document-save-publish"
      >
        {offer !== null && hosted.dirty ? (
          // Changes from the last visit, after an edit since: Save stores
          // the edit, and the offer to put them back is here.
          <RecoveryOfferChip label="Earlier changes" offer={offer} />
        ) : null}
        <div className="flex items-center">
          {!canSave ? null : save.kind === "offered" && offer !== null ? (
            <LastVisitChip
              label={save.label}
              offer={offer}
              save={{
                run: () => {
                  void hosted.run("save");
                },
                ...(hosted.bindings.save?.disabledReason === undefined
                  ? {}
                  : { disabledReason: hosted.bindings.save.disabledReason }),
              }}
              trigger={
                <SaveButton
                  view={save}
                  leads={saveLeads}
                  joined={saveArrow !== null}
                />
              }
            />
          ) : (
            <WithTooltip tooltip={held ?? tooltipOf(save)}>
              <SaveButton
                view={save}
                leads={saveLeads}
                joined={saveArrow !== null}
                held={held}
                onPress={runSave}
              />
            </WithTooltip>
          )}
          {saveArrow}
        </div>
        {publish === null ? null : (
          <div className="flex items-center" data-publish-split="">
            <WithTooltip tooltip={tooltipOf(publish)}>
              <PublishButton
                view={publish}
                onPress={() => {
                  void hosted.publishLatest?.();
                }}
                reason={publishReason(hosted)}
                joined={hasRows}
              />
            </WithTooltip>
            {hasRows ? (
              <ActionOptionsMenu
                options={options}
                dangerOptions={danger}
                optionsLabel={PUBLISH_OPTIONS_LABEL}
                menuClassName={COMPACT_MENU_CLASS}
              />
            ) : null}
          </div>
        )}
        <PairLiveRegions
          save={save}
          publish={publish}
          failure={failure}
          nothingToSave={nothingToSave}
        />
      </div>
    </FailureNotice>
  );
}

/** The arrow beside a quiet Save that leads: no fill, as Save has none. */
const ARROW_QUIET =
  "border-input border-l-input bg-transparent text-foreground hover:bg-muted";

/** The host's bindings in the compact bar's shape: each runs through `run`. */
function bindingsOf(
  hosted: DocumentActionBindings
): Record<string, ActionBinding | undefined> {
  const bindings: Record<string, ActionBinding | undefined> = {};
  for (const [id, binding] of Object.entries(hosted.bindings)) {
    if (binding === undefined) continue;
    bindings[id] = {
      onSelect: () => {
        void hosted.run(id);
      },
      ...(binding.disabledReason === undefined
        ? {}
        : { disabledReason: binding.disabledReason }),
    };
  }
  return bindings;
}

/**
 * Why Publish can't run now, where it can't: the offered Publish's own
 * reason (its permission, a colleague's lock, a store under way, errors on
 * the page), or that nothing here can publish what is on screen.
 */
function publishReason(hosted: DocumentActionBindings): string | undefined {
  if (hosted.publishLatest === undefined) return CANT_PUBLISH;
  const offered = hosted.actions.find(action => action.id === "publish");
  return offered?.disabledReason ?? hosted.bindings.publish?.disabledReason;
}

/** Why Publish is held where nothing here can publish the page. */
const CANT_PUBLISH = "This page can't be published from here.";

/**
 * Why Save can't run now, where it could otherwise: a colleague's lock,
 * errors on the page. Not "nothing has changed" or a store under way, which
 * its own states ("✓ Saved", "Saving…") already say.
 */
function saveHeld(hosted: DocumentActionBindings): string | undefined {
  const reason = hosted.bindings.save?.disabledReason;
  if (reason === NOTHING_CHANGED_REASON || reason === SAVING_REASON) {
    return undefined;
  }
  return reason;
}

/** The reason the model holds a store with while another runs. */
const SAVING_REASON = "Saving…";

/** What the failure the save state reports says, in the pair's notice. */
function failureOf(hosted: DocumentActionBindings): Failure | null {
  const { saveState } = hosted;
  if (saveState.kind !== "failed") return null;
  // A failed publish is tried again as Publish runs it: the publish of a
  // live page's edits is not an action `run` offers by name.
  const retry =
    hosted.failedAction === "publish" ? hosted.publishLatest : saveState.retry;
  return {
    title: hosted.failedAction === "publish" ? "Not published" : "Not saved",
    reason: saveState.message,
    retry:
      retry === undefined
        ? undefined
        : () => {
            void retry();
          },
  };
}

/** A view's tooltip, where it has one. */
function tooltipOf(view: SaveButtonView | PublishButtonView): string | null {
  return "tooltip" in view ? view.tooltip : null;
}

/** A control's tooltip, opened by pointer and by keyboard focus alike. */
function WithTooltip({
  tooltip,
  children,
}: {
  tooltip: string | null;
  children: ReactNode;
}): JSX.Element {
  if (tooltip === null) return <>{children}</>;
  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        <TooltipContent side="bottom" align="end">
          <p>{tooltip}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/**
 * An inert state: it keeps its place in the Tab order (`aria-disabled`, not
 * `disabled`), so its tooltip, which says when, can be read by keyboard.
 */
const INERT = "aria-disabled:cursor-default aria-disabled:hover:opacity-100";

/** The Save button in each of its states; see `saveButtonView`. */
const SaveButton = forwardRef<
  HTMLButtonElement,
  {
    view: SaveButtonView;
    /** Whether it leads alone, drawn as the leading action. */
    leads: boolean;
    /** Whether an arrow is joined to it. */
    joined: boolean;
    /** Why it can't save now, where it otherwise would. */
    held?: string | undefined;
    onPress?: () => void;
  } & ComponentPropsWithoutRef<"button">
>(function SaveButton(
  { view, leads, joined, held, onPress, onClick, ...trigger },
  ref
) {
  // Changes from the last visit still open their offer while Save is held:
  // Discard stays the author's, and the offer's Save says why it waits.
  const acts =
    view.kind === "offered" ||
    ((view.kind === "save" || view.kind === "retry") && held === undefined);
  const quiet = view.kind === "saved" || view.kind === "saving";
  return (
    <Button
      ref={ref}
      type="button"
      size="sm"
      variant={leads && !quiet ? "default" : "outline"}
      data-action="save"
      data-state-kind={view.kind}
      {...trigger}
      aria-disabled={acts ? undefined : true}
      aria-busy={view.kind === "saving" ? true : undefined}
      {...(held === undefined || view.kind === "offered"
        ? {}
        : { "aria-description": held })}
      className={cn(
        "gap-1.5",
        INERT,
        quiet && "text-muted-foreground hover:bg-transparent",
        joined && "rounded-r-none",
        trigger.className
      )}
      onClick={event => {
        if (!acts) {
          event.preventDefault();
          return;
        }
        onPress?.();
        // A trigger's own handler (the offer's popover opens on it).
        onClick?.(event);
      }}
    >
      <SaveMark view={view} />
      {view.label}
    </Button>
  );
});

/** The mark before Save's words: a spinner, a warning or a tick. */
function SaveMark({ view }: { view: SaveButtonView }): JSX.Element | null {
  switch (view.kind) {
    case "saving":
      return <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />;
    case "retry":
      return (
        <AlertTriangle
          className="size-3.5 text-danger-text"
          aria-hidden="true"
        />
      );
    case "saved":
      return <Check className="size-3.5" aria-hidden="true" />;
    default:
      return null;
  }
}

/** The Publish split's press in each of its states; see `publishButtonView`. */
const PublishButton = forwardRef<
  HTMLButtonElement,
  {
    view: PublishButtonView;
    onPress: () => void;
    /** Why it can't run now, where it can't. */
    reason: string | undefined;
    /** Whether its arrow is joined to it. */
    joined: boolean;
  } & ComponentPropsWithoutRef<"button">
>(function PublishButton(
  { view, onPress, reason, joined, onClick, ...trigger },
  ref
) {
  const acts = view.kind === "publish" || view.kind === "publish-changes";
  const held = acts && reason !== undefined;
  return (
    <Button
      ref={ref}
      type="button"
      size="sm"
      data-action="publish"
      data-primary="true"
      data-state-kind={view.kind}
      {...trigger}
      aria-disabled={!acts || held ? true : undefined}
      aria-busy={view.kind === "publishing" ? true : undefined}
      {...(held ? { "aria-description": reason } : {})}
      className={cn(
        "gap-1.5",
        INERT,
        joined && "rounded-r-none",
        trigger.className
      )}
      onClick={event => {
        if (!acts || held) {
          event.preventDefault();
          return;
        }
        onPress();
        onClick?.(event);
      }}
    >
      {view.kind === "publishing" ? (
        <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
      ) : null}
      {view.label}
    </Button>
  );
});

/**
 * A failed save or publish, said where it happened: a notice under the pair
 * with the reason and Retry, opened without taking focus from the editor
 * (the assertive announcement has already told a screen reader). It closes
 * on its own once the failure is over.
 */
function FailureNotice({
  failure,
  children,
}: {
  failure: Failure | null;
  children: ReactNode;
}): JSX.Element {
  const identity =
    failure === null ? null : `${failure.title}\u0000${failure.reason}`;
  const [dismissed, setDismissed] = useState<string | null>(null);
  const open = identity !== null && identity !== dismissed;
  return (
    <Popover
      open={open}
      onOpenChange={next => {
        if (!next) setDismissed(identity);
      }}
    >
      <PopoverAnchor asChild>{children}</PopoverAnchor>
      <PopoverContent
        align="end"
        className="w-72 text-sm"
        data-testid="document-save-publish-notice"
        onOpenAutoFocus={event => event.preventDefault()}
      >
        {failure === null ? null : (
          <>
            <p className="font-medium text-foreground">{failure.title}</p>
            <p className="mt-1 text-muted-foreground">{failure.reason}</p>
            {failure.retry === undefined ? null : (
              <div className="mt-3 flex justify-end">
                <Button
                  type="button"
                  size="sm"
                  onClick={() => {
                    setDismissed(identity);
                    failure.retry?.();
                  }}
                >
                  Retry
                </Button>
              </div>
            )}
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}

/**
 * The pair's spoken status. Settled states politely, once each time one is
 * reached ("Saved", "Published", changes from the last visit waiting, and
 * ⌘S with nothing to save); a failure assertively, with its reason; and
 * "Saving…" and "Publishing…" not at all, since where they come to rest is
 * what matters.
 */
function PairLiveRegions({
  save,
  publish,
  failure,
  nothingToSave,
}: {
  save: SaveButtonView;
  publish: PublishButtonView | null;
  failure: Failure | null;
  nothingToSave: number;
}): JSX.Element {
  const [polite, setPolite] = useState<{ text: string; n: number }>({
    text: "",
    n: 0,
  });
  const say = (text: string) => setPolite(last => ({ text, n: last.n + 1 }));
  const before = useRef<{ save: string; publish: string | null } | null>(null);

  const saveKind = save.kind;
  const publishKind = publish?.kind ?? null;
  useEffect(() => {
    const last = before.current;
    before.current = { save: saveKind, publish: publishKind };
    if (last === null) {
      // On open, only what the author has to decide about.
      if (saveKind === "offered") say(LAST_VISIT_NOTICE);
      return;
    }
    if (publishKind === "published" && last.publish === "publishing") {
      say("Published");
    } else if (saveKind === "saved" && last.save !== "saved") {
      say("Saved");
    } else if (saveKind === "offered" && last.save !== "offered") {
      say(LAST_VISIT_NOTICE);
    }
  }, [saveKind, publishKind]);

  useEffect(() => {
    if (nothingToSave > 0) say(NOTHING_TO_SAVE);
  }, [nothingToSave]);

  const assertive =
    failure === null ? "" : `${failure.title}. ${failure.reason}`;
  return (
    <>
      <span
        role="status"
        aria-live="polite"
        className="sr-only"
        data-testid="document-save-publish-status"
      >
        {/* Keyed by each saying, so the same words said again are new. */}
        <span key={polite.n}>{polite.text}</span>
      </span>
      <span
        aria-live="assertive"
        className="sr-only"
        data-testid="document-save-publish-failure"
      >
        {assertive}
      </span>
    </>
  );
}
