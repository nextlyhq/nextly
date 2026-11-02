/**
 * Mounting the editor: the registry, the document it opens with, the site's
 * caps and component library, and the editor state built from them, with the
 * inline-text surface and the save-as-pattern verb that act on that state.
 *
 * @module @nextlyhq/plugin-page-builder/admin/editor/use-editor-mount
 */
import {
  blockLabelFrom,
  getBlock,
  isComponentDocument,
  placementRefusalMessage,
  type BlockDocument,
  type DocumentKind,
  type DocumentLimits,
  type LocatedPlacementBreak,
} from "@nextlyhq/blocks-engine";
import { deepActiveElement, isHTMLElement } from "@nextlyhq/builder";
import {
  type ComponentFieldsHost,
  type NoticeQueue,
  type EditorState,
  type UseInlineEditingResult,
  CANVAS_ROOT_CLASS,
  inspectInstance,
  partOfComponentSentence,
  useEditorState,
  useInlineEditing,
  useNoticeQueue,
  userPreferenceStore,
  type BuilderShellProps,
  type InlineEditOutcome,
} from "@nextlyhq/builder/shell";
import {
  loadInlineRichTextEditor,
  useCurrentUserId,
  useDocumentIdentity,
  usePluginClientConfig,
} from "@nextlyhq/plugin-sdk/admin";
// From @nextlyhq/ui rather than sonner: the Toaster the admin mounts is ui's,
// and sonner keeps its queue in module state, so a toast published into another
// bundled copy would never reach it.
import { toast } from "@nextlyhq/ui";
import { useCallback, useMemo, useState } from "react";

import { useComponentFacts } from "../component-facts-client";
import {
  useComponentLibrary,
  type ComponentLibraryRead,
} from "../component-library-client";
import { ensureEditorBlocksRegistered } from "../contributed-blocks";
import { readDocumentLimits } from "../page-render-inputs";
import { useMayCreatePattern } from "../pattern-capability-client";

import { useConnectStyleHistory } from "./site-style-history";
import { documentFrom, PLUGIN_SOURCE } from "./stored-document";
import { finishInlineEdit } from "./use-host-commit";

/**
 * What to tell the author when an inline edit did not save, or `null` when
 * there is nothing to say.
 *
 * Said at all because nothing else would. An inline edit lives in the element
 * until it ends, so the document never records it, the dirty flag never moves,
 * and an edit that could not be written leaves no trace for the author to
 * notice — they would find the old words back on the page and no reason given.
 *
 * The two refusals are separated because only one of them is theirs to act on:
 * a passage that outgrew the page can be shortened, while one that was edited
 * elsewhere cannot be reconciled from here, and the useful thing to say is that
 * their version is still on screen for as long as they leave it there.
 */
function inlineEditProblem(outcome: InlineEditOutcome): string | null {
  if (outcome.status === "unavailable")
    return "Another block is still holding text that has not been saved. Finish that one first.";
  if (outcome.status === "discarded")
    return "That block changed while you were editing it, so your text was not saved.";
  if (outcome.status !== "refused") return null;
  return outcome.reason === "moved-on"
    ? "That block was edited somewhere else while you were typing. Your text is still in it \u2014 copy what you need before you leave."
    : "Your text could not be saved into this page. Shortening it may help.";
}

/** What {@link useSavePatternVerb} returns, and what the editor hands on as `savePattern`. */
type SavePatternVerb = {
  /** The document to save from, or `null` when the author has not asked. */
  readonly document: BlockDocument | null;
  /** Where focus should go when the form closes, asked at that moment. */
  readonly returnFocusTo: () => HTMLElement | null;
  readonly open: () => void;
  readonly close: () => void;
};

/**
 * Raising the save-as-pattern form, and everything that has to be true first.
 *
 * A hook rather than three pieces of state in the editor, and not only because
 * that function is the most complex in the package: the three are one gesture.
 * An open passage has to be committed before the document is worth saving, the
 * document that comes back is what the form must store, and the control the
 * author pressed has to be remembered before it loses focus. Split across the
 * editor they would be three things to keep in step; here the order is the
 * function body.
 */
