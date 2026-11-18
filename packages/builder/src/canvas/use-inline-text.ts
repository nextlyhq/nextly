"use client";

/**
 * Typing a block's text directly on the canvas.
 *
 * The DOM half of {@link module:inline-text}, which decides WHAT may be edited;
 * this decides how. The split is the same one the rest of this package makes,
 * and here it earns its keep twice over: the rules are asserted without a
 * browser, and the parts that genuinely need one are small enough to read.
 *
 * ## The element is left UNCONTROLLED while the caret is in it
 *
 * No op is dispatched per keystroke. React renders the canvas from the
 * document, so an edit that wrote through on every character would re-render
 * the element the author is typing into and move the caret out from under
 * them — the standard failure of `contentEditable` inside a framework that
 * owns the DOM. Every editor that does this well hands the element over for
 * the duration: Gutenberg, Lexical and Puck all do.
 *
 * So the document is untouched until the edit finishes, and finishing writes
 * ONE op. That also gives the behaviour an author expects from undo: a
 * sentence typed and then undone comes back as a sentence, not as forty
 * characters.
 *
 * The visible cost is that the inspector shows the value the document holds
 * rather than the letters being typed, until the edit is committed. That is
 * the same rule the blocks field itself follows when it commits its document
 * on exit, and one editor with two answers about when a change counts is
 * worse than a panel that updates a moment later.
 *
 * ## `plaintext-only`, with a fallback that still cannot store markup
 *
 * The values here are plain text, and `contenteditable="plaintext-only"` is
 * what stops a paste bringing markup, a bold shortcut inserting a `<b>`, and
 * Enter inserting a `<div>`. Where a browser does not support it the attribute
 * falls back to ordinary editing, so the commit reads the element's text — which is
 * text whatever the element ended up containing.
 *
 * @module use-inline-text
 */

import { itemOfPropName, type BlockDocument } from "@nextlyhq/blocks-engine";
import { useCallback, useEffect, useRef, useState } from "react";

import { isElement } from "../dom-kind";
import type { EditorState } from "../editor-state";
import type { BuilderOp } from "../op-vocabulary";

import { useCanvasFrame } from "./canvas-frame-context";
import {
  composedTextAt,
  exposedTextOp,
  type ExposedTextTarget,
} from "./exposed-inline";
import {
  INLINE_EDIT_DISCARDED,
  type InlineEditOutcome,
  type InlineEditRefusal,
} from "./inline-edit-outcome";
import { namedTarget } from "./inline-target";
import {
  inlineTarget,
  inlineTargets,
  inlineTextOp,
  removeItemOp,
  splitItemOp,
  type ItemCaret,
  type ItemEdit,
} from "./inline-text";

/** The attribute naming the element an author is currently typing into. */
export const EDITING_ATTRIBUTE = "data-nx-editing";

/** Which value is being edited. */
export interface InlineTextEditing {
  readonly nodeId: string;
  readonly prop: string;
  /**
   * Set when the value is a component's exposed text: the node is composed,
   * and the edit is stored on the placement under the exposure's id.
   */
  readonly exposure?: ExposedTextTarget;
}

/**
 * The op a finished edit of exposed text writes, asked again of the editor as
 * it stands: the component library may have changed while the caret was in
 * the text, and a prop no longer fed by the same text exposure takes nothing.
 */
function exposedCommitOp(
  editor: EditorState,
  started: ExposedTextTarget,
  next: string
) {
  const now = exposedTarget(editor, started.nodeId, started.prop);
  if (now === undefined || now.exposureId !== started.exposureId) return null;
  return exposedTextOp(editor.document, started, next);
}

/**
 * What the document holds for this edit now, or `undefined` when the value
 * stopped being editable here: its block locked or removed, or the text no
 * longer fed by the same exposure.
 */
function liveValueOf(
  editor: EditorState,
  current: InlineTextEditing
): string | undefined {
  if (current.exposure === undefined) {
    return inlineTarget(editor.document, current.nodeId, current.prop)?.value;
  }
  const now = exposedTarget(
    editor,
    current.exposure.nodeId,
    current.exposure.prop
  );
  return now?.exposureId === current.exposure.exposureId
    ? now.value
    : undefined;
}

