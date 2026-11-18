"use client";

/**
 * Editing the site header or footer in place, wired: the plugin's side of
 * the builder's editing target.
 *
 * The builder edits a region in place given its document and words, and
 * knows nothing of where the region comes from. This is where it comes from:
 * the component a header & footer set names for the area, opened through a
 * session on that component (`useDocumentSession`), which reads its latest
 * version, holds its lock, saves it as a draft or publishes it, and records
 * a recovery point for it, each the admin's own.
 *
 * - **In**: "Edit header" on the region's card, a double-click on the region
 *   or Enter on it while it is selected. The editing starts once the
 *   component is read, its lock is held and its reach is counted; while a
 *   colleague holds it, nothing starts and the author is told who.
 * - **The bar**: "Editing the site header · changes show on N pages", N the
 *   component's reach, the number its own view says, with "Unpublished
 *   changes from <when>" when the version edited is newer than the live one.
 * - **Save and Publish**: the top bar's act on the header ("Save header",
 *   "Publish header"), a publish confirming its reach first. A failure keeps
 *   the editing and the changes, and says so with "Try again". The page's
 *   own Save waits until Done: a store of the page asked meanwhile (the save
 *   shortcut) saves the header instead.
 * - **Done**: at once when nothing is unsaved, else the question with its
 *   four answers (three without the right to publish). Leaving draws the
 *   header from its published version again and gives focus back to it.
 * - **Guarded**: unsaved header work is reported to the admin's leave guard,
 *   as the page's is, and recorded as the component's own recovery point.
 *
 * @module admin/editor/region-editing
 */
import {
  isComponentDocument,
  type BlockDocument,
  type DefinitionsById,
  type RegionArea,
} from "@nextlyhq/blocks-engine";
import {
  canvasEditingOf,
  INLINE_EDIT_UNCHANGED,
  type ComponentFieldsHost,
  type EditingTargetState,
  type EditorState,
  type InlineEditOutcome,
  type RegionSelection,
} from "@nextlyhq/builder/shell";
import {
  useBeforeDocumentAction,
  useDocumentLocale,
  useDocumentSession,
  type DocumentSession,
  type DocumentSessionOutcome,
} from "@nextlyhq/plugin-sdk/admin";
import { toast } from "@nextlyhq/ui";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type JSX,
} from "react";

import { FACTS_PENDING, useComponentFacts } from "../component-facts-client";
import { sayFillNotices, type BuilderSets } from "../filled-default-notice";
import { siteRegionName, type RegionCardFacts } from "../page-layout";
import { useComponentEditing } from "../pattern-capability-client";
import { usePublishQuestion, type PublishQuestion } from "../publish-offer";
import {
  useRemovalQuestion,
  type RemovalQuestion,
} from "../removal-hold-client";

import {
  RegionDoneDialog,
  RegionPublishDialog,
  type DoneAnswer,
} from "./region-done-dialog";
import {
  BACK_TO_THE_PAGE,
  couldNotOpen,
  DONE,
  editingWords,
  lockedBy,
  publishLabel,
  saveFailed,
  saveLabel,
  savedElsewhere,
  storedWords,
  TRY_AGAIN,
  type RegionReach,
} from "./region-editing-words";
import { documentFrom } from "./stored-document";
import { finishInlineEdit } from "./use-host-commit";

/** The editor's inline typing, which is finished before a store. */
interface InlineTyping {
  readonly commit: () => InlineEditOutcome;
  readonly editing: unknown;
  readonly editingRich: unknown;
  /** End whichever passage is open, its words discarded. */
  readonly cancel?: () => void;
  /** A passage open in an inspector field, whose words are not yet written. */
  readonly inspecting?: boolean;
}

/** No passage open: what the page types while a region is edited in place. */
const NO_PAGE_PASSAGE: InlineTyping = {
  commit: () => INLINE_EDIT_UNCHANGED,
  editing: null,
  editingRich: null,
};

/**
 * The page's own inline typing: none while a region is edited in place,
 * since the passage open then is the region's, and finishing it into the
 * page (as the page's handover does when the editor goes away) would put
 * the header's document in the page's place.
 */
