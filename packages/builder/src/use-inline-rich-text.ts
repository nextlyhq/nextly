"use client";

/**
 * Editing a block's passage directly on the canvas.
 *
 * The DOM half of {@link module:inline-rich-text}, which decides WHAT may be
 * edited; this decides how. The split is the same one the plain-text pair
 * makes, and earns its keep the same way: the rules are asserted without a
 * browser, and the part that genuinely needs one stays small enough to read.
 *
 * ## ONE editor, moved between passages
 *
 * The editor is not built here. It is loaded from the admin facade, which hands
 * over four operations rather than Lexical itself — because building an editor
 * means importing Lexical, and a second copy of Lexical anywhere produces nodes
 * that fail their own `instanceof` checks, with content saving and reading back
 * as plain text on documents that already saved.
 *
 * It is loaded on FIRST EDIT rather than on mount. The node classes carry a
 * 630KB chunk, and an author who never edits a passage should never fetch it.
 *
 * ## The subtree is given back exactly as it was found
 *
 * React renders the passage from the document; the editor then owns that DOM
 * for the duration and rewrites it as the author types. When the edit ends,
 * React's picture of the subtree is whatever it last rendered, and the real DOM
 * is whatever the editor left — so a later render would diff against a tree
 * that is no longer there and patch around the editor's nodes.
 *
 * So the markup is snapshotted before the handover and restored after it, on
 * EVERY exit rather than only on cancel. That puts the DOM back in agreement
 * with React, and a committed edit then re-renders from the document the
 * ordinary way, because the op changed it.
 *
 * @module use-inline-rich-text
 */

import { useCallback, useEffect, useRef, useState } from "react";

import type { EditorState } from "./editor-state";
import {
  INLINE_EDIT_DISCARDED,
  INLINE_EDIT_UNAVAILABLE,
  INLINE_EDIT_UNCHANGED,
  type InlineEditOutcome,
} from "./inline-edit-outcome";
import {
  richInlineTargets,
  richInlineTextOp,
  richTextChanged,
  richTextMovedOn,
} from "./inline-rich-text";
import { namedTarget } from "./inline-target";
import { editableElement, EDITING_ATTRIBUTE } from "./use-inline-text";

/** Where a point falls in a document's text, however this engine spells it. */
interface CaretLocator {
  /** WebKit and Chromium. */
  caretRangeFromPoint?: (x: number, y: number) => Range | null;
  /** The standard spelling, which Firefox implements. */
  caretPositionFromPoint?: (
    x: number,
    y: number
  ) => { offsetNode: Node; offset: number } | null;
}

/** A point where the author pressed, in client coordinates. */
export interface CaretPoint {
  readonly x: number;
  readonly y: number;
}

/**
 * The text position under a point, as a range.
 *
 * Two spellings because no single one is implemented everywhere, and both are
 * optional because a runtime may have neither — jsdom does not, which is one of
 * the reasons this behaviour cannot be observed there at all.
 */
function caretRangeAt(
  document: Document,
  point: CaretPoint
): { container: Node; offset: number } | undefined {
  const locator: CaretLocator = document;
  const range = locator.caretRangeFromPoint?.(point.x, point.y);
  if (range)
    return { container: range.startContainer, offset: range.startOffset };
  const position = locator.caretPositionFromPoint?.(point.x, point.y);
  if (position)
    return { container: position.offsetNode, offset: position.offset };
  return undefined;
}

/**
 * Where the author's pointer fell inside an element, as a character offset into
 * its text.
 *
 * Taken from the POINT rather than from the document's selection, and that is
 * the whole difficulty. A press on a block is a grab, not a text selection —
 * the canvas suppresses the browser's own selection so that dragging a block
 * does not highlight its words — so at the moment a double-click arrives there
 * is no selection to read. Measured in a browser: `rangeCount` is 0. An earlier
 * version of this read the selection and therefore always answered `undefined`,
 * which sent every edit's caret to the end of the passage.
 *
 * Counted rather than kept as a range, because attaching REBUILDS the subtree:
 * a range captured now points at nodes that will not be in the document by the
 * time there is an editor to hand it to. An offset survives that.
 *
 * `undefined` when the point is outside this element or the engine cannot
 * locate it — both meaning "no better answer than the editor's own".
 */
