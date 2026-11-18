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
import type {
  EditingTargetState,
  EditorState,
  InlineEditOutcome,
  RegionSelection,
} from "@nextlyhq/builder/shell";
import {
  useBeforeDocumentAction,
  useDocumentSession,
  useReportUnsavedWork,
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
  /** The questions, to be drawn anywhere inside the editor. */
  readonly dialogs: JSX.Element;
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
 */
function useRegionSavePoint(
  active: Pick<EditorState, "undoDepth">,
  editingArea: RegionArea | undefined,
  inline: InlineTyping
): {
  dirty: boolean;
  stored: () => void;
  depth: React.RefObject<number>;
} {
  const [savedAt, setSavedAt] = useState<number | "unreachable">(0);
  const [session, setSession] = useState(editingArea);
  if (session !== editingArea) {
    setSession(editingArea);
    setSavedAt(0);
  }
  if (typeof savedAt === "number" && active.undoDepth < savedAt) {
    setSavedAt("unreachable");
  }
  const depth = useRef(active.undoDepth);
  depth.current = active.undoDepth;
  const stored = useCallback(() => setSavedAt(depth.current), []);
  const dirty =
    editingArea !== undefined &&
    (savedAt !== active.undoDepth ||
      inline.editing !== null ||
      inline.editingRich !== null);
  return { dirty, stored, depth };
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
  useEffect(() => {
    if (opening === null || inRegion || field === undefined) return;
    const { area } = opening;
    if (session.lock.status === "held-by-other") {
      toast.error(lockedBy(area, session.lock.holder));
      setOpening(null);
      return;
    }
    if (session.open.status === "failed") {
      setOpening(null);
      toast.error(couldNotOpen(area), {
        action: { label: TRY_AGAIN, onClick: () => setOpening(opening) },
      });
      return;
    }
    const document = regionDocumentOf(session, field);
    if (
      document === undefined ||
      session.open.status !== "ready" ||
      session.lock.status !== "held" ||
      !reach.known
    ) {
      return;
    }
    // The page's own passage, if one is open, ends here, in the page.
    inline.commit();
    const unpublishedFrom =
      session.open.published && session.open.unpublishedChanges
        ? (session.open.changedAt ?? undefined)
        : undefined;
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
  return useMemo(() => {
    if (field === undefined) return undefined;
    return (area: RegionArea) => {
      if (inRegion) return;
      const card = cards.find(facts => facts.area === area);
      if (card !== undefined) {
        setOpening({ area, componentId: card.componentId });
      }
    };
  }, [field, inRegion, cards, setOpening]);
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
  const store = useComponentEditing();
  const field = store?.field;
  const [opening, setOpening] = useState<Opening | null>(null);
  const session = useDocumentSession(
    opening === null || store === undefined
      ? null
      : { collection: store.collection, id: opening.componentId }
  );
  const facts = useComponentFacts(opening?.componentId);
  const reach = useMemo(() => reachOf(facts), [facts]);
  const area =
    editing.target.kind === "region" ? editing.target.area : undefined;
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

  // The header's work, recorded as the component's own recovery point and
  // reported to the leave guard, as the page's is.
  const { record } = session;
  useEffect(() => {
    if (area !== undefined && field !== undefined && savePoint.dirty) {
      record({ [field]: active.document });
    }
  }, [area, field, savePoint.dirty, active.document, record]);
  useReportUnsavedWork("blocks:edited-region", savePoint.dirty);

  const [busy, setBusy] = useState(false);
  const { stored } = savePoint;
  const storeRegion = useCallback(
    async (intent: "save" | "publish"): Promise<boolean> => {
      if (area === undefined || field === undefined) return false;
      const finished = finishInlineEdit(inline, active.document);
      if (!finished.mayClose) return false;
      setBusy(true);
      const changes = { [field]: finished.document };
      const outcome =
        intent === "publish"
          ? await session.publish(changes)
          : await session.saveDraft(changes);
      setBusy(false);
      if (!outcome.ok) {
        toast.error(refusalWords(area, intent, outcome), {
          action: {
            label: TRY_AGAIN,
            onClick: () => void storeRegion(intent),
          },
        });
        return false;
      }
      stored();
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
      stored,
      rereadRegions,
      sets,
    ]
  );

  const leaving = useRef<(() => void) | null>(null);
  const { leave: leaveTarget } = editing;
  const leave = useCallback(() => {
    if (area === undefined) return;
    leaveTarget();
    setOpening(null);
    rereadRegions();
    // The region chosen before, chosen again, with focus back on it.
    selection.select(area);
    const next = leaving.current;
    leaving.current = null;
    requestAnimationFrame(() => {
      canvas?.querySelector<HTMLElement>(`[data-nx-region="${area}"]`)?.focus();
      next?.();
    });
  }, [area, leaveTarget, rereadRegions, selection, canvas]);

  const [asking, setAsking] = useState<"done" | "publish" | null>(null);
  const done = useCallback(() => {
    if (area === undefined) return;
    if (!savePoint.dirty) leave();
    else setAsking("done");
  }, [area, savePoint.dirty, leave]);
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
        setAsking(null);
        return;
      }
      if (choice === "discard") {
        await session.discard();
      } else if (!(await storeRegion(choice))) {
        return;
      }
      setAsking(null);
      leave();
    },
    [session, storeRegion, leave]
  );

  // A store of the page asked while the header is edited (the save
  // shortcut) saves the header instead: the page's Save waits until Done.
  useBeforeDocumentAction(() => {
    if (area === undefined) return;
    void storeRegion("save");
    throw new DOMException("The page is saved after Done.", "AbortError");
  });

  const open = session.open;
  const draftable = open.status === "ready" && open.draftable;
  const topBar = useMemo((): RegionTopBar | undefined => {
    if (area === undefined) return undefined;
    return {
      area,
      saveLabel: saveLabel(area),
      publishLabel: publishLabel(area),
      mayPublish: session.mayPublish,
      draftable,
      dirty: savePoint.dirty,
      busy,
      save: () => void storeRegion("save"),
      publish: () => setAsking("publish"),
    };
  }, [area, session.mayPublish, draftable, savePoint.dirty, busy, storeRegion]);

  const dialogs = (
    <>
      <RegionDoneDialog
        open={asking === "done" && area !== undefined}
        area={area ?? "header"}
        reach={reach.reach}
        busy={busy}
        mayPublish={session.mayPublish}
        draftable={draftable}
        onAnswer={choice => void answer(choice)}
      />
      <RegionPublishDialog
        open={asking === "publish" && area !== undefined}
        area={area ?? "header"}
        reach={reach.reach}
        busy={busy}
        onCancel={() => setAsking(null)}
        onPublish={() => {
          void storeRegion("publish").then(ok => {
            if (ok) setAsking(null);
          });
        }}
      />
    </>
  );

  return { area, requestEdit, done, leaveThen, topBar, dialogs };
}