export function pageInlineOf<T extends InlineTyping>(
  area: RegionArea | undefined,
  inline: T
): T | InlineTyping {
  return area === undefined ? inline : NO_PAGE_PASSAGE;
}

/**
 * The regions drawn around the page as their bindings are read: the one
 * edited in place as it is now, so a source only its edits name is read for
 * it, and the others as published.
 */
export function useRegionsAsEdited<
  R extends {
    readonly area: RegionArea;
    readonly document: BlockDocument;
    readonly definitions?: DefinitionsById;
  },
>(
  regions: readonly R[],
  editing: Pick<EditingTargetState, "target" | "active">
): readonly R[] {
  const edited = canvasEditingOf(editing);
  const area = edited?.area;
  const document = edited?.document;
  const definitions = edited?.definitions;
  return useMemo(() => {
    if (area === undefined || document === undefined) return regions;
    return regions.map(region =>
      region.area === area
        ? {
            ...region,
            document,
            ...(definitions === undefined ? {} : { definitions }),
          }
        : region
    );
  }, [regions, area, document, definitions]);
}

/** The region an author asked to edit: its area and the component filling it. */
interface Opening {
  readonly area: RegionArea;
  readonly componentId: string;
}

/** What the top bar draws while a region is edited. */
export interface RegionTopBar {
  readonly area: RegionArea;
  readonly saveLabel: string;
  readonly publishLabel: string;
  readonly mayPublish: boolean;
  /** Whether a draft can be saved without changing what is live. */
  readonly draftable: boolean;
  /** Whether there are changes to save. */
  readonly dirty: boolean;
  /** A save or publish is under way. */
  readonly busy: boolean;
  readonly save: () => void;
  /** Ask "Publish the header to N pages?", publishing on yes. */
  readonly publish: () => void;
}

/** The editor's side of editing a region in place. */
export interface RegionEditingHost {
  /** The region being edited, or `undefined` while the page is. */
  readonly area: RegionArea | undefined;
  /** Edit a region in place; absent for someone who may not edit components. */
  readonly requestEdit: ((area: RegionArea) => void) | undefined;
  /** Done, and Escape with nothing selected inside: asks when work is unsaved. */
  readonly done: () => void;
  /**
   * Leave the region, asking first as Done does, then run `next`: the way
   * out of the editor while a region is edited, so the header's work is
   * never dropped by leaving the builder.
   */
  readonly leaveThen: (next: () => void) => void;
  /** The top bar's Save and Publish while a region is edited. */
  readonly topBar: RegionTopBar | undefined;
  /** Whether the region edited holds work not saved. */
  readonly dirty: boolean;
  /** The questions, to be drawn anywhere inside the editor. */
  readonly dialogs: JSX.Element;
  /**
   * The edited component's live facts, while a region is edited: the ids a
   * new field must never reuse and how far a change reaches, as its own view
   * is told.
   */
  readonly componentFacts: ComponentFieldsHost | undefined;
}

/** The pages the component reaches, once its facts have answered. */
function reachOf(facts: ReturnType<typeof useComponentFacts>): {
  known: boolean;
  reach: RegionReach;
} {
  if (facts === undefined) return { known: false, reach: undefined };
  const reserved = facts.reserved;
  const pending =
    reserved !== undefined &&
    "unavailable" in reserved &&
    reserved.unavailable === FACTS_PENDING;
  return { known: !pending, reach: facts.pages };
}

/** The region edited in place, or nothing while the page is edited. */
function editedAreaOf(
  editing: Pick<EditingTargetState, "target">
): RegionArea | undefined {
  return editing.target.kind === "region" ? editing.target.area : undefined;
}

/** Whether the component read can be saved as a draft without going live. */
function draftableOf(session: Pick<DocumentSession, "open">): boolean {
  return session.open.status === "ready" && session.open.draftable;
}

/** The region's document, read from the component's stored values. */
function regionDocumentOf(
  session: DocumentSession,
  field: string
): BlockDocument | undefined {
  if (session.open.status !== "ready") return undefined;
  const document = documentFrom(session.open.values[field], ["component"]);
  return isComponentDocument(document) ? document : undefined;
}