function caretOffsetAt(
  element: HTMLElement,
  point: CaretPoint
): number | undefined {
  const found = caretRangeAt(element.ownerDocument, point);
  if (found === undefined) return undefined;
  if (!element.contains(found.container)) return undefined;
  const upToCaret = element.ownerDocument.createRange();
  upToCaret.selectNodeContents(element);
  try {
    upToCaret.setEnd(found.container, found.offset);
  } catch {
    // The located node is not one this range can end in — an offset past its
    // length, or a node type the range refuses. The editor's own answer stands.
    return undefined;
  }
  return upToCaret.toString().length;
}

/** Which passage is being edited. */
export interface InlineRichTextEditing {
  readonly nodeId: string;
  readonly prop: string;
}

export interface UseInlineRichTextResult {
  /** The passage being edited, or `null` when none is. */
  editing: InlineRichTextEditing | null;
  /**
   * Start editing a passage, reporting whether it could be.
   *
   * `prop` defaults to the block's FIRST declared rich value, which is what a
   * keyboard caller wants: it has a selected block and no element.
   *
   * `element` is the one a pointer landed on. A caller that has it should pass
   * it: finding the element again from the document alone searches the whole
   * page, and two canvases showing one document carry the same node ids — so
   * the search can answer with the other canvas's passage, attaching there
   * while committing here.
   */
  begin: (
    nodeId: string,
    prop?: string,
    element?: HTMLElement,
    point?: CaretPoint
  ) => boolean;
  /**
   * Finish, writing whatever the author left behind.
   *
   * A caller about to hand the document somewhere else needs the outcome, not
   * just the document: its own copy is the one from before this commit, and a
   * REFUSED commit leaves the passage open with the author's words in it, so
   * closing or opening anything else on top of that destroys them.
   */
  commit: () => InlineEditOutcome;
  /** Finish, discarding it. */
  cancel: () => void;
}

/** One consumer's hold on the shared editor, as this module uses it. */
interface EditorSession {
  focus(at?: number): void;
  read(): unknown;
  detach(): void;
  /** Keep this attachment when something else asks for the shared editor. */
  hold(): void;
}

/** What asking the facade for the editor produced, as this module reads it. */
type Attachment =
  | { readonly status: "attached"; readonly session: EditorSession }
  | { readonly status: "refused"; readonly reason: "unsupported" | "held" };

/** The facade's editor, as this module uses it. */
interface LoadedEditor {
  /** Refused for a passage this editor cannot take, or while it is held. */
  attach(element: HTMLElement, value: unknown): Attachment;
}

/**
 * Told how every finished edit turned out.
 *
 * A host cannot learn this from `commit`'s return value alone, because most
 * edits do not end by the host calling `commit`. Leaving the passage ends one,
 * so does opening another, so does the canvas unmounting — and the outcome that
 * most needs saying, an edit whose value stopped being editable while it was
 * open, is reached almost entirely through the first of those. A host reporting
 * only what its own calls returned would say nothing on the common path.
 *
 * Called for EVERY commit including the host's own, so that reporting has one
 * home. A host should read `commit`'s return value for control flow — whether
 * it may close, which document to save — and this for anything it says to the
 * author; doing both from the return value reports the same edit twice.
 */
export type InlineRichTextFinished = (outcome: InlineEditOutcome) => void;

/**
 * How the editor is fetched.
 *
 * A parameter rather than a hard import so the rules of this hook can be
 * exercised without loading Lexical — and because the editor is genuinely
 * optional: a builder embedded somewhere that never supplies one still edits
 * plain text, and a passage simply does not open.
 */
export type InlineRichTextEditorLoader = () => Promise<LoadedEditor>;

/**
 * @param editor - the editor state whose document is being edited
 * @param load - how to obtain the shared rich-text editor
 * @returns the current edit and the ways in and out
 */