/** How an edit would finish: a write, a refusal, or nothing to write. */
type Finish =
  | { readonly op?: BuilderOp }
  | { readonly refused: InlineEditRefusal };

const NOTHING_TO_WRITE: Finish = {};

/** A composed node's exposed text, when that is what this value is. */
function exposedTarget(
  editor: EditorState,
  nodeId: string,
  prop: string
): ExposedTextTarget | undefined {
  const answer = composedTextAt(
    editor.document,
    editor.composed(),
    nodeId,
    prop,
    editor.lockDefinitions
  );
  return answer?.kind === "exposed" ? answer.target : undefined;
}

export interface UseInlineTextResult {
  /** The value being edited, or `null` when none is. */
  editing: InlineTextEditing | null;
  /**
   * Start editing a value, reporting whether it could be.
   *
   * `prop` defaults to the block's FIRST declared inline value, which is what
   * a keyboard caller wants: it has a selected block and no element.
   */
  begin: (nodeId: string, prop?: string) => boolean;
  /**
   * Finish, writing whatever the author left behind.
   *
   * Returns the document the write produced, or `null` when there was nothing
   * to write — a caller about to hand the document elsewhere holds the one from
   * before this commit.
   */
  commit: () => BlockDocument | null;
  /** Finish, discarding it. */
  cancel: () => void;
  /**
   * Enter an edit from a double-click on the canvas.
   *
   * Handed to `Canvas` rather than attached here, because the canvas owns its
   * own root and a second listener on the same tree would be a second place
   * the gesture is decided.
   */
  onDoubleClick: (event: { target: EventTarget | null }) => void;
}

/**
 * The element the author is typing into, found from what they double-clicked.
 *
 * Walks UP from the event target rather than reading it: a click lands on
 * whatever leaf is under the pointer, and the element carrying the mark may be
 * an ancestor of it.
 */
/**
 * The words an element holds, as the value it edits: its text, with each
 * `<br>` read as the `\n` it stands for. `textContent` alone drops a line
 * break drawn as an element, so a line of a Text's one paragraph edited here
 * would come back joined to the next.
 */
export function elementWords(element: Node): string {
  const parts: string[] = [];
  const stack: Node[] = [...element.childNodes].reverse();
  while (stack.length > 0) {
    const node = stack.pop();
    if (node === undefined) continue;
    if (isElement(node) && node.localName === "br") {
      parts.push("\n");
      continue;
    }
    if (node.nodeType === node.TEXT_NODE) {
      parts.push(node.nodeValue ?? "");
      continue;
    }
    for (let i = node.childNodes.length - 1; i >= 0; i--) {
      const child = node.childNodes[i];
      if (child !== undefined) stack.push(child);
    }
  }
  return parts.join("");
}

export function editableFrom(target: EventTarget | null): {
  element: HTMLElement;
  prop: string;
  nodeId: string;
} | null {
  // By node kind: a double-click inside a canvas in a frame targets an
  // element that frame's window built.
  if (!isElement(target)) return null;
  const element = target.closest<HTMLElement>("[data-nx-prop]");
  if (element === null) return null;
  const prop = element.getAttribute("data-nx-prop");
  const owner = element.closest("[data-nx-node]");
  const nodeId = owner?.getAttribute("data-nx-node") ?? null;
  if (prop === null || nodeId === null) return null;
  return { element, prop, nodeId };
}

/**
 * The element carrying a value, found from the rendered tree rather than from a
 * click.
 *
 * For a keyboard caller, which has a selected node and no element. The node id
 * is compared in JavaScript rather than interpolated into the selector: it
 * reaches this from stored data, and putting it in a selector makes any
 * character CSS treats specially either throw or match something else. The prop
 * name is a key from the block's own schema and is escaped rather than
 * compared, because it addresses an element that may have no other handle.
 *
 * Exported for its own test. Which element holds a value is the part of this
 * module that varies per block, and it is not observable from the hook's
 * result — a wrong answer here shows up as an edit that quietly never starts.
 */