/**
 * Where the history stood when the region's document was last stored: an
 * undo depth, or `"unreachable"` once an undo went below it. Each editing
 * session starts from the stored version, at depth 0.
 *
 * A store names the document it sent, and moves the point only while that is
 * still the document edited. An edit or an undo made while the store was on
 * its way left what was stored behind, so no point in the history is known
 * to be stored, and the header stays unsaved until the next store.
 */
function useRegionSavePoint(
  active: Pick<EditorState, "undoDepth" | "document">,
  editingArea: RegionArea | undefined,
  inline: InlineTyping
): {
  dirty: boolean;
  stored: (sent: BlockDocument) => void;
} {
  const [savedAt, setSavedAt] = useState<number | "unreachable">(0);
  const [session, setSession] = useState(editingArea);
  const [sent, stored] = useState<BlockDocument | null>(null);
  if (session !== editingArea) {
    setSession(editingArea);
    setSavedAt(0);
  }
  if (sent !== null) {
    stored(null);
    setSavedAt(sent === active.document ? active.undoDepth : "unreachable");
  }
  if (typeof savedAt === "number" && active.undoDepth < savedAt) {
    setSavedAt("unreachable");
  }
  const dirty =
    editingArea !== undefined &&
    (savedAt !== active.undoDepth || passageOpen(inline));
  return { dirty, stored };
}

/** Whether a passage is open, on the canvas or in an inspector field. */
function passageOpen(inline: InlineTyping): boolean {
  return (
    inline.editing !== null ||
    inline.editingRich !== null ||
    inline.inspecting === true
  );
}

/**
 * Whether the opening of a region is refused: a colleague holds it, said by
 * name, or it could not be read, said with "Try again", which asks again as
 * the author asks (never while something is edited).
 */
function openingRefused(
  session: DocumentSession,
  area: RegionArea,
  retry: React.RefObject<((area: RegionArea) => void) | undefined>
): boolean {
  if (session.lock.status === "held-by-other") {
    toast.error(lockedBy(area, session.lock.holder));
    return true;
  }
  if (session.open.status === "failed") {
    toast.error(couldNotOpen(area), {
      action: { label: TRY_AGAIN, onClick: () => retry.current?.(area) },
    });
    return true;
  }
  return false;
}

/** The region's document once it is read, locked and counted, else nothing. */
function enterable(
  session: DocumentSession,
  field: string,
  reach: { known: boolean }
): BlockDocument | undefined {
  if (session.lock.status !== "held" || !reach.known) return undefined;
  return regionDocumentOf(session, field);
}

/** When the version opened was changed, where it is newer than the live one. */
function unpublishedFromOf(session: DocumentSession): string | undefined {
  if (session.open.status !== "ready") return undefined;
  const { published, unpublishedChanges, changedAt } = session.open;
  return published && unpublishedChanges ? (changedAt ?? undefined) : undefined;
}

/** A refusal of a save or publish, in the author's words. */
function refusalWords(
  area: RegionArea,
  intent: "save" | "publish",
  outcome: Extract<DocumentSessionOutcome, { ok: false }>
): string {
  if (outcome.reason === "stale")
    return savedElsewhere(area, outcome.changedBy);
  return saveFailed(area, intent, outcome.message);
}

/**
 * The opening of a region: asked for, then entered once the component is
 * read, locked and counted, or refused with the holder's name.
 */
