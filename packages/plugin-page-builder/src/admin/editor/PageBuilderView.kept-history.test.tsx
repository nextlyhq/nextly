// @vitest-environment jsdom

/**
 * The builder's undo history, kept while the view draws the read-only page.
 *
 * When the document's lock is lost (a connection that dropped, a colleague who
 * took it over) the admin hands the view `readOnly`, and the view draws the
 * page in place of the editor. Taking the lock back mounts the editor again,
 * and a new editor starts with an empty history: the author's undo was gone.
 * The view keeps the history of the editor it unmounted for that, and the
 * editor that mounts again on the same page, for the same person, carries on
 * with it. On any other page (someone else's change loaded meanwhile) it
 * starts fresh, since the kept inverses describe the page before that change.
 *
 * The editor state is the real one; the shell around it is stood in for as
 * `PageBuilderView.test` does, since the subject is the history alone.
 *
 * @module admin/editor/PageBuilderView.kept-history.test
 */
import {
  DOCUMENT_FORMAT_VERSION,
  type BlockDocument,
} from "@nextlyhq/blocks-engine";
import { coreBlocks } from "@nextlyhq/blocks-react/blocks";
import type {
  EditorState,
  useEditorState as realUseEditorState,
} from "@nextlyhq/builder/shell";
import type { DocumentViewProps } from "@nextlyhq/plugin-sdk/admin";
import { act, cleanup, render } from "@testing-library/react";
import * as React from "react";
import { useForm, type FieldValues } from "react-hook-form";
import { ShortcutProvider, TooltipProvider } from "@nextlyhq/ui";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { BlocksFieldConfig } from "../../fields/blocks-options";
import { closedDocumentSession } from "../../__tests__/closed-document-session";

/** The open editor's state as last rendered. */
let live: EditorState | undefined;

/** Who is signed in. */
let signedIn: string | null = "author-1";

/** The document around the view. */
let identity = { kind: "collection", slug: "pages", documentId: "p1" };

/** Resets the host's form, as loading another version of the document does. */
let resetForm: ((next: FieldValues) => void) | undefined;

// The editor asks the session's grants for shared styles; this file is not
// about them, so the author holds the right to change the site's design.
vi.mock("@nextlyhq/plugin-sdk/client", () => ({
  useCan: (permission: string) => permission === "update-site-style",
}));

vi.mock("@nextlyhq/builder/shell", async importOriginal => {
  const real = await importOriginal<Record<string, unknown>>();
  const nothing = (): null => null;
  const passthrough = ({
    children,
  }: {
    children?: React.ReactNode;
  }): React.JSX.Element => <>{children}</>;
  return {
    ...real,
    /*
     * The real shell's banner, by the name it carries there, with the exit
     * behind a button a test can press. Named, so the read-only case can
     * assert the editor's chrome is absent and the editable cases show what
     * that absence is measured against.
     */
    BuilderShell: ({
      onExit,
      exitLabel,
      topBarEnd,
      children,
      canvasStrip,
    }: {
      onExit?: () => void;
      exitLabel?: string;
      topBarEnd?: React.ReactNode;
      children?: React.ReactNode;
      canvasStrip?: React.ReactNode;
    }): React.JSX.Element => (
      // The providers the real shell gives what it draws: its shortcut
      // manager and its tooltips.
      <ShortcutProvider>
        <TooltipProvider>
          <div>
            <header aria-label="Editor actions">
              {/* Named by the host's words for it where it gives some, as
                  the real arrow is. */}
              <button type="button" onClick={onExit}>
                {exitLabel ?? "Leave editor"}
              </button>
              {/* The host's controls at the bar's end: the ⋯ menu. */}
              {topBarEnd}
            </header>
            {/* The real shell's strip slot, above the canvas. */}
            {canvasStrip === undefined ? null : (
              <div data-testid="canvas-strip">{canvasStrip}</div>
            )}
            {children}
          </div>
        </TooltipProvider>
      </ShortcutProvider>
    ),
    BreakpointManager: nothing,
    BreakpointSwitcher: nothing,
    InspectorPanel: nothing,
    Canvas: nothing,
    BlockKeyboardActions: passthrough,
    BlockContextMenu: passthrough,
    BlockToolbar: nothing,
    EditorCommandPalette: nothing,
    DropIndicator: nothing,
    InsertPanel: nothing,
    RepairNotice: nothing,
    LayersPanel: nothing,
    TokensPanel: nothing,
    OnboardingChecklist: nothing,
    SelectionBreadcrumb: nothing,
    SpacingOverlay: nothing,
    useBuilderChecklist: () => ({
      visible: false,
      steps: [],
      dismiss: () => {},
    }),
    useCanvasDrag: () => ({
      handlers: {},
      target: null,
      draggingId: null,
      draggingBlockName: null,
    }),
    /*
     * The real editor state, held where a case can reach it: the subject is
     * the history the view keeps for it, so nothing about it is stood in for.
     */
    useEditorState: (args: Parameters<typeof realUseEditorState>[0]) => {
      const state = (real.useEditorState as typeof realUseEditorState)(args);
      live = state;
      return state;
    },
    useInlineEditing: () => ({
      editing: null,
      editingRich: null,
      begin: () => false,
      commit: () => ({ status: "unchanged" }),
      cancel: () => {},
      onDoubleClick: () => {},
    }),
  };
});