export function editableElement(
  root: ParentNode,
  editing: InlineTextEditing
): HTMLElement | null {
  const owners = root.querySelectorAll<HTMLElement>("[data-nx-node]");
  let found: HTMLElement | null = null;
  // `forEach` rather than `for…of`: a `NodeList` is only iterable under a lib
  // that declares its iterator, and this package compiles without one.
  owners.forEach(owner => {
    if (found !== null) return;
    if (owner.getAttribute("data-nx-node") !== editing.nodeId) return;
    // The owner ITSELF first. A block whose text is its own root element — an
    // unlinked heading is exactly this, carrying both attributes on one `<h2>`
    // — is missed entirely by a descendant search, and the failure is silent:
    // the edit never begins and the key reads as broken.
    if (owner.getAttribute("data-nx-prop") === editing.prop) {
      found = owner;
      return;
    }
    owner.querySelectorAll<HTMLElement>("[data-nx-prop]").forEach(candidate => {
      if (found !== null) return;
      if (candidate.getAttribute("data-nx-prop") !== editing.prop) return;
      // Not a value belonging to a block nested inside this one. Blocks nest,
      // so without this a container answers with its child's text and the
      // caret lands in a block the author did not select.
      if (candidate.closest("[data-nx-node]") !== owner) return;
      found = candidate;
    });
  });
  return found;
}

/**
 * Where the caret goes as an edit opens: across the whole value, so typing
 * replaces it, as a double-click or a key opens one; or at its start or end,
 * as Enter and Backspace move it from one item of a list to the next.
 */
type CaretPlace = "all" | ItemCaret["caret"];

function placeCaret(element: HTMLElement, at: CaretPlace): void {
  const selection = element.ownerDocument.defaultView?.getSelection();
  if (!selection) return;
  const range = element.ownerDocument.createRange();
  range.selectNodeContents(element);
  if (at !== "all") range.collapse(at === "start");
  selection.removeAllRanges();
  selection.addRange(range);
}

/**
 * An element's words either side of the caret, a selection's words dropped as
 * typing over them would drop them. All of them before it when the caret is
 * not in the element.
 */
function wordsAroundCaret(element: HTMLElement): [string, string] {
  const selection = element.ownerDocument.defaultView?.getSelection();
  const range =
    selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
  if (
    range === null ||
    !element.contains(range.startContainer) ||
    !element.contains(range.endContainer)
  ) {
    return [elementWords(element), ""];
  }
  const before = element.ownerDocument.createRange();
  before.selectNodeContents(element);
  before.setEnd(range.startContainer, range.startOffset);
  const after = element.ownerDocument.createRange();
  after.selectNodeContents(element);
  after.setStart(range.endContainer, range.endOffset);
  // Read as the element is, a `<br>` as the line break it stands for, so a
  // split changes nothing either side of the caret.
  return [
    elementWords(before.cloneContents()),
    elementWords(after.cloneContents()),
  ];
}

/**
 * The words an open edit holds. A browser holds an emptied line open with a
 * `<br>` as its last node; in an item of a list, which is one line, that
 * placeholder is not a line break, so an item emptied that way holds
 * nothing. Judged by the element's last node, not by the words: a line break
 * the item stores is text, and opening and leaving it keeps it.
 */
function editedWords(element: Node, editing: InlineTextEditing): string {
  const words = elementWords(element);
  return itemOfPropName(editing.prop) !== null && endsInBreak(element)
    ? words.slice(0, -1)
    : words;
}

/** Whether an element's last node, however deep, is a `<br>`. */
function endsInBreak(element: Node): boolean {
  let last = element.lastChild;
  while (last !== null && isElement(last) && last.localName !== "br") {
    last = last.lastChild;
  }
  return last !== null && isElement(last) && last.localName === "br";
}

/** An edit to a list's items, planned against the document as it stands. */
type ItemPlan = () => ItemEdit<ItemCaret | null> | null;

/**
 * What Enter or Backspace does in an item of a list, or `null` when the key
 * is not the list's: Enter adds the next item with the words after the caret,
 * and Backspace in an empty item removes it. Read when the key is pressed;
 * planned when it is written, against the document then.
 */