function useRegionOpening({
  editing,
  inline,
  definitions,
  field,
  cards,
  opening,
  setOpening,
  session,
  reach,
  onEntered,
}: {
  editing: EditingTargetState;
  inline: InlineTyping;
  definitions: DefinitionsById;
  field: string | undefined;
  cards: readonly RegionCardFacts[];
  opening: Opening | null;
  setOpening: (opening: Opening | null) => void;
  session: DocumentSession;
  reach: { known: boolean; reach: RegionReach };
  onEntered: () => void;
}): ((area: RegionArea) => void) | undefined {
  const { enter } = editing;
  const inRegion = editing.target.kind === "region";
  // The way in as it is now, which a failed opening's "Try again" takes.
  const retry = useRef<((area: RegionArea) => void) | undefined>(undefined);
  useEffect(() => {
    if (opening === null || inRegion || field === undefined) return;
    const { area } = opening;
    if (openingRefused(session, area, retry)) {
      setOpening(null);
      return;
    }
    const document = enterable(session, field, reach);
    if (document === undefined) return;
    // The page's own passage, if one is open, ends here, in the page; one
    // that could not be written keeps the page, with the words in it.
    if (inline.commit().status === "refused") {
      setOpening(null);
      return;
    }
    const unpublishedFrom = unpublishedFromOf(session);
    enter({
      area,
      document,
      definitions,
      label: siteRegionName(area),
      words: {
        ...editingWords(area, reach.reach, unpublishedFrom),
        done: DONE,
        left: BACK_TO_THE_PAGE,
      },
    });
    onEntered();
  }, [
    opening,
    inRegion,
    field,
    session,
    reach,
    inline,
    enter,
    definitions,
    setOpening,
    onEntered,
  ]);
  const requestEdit = useMemo(() => {
    if (field === undefined) return undefined;
    return (area: RegionArea) => {
      if (inRegion) return;
      const card = cards.find(facts => facts.area === area);
      if (card !== undefined) {
        setOpening({ area, componentId: card.componentId });
      }
    };
  }, [field, inRegion, cards, setOpening]);
  retry.current = requestEdit;
  return requestEdit;
}

/** A save or publish of the region, carried out and said. */
interface RegionStore {
  /** A save or publish is under way. */
  readonly busy: boolean;
  /** Store the region's document; answers whether it was stored. */
  readonly store: (intent: "save" | "publish") => Promise<boolean>;
}

/**
 * Saving and publishing the region through its session. A failure keeps the
 * editing and the changes and says why, with "Try again"; a store reads the
 * regions again, so the canvas draws what is published now, and a publish
 * says the fill toast when it filled the site's default.
 */
function useRegionStore({
  area,
  field,
  inline,
  active,
  session,
  removal,
  stored,
  rereadRegions,
  sets,
}: {
  area: RegionArea | undefined;
  field: string | undefined;
  /** The component edited, and the hold its publish takes first. */
  removal: RegionRemoval;
  inline: InlineTyping;
  active: Pick<EditorState, "document">;
  session: DocumentSession;
  stored: (sent: BlockDocument) => void;
  rereadRegions: () => void;
  sets: BuilderSets;
}): RegionStore {
  const [busy, setBusy] = useState(false);
  // "Try again" stores the header as it is when it is clicked, through the
  // latest store, not the one whose attempt failed; only while the opening
  // it failed in is still the one edited.
  const latest = useRef<RegionStore["store"]>(() => Promise.resolve(false));
  const editedNow = useRef<Opening | null>(null);
  editedNow.current = area === undefined ? null : removal.opening;
  const store = useCallback(
    async (intent: "save" | "publish"): Promise<boolean> => {
      if (area === undefined || field === undefined) return false;
      const finished = finishInlineEdit(inline, active.document);
      if (!finished.mayClose) return false;
      setBusy(true);
      const ready =
        intent !== "publish" ||
        (await readyToPublish(removal, finished.document));
      if (!ready) {
        setBusy(false);
        return false;
      }
      const changes = { [field]: finished.document };
      const outcome = await (intent === "publish"
        ? session.publish(changes)
        : session.saveDraft(changes));
      setBusy(false);
      if (!outcome.ok) {
        const origin = removal.opening;
        toast.error(refusalWords(area, intent, outcome), {
          action: {
            label: TRY_AGAIN,
            onClick: () => {
              if (origin !== null && editedNow.current === origin) {
                void latest.current(intent);
              }
            },
          },
        });
        return false;
      }
      stored(finished.document);
      toast.success(storedWords(area, intent));
      // The regions are drawn from the published set and components: a
      // publish changes them, and a draft adds "Draft changes not live".
      rereadRegions();
      if (intent === "publish") void sayFillNotices(sets);
      return true;
    },
    [
      area,
      field,
      inline,
      active.document,
      session,
      removal,
      stored,
      rereadRegions,
      sets,
    ]
  );
  latest.current = store;
  return { busy, store };
}

