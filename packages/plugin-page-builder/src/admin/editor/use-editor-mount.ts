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
  placementRefusalMessage,
  type BlockDocument,
  type DefinitionsById,
  type DocumentKind,
  type DocumentLimits,
  type LocatedPlacementBreak,
} from "@nextlyhq/blocks-engine";
import { deepActiveElement, isHTMLElement } from "@nextlyhq/builder";
import {
  type ComponentFieldsHost,
  type ComponentVariantsHost,
  type NoticeQueue,
  type EditorState,
  type UseInlineEditingResult,
  CANVAS_ROOT_CLASS,
  useCanvasFrame,
  inspectInstance,
  lockViewOf,
  partOfComponentSentence,
  createOpenPassages,
  useInlineEditing,
  type OpenPassages,
  useNoticeQueue,
  type BuilderShellProps,
  type ComponentVerbsHost,
  type TurnIntoChoice,
  type InlineEditOutcome,
} from "@nextlyhq/builder/shell";
import {
  loadInlineRichTextEditor,
  useCurrentUserId,
  useDocumentLocale,
  usePluginClientConfig,
} from "@nextlyhq/plugin-sdk/admin";
// From @nextlyhq/ui rather than sonner: the Toaster the admin mounts is ui's,
// and sonner keeps its queue in module state, so a toast published into another
// bundled copy would never reach it.
import { toast } from "@nextlyhq/ui";
import { useCallback, useMemo, useRef, useState, type RefObject } from "react";

import type { ComponentFromSelectionAction } from "../../library-contract";
import { useEditedComponentFacts } from "../component-facts-client";
import {
  useComponentLibrary,
  type ComponentLibraryRead,
} from "../component-library-client";
import type { ComponentActionRequest } from "../ComponentActionPrompt";
import { ensureEditorBlocksRegistered } from "../contributed-blocks";
import { readDocumentLimits } from "../page-render-inputs";
import {
  useMayCreateComponent,
  useMayCreatePattern,
  useMayUpdatePattern,
} from "../pattern-capability-client";
import { useEditedComponentVariants } from "../variant-use-client";

import { shellPreferenceStore } from "./editor-preference-stores";
import { useRestorableEditorState } from "./restore-as-edit";
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
  if (outcome.reason === "no-longer-editable")
    return "That block can't be edited any more, so your text was not saved. It is still on screen \u2014 copy what you need, then press Escape.";
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
   * A canvas in a frame is found through the frame: its root is in the
   * frame's document, where the editor's own holds no canvas, and the frame
   * element is what takes focus into the page.
   *
   * A canvas sharing the editor's document is found by its REGION rather than
   * its root: the root is a plain div with no tabindex, so focusing it does
   * nothing, while the region the shell wraps it in is `tabIndex={0}` because
   * a keyboard author has to be able to scroll the page. Found by walking up
   * from the root rather than by its label, which is display copy.
   */
  const { frame } = useCanvasFrame();
  const returnFocusTo = useCallback((): HTMLElement | null => {
    if (openedFrom?.isConnected === true) return openedFrom;
    if (frame !== null) return frame;
    const root = window.document.querySelector(`.${CANVAS_ROOT_CLASS}`);
    const region = root?.closest<HTMLElement>("[tabindex]") ?? null;
    return region;
  }, [openedFrom, frame]);

  return { document, returnFocusTo, open, close };
}

/** What {@link useMakeComponentVerb} returns, handed on as `makeComponent`. */
type MakeComponentVerb = {
  /** What the author asked for, or `null` while no form is up. */
  readonly request: {
    readonly action: ComposeAction;
    readonly document: BlockDocument;
    /** For "Turn into component…": which ways are open. */
    readonly choice?: TurnIntoChoice;
  } | null;
  readonly returnFocusTo: () => HTMLElement | null;
  readonly open: (action: ComposeAction, choice?: TurnIntoChoice) => void;
  readonly close: () => void;
  /** The verbs as the shared verb chain takes them, with the author's grant. */
  readonly verbs: ComponentVerbsHost;
};

/** Every composition verb whose form the editor raises. */
type ComposeAction =
  | ComponentFromSelectionAction
  | ComponentActionRequest["action"];

/**
 * Raising a composition form: the same gesture as the pattern form's (the
 * open passage committed first, the opener remembered), plus which verb was
 * asked for.
 */