/** Asking the stored style again, as the editor does after a save. */
const refetchStoredStyle = async () => ({ isError: false });
// The stored site style arrives through the editor's one read, the plugin's
// route; that read's request is asserted in `site-style-read.test`.
vi.mock("../site-style-read", () => ({
  useStoredSiteStyle: () => ({
    data: undefined,
    isPending: false,
    error: null,
    refetch: refetchStoredStyle,
  }),
}));

vi.mock("@nextlyhq/plugin-sdk/admin", async () => ({
  // The empty page's starter pages read, offering none: no case here starts
  // a page from one.
  readPluginRoute: async () => ({ items: [] }),
  // The canvas's media read, answering nothing: these cases draw no image.
  // One function for every call, as the admin's own hook keeps it.
  useMediaResolver: (
    read => () =>
      read
  )(() => Promise.resolve(null)),
  // The Fallback picker's library search, finding nothing: no case here
  // opens it. One function for every call, as the admin's own hook keeps it.
  useMediaSearcher: (
    search => () =>
      search
  )(() => Promise.resolve([])),
  // The host's font table, which the real entry re-exports from core.
  WEB_FONT_FORMATS: (await import("nextly/config")).WEB_FONT_FORMATS,
  // The media library, drawn as nothing: these cases never open it.
  MediaPickerDialog: () => null,
  // The media library's upload, which an Image's empty state offers: these
  // cases upload nothing.
  useUploadMedia: () => ({ mutateAsync: () => new Promise<never>(() => {}) }),
  loadInlineRichTextEditor: () => new Promise<never>(() => {}),
  // No preview here: the surrounding editor offers none.
  useDocumentPreview: () => null,
  // Who is signed in, as each case sets it.
  useCurrentUserId: () => signedIn,
  // What the editor remembers for a signed-in person, kept nowhere.
  devicePreferenceStore: () => ({
    read: () => null,
    write: () => {},
    remove: () => {},
  }),
  // The schema never moves here.
  schemaVersion: () => 1,
  onSchemaChange: () => () => {},
  usePluginClientConfig: () => undefined,
  // A saved page around the view, as the admin draws it at that page's own
  // address.
  useDocumentIdentity: () => identity,
  navigateTo: vi.fn(),
  // Where the page's collection opens, as each case sets it.
  useDocumentOpensIn: () => null,
  PIN_TO_DASHBOARD_ACTION: "pin-to-dashboard",
  useDocumentLocale: () => null,
  /*
   * Every plugin read answers with nothing. A disabled read is modelled the
   * way TanStack treats one — nothing requested, still pending — because the
   * read-only page reads the component library only for a page that places a
   * component, and a stub answering a read that was never made would let it
   * wait on nothing.
   */
  usePluginRoute: (args: { enabled?: boolean }) => ({
    data: undefined,
    pending: args.enabled === false,
    error: null,
    refetch: () => {},
  }),
  usePluginRouteMutation: () => ({
    write: async () => ({ message: "", item: {} }),
    pending: false,
    error: null,
  }),
  apiErrorMessage: (_error: unknown, fallback: string) => fallback,
  validationIssues: () => [],
  toastMutationResult: () => {},
  useDocumentCheckpoint: () => ({ schedule: () => {} }),
  useEntryFieldsPanel: () => null,
  useReportUnsavedWork: () => {},
  useSuppressAdminChrome: () => {},
  // The form's storing gate, which site style writes are tracked with.
  useTrackedWrite: () => () => {},
  useBeforeDocumentAction: () => {},
  // The session a header edited in place opens; none is opened here.
  useDocumentSession: () => closedDocumentSession(),
  // The header's controls the bar places; drawn by the admin, not here.
  DocumentSaveAndPublish: () => null,
  useDocumentLifeStage: () => null,
  useDocumentActions: () => null,
  useDocumentStatus: () => null,
  // The admin's words for a document's state, which a template's strip
  // draws the previewed entry's status in.
  PILL_LABEL: {
    draft: "Draft",
    modified: "Modified",
    changed: "Changed",
    published: "Published",
  },
  // The editor registers its restore; nothing here offers one.
  useDocumentRestore: () => undefined,
  // Nothing stored, read successfully: the site's style is ready, so the
  // read-only page is drawn rather than held back for a sheet still coming.
  useUpdateSingleDocument: () => ({
    mutateAsync: async () => ({ success: true }),
    isPending: false,
  }),
}));