export function useSavePatternVerb(
  editor: { document: BlockDocument },
  inline: { commit: () => InlineEditOutcome }
): SavePatternVerb {
  const [document, setDocument] = useState<BlockDocument | null>(null);
  /*
   * The opener, read at the GESTURE.
   *
   * The toolbar button, the menu item or the palette row still has focus while
   * this runs, and by the time the dialog is mounting it does not — measured,
   * it has gone even by Radix's own "about to take focus" hook. This is the
   * last moment it is knowable.
   */
  const [openedFrom, setOpenedFrom] = useState<HTMLElement | null>(null);

  const open = useCallback(() => {
    /*
     * An open inline passage is COMMITTED first, and its document is what the
     * form saves.
     *
     * A rich-text editor holds the author's words itself while they type — the
     * canvas keeps the caret still — so `editor.document` during an open
     * passage is the one from before it. A form snapshotting that stores a
     * pattern missing the words on screen, silently.
     *
     * A REFUSED commit declines to open the form at all, for the reason the
     * exit gesture declines to close: the words are in the passage and nowhere
     * else, and the author has been told what happened.
     */
    const finished = finishInlineEdit(inline, editor.document);
    if (!finished.mayClose) return;
    // Read through any focused frame, and classified by node kind: a control
    // inside a canvas mounted in an iframe is that window's element, and from
    // here focus on it reads only as the iframe around it.
    const active = deepActiveElement(window.document);
    setOpenedFrom(isHTMLElement(active) ? active : null);
    setDocument(finished.document);
  }, [editor.document, inline]);

  const close = useCallback(() => setDocument(null), []);

  /*
   * Resolved at the CLOSE, not at the open.
   *
   * The control that raised the form is usually gone by then: a context-menu
   * item unmounts with its menu, and a palette row with the palette. Focusing a
   * detached node does nothing and leaves the author on the body, at the top of
   * the page — so the fallback is the editor itself.
   *
   * The canvas REGION rather than the canvas root: the root is a plain div with
   * no tabindex, so focusing it does nothing, while the region the shell wraps
   * it in is `tabIndex={0}` because a keyboard author has to be able to scroll
   * the page. Found by walking up from the root rather than by its label, which
   * is display copy.
   */
  const returnFocusTo = useCallback((): HTMLElement | null => {
    if (openedFrom?.isConnected === true) return openedFrom;
    const root = window.document.querySelector(`.${CANVAS_ROOT_CLASS}`);
    const region = root?.closest<HTMLElement>("[tabindex]") ?? null;
    return region;
  }, [openedFrom]);

  return { document, returnFocusTo, open, close };
}

/**
 * Everything the editor is mounted from, read once per opening.
 *
 * Called by the component that is mounted only while the editor is open, so
 * none of it runs for an entry form whose editor is closed.
 */