function useMakeComponentVerb(
  editor: { document: BlockDocument },
  inline: { commit: () => InlineEditOutcome },
  definitions: DefinitionsById
): MakeComponentVerb {
  const gesture = useSavePatternVerb(editor, inline);
  const [action, setAction] = useState<{
    readonly verb: ComposeAction;
    readonly choice?: TurnIntoChoice;
  }>({ verb: "convert" });
  const openGesture = gesture.open;
  const open = useCallback(
    (next: ComposeAction, choice?: TurnIntoChoice) => {
      setAction(choice === undefined ? { verb: next } : { verb: next, choice });
      openGesture();
    },
    [openGesture]
  );
  const request = useMemo(
    () =>
      gesture.document === null
        ? null
        : {
            action: action.verb,
            document: gesture.document,
            ...(action.choice === undefined ? {} : { choice: action.choice }),
          },
    [action, gesture.document]
  );
  const mayCreate = useMayCreateComponent();
  const mayUpdatePattern = useMayUpdatePattern();
  const verbs = useMemo(
    () => ({
      mayCreate,
      mayUpdatePattern,
      definitions,
      // One form for both ways, opening on replacing the blocks unless only
      // keeping them is open.
      onTurnIntoComponent: (choice: TurnIntoChoice) =>
        open(
          choice.replaceRefused === undefined ? "convert" : "save-as",
          choice
        ),
      onDetachComponent: () => open("detach"),
      onDuplicateComponent: () => open("duplicate"),
      onUpdatePattern: () => open("update-pattern"),
    }),
    [mayCreate, mayUpdatePattern, definitions, open]
  );
  return {
    request,
    returnFocusTo: gesture.returnFocusTo,
    open,
    close: gesture.close,
    verbs,
  };
}

/** Open a component alone, from a placement when one is named. */
type OpenComponent = (componentId: string, nodeId?: string) => void;

/**
 * The toast's options after a double-click on a placement's own content: an
 * "Edit component" action opening that component from this placement, since
 * the rest of its content is edited there. Nothing for an author who may not
 * edit components, where `open` is undefined.
 */
export function partOfToastOptions(
  inspection: { readonly componentId: string; readonly nodeId: string },
  open: OpenComponent | undefined
): { action?: { label: string; onClick: () => void } } {
  if (open === undefined) return {};
  return {
    action: {
      label: "Edit component",
      onClick: () => open(inspection.componentId, inspection.nodeId),
    },
  };
}

/**
 * The component opener the "Part of" toast offers. The view that builds it is
 * made after the mount, from what the mount returns, so it is handed over by
 * `offerEditComponent` rather than passed in.
 */
function useComponentOpener(): {
  openComponent: RefObject<OpenComponent | undefined>;
  offerEditComponent: (open: OpenComponent | undefined) => void;
} {
  const openComponent = useRef<OpenComponent | undefined>(undefined);
  const offerEditComponent = useCallback((open: OpenComponent | undefined) => {
    openComponent.current = open;
  }, []);
  return { openComponent, offerEditComponent };
}

/**
 * What the canvas's inline editing tells the author: an edit that did not
 * save, and the component a clicked part of a placement belongs to.
 */
function useInlineNotices(
  editor: EditorState,
  componentLibrary: ComponentLibraryRead
): {
  announce: (outcome: InlineEditOutcome) => void;
  partOf: (placementId: string, heldExposureId?: string) => void;
  offerEditComponent: (open: OpenComponent | undefined) => void;
} {
  const { openComponent, offerEditComponent } = useComponentOpener();
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
    (placementId: string, heldExposureId?: string) => {
      // With the editor's lock view, so a field a lock the component sets
      // holds is said in the reason the panel shows for its row.
      const inspection = inspectInstance(
        editor.document,
        placementId,
        componentLibrary.definitions,
        componentLibrary.components,
        lockViewOf(editor)
      );
      if (inspection !== null) {
        toast.info(
          partOfComponentSentence(inspection, heldExposureId),
          // Read when the toast is raised, so the opener the view gave last
          // is the one offered.
          partOfToastOptions(inspection, openComponent.current)
        );
      }
    },
    [editor, componentLibrary, openComponent]
  );
  return { announce, partOf, offerEditComponent };
}

/**
 * What the editor asks the server about the author and the document as it
 * mounts: whether the author may save a pattern, and, for a component, what
 * its live definition holds and how many documents place it, and how many
 * placements chose each of its variants, which its own document cannot say
 * (nothing for a page).
 */