/**
 * What a publish of the region asks first, as the component's own view
 * asks it: the unpublished parts it places, offered to publish with it, then
 * the fields it removes, held at the count told and asked again while that
 * grew. Answers whether the publish may go ahead; called off, nothing is
 * said, and a check that could not be had says why.
 */
async function readyToPublish(
  removal: RegionRemoval,
  document: BlockDocument
): Promise<boolean> {
  if (removal.componentId === undefined) return false;
  try {
    await removal.offer([document]);
    await removal.hold(removal.componentId, () => document, removal.locale);
    return true;
  } catch (error) {
    if (!(error instanceof DOMException && error.name === "AbortError")) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
    return false;
  }
}

/** Leaving the region, and the questions Done and Publish ask first. */
interface RegionLeaving {
  readonly asking: "done" | "publish" | null;
  readonly ask: (question: "done" | "publish" | null) => void;
  readonly done: () => void;
  readonly leaveThen: (next: () => void) => void;
  readonly answer: (choice: DoneAnswer) => Promise<void>;
  /** A Discard is on its way: nothing else is answered until it lands. */
  readonly discarding: boolean;
}

/**
 * Done, at once when nothing is unsaved, else after its question; leaving
 * draws the regions again, chooses the region again and gives it focus.
 */
function useRegionLeaving({
  area,
  dirty,
  busy,
  inline,
  editing,
  session,
  store,
  release,
  selection,
  canvas,
  rereadRegions,
}: {
  area: RegionArea | undefined;
  dirty: boolean;
  /** A store is on its way, whose outcome the question waits for. */
  busy: boolean;
  inline: Pick<InlineTyping, "cancel">;
  editing: Pick<EditingTargetState, "leave">;
  session: Pick<DocumentSession, "discard">;
  store: RegionStore["store"];
  /** Let the component go: its session ends and its lock is released. */
  release: () => void;
  selection: RegionSelection;
  canvas: HTMLElement | null;
  rereadRegions: () => void;
}): RegionLeaving {
  const [asking, ask] = useState<"done" | "publish" | null>(null);
  const [discarding, setDiscarding] = useState(false);
  const leaving = useRef<(() => void) | null>(null);
  const { leave: leaveTarget } = editing;
  const leave = useCallback(() => {
    if (area === undefined) return;
    leaveTarget();
    release();
    rereadRegions();
    // The region chosen before, chosen again, with focus back on it.
    selection.select(area);
    const next = leaving.current;
    leaving.current = null;
    requestAnimationFrame(() => {
      canvas?.querySelector<HTMLElement>(`[data-nx-region="${area}"]`)?.focus();
      next?.();
    });
  }, [area, leaveTarget, release, rereadRegions, selection, canvas]);
  const done = useCallback(() => {
    if (area === undefined) return;
    if (dirty || busy) ask("done");
    else leave();
  }, [area, dirty, busy, leave]);
  const leaveThen = useCallback(
    (next: () => void) => {
      leaving.current = next;
      done();
    },
    [done]
  );
  const answer = useCallback(
    async (choice: DoneAnswer) => {
      if (choice === "keep") {
        leaving.current = null;
        ask(null);
        return;
      }
      // Discarded, a passage still open in the header (one its cap refused,
      // say) ends with it, never to be written into the page left for; and
      // nothing else is answered until the recovery point is emptied.
      if (choice === "discard") {
        inline.cancel?.();
        setDiscarding(true);
      }
      const left =
        choice === "discard"
          ? await session.discard().then(
              () => true,
              // The point could not be emptied: the author still chose to
              // throw the changes away, so the header is left all the same.
              () => true
            )
          : await store(choice);
      setDiscarding(false);
      if (!left) return;
      ask(null);
      leave();
    },
    [inline, session, store, leave]
  );
  return { asking, ask, done, leaveThen, answer, discarding };
}