// Imported after the mocks, which is what makes them take effect.
const { PageBuilderView } = await import("./PageBuilderView");

// What Radix's menu reaches for and jsdom lacks.
Element.prototype.hasPointerCapture ??= () => false;
Element.prototype.releasePointerCapture ??= () => {};
Element.prototype.scrollIntoView ??= () => {};

/*
 * The block's OWN version rather than a literal: the renderer drops a node
 * whose version it cannot reconcile, and it drops it silently.
 */
const TEXT = coreBlocks.find(block => block.name === "core/text");
if (!TEXT) throw new Error("core/text is missing from coreBlocks");
const { name: TEXT_TYPE, version: TEXT_VERSION } = TEXT;

/** A page holding one passage, so where it was drawn from can be told. */
function pageSaying(text: string): BlockDocument {
  return {
    formatVersion: DOCUMENT_FORMAT_VERSION,
    kind: "page",
    nodes: [
      {
        id: "passage",
        type: TEXT_TYPE,
        version: TEXT_VERSION,
        props: { text },
      },
    ],
  } as unknown as BlockDocument;
}

const STORED_TEXT = "The words as stored";
const EDITED_TEXT = "The words after the edit";

/**
 * A blocks field's declaration, checked against the plugin's own shape and
 * then handed over as the admin hands it.
 */
function declaration(config: BlocksFieldConfig): DocumentViewProps["field"] {
  return config as never;
}

const CONTENT_FIELD = declaration({ name: "content", type: "blocks" });
const BODY_FIELD = declaration({ name: "body", type: "blocks" });

/** A document form, with the view opened for the field `field` names. */
function Host({
  field = CONTENT_FIELD,
  readOnly = false,
}: {
  field?: DocumentViewProps["field"];
  readOnly?: boolean;
}): React.JSX.Element {
  const { control, reset } = useForm<FieldValues>({
    defaultValues: {
      body: pageSaying("The body field's page"),
      content: pageSaying(STORED_TEXT),
    },
  });
  resetForm = reset;
  return (
    <PageBuilderView
      control={control}
      field={field}
      readOnly={readOnly}
      exit={() => {}}
    />
  );
}