function useServerReads(initialDocument: BlockDocument): {
  readonly mayCreatePattern: boolean;
  readonly componentFacts: ComponentFieldsHost | undefined;
  readonly componentVariants: ComponentVariantsHost | undefined;
} {
  return {
    mayCreatePattern: useMayCreatePattern(),
    componentFacts: useEditedComponentFacts(initialDocument),
    componentVariants: useEditedComponentVariants(initialDocument),
  };
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
  // With a recovery point's restore as one edit, so the author can undo it.
  const editor = useRestorableEditorState(
    {
      initialDocument,
      limits: documentLimits,
      // The SAME map the canvas draws with, so an edit is refused when the page
      // would no longer compose with it in — every surface reaches the page
      // through this apply, and this is the one place the reason is known.
      definitions: componentLibrary.definitions,
      onRefused: refusal => notices.raise(refusal.sentence),
      // A lock refusal, said the same way: the author reads why, in words.
      onLockRefused: refusal => notices.raise(refusal.sentence),
      // A block a component locks is refused naming the component, as the
      // panel's held row names it, from the library the canvas draws with.
      componentName: id =>
        componentLibrary.components.find(component => component.id === id)
          ?.title,
      // What the next save judges locks against, so the editor refuses exactly
      // what that save would.
      stored,
      // An edit that would put a block where it may not go is refused by the op
      // store whichever surface asked for it, so the author is told why here
      // rather than seeing the edit silently not happen.
      onPlacementRefused: refusal => notices.raise(placementSentence(refusal)),
    },
    kinds
  );
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
  const { announce, partOf, offerEditComponent } = useInlineNotices(
    editor,
    componentLibrary
  );
  const { inline, passages, locale } = useInlineAndInspector(
    editor,
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
  const { mayCreatePattern, componentFacts, componentVariants } =
    useServerReads(initialDocument);
  // The make-component verbs, and whether this author holds their grants.
  const makeComponent = useMakeComponentVerb(
    editor,
    inline,
    componentLibrary.definitions
  );
  /*
   * Where the shell keeps this author's panel, device and zoom: under their
   * own id, so two authors of one browser each get their own. While no one is
   * known it keeps nothing; the shell moves to the author's store once their
   * id arrives.
   */
  const userId = useCurrentUserId();
  const preferenceStore = useMemo(() => shellPreferenceStore(userId), [userId]);

  return {
    initialDocument,
    clientConfig,
    documentLimits,
    componentLibrary,
    notices,
    editor,
    inline,
    passages,
    locale,
    savePattern,
    mayCreatePattern,
    makeComponent,
    componentVerbs: makeComponent.verbs,
    preferenceStore,
    userId,
    componentFacts,
    componentVariants,
    offerEditComponent,
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
  /** The inspector's open passages; see `createOpenPassages`. */
  passages: OpenPassages;
  /** The language being edited, by code, when the document has one. */
  locale: string | undefined;
  inline: UseInlineEditingResult;
  savePattern: SavePatternVerb;
  mayCreatePattern: boolean;
  makeComponent: MakeComponentVerb;
  /** The make-component verbs as the shared verb chain takes them. */
  componentVerbs: ComponentVerbsHost;
  /** Where the shell keeps the signed-in author's preferences. */
  preferenceStore: NonNullable<BuilderShellProps["store"]>;
  /** The signed-in author, whose recent pages the title switcher shows. */
  userId: string | null;
  /** What the inspector is told about the component being edited, if any. */
  componentFacts: ComponentFieldsHost | undefined;
  /** What the variants section is told about the component, if any. */
  componentVariants: ComponentVariantsHost | undefined;
  /** Give the "Part of" toast the opener its Edit component action calls. */
  offerEditComponent: (open: OpenComponent | undefined) => void;
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

/**
 * What the canvas's inline editing and the inspector share:
 * - the registry the inspector's rich-text fields hold an open passage in,
 *   lent to the inline editing, whose commit finishes them before a save, and
 *   to the inspector; one per mounted editor;
 * - the language being edited, which the inspector's relation searches read
 *   titles in.
 */
function useInlineAndInspector(
  editor: EditorState,
  announce: (outcome: InlineEditOutcome) => void,
  partOf: (placementId: string, heldExposureId?: string) => void
): {
  inline: UseInlineEditingResult;
  passages: OpenPassages;
  locale: string | undefined;
} {
  const [passages] = useState(createOpenPassages);
  const locale = useDocumentLocale()?.code ?? undefined;
  const inline = useInlineEditing(
    editor,
    loadInlineRichTextEditor,
    announce,
    partOf,
    passages
  );
  return { inline, passages, locale };
}