/** The top bar's Save and Publish for the region, while one is edited. */
function regionTopBar(
  area: RegionArea | undefined,
  facts: {
    mayPublish: boolean;
    draftable: boolean;
    dirty: boolean;
    busy: boolean;
  },
  store: RegionStore["store"],
  ask: RegionLeaving["ask"]
): RegionTopBar | undefined {
  if (area === undefined) return undefined;
  return {
    area,
    saveLabel: saveLabel(area),
    publishLabel: publishLabel(area),
    ...facts,
    save: () => void store("save"),
    publish: () => ask("publish"),
  };
}

/** Done's question and Publish's, for the region being edited. */
function RegionQuestions({
  area,
  reach,
  store,
  leaving,
  mayPublish,
  draftable,
  removal,
}: {
  area: RegionArea | undefined;
  reach: RegionReach;
  store: RegionStore;
  leaving: RegionLeaving;
  mayPublish: boolean;
  draftable: boolean;
  /** The removal's question, asked again while its count grew. */
  removal: JSX.Element;
}): JSX.Element {
  const shown = area ?? "header";
  const { asking, ask, answer, discarding } = leaving;
  return (
    <>
      <RegionDoneDialog
        open={asking === "done" && area !== undefined}
        area={shown}
        reach={reach}
        busy={store.busy || discarding}
        mayPublish={mayPublish}
        draftable={draftable}
        onAnswer={choice => void answer(choice)}
      />
      <RegionPublishDialog
        open={asking === "publish" && area !== undefined}
        area={shown}
        reach={reach}
        busy={store.busy}
        onCancel={() => ask(null)}
        onPublish={() => {
          void store.store("publish").then(ok => {
            if (ok) ask(null);
          });
        }}
      />
      {removal}
    </>
  );
}

/**
 * The header's work, recorded as the component's own recovery point while
 * it is unsaved; the editor reports it to the leave guard with the page's.
 */
function useRecordedRegion(
  session: Pick<DocumentSession, "record" | "discard">,
  field: string | undefined,
  document: BlockDocument,
  dirty: boolean,
  area: RegionArea | undefined
): void {
  const { record, discard } = session;
  useEffect(() => {
    if (field !== undefined && dirty) record({ [field]: document });
  }, [field, dirty, document, record]);
  // Back to what is stored while still edited (an undo to it, say): the
  // point recorded for the work since is emptied, so it is never offered.
  const wasDirty = useRef(dirty);
  useEffect(() => {
    if (wasDirty.current && !dirty && area !== undefined) void discard();
    wasDirty.current = dirty;
  }, [dirty, area, discard]);
}

/**
 * A store of the page asked while the header is edited (the save shortcut)
 * saves the header instead: the page's Save waits until Done.
 */
function usePageStoreWaits(
  area: RegionArea | undefined,
  store: RegionStore["store"]
): void {
  useBeforeDocumentAction(() => {
    if (area === undefined) return;
    void store("save");
    throw new DOMException("The page is saved after Done.", "AbortError");
  });
}

/**
 * The session on the component a region asked for, and how far it reaches:
 * in the language the page is edited in, as its regions are drawn.
 */
function useOpenedComponent(opening: Opening | null): {
  store: ReturnType<typeof useComponentEditing>;
  session: DocumentSession;
  facts: ComponentFieldsHost | undefined;
  reach: { known: boolean; reach: RegionReach };
  locale: string | undefined;
} {
  const store = useComponentEditing();
  const locale = useDocumentLocale()?.code ?? null;
  const session = useDocumentSession(
    opening === null || store === undefined
      ? null
      : {
          collection: store.collection,
          id: opening.componentId,
          ...(locale === null ? {} : { locale }),
        }
  );
  const facts = useComponentFacts(opening?.componentId);
  const reach = useMemo(() => reachOf(facts), [facts]);
  return { store, session, facts, reach, locale: locale ?? undefined };
}

/** `value` while a region is edited, else nothing. */
function whileEdited<T>(
  area: RegionArea | undefined,
  value: T | undefined
): T | undefined {
  return area === undefined ? undefined : value;
}