/** The open editor's state; fails the case where none is open. */
function editor(): EditorState {
  if (live === undefined) throw new Error("no editor is open");
  return live;
}

/** The passage's words in the open editor's page. */
function passageText(): unknown {
  return editor().document.nodes[0]?.props.text;
}

/** Selects the passage and edits its words, as one undoable edit. */
function editThePassage(): void {
  act(() => editor().select("passage"));
  act(() => {
    editor().apply({
      kind: "update",
      id: "passage",
      patch: { props: { text: EDITED_TEXT } },
    });
  });
  expect(passageText()).toBe(EDITED_TEXT);
}

/** The lock lost and then taken back: read-only, then editable again. */
function loseAndRetake(view: ReturnType<typeof render>, between = () => {}) {
  view.rerender(<Host readOnly />);
  // The editor is gone while the page is read-only.
  live = undefined;
  between();
  view.rerender(<Host readOnly />);
  view.rerender(<Host />);
}

beforeEach(() => {
  live = undefined;
  signedIn = "author-1";
  identity = { kind: "collection", slug: "pages", documentId: "p1" };
  resetForm = undefined;
});

afterEach(() => {
  cleanup();
});

describe("the editor after the lock comes back", () => {
  it("undoes the edit made before the lock was lost, with the selection kept", () => {
    const view = render(<Host />);
    editThePassage();

    loseAndRetake(view);

    expect(passageText()).toBe(EDITED_TEXT);
    expect(editor().canUndo).toBe(true);
    expect(editor().selectedId).toBe("passage");
    act(() => {
      editor().undo();
    });
    expect(passageText()).toBe(STORED_TEXT);
    act(() => {
      editor().redo();
    });
    expect(passageText()).toBe(EDITED_TEXT);
  });

  it("starts fresh when another version of the page was loaded meanwhile", () => {
    // A colleague's save loaded as the lock came back: undo would put the
    // page from before it back, over their work.
    const view = render(<Host />);
    editThePassage();

    loseAndRetake(view, () =>
      act(() =>
        resetForm?.({
          body: pageSaying("The body field's page"),
          content: pageSaying("A colleague's words"),
        })
      )
    );

    expect(passageText()).toBe("A colleague's words");
    expect(editor().canUndo).toBe(false);
    expect(editor().canRedo).toBe(false);
    expect(editor().selectedId).toBeNull();
  });

  it("starts fresh for another person signed in meanwhile", () => {
    const view = render(<Host />);
    editThePassage();

    loseAndRetake(view, () => {
      signedIn = "author-2";
    });

    expect(editor().canUndo).toBe(false);
  });

  it("starts fresh on another document", () => {
    const view = render(<Host />);
    editThePassage();

    loseAndRetake(view, () => {
      identity = { kind: "collection", slug: "pages", documentId: "p2" };
    });

    expect(editor().canUndo).toBe(false);
  });

  it("keeps nothing for an editor that closed for another reason", () => {
    // Moving to another field and back is not the lock: the editor that
    // opens again starts fresh, as it always has.
    const view = render(<Host />);
    editThePassage();

    view.rerender(<Host field={BODY_FIELD} />);
    view.rerender(<Host field={CONTENT_FIELD} />);

    expect(passageText()).toBe(EDITED_TEXT);
    expect(editor().canUndo).toBe(false);
  });

  it("keeps nothing once the view itself has closed", () => {
    // Leaving the builder for good: a view opened again later starts fresh.
    const view = render(<Host />);
    editThePassage();
    view.rerender(<Host readOnly />);
    view.unmount();
    live = undefined;

    render(<Host />);

    expect(editor().canUndo).toBe(false);
  });
});
