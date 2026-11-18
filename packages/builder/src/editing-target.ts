"use client";

/**
 * Which document the editor is editing: the page, or a region of its layout
 * (a header or footer) drawn from another document and edited in place, the
 * page staying on screen under it.
 *
 * Two editor states, never merged. The page's stays mounted and frozen while a
 * region is edited: nothing routes an edit, an undo or a recorded step to it,
 * because everything that edits reads the ACTIVE state this hands out. The
 * region's is a second `useEditorState` of its own, started from the region's
 * document with an empty history on entering and started again empty on
 * leaving, so its history is dropped whatever leaving chose. An undo after
 * leaving can never reach into a header that may already be published.
 *
 * Generic on purpose: the host supplies the region's document, its
 * definitions and every word said about it (the bar, Done, the announcements,
 * the name Layers and the inspector use). The builder knows nothing of what
 * the region comes from or how it is saved.
 *
 * The verbs are plain commands (`enter`, `leave`, `pulseDone`) so a keyboard
 * route, a button, a command palette or an agent all reach the same switch.
 *
 * @module editing-target
 * @experimental Settles with editing a header or footer in place.
 */

import type {
  BlockDocument,
  DefinitionsById,
  RegionArea,
} from "@nextlyhq/blocks-engine";
import { useCallback, useMemo, useRef, useState } from "react";

import {
  useEditorState,
  type EditorState,
  type UseEditorStateArgs,
} from "./editor-state";

/** What the host says about a region while it is edited. */
export interface RegionEditingWords {
  /** The bar above the canvas: "Editing the site header · changes show on 11 pages". */
  readonly bar: string;
  /** The bar's button that ends the editing: "Done". */
  readonly done: string;
  /** Announced on entering: "Editing the site header. Changes show on 11 pages." */
  readonly entered: string;
  /** Announced on leaving: "Back to the page." */
  readonly left: string;
}

/** A region of the page's layout to edit in place, as the host hands it over. */
export interface RegionEditing {
  /** Which region: the header or the footer. */
  readonly area: RegionArea;
  /** Its document as editing starts: the latest version of what fills it. */
  readonly document: BlockDocument;
  /** The definitions that document's component placements are drawn from. */
  readonly definitions?: DefinitionsById;
  /** Its name, "Site header": "Layers · Site header", "Navigation · in Site header". */
  readonly label: string;
  /** What is said about it while it is edited. */
  readonly words: RegionEditingWords;
}

/** What the editor edits: the page, or a region of its layout in place. */
export type EditingTarget =
  | { readonly kind: "page" }
  | ({ readonly kind: "region" } & RegionEditing);

/** The editing target, the state that edits it, and the ways to switch. */
export interface EditingTargetState {
  /** What is being edited now. */
  readonly target: EditingTarget;
  /**
   * The state of the document being edited: the region's while one is edited,
   * else the page's. Everything that edits or reads "the document being
   * edited" (the inspector, Layers, the Add panel, the keyboard, the palette,
   * the toolbar, the canvas marks, Undo and Redo, a recorded site-style step)
   * is handed this, so one switch routes them all.
   */
  readonly active: EditorState;
  /** Edit `region` in place, with a history of its own that starts empty. */
  readonly enter: (region: RegionEditing) => void;
  /** Back to the page, dropping the region's history. */
  readonly leave: () => void;
  /**
   * How many times the dimmed page was pressed this session: each press
   * briefly highlights Done, the one way back, and changes nothing else.
   */
  readonly pulse: number;
  /** Count one press on the dimmed page. */
  readonly pulseDone: () => void;
  /**
   * What a live region says now: the region's `entered` words after entering,
   * its `left` words after leaving, empty before either.
   */
  readonly announcement: string;
  /**
   * The definitions the region is drawn from now, while one is edited: the
   * host's current ones, else those it was entered with.
   */
  readonly definitions?: DefinitionsById;
}

/** The arguments the region's state takes beyond its own document. */
export type RegionStateArgs = Omit<
  UseEditorStateArgs,
  "initialDocument" | "definitions" | "stored" | "session"
> & {
  /**
   * The definitions the host draws component placements from now, which a
   * region edited in place is drawn and judged by over the ones it was
   * entered with: a component made or loaded while it is edited is known to
   * it at once, its history kept.
   */
  readonly definitions?: DefinitionsById;
};