/** The component a region's publish asks about first, and its checks. */
interface RegionRemoval {
  /** The opening of it a store belongs to. */
  readonly opening: Opening | null;
  readonly componentId: string | undefined;
  readonly locale: string | undefined;
  readonly hold: RemovalQuestion["hold"];
  readonly offer: PublishQuestion["offer"];
}

/**
 * The fields a publish of the region removes, held first: told as each one
 * left the header while it was edited, for this opening of it.
 */
function useRegionRemoval(
  editing: BlockDocument,
  facts: ComponentFieldsHost | undefined,
  opening: Opening | null,
  locale: string | undefined
): { removal: RegionRemoval; dialog: JSX.Element } {
  const question = useRemovalQuestion(editing, () => facts?.reach, opening);
  const parts = usePublishQuestion("component");
  const componentId = opening?.componentId;
  const { hold } = question;
  const { offer } = parts;
  const removal = useMemo(
    () => ({ opening, componentId, locale, hold, offer }),
    [opening, componentId, locale, hold, offer]
  );
  return {
    removal,
    dialog: (
      <>
        {parts.dialog}
        {question.dialog}
      </>
    ),
  };
}

/**
 * The editor's side of editing a header or footer in place, for the
 * editor's body to hand to the canvas, the panels, the top bar and the strip.
 */
export function useRegionEditing({
  editing,
  inline,
  definitions,
  cards,
  selection,
  canvas,
  requestLayers,
  sets,
  rereadRegions,
}: {
  editing: EditingTargetState;
  inline: InlineTyping;
  /** The definitions the region's placements are drawn from. */
  definitions: DefinitionsById;
  /** The regions drawn around the page, with the component filling each. */
  cards: readonly RegionCardFacts[];
  /** The page's region selection, which is the region again on leaving. */
  selection: RegionSelection;
  /** The canvas, whose region takes focus back on leaving. */
  canvas: HTMLElement | null;
  /** Open Layers, where focus moves on entering. */
  requestLayers: () => void;
  /** The builder's way to its sets, for the toast a filling publish says. */
  sets: BuilderSets;
  /** Read the regions drawn around the page again. */
  rereadRegions: () => void;
}): RegionEditingHost {
  const [opening, setOpening] = useState<Opening | null>(null);
  const {
    store: place,
    session,
    facts: componentFacts,
    reach,
    locale,
  } = useOpenedComponent(opening);
  const field = place?.field;
  const area = editedAreaOf(editing);
  const { active } = editing;
  const savePoint = useRegionSavePoint(active, area, inline);
  const requestEdit = useRegionOpening({
    editing,
    inline,
    definitions,
    field,
    cards,
    opening,
    setOpening,
    session,
    reach,
    onEntered: requestLayers,
  });
  useRecordedRegion(session, field, active.document, savePoint.dirty, area);
  const { removal, dialog: removalDialog } = useRegionRemoval(
    active.document,
    componentFacts,
    opening,
    locale
  );
  const store = useRegionStore({
    area,
    field,
    inline,
    active,
    session,
    removal,
    stored: savePoint.stored,
    rereadRegions,
    sets,
  });
  const release = useCallback(() => setOpening(null), []);
  const leaving = useRegionLeaving({
    area,
    dirty: savePoint.dirty,
    busy: store.busy,
    inline,
    editing,
    session,
    store: store.store,
    release,
    selection,
    canvas,
    rereadRegions,
  });
  usePageStoreWaits(area, store.store);

  const draftable = draftableOf(session);
  const facts = {
    mayPublish: session.mayPublish,
    draftable,
    dirty: savePoint.dirty,
    busy: store.busy,
  };
  return {
    area,
    requestEdit,
    done: leaving.done,
    leaveThen: leaving.leaveThen,
    topBar: regionTopBar(area, facts, store.store, leaving.ask),
    dirty: savePoint.dirty,
    componentFacts: whileEdited(area, componentFacts),
    dialogs: (
      <RegionQuestions
        area={area}
        reach={reach.reach}
        store={store}
        leaving={leaving}
        mayPublish={session.mayPublish}
        draftable={draftable}
        removal={removalDialog}
      />
    ),
  };
}