function itemKeyPlan(
  event: KeyboardEvent,
  element: HTMLElement,
  editing: InlineTextEditing,
  documentNow: () => BlockDocument
): ItemPlan | null {
  if (editing.exposure !== undefined || event.isComposing) return null;
  if (itemOfPropName(editing.prop) === null) return null;
  const { nodeId, prop } = editing;
  if (event.key === "Enter") {
    const [head, tail] = wordsAroundCaret(element);
    return () => {
      const split = splitItemOp(documentNow(), nodeId, prop, head, tail);
      return split === null
        ? null
        : { op: split.op, next: { prop: split.next, caret: "start" } };
    };
  }
  if (event.key !== "Backspace" || editedWords(element, editing) !== "") {
    return null;
  }
  return () => removeItemOp(documentNow(), nodeId, prop);
}

/**
 * Why the open value may not be written now, or `null`: it stopped being
 * editable here (a lock arrived, so there is nowhere to write it), or it moved
 * on while it was typed (writing would replace newer words with older ones).
 * Every write an edit makes asks this first.
 *
 * @param opened - the value as it was when the caret went in
 */
function stalenessOf(
  editor: EditorState,
  current: InlineTextEditing,
  opened: string | null
): InlineEditRefusal | null {
  const live = liveValueOf(editor, current);
  if (live === undefined) return "no-longer-editable";
  return opened !== null && live !== opened ? "moved-on" : null;
}

/**
 * The edit's side of moving through a list's items, read afresh each time a
 * key lands, so a key is judged against the editor and the session as they
 * stand then.
 */
function itemMoveHostOf(
  editor: { readonly current: EditorState },
  editing: InlineTextEditing,
  session: {
    readonly current: {
      readonly finished?: ((outcome: InlineEditOutcome) => void) | undefined;
      readonly opened: string | null;
    };
  },
  edit: ItemEditHandles
): () => ItemMoveHost {
  return () => itemMoveHost(editor.current, editing, session.current, edit);
}

/** What the edit hands over to open the next item. */
interface ItemEditHandles {
  readonly release: () => void;
  readonly session: { current: { caretAt: CaretPlace } };
  readonly setEditing: (next: InlineTextEditing) => void;
}

/** The edit's side of moving through a list's items, as it stands now. */
function itemMoveHost(
  editor: EditorState,
  editing: InlineTextEditing,
  session: {
    readonly finished?: ((outcome: InlineEditOutcome) => void) | undefined;
    readonly opened: string | null;
  },
  edit: ItemEditHandles
): ItemMoveHost {
  return {
    editor,
    stale: stalenessOf(editor, editing, session.opened),
    refused: reason => session.finished?.({ status: "refused", reason }),
    release: edit.release,
    open: next => {
      edit.session.current.caretAt = next.caret;
      edit.setEditing({ nodeId: editing.nodeId, prop: next.prop });
    },
  };
}

/** What moving through a list's items needs of the edit it moves from. */
interface ItemMoveHost {
  readonly editor: EditorState;
  /** Why the open value may not be written now, or `null`. */
  readonly stale: InlineEditRefusal | null;
  /** Told when the write is refused, the line staying open with its words. */
  readonly refused: (reason: InlineEditRefusal) => void;
  /** Ends the open edit. */
  readonly release: () => void;
  /** Opens the item the caret goes to. */
  readonly open: (next: ItemCaret) => void;
}

/**
 * A planned edit to a list's items, written, then the caret moved on: the
 * refusal said when it cannot be written (the value moved on or stopped being
 * editable, or the page refused the write). The item the caret goes to is
 * asked of the document the write produced: the editor's own holds it only
 * from its next render, and an item Enter added is not in it yet.
 */
function moveThroughItems(
  host: ItemMoveHost,
  element: HTMLElement,
  editing: InlineTextEditing,
  plan: ItemPlan
): void {
  if (host.stale !== null) return host.refused(host.stale);
  const planned = plan();
  if (planned === null) return host.refused("no-longer-editable");
  const written = host.editor.apply(planned.op);
  if (written === null) return host.refused("rejected");
  // The element the author typed into, given back holding what its item now
  // holds. Its item's stored words may not have changed (a split at the end
  // of words typed after them), and then nothing redraws it: the words after
  // the caret would show in it and in the item that took them.
  element.textContent =
    inlineTarget(written, editing.nodeId, editing.prop)?.value ?? "";
  host.release();
  const { next } = planned;
  if (next === null) return;
  if (inlineTarget(written, editing.nodeId, next.prop) === null) return;
  host.open(next);
}