export function useInlineRichText(
  editor: EditorState,
  load: InlineRichTextEditorLoader | undefined,
  onFinished?: InlineRichTextFinished
): UseInlineRichTextResult {
  const [editing, setEditing] = useState<InlineRichTextEditing | null>(null);

  /*
   * Read through refs inside the callbacks below rather than captured as
   * dependencies, so a commit is decided against the document as it stands now
   * rather than the one that was current when the caret went in.
   */
  const editorRef = useRef(editor);
  editorRef.current = editor;
  const editingRef = useRef(editing);
  editingRef.current = editing;
  // Held in a ref for the same reason, and for one more: a host passing an
  // inline arrow would otherwise give `commit` a new identity every render, and
  // `commit` is what the handover effect depends on.
  const finishedRef = useRef(onFinished);
  finishedRef.current = onFinished;
  /*
   * The loader, read through a ref for a reason that costs an author their
   * words otherwise.
   *
   * A consumer passing an inline closure — the ordinary way to write
   * `useInlineRichText(editor, () => import("..."))` — gives it a new identity
   * every render. As a DEPENDENCY that reruns the handover effect while the
   * element is still mounted, and the cleanup below deliberately releases a
   * held session because it assumes it is unmounting. So a re-render for any
   * unrelated reason would tear down a passage being kept open precisely
   * because its words exist nowhere else.
   *
   * The effect therefore depends on WHICH passage is being edited, not on how
   * the editor is fetched. A loader that changes mid-edit is not a reason to
   * re-open anything; the chunk in flight is already the right one.
   */
  const loadRef = useRef(load);
  loadRef.current = load;

  /**
   * The element a pointer handed over, used in place of searching for one.
   *
   * A ref rather than state: it is read once by the effect that follows the
   * `begin` it came with, and re-rendering for it would be a render nobody
   * needs.
   */
  const handed = useRef<HTMLElement | null>(null);

  /** Where the pointer fell, when a pointer is what started the edit. */
  const handedPoint = useRef<CaretPoint | null>(null);

  /** The live editor, the element it holds, and what to put back. */
  const mounted = useRef<{
    session: EditorSession;
    element: HTMLElement;
    /**
     * WHICH passage this session was mounted for.
     *
     * Recorded with the session rather than read from the hook's current state
     * when the write happens. A caller that begins a second passage before the
     * first has released changes that state first, and the cleanup that follows
     * would then read the live session — the first passage — while addressing
     * the op with the second's node and prop, copying one block's words over
     * another. Bound here, a session can only ever write to the passage it was
     * opened for.
     */
    editing: InlineRichTextEditing;
    /**
     * The STORED passage the session was handed.
     *
     * Kept so the write can refuse when the document's copy has moved on:
     * another surface, an undo or an op from anywhere else can rewrite the same
     * prop while the caret is open, and this editor is holding a copy from
     * before that.
     */
    opened: unknown;
    /** The editor's own reading of the passage when it opened. */
    baseline: unknown;
  } | null>(null);

  /**
   * Take the subtree back, whatever else happens.
   *
   * Reads nothing. Whether the passage is worth reading is the caller's
   * question, and a `release` that answered it too made every caller look like
   * it had considered the answer.
   */
  const letGo = useCallback(() => {
    const live = mounted.current;
    mounted.current = null;
    setEditing(null);
    if (live === null) return;
    // The element's markup and attributes are the editor's to put back: it is
    // what changed them, and it is what a plugin using the facade directly
    // relies on. Only this module's own mark is this module's to remove.
    live.session.detach();
    live.element.removeAttribute(EDITING_ATTRIBUTE);
  }, []);

  /**
   * Say how an edit turned out, and answer with it.
   *
   * Every path out of `commit` goes through this, so a new one cannot be added
   * that a host never hears about — which is the defect this exists to close:
   * the outcome was reported at the two places the host itself called, and the
   * ways an edit actually ends most often are not those.
   */
  const report = useCallback(
    (outcome: InlineEditOutcome): InlineEditOutcome => {
      finishedRef.current?.(outcome);
      return outcome;
    },
    []
  );

  const commit = useCallback((): InlineEditOutcome => {
    const live = mounted.current;
    if (live === null) {
      // No session, but possibly a pending one: `editing` is set from the
      // moment the passage is requested and the editor arrives later.
      letGo();
      return report(INLINE_EDIT_UNCHANGED);
    }
    /*
     * Let go only once the write is SETTLED, never before.
     *
     * Releasing is what destroys an author's words: they exist in the editor
     * and nowhere else, so tearing it down loses them and puts the page's older
     * copy back in their place with nothing said. So each way of failing to
     * write is asked first, and the ones an author can still act on keep the
     * passage open — their text stays on screen, and Escape still discards it
     * deliberately.
     */
    // Read BEFORE detaching: a detached session answers nothing, deliberately,
    // so that a superseded one cannot read the live passage. Read before
    // JUDGING as well — every refusal below is a refusal to destroy something,
    // so whether there is anything to destroy is the first question.
    const next = live.session.read();
    const typed = richTextChanged(live.baseline, next);
    if (
      richTextMovedOn(
        editorRef.current.document,
        live.editing.nodeId,
        live.editing.prop,
        live.opened
      )
    ) {
      /*
       * The document moved on. Holding the passage open protects an author's
       * words from being replaced by the older copy — but only if they wrote
       * any. A caret that merely sat in a passage has nothing to protect, and
       * refusing there is worse than doing nothing: the host cannot close, and
       * the untouched editor goes on showing the stale passage over the newer
       * one that arrived, until somebody presses Escape.
       */
      if (!typed) {
        letGo();
        return report(INLINE_EDIT_UNCHANGED);
      }
      /*
       * Held at the SHARED editor as well as here. This hook's own `begin`
       * guard covers one canvas; ownership of the editor is global, so a second
       * canvas with its own hook sees nothing mounted and would attach straight
       * over the top of these words.
       */
      live.session.hold();
      return report({ status: "refused", reason: "moved-on" });
    }
    // The passage this session was opened for, not whichever is current now.
    const op = richInlineTextOp(
      editorRef.current.document,
      live.editing.nodeId,
      live.editing.prop,
      next,
      live.baseline,
      live.opened
    );
    if (op === null) {
      /*
       * Nothing to write, and nothing staying open would rescue.
       *
       * `richInlineTextOp` refuses an unchanged passage, one the editor did not
       * return as rich text, and one whose node was deleted or locked while the
       * caret was in it. Only the first is harmless — but for the others the
       * passage has nowhere left to be written to, so holding the editor open
       * would trap the author in a value they cannot leave rather than save
       * anything. Whether their typing was actually lost is worth saying, and
       * the comparison that says it is the same one the op made.
       */
      letGo();
      return report(typed ? INLINE_EDIT_DISCARDED : INLINE_EDIT_UNCHANGED);
    }
    const written = editorRef.current.apply(op);
    if (written === null) {
      /*
       * The op layer refused the group — a cap this passage would exceed, or a
       * node that went between the checks above and the write. Nothing was
       * applied, so the words are still only in the editor and the passage
       * stays open: an author who has hit a cap can shorten what they wrote.
       */
      live.session.hold();
      return report({ status: "refused", reason: "rejected" });
    }
    letGo();
    return report({ status: "written", document: written });
  }, [letGo, report]);

  const cancel = useCallback(() => {
    letGo();
  }, [letGo]);

  const begin = useCallback(
    (
      nodeId: string,
      prop?: string,
      element?: HTMLElement,
      point?: CaretPoint
    ) => {
      if (load === undefined) return false;
      const target = namedTarget(
        richInlineTargets(editorRef.current.document, nodeId),
        prop
      );
      if (target === undefined) return false;
      /*
       * Finish the open passage FIRST, synchronously.
       *
       * Otherwise the old edit's effect cleanup runs after this one's state is
       * installed, and its `commit` clears `editing` — cancelling the passage
       * just requested instead of the one it belongs to. `useInlineEditing`
       * sequences this correctly, but this hook is exported on its own and its
       * `begin` does not oblige a caller to.
       *
       * A commit that REFUSED is still holding the previous passage, and the
       * words in it are the author's only copy. There is one editor, so opening
       * anything else supersedes that session and takes them with it — the
       * request is declined instead, which is what the return value is for.
       */
      if (mounted.current !== null && commit().status === "refused")
        return false;
      handed.current = element ?? null;
      handedPoint.current = point ?? null;
      setEditing({ nodeId: target.nodeId, prop: target.prop });
      return true;
    },
    [commit, load]
  );

  /*
   * Drop an edit the author has already walked away from.
   *
   * The editor arrives asynchronously, and until it does the element is neither
   * focused nor editable — this module marks it inside `attach`. So none of the
   * ordinary ways of leaving a block emit `blur`: clicking the canvas
   * background, selecting another block, or deselecting from the keyboard each
   * change only the selection. Nothing would cancel the pending load, and when
   * it landed it would attach to the passage they left and take the caret back.
   *
   * Only a load that has NOT attached yet is dropped this way. Once the editor
   * is live the element is focused, leaving it blurs, and blur commits — so
   * cancelling here as well would throw away what the author had just typed.
   */
  useEffect(() => {
    if (editing === null || mounted.current !== null) return;
    if (editor.selectedId === editing.nodeId) return;
    cancel();
  }, [editor.selectedId, editing, cancel]);

  /*
   * Hand the subtree over, and take it back on the way out.
   *
   * In an effect rather than in `begin` so the handover happens after React has
   * finished rendering: attaching an editor mid-render fights whatever the
   * renderer is about to commit.
   */
  useEffect(() => {
    if (editing === null) return;
    // Read once, here, rather than depended on — see `loadRef`. A host that
    // supplies no loader edits plain text and simply never opens a passage.
    const fetch = loadRef.current;
    if (fetch === undefined) return;
    if (globalThis.document === undefined) return;
    // The element the gesture landed on, when there was one. Searching the
    // document is the fallback for a keyboard caller, which has no element.
    const element =
      handed.current ?? editableElement(globalThis.document, editing);
    handed.current = null;
    if (element === null) {
      // Nothing on screen carries this passage. The node may have been removed
      // between the request and this effect; dropping the edit is the honest
      // answer, and leaving `editing` set would show a caret nobody can see.
      setEditing(null);
      return;
    }

    let cancelled = false;
    /*
     * The POINT is taken now and the offset from it later.
     *
     * The ref has to be cleared synchronously, or a second edit begun before
     * this one attaches inherits its gesture. The offset must not be computed
     * yet though: it is a character count into the passage, and the passage can
     * be rewritten while the editor loads — an offset measured against the old
     * text lands somewhere unrelated in the new, or past its end. The element
     * still holds what the page rendered when the loader resolves, because this
     * is what replaces it.
     */
    const point = handedPoint.current;
    handedPoint.current = null;
    void fetch().then(
      live => {
        /*
         * The author may have left before the chunk arrived. Attaching then
         * would put a caret into a passage they are no longer editing.
         *
         * All three conditions are asked, because `cancelled` alone is not
         * enough: it is set by an effect CLEANUP, and this callback can run
         * before React has flushed that — so a selection that has already moved
         * is visible here while the cleanup that would record it has not run.
         */
        if (cancelled) return;
        if (editingRef.current !== editing) return;
        if (editorRef.current.selectedId !== editing.nodeId) return;
        /*
         * The ELEMENT can go while the chunk is in flight, without the edit
         * being cancelled: React re-renders the canvas and replaces this
         * subtree, and the node captured before the request is then detached
         * while the passage is still selected and still being edited. None of
         * the three checks above sees that — they ask about the edit, not about
         * the element it was measured against.
         *
         * Attaching anyway puts the editor on a node nobody is looking at: no
         * caret appears, typing goes nowhere visible, and the commit writes
         * back whatever that orphan holds.
         */
        if (!element.isConnected) {
          setEditing(null);
          return;
        }
        /*
         * Read the passage NOW, not before the chunk was requested.
         *
         * An undo, a remote update or another surface can rewrite it while the
         * editor is in flight, and the page has already re-rendered with the
         * new words by the time this runs. Attaching the copy taken earlier
         * puts the caret into content nobody can see any more, and the first
         * thing the author types is refused as `moved-on` — a write lost to a
         * conflict that had already resolved before the editor existed.
         */
        const target = richInlineTargets(
          editorRef.current.document,
          editing.nodeId
        ).find(t => t.prop === editing.prop);
        if (target === undefined) {
          // The passage stopped being editable while the chunk was loading.
          setEditing(null);
          return;
        }
        /*
         * Measured BEFORE the handover, and that ordering is the whole point.
         *
         * Attaching replaces this subtree and applies the editor's own theme —
         * a heading's size, a list's indentation, a table's box all change — so
         * hit-testing afterwards asks where a point falls in a layout the
         * author never saw. It is measured here rather than before the chunk
         * was requested, because the passage may have been rewritten while it
         * was in flight: this is the first moment where what is on screen is
         * also what is about to be edited.
         */
        const caret =
          point === null ? undefined : caretOffsetAt(element, point);
        const attachment = live.attach(element, target.value);
        if (attachment.status === "refused") {
          /*
           * Dropping this edit is right either way: it leaves the passage as the
           * page rendered it, which is the only outcome that cannot lose words,
           * here or in whatever is holding on.
           *
           * The two reasons differ in what a host can say about it. A passage
           * this editor cannot represent is nothing the author did and nothing
           * they can act on, so it passes in silence. An editor busy protecting
           * an edit elsewhere is worth saying: otherwise their gesture appears
           * to do nothing, which is the same silent refusal this module already
           * refuses to ship on the way OUT of an edit.
           */
          setEditing(null);
          if (attachment.reason === "held") report(INLINE_EDIT_UNAVAILABLE);
          return;
        }
        const session = attachment.session;
        element.setAttribute(EDITING_ATTRIBUTE, editing.prop);
        session.focus(caret);
        mounted.current = {
          session,
          element,
          editing,
          // The RAW stored value, kept so the write can tell one unusable value
          // from another — the narrowed form collapses them all to `undefined`.
          opened: target.stored,
          // Taken AFTER the editor loaded the value, so it is the editor's own
          // reading of an untouched passage — which is what makes an unchanged
          // edit compare equal rather than differing by normalisation alone.
          baseline: session.read(),
        };
      },
      () => {
        /*
         * The chunk did not arrive. Leaving `editing` set would show a passage
         * marked as being edited with no editor behind it — and because the
         * element then swallows the double-click that would retry, the author
         * would be locked out of it for the rest of the session.
         *
         * Dropping the edit puts the gesture back in their hands. The loader
         * discards its rejected promise, so the next double-click genuinely
         * tries again rather than replaying the failure.
         */
        if (!cancelled) setEditing(null);
      }
    );

    /*
     * Stopped at the element rather than by teaching the canvas about editing.
     * Selection and dragging both listen on the canvas root, so a press inside
     * the passage would start a drag instead of placing the caret — and the
     * rule belongs to the element that is currently something else.
     */
    const swallow = (event: Event) => event.stopPropagation();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      cancel();
    };

    /*
     * Leaving the passage finishes the edit, as it does for plain text. Enter
     * is deliberately NOT an exit here: a passage holds paragraphs, so Enter
     * belongs to the value.
     */
    const onBlur = () => commit();

    element.addEventListener("keydown", onKeyDown);
    element.addEventListener("blur", onBlur);
    element.addEventListener("pointerdown", swallow);
    element.addEventListener("click", swallow);
    element.addEventListener("dblclick", swallow);
    return () => {
      cancelled = true;
      /*
       * Give the element back on the way out, not only when the author leaves
       * the passage. Unmounting the canvas — a navigation, a field removed,
       * access revoked — removes the focused element without reliably firing
       * `blur`, so nothing else would run: the editor would stay attached to a
       * detached tree, holding its listeners and its state, until some later
       * passage displaced it.
       */
      /*
       * COMMITTED, not discarded. Rich keystrokes go into the editor's own
       * history and never touch the document until an edit finishes, so the
       * canvas op history — which is what the unsaved-work guard reads — is
       * still at zero while a passage is being typed. Detaching without writing
       * would drop the words AND leave the guard silent about it, so a
       * navigation nobody warned about takes the work with it.
       */
      if (mounted.current !== null) {
        commit();
        /*
         * A refusal keeps the session by design, because staying open is what
         * saves the words. Here there is nowhere to stay: the element is being
         * removed, so the choice is between losing the text and ALSO leaving an
         * editor attached to a detached tree, holding its listeners and its
         * state until some later passage displaces it. Released explicitly.
         */
        if (mounted.current !== null) letGo();
      }
      element.removeEventListener("keydown", onKeyDown);
      element.removeEventListener("blur", onBlur);
      element.removeEventListener("pointerdown", swallow);
      element.removeEventListener("click", swallow);
      element.removeEventListener("dblclick", swallow);
    };
  }, [editing, cancel, commit, letGo, report]);

  return { editing, begin, commit, cancel };
}