/** The page as the target: one value, so a render compares it by identity. */
const PAGE_TARGET: EditingTarget = { kind: "page" };

/** The region state's document while no region is edited. */
const NO_REGION: BlockDocument = {
  formatVersion: 1,
  kind: "component",
  nodes: [],
};

/**
 * The editing target for an editor whose page state is `page`.
 *
 * The region's state is always mounted, so entering and leaving change which
 * state is active without mounting anything: each entry is a new session of
 * it (`useEditorState`'s `session`), started from the region's document with
 * nothing selected and an empty history, and leaving starts it again on an
 * empty document, which drops that history. The page's selection is never
 * touched, so it is as it was when the author comes back.
 *
 * `args` are what the region's edits are judged by beside its own document:
 * the host's caps, refusal reporting and locks, as the page's are.
 */
export function useEditingTarget(
  page: EditorState,
  args: RegionStateArgs = {}
): EditingTargetState {
  const [target, setTarget] = useState<EditingTarget>(PAGE_TARGET);
  const [pulse, setPulse] = useState(0);
  const [announcement, setAnnouncement] = useState("");
  const editing = target.kind === "region" ? target : undefined;
  const { definitions: current, ...judged } = args;
  const definitions =
    editing === undefined ? undefined : (current ?? editing.definitions);
  const region = useEditorState({
    ...judged,
    initialDocument: editing?.document ?? NO_REGION,
    ...(definitions === undefined ? {} : { definitions }),
    // The target itself names the session: every entry is a new object, so
    // entering again, even the same region, starts from an empty history.
    session: target,
  });

  const enter = useCallback((next: RegionEditing) => {
    setTarget({ kind: "region", ...next });
    setPulse(0);
    setAnnouncement(current => said(current, next.words.entered));
  }, []);
  // Read when leaving rather than closed over, so a Done bound by an older
  // render still says the words of the region being left.
  const latestTarget = useRef(target);
  latestTarget.current = target;
  const leave = useCallback(() => {
    const leaving = latestTarget.current;
    if (leaving.kind !== "region") return;
    setTarget(PAGE_TARGET);
    setAnnouncement(current => said(current, leaving.words.left));
  }, []);
  const pulseDone = useCallback(() => setPulse(count => count + 1), []);

  const active = editing === undefined ? page : region;
  return useMemo(
    () => ({
      target,
      active,
      enter,
      leave,
      pulse,
      pulseDone,
      announcement,
      ...(definitions === undefined ? {} : { definitions }),
    }),
    [target, active, enter, leave, pulse, pulseDone, announcement, definitions]
  );
}

/**
 * `message` as a live region's next text. A live region does not say text
 * that did not change, so the same words twice running (leaving the header,
 * then the footer) differ by a zero-width space that is not read aloud.
 */
function said(previous: string, message: string): string {
  return previous.replace(/​$/, "") === message ? `${message}​` : message;
}

/**
 * What the canvas draws as the region being edited: its area, the region
 * state's LIVE document and its definitions, or nothing while the page is
 * the target. Derived from the editing target, so the canvas cannot draw one
 * region while the panels edit another.
 */
export function canvasEditingOf(
  editing: Pick<EditingTargetState, "target" | "active" | "definitions">
):
  | {
      readonly area: RegionArea;
      readonly document: BlockDocument;
      readonly definitions?: DefinitionsById;
    }
  | undefined {
  const { target } = editing;
  if (target.kind !== "region") return undefined;
  const definitions = editing.definitions ?? target.definitions;
  return {
    area: target.area,
    document: editing.active.document,
    ...(definitions === undefined ? {} : { definitions }),
  };
}

/**
 * What Escape does once nothing inside the region is selected and no popover
 * is open (the keyboard's Escape has already cleared those, innermost
 * first): it ends the region's editing as Done does, the host's `done` where
 * it asks first about unsaved changes, else at once. While the page is the
 * target it runs the host's own `otherwise`.
 *
 * For `BlockKeyboardActions`'s `onEscapeWithoutSelection`.
 */
export function regionEscape(
  editing: Pick<EditingTargetState, "target" | "leave">,
  {
    done,
    otherwise,
  }: { readonly done?: () => void; readonly otherwise?: () => void }
): () => void {
  return () => {
    if (editing.target.kind === "region") (done ?? editing.leave)();
    else otherwise?.();
  };
}