/**
 * Listen for Enter and Backspace in an item of a list being typed, and move
 * through its items by them. A key the list takes goes no further, so the
 * edit's own keys (Enter leaving a line) never see it. Returns the way to
 * stop listening.
 */
function listenForItemKeys(
  element: HTMLElement,
  editing: InlineTextEditing,
  host: () => ItemMoveHost
): () => void {
  const onKey = (event: KeyboardEvent) => {
    const current = host();
    const plan = itemKeyPlan(
      event,
      element,
      editing,
      () => current.editor.document
    );
    if (plan === null) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    // A held Enter's auto-repeat adds no run of empty items.
    if (event.repeat && event.key === "Enter") return;
    moveThroughItems(current, element, editing, plan);
  };
  element.addEventListener("keydown", onKey);
  return () => element.removeEventListener("keydown", onKey);
}

/**
 * @param editor - the editor state whose document is being edited
 * @param onFinished - told when a key's way out of the line was refused and
 *   the line stays open with the words in it, so a host can say why
 * @returns the current edit, the ways in and out, and the canvas handler
 */
export function useInlineText(
  editor: EditorState,
  onFinished?: (outcome: InlineEditOutcome) => void
): UseInlineTextResult {
  const [editing, setEditing] = useState<InlineTextEditing | null>(null);
  /*
   * The document the canvas is drawn in, which a keyboard caller's edit is
   * found in: the frame's when the canvas is in one. The editor's own
   * document holds no block there.
   */
  const { document: canvasDocument } = useCanvasFrame();
  /** The element handed over for the duration, so the exit can find it again. */
  const elementRef = useRef<HTMLElement | null>(null);

  /*
   * Read through refs inside the listeners below rather than captured as
   * dependencies. The listeners are attached once per edit, and closing over
   * these would pin the document they saw when the caret went in — so a commit
   * would be decided against a document that may have changed underneath.
   */
  const editorRef = useRef(editor);
  editorRef.current = editor;
  const editingRef = useRef(editing);
  editingRef.current = editing;
  /*
   * The host's ear, and the value as it was when the caret went in. The
   * second tells a write that replaces it from one that would replace a NEWER
   * value another surface, an undo or a remote change put there meanwhile. It
   * is recorded once per edit (`openedFor`), so a frame replacing its
   * document mid-edit keeps the same baseline.
   */
  const session = useRef<{
    finished?: (outcome: InlineEditOutcome) => void;
    opened: string | null;
    openedFor: InlineTextEditing | null;
    /*
     * Where the caret goes in the next edit opened: across its value, unless
     * Enter or Backspace moved it there from the item beside it.
     */
    caretAt: CaretPlace;
  }>({ opened: null, openedFor: null, caretAt: "all" });
  session.current.finished = onFinished;

  /** Take the element back, whatever else happens. */
  const release = useCallback(() => {
    const element = elementRef.current;
    elementRef.current = null;
    setEditing(null);
    if (element === null) return;
    element.removeAttribute("contenteditable");
    element.removeAttribute(EDITING_ATTRIBUTE);
    return element;
  }, []);

  /**
   * The op that stores what the element holds, or `null` when there is
   * nothing to store: an unchanged value, or one that stopped being editable
   * while the caret was in it — see `inlineTextOp`.
   */
  const commitOp = useCallback(
    (current: InlineTextEditing, next: string): BuilderOp | null =>
      current.exposure === undefined
        ? inlineTextOp(
            editorRef.current.document,
            current.nodeId,
            current.prop,
            next
          )
        : exposedCommitOp(editorRef.current, current.exposure, next),
    []
  );

  /**
   * What finishing the edit would do, decided ONCE for every way out — a key,
   * a click away, or the host — so no exit writes what another refuses:
   *
   * - nothing to write: nothing typed, or the element has left the page with
   *   nothing to hold the words in;
   * - refused, because the value moved on while it was typed (writing would
   *   replace newer words with older ones) or stopped being editable (a lock
   *   arrived, so there is nowhere to write it);
   * - otherwise the write.
   */
  const decide = useCallback((): Finish => {
    const element = elementRef.current;
    const current = editingRef.current;
    if (element === null || current === null) return NOTHING_TO_WRITE;
    // The element's text (`elementWords`, with a `<br>` read as `\n`) rather
    // than `innerText` or `innerHTML`: the first is what
    // the value IS regardless of what the element ended up containing, and the
    // last would store markup this value cannot hold.
    const next = editedWords(element, current);
    const opened = session.current.opened;
    if (next === opened || !element.isConnected) return NOTHING_TO_WRITE;
    const refused = stalenessOf(editorRef.current, current, opened);
    if (refused !== null) return { refused };
    const op = commitOp(current, next);
    return op === null ? NOTHING_TO_WRITE : { op };
  }, [commitOp]);

  /**
   * The host's way out. It cannot leave the line open, because it is closing
   * or opening something else, so a refused or rejected write gives the line
   * back unwritten and says the words were lost.
   */
  const commit = useCallback(() => {
    const finish = decide();
    release();
    if ("refused" in finish) {
      session.current.finished?.(INLINE_EDIT_DISCARDED);
      return null;
    }
    if (finish.op === undefined) return null;
    const written = editorRef.current.apply(finish.op);
    if (written === null) session.current.finished?.(INLINE_EDIT_DISCARDED);
    return written;
  }, [decide, release]);

  /**
   * The author's way out, by a key or a click away: the write is made first
   * and the edit ends only once the page has taken it. The refusal's reason
   * when the line stays open with the words in it, because they are the
   * author's only copy: {@link decide}'s refusals, and the page refusing the
   * write (a size cap).
   */
  const commitOrHold = useCallback((): InlineEditRefusal | null => {
    const finish = decide();
    if ("refused" in finish) return finish.refused;
    if (
      finish.op !== undefined &&
      editorRef.current.apply(finish.op) === null
    ) {
      return "rejected";
    }
    release();
    return null;
  }, [decide, release]);

  const cancel = useCallback(() => {
    const element = elementRef.current;
    const current = editingRef.current;
    // Put back what the document holds before letting go. Without it the
    // abandoned text stays on screen until something else re-renders the
    // canvas, and the author sees an edit they explicitly discarded.
    if (element !== null && current !== null) {
      // The opened value where the document's is no longer editable here, so
      // a line held after a lock arrived still shows what the page holds.
      const restored =
        liveValueOf(editorRef.current, current) ?? session.current.opened;
      if (restored !== null) element.textContent = restored;
    }
    release();
  }, [release]);

  const begin = useCallback((nodeId: string, prop?: string) => {
    const target = namedTarget(
      inlineTargets(editorRef.current.document, nodeId),
      prop
    );
    if (target !== undefined) {
      setEditing({ nodeId: target.nodeId, prop: target.prop });
      return true;
    }
    // Not a node of the page: a component's exposed text, reached through
    // its placement, when it is one.
    if (prop === undefined) return false;
    const exposure = exposedTarget(editorRef.current, nodeId, prop);
    if (exposure === undefined) return false;
    setEditing({ nodeId, prop, exposure });
    return true;
  }, []);

  const onDoubleClick = useCallback(
    (event: { target: EventTarget | null }) => {
      const found = editableFrom(event.target);
      if (found === null) return;
      if (begin(found.nodeId, found.prop)) elementRef.current = found.element;
    },
    [begin]
  );

  /*
   * Hand the element over, and take it back on the way out.
   *
   * In an effect rather than in `begin` so the handover happens after React has
   * finished rendering: setting `contentEditable` and focusing mid-render
   * fights whatever the renderer is about to commit.
   */
  useEffect(() => {
    if (editing === null) return;
    /*
     * The element a press handed over, while it is still the page's: a frame
     * that replaces its document mid-edit leaves it in the discarded page, and
     * the value is then found again in the page the canvas now draws.
     */
    const held = elementRef.current;
    const current =
      held !== null &&
      held.isConnected &&
      (canvasDocument === null || held.ownerDocument === canvasDocument)
        ? held
        : null;
    const element =
      current ??
      (canvasDocument === null
        ? null
        : editableElement(canvasDocument, editing));
    if (element === null) {
      // Nothing on screen carries this value. The node may have been removed
      // between the request and this effect; dropping the edit is the honest
      // answer, and leaving `editing` set would show a caret nobody can see.
      setEditing(null);
      return;
    }
    // The page it was typed into is gone, but the typing is not committed:
    // it goes on in the new page's element rather than being lost with it.
    if (held !== null && held !== element) {
      element.textContent = held.textContent;
    }
    elementRef.current = element;
    if (session.current.openedFor !== editing) {
      session.current.openedFor = editing;
      session.current.opened = liveValueOf(editorRef.current, editing) ?? null;
    }

    element.setAttribute("contenteditable", "plaintext-only");
    element.setAttribute(EDITING_ATTRIBUTE, editing.prop);
    element.focus();
    placeCaret(element, session.current.caretAt);
    session.current.caretAt = "all";

    /*
     * The words a keyboard exit's write was refused with, while the line
     * stays open. The next deliberate Escape over the SAME words lets them
     * go: the author's way out of a write the page will not take. Words
     * revised since are a new write, tried again.
     */
    let refusedWith: string | null = null;
    const tryToLeave = () => {
      const words = elementWords(element);
      const refusal = commitOrHold();
      refusedWith = refusal === null ? null : words;
      if (refusal !== null) {
        session.current.finished?.({ status: "refused", reason: refusal });
      }
    };
    const exitByKey = () => {
      const words = elementWords(element);
      if (refusedWith !== null && words === refusedWith) {
        cancel();
        return;
      }
      tryToLeave();
    };
    /*
     * Enter and Backspace in an item of a list: a listener of their own,
     * added before the one below so a key the list takes goes no further.
     */
    const stopItemKeys = listenForItemKeys(
      element,
      editing,
      itemMoveHostOf(editorRef, editing, session, {
        release,
        session,
        setEditing,
      })
    );
    const onKeyDown = (event: KeyboardEvent) => {
      // Escape keeps what was typed and ends the edit, as Enter does on a
      // line: the editor's design asks for it, and an author pressing Escape
      // to get out of the text expects their words to stay. Stopped here, so
      // it is the NEXT Escape that selects the block's parent. A held key's
      // auto-repeat is not a second press, so it neither writes nor discards.
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        if (event.repeat) return;
        exitByKey();
        return;
      }
      if (event.key !== "Enter") return;
      const target =
        editing.exposure ??
        inlineTarget(editorRef.current.document, editing.nodeId, editing.prop);
      // Enter belongs to the VALUE: a line break in a paragraph, and the way
      // out of a heading. The schema says which, so a block changing a field
      // from one type to the other changes this with it.
      if (target?.multiline === true) return;
      event.preventDefault();
      if (event.repeat) return;
      tryToLeave();
    };
    /*
     * Stopped at the element rather than by teaching the canvas about editing.
     * Selection and dragging both listen on the canvas root, so a press inside
     * the text would start a drag instead of placing the caret — and the rule
     * belongs to the element that is currently something else.
     */
    const swallow = (event: Event) => event.stopPropagation();

    element.addEventListener("keydown", onKeyDown);
    element.addEventListener("blur", tryToLeave);
    element.addEventListener("pointerdown", swallow);
    element.addEventListener("click", swallow);
    element.addEventListener("dblclick", swallow);
    return () => {
      stopItemKeys();
      element.removeEventListener("keydown", onKeyDown);
      element.removeEventListener("blur", tryToLeave);
      element.removeEventListener("pointerdown", swallow);
      element.removeEventListener("click", swallow);
      element.removeEventListener("dblclick", swallow);
    };
  }, [editing, cancel, commit, commitOrHold, canvasDocument, release]);

  return { editing, begin, commit, cancel, onDoubleClick };
}