export function useEditorMount(
  initialValue: unknown,
  /** The kinds the field accepts, so a seeded document is one it will take. */
  kinds: readonly DocumentKind[] | undefined,
  /**
   * The field's value as last loaded or saved, which locks keep against;
   * undefined for an entry never saved.
   */
  savedValue?: unknown
): EditorMount {
  // The core blocks and every block a plugin contributed, before anything
  // reads the registry. Inside the component that mounts the editor rather
  // than at module scope: this file is imported by the field control, which
  // every entry form holding a blocks field renders whether or not the editor
  // is ever opened.
  ensureEditorBlocksRegistered();

  const initialDocument = useMemo(
    () => documentFrom(initialValue, kinds),
    [initialValue, kinds]
  );
  const stored = useMemo(
    () =>
      savedValue === undefined ? undefined : documentFrom(savedValue, kinds),
    [savedValue, kinds]
  );
  const clientConfig = usePluginClientConfig(PLUGIN_SOURCE);
  /*
   * The site's document caps, read once.
   *
   * Four readers — the editor's own apply, the renderer inputs, which repair
   * the document against them, the class-usage count and the drag. Read
   * separately they would agree until the day one of them was pointed at a
   * different config. The editor is the reader that must not be missed: an
   * apply judged under the engine's defaults refuses, silently, an edit to a
   * page that is legal only under a cap this site raised, after the insert's
   * preflight and the canvas both accepted it.
   */
  const documentLimits = useMemo(
    () => readDocumentLimits(clientConfig),
    [clientConfig]
  );
  /*
   * The site's component definitions, read once per editor and at DRAFT
   * posture. Without them the renderer draws the could-not-be-loaded marker
   * for every instance on the page, which is what the editor showed before
   * this read: a component placed in the builder rendered on the site and
   * nowhere an author could see while editing.
   */
  const componentLibrary = useComponentLibrary();
  /*
   * Where a refusal the editor makes is said. The shell provides a sink to
   * everything it renders, and this editor is built ABOVE the shell — so the
   * host owns the queue, hands it to the shell to draw and provide, and
   * raises into it from here.
   */
  const notices = useNoticeQueue();
  const editor = useEditorState({
    initialDocument,
    limits: documentLimits,
    // The SAME map the canvas draws with, so an edit is refused when the page
    // would no longer compose with it in — every surface reaches the page
    // through this apply, and this is the one place the reason is known.
    definitions: componentLibrary.definitions,
    onRefused: refusal => notices.raise(refusal.sentence),
    // A lock refusal, said the same way: the author reads why, in words.
    onLockRefused: refusal => notices.raise(refusal.sentence),
    // What the next save judges locks against, so the editor refuses exactly
    // what that save would.
    stored,
    // An edit that would put a block where it may not go is refused by the op
    // store whichever surface asked for it, so the author is told why here
    // rather than seeing the edit silently not happen.
    onPlacementRefused: refusal => notices.raise(placementSentence(refusal)),
  });
  // A shared style change saved while this editor is open is a step of its
  // history, so the editor connects the history to the style writers.
  useConnectStyleHistory(editor.recordStep);

  /*
   * Typing a block's text on the canvas. The hook owns the caret; which values
   * may be typed into is the block's own declaration, read by the builder, and
   * WHICH editor a value gets is that declaration too.
   *
   * The rich-text loader is passed rather than imported by the builder, because
   * it reaches Lexical and the builder must not: one copy of Lexical is what
   * keeps its node classes recognisable, and this package is already on the
   * admin side of that line.
   */
  /*
   * ONE place the author is told about an inline edit that did not save.
   *
   * Passed to the hook rather than read from what `commit` returns here,
   * because most edits do not end by this component calling `commit`. Leaving
   * the passage ends one; so does opening another, and so does this canvas
   * unmounting. The outcome that most needs saying — a passage whose block was
   * deleted or locked while the author typed into it — is reached almost
   * entirely by the first of those, so reporting from the return value alone
   * said nothing on the common path.
   */
  const announce = useCallback((outcome: InlineEditOutcome) => {
    const problem = inlineEditProblem(outcome);
    if (problem !== null) toast.error(problem);
  }, []);
  /*
   * A double-click on text a component does not expose selects the placement
   * (the hook does that) and says whose the text is, with the variant, so the
   * gesture is never met with nothing. Read against the same library the
   * canvas draws with. A toast rather than the builder's notice queue, which
   * holds failures: this is information, and it fades.
   */
  const partOf = useCallback(
    (placementId: string) => {
      const inspection = inspectInstance(
        editor.document,
        placementId,
        componentLibrary.definitions,
        componentLibrary.components
      );
      if (inspection !== null) toast.info(partOfComponentSentence(inspection));
    },
    [editor.document, componentLibrary]
  );
  const inline = useInlineEditing(
    editor,
    loadInlineRichTextEditor,
    announce,
    partOf
  );

  // Whether the save-as-pattern form is up. A boolean here rather than the form
  // itself, because the verb that raises it belongs to the shared chain — the
  // toolbar, the context menu and the palette all reach it — while everything
  // the form needs is mounted only while it is up. See `SavePatternPrompt`.
  const savePattern = useSavePatternVerb(editor, inline);
  /*
   * Whether this author may create a pattern at all, read EAGERLY here.
   *
   * Beside the verb it gates rather than inside it: the toolbar, the context
   * menu and the command palette all offer the verb from one shared action
   * list, so the answer has to exist before any of them draws — and asking in
   * three places would be three requests answering one question.
   */
  const mayCreatePattern = useMayCreatePattern();
  // Asked only of a component with a row: what its live definition holds and
  // how many documents place it, which its own document cannot say.
  const identity = useDocumentIdentity();
  const componentFacts = useComponentFacts(
    isComponentDocument(initialDocument) ? identity?.documentId : undefined
  );

  /*
   * Where the shell keeps this author's panel, device and zoom: under their
   * own id, so two authors of one browser each get their own. While no one is
   * known it keeps nothing; the shell moves to the author's store once their
   * id arrives.
   */
  const userId = useCurrentUserId();
  const preferenceStore = useMemo(() => userPreferenceStore(userId), [userId]);

  return {
    initialDocument,
    clientConfig,
    documentLimits,
    componentLibrary,
    notices,
    editor,
    inline,
    savePattern,
    mayCreatePattern,
    preferenceStore,
    componentFacts,
  };
}

/** What mounting the editor produced, for the hooks that build on it. */
export type EditorMount = {
  initialDocument: BlockDocument;
  clientConfig: Record<string, unknown> | undefined;
  documentLimits: DocumentLimits;
  componentLibrary: ComponentLibraryRead;
  notices: NoticeQueue;
  editor: EditorState;
  inline: UseInlineEditingResult;
  savePattern: SavePatternVerb;
  mayCreatePattern: boolean;
  /** Where the shell keeps the signed-in author's preferences. */
  preferenceStore: NonNullable<BuilderShellProps["store"]>;
  /** What the inspector is told about the component being edited, if any. */
  componentFacts: ComponentFieldsHost | undefined;
};

/**
 * A placement refusal as the author reads it: the engine's wording, which the
 * server uses for the same refusal on a save, with the editor's block labels.
 */
function placementSentence(refusal: LocatedPlacementBreak): string {
  return placementRefusalMessage(refusal.verdict, {
    labelOf: type => blockLabelFrom(type, getBlock(type)),
  });
}
