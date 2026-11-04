// @vitest-environment jsdom

/**
 * The builder's document view: which field it edits, and what it draws when
 * the document may not be edited.
 *
 * The admin hands the view the document's whole form and the declaration of
 * the one field it opened for. Everything the editor does reaches the form
 * through that declaration's name, so a view that bound to the wrong field, or
 * to the first blocks field it found, would draw a working editor over the
 * wrong value and commit the author's work into it. The cases below give the
 * form two document-holding fields so that difference shows.
 *
 * The editor's own state is replaced with a small stateful stand-in, as
 * `BlocksField.hostCommit.test` does and for its reason: the subject is what
 * the view seeds the editor with and where an edit lands, not the canvas.
 *
 * @module admin/editor/PageBuilderView.test
 */
import {
  DOCUMENT_FORMAT_VERSION,
  type BlockDocument,
} from "@nextlyhq/blocks-engine";
import { coreBlocks } from "@nextlyhq/blocks-react/blocks";
import type { DocumentViewProps } from "@nextlyhq/plugin-sdk/admin";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import * as React from "react";
import {
  useForm,
  useWatch,
  type Control,
  type FieldValues,
} from "react-hook-form";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { BlocksFieldConfig } from "../../fields/blocks-options";

/** Each document the editor was seeded with, in mount order. */
const seeded: BlockDocument[] = [];

/** Replaces the open editor's document, as one undoable edit would. */
let edit: ((next: BlockDocument) => void) | undefined;

/** The form's values as last rendered, which is what a save would send. */
let values: FieldValues | undefined;

/** The saved copy the open editor last judged locks against. */
let lastStored: BlockDocument | undefined;

/** Resets the host's form, as a save does to what the server stored. */
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
      children,
    }: {
      onExit?: () => void;
      children?: React.ReactNode;
    }): React.JSX.Element => (
      <div>
        <header aria-label="Editor actions">
          <button type="button" onClick={onExit}>
            Leave editor
          </button>
        </header>
        {children}
      </div>
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
     * Records what it was seeded with, and keeps an edit as a NEW document
     * with a deeper history — so the document handed back on leaving is one
     * only an edit could have produced.
     */
    useEditorState: ({
      initialDocument,
      stored,
    }: {
      initialDocument: BlockDocument;
      stored?: BlockDocument;
    }) => {
      lastStored = stored;
      const [document, setDocument] = React.useState(() => {
        seeded.push(initialDocument);
        return initialDocument;
      });
      const [undoDepth, setUndoDepth] = React.useState(0);
      edit = next => {
        setDocument(next);
        setUndoDepth(depth => depth + 1);
      };
      return {
        document,
        selectedId: null,
        selection: { ids: [], primary: null },
        apply: () => null,
        applyAll: () => null,
        select: () => {},
        undo: () => {},
        redo: () => {},
        canUndo: undoDepth > 0,
        canRedo: false,
        undoDepth,
      };
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
  // The canvas's media read, answering nothing: these cases draw no image.
  // One function for every call, as the admin's own hook keeps it.
  useMediaResolver: (
    read => () =>
      read
  )(() => Promise.resolve(null)),
  // The host's font table, which the real entry re-exports from core.
  WEB_FONT_FORMATS: (await import("nextly/config")).WEB_FONT_FORMATS,
  // The media library, drawn as nothing: these cases never open it.
  MediaPickerDialog: () => null,
  loadInlineRichTextEditor: () => new Promise<never>(() => {}),
  // No preview here: the surrounding editor offers none.
  useDocumentPreview: () => null,
  // No one signed in: the editor keeps no preferences.
  useCurrentUserId: () => null,
  usePluginClientConfig: () => undefined,
  // A saved page around the view, as the admin draws it at that page's own
  // address.
  useDocumentIdentity: () => ({
    kind: "collection",
    slug: "pages",
    documentId: "p1",
  }),
  navigateTo: vi.fn(),
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
  // The header's controls the bar places; drawn by the admin, not here.
  DocumentSaveIndicator: () => null,
  DocumentPrimaryAction: () => null,
  useDocumentActions: () => null,
  useDocumentStatus: () => null,
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

const BODY_TEXT = "The words in the body field";
const CONTENT_TEXT = "The words in the content field";

/** A document only an edit produces, unlike either field's stored value. */
const EDITED = pageSaying("The words after the edit");

/**
 * A blocks field's declaration, checked against the plugin's own shape and
 * then handed over as the admin hands it. `FieldConfig` is the closed union of
 * the built-in shapes, and a contributed type such as `blocks` has no arm in
 * it.
 */
function declaration(config: BlocksFieldConfig): DocumentViewProps["field"] {
  return config as never;
}

const CONTENT_FIELD = declaration({ name: "content", type: "blocks" });

/** The view's way back to the edit form. */
const exit = vi.fn();

/** Records the form's values on every render. */
function Values({
  control,
}: {
  control: Control<FieldValues>;
}): React.JSX.Element | null {
  values = useWatch({ control });
  return null;
}

/**
 * A document form holding TWO document-valued fields, with the view opened for
 * the one `field` names.
 */
function Host({
  field = CONTENT_FIELD,
  fieldPath,
  readOnly = false,
  stored = {
    body: pageSaying(BODY_TEXT),
    content: pageSaying(CONTENT_TEXT),
  },
}: {
  field?: DocumentViewProps["field"];
  fieldPath?: string;
  readOnly?: boolean;
  stored?: FieldValues;
}): React.JSX.Element {
  const { control, reset } = useForm<FieldValues>({ defaultValues: stored });
  resetForm = reset;
  return (
    <>
      <PageBuilderView
        control={control}
        field={field}
        {...(fieldPath === undefined ? {} : { fieldPath })}
        readOnly={readOnly}
        exit={exit}
      />
      <Values control={control} />
    </>
  );
}

/** The editor's own chrome, which only an editable view draws. */
function editorChrome(): HTMLElement | null {
  return screen.queryByRole("banner", { name: "Editor actions" });
}

beforeEach(() => {
  seeded.length = 0;
  edit = undefined;
  values = undefined;
  lastStored = undefined;
  resetForm = undefined;
  exit.mockClear();
});

afterEach(() => {
  cleanup();
});

describe("the field the view edits", () => {
  it("seeds the editor from the named field's value, not another's", () => {
    render(<Host />);

    // By value, because the form keeps a copy of its defaults. The other
    // field holds a well-formed page too, so an editor bound to it would be
    // seeded with a plausible document and fail here only on its words.
    expect(seeded).toEqual([pageSaying(CONTENT_TEXT)]);
  });

  it("holds locks against the named field's saved copy, and follows it when a save resets the form", () => {
    render(<Host />);
    expect(lastStored).toEqual(pageSaying(CONTENT_TEXT));

    // A save resets the form to what the server stored. The editor then
    // judges the next edit against that page, not the one it opened with.
    act(() => resetForm?.({ body: pageSaying(BODY_TEXT), content: EDITED }));

    expect(lastStored).toEqual(EDITED);
  });

  it("commits an edit into the named field on leaving, and leaves the other alone", () => {
    render(<Host />);
    act(() => edit?.(EDITED));
    fireEvent.click(screen.getByRole("button", { name: "Leave editor" }));

    expect(values?.content).toEqual(EDITED);
    expect(values?.body).toEqual(pageSaying(BODY_TEXT));
    expect(exit).toHaveBeenCalledTimes(1);
  });

  it("follows the declaration's name, so the same form opened for the other field edits that one", () => {
    // The control for the two cases above: a view that always bound to
    // `content` would pass both.
    render(<Host field={declaration({ name: "body", type: "blocks" })} />);
    act(() => edit?.(EDITED));
    fireEvent.click(screen.getByRole("button", { name: "Leave editor" }));

    expect(seeded).toEqual([pageSaying(BODY_TEXT)]);
    expect(values?.body).toEqual(EDITED);
    expect(values?.content).toEqual(pageSaying(CONTENT_TEXT));
  });
});

describe("a field inside a named group", () => {
  const HERO_TEXT = "The words in the hero's own page";
  // The group's field shares its name with a top-level one, so a view that
  // bound by the declaration's own name would reach a well-formed page and
  // fail only on its words.
  const nested = {
    field: declaration({ name: "body", type: "blocks" }),
    fieldPath: "hero.body",
    stored: {
      body: pageSaying(BODY_TEXT),
      hero: { body: pageSaying(HERO_TEXT) },
    },
  };

  it("edits the field at its path, and leaves the top-level field of that name alone", () => {
    render(<Host {...nested} />);
    expect(seeded).toEqual([pageSaying(HERO_TEXT)]);

    act(() => edit?.(EDITED));
    fireEvent.click(screen.getByRole("button", { name: "Leave editor" }));

    expect(values?.hero).toEqual({ body: EDITED });
    expect(values?.body).toEqual(pageSaying(BODY_TEXT));
  });

  it("draws the page at its path while read-only", () => {
    const { container } = render(<Host {...nested} readOnly />);

    expect(container.textContent).toContain(HERO_TEXT);
    expect(container.textContent).not.toContain(BODY_TEXT);
  });
});

describe("moving to another field's address", () => {
  it("keeps each field's page to itself", () => {
    // The admin keeps the view mounted when `?field=` changes, and the editor
    // reads its document once, when it mounts. One that stayed would go on
    // showing the first field's page while writing into the second: an edit
    // made after the move would then save content's page into body.
    const view = render(<Host />);
    act(() => edit?.(EDITED));

    view.rerender(
      <Host field={declaration({ name: "body", type: "blocks" })} />
    );

    // The editor for body starts from body's own page...
    expect(seeded).toEqual([pageSaying(CONTENT_TEXT), pageSaying(BODY_TEXT)]);
    // ...and the work done on content went to content as its editor left.
    expect(values?.content).toEqual(EDITED);
    expect(values?.body).toEqual(pageSaying(BODY_TEXT));

    // An edit after the move lands in body and leaves content as it was.
    const AFTER = pageSaying("Written after the move");
    act(() => edit?.(AFTER));
    fireEvent.click(screen.getByRole("button", { name: "Leave editor" }));
    expect(values?.body).toEqual(AFTER);
    expect(values?.content).toEqual(EDITED);
  });
});

describe("a document that may not be edited", () => {
  it("draws the editor when the document may be edited", () => {
    // The control for the case below: the chrome it asserts absent is drawn
    // here, by the same stand-in, so its absence there is not an artefact of
    // the stand-in drawing nothing.
    render(<Host />);

    expect(editorChrome()).not.toBeNull();
  });

  it("draws the page and no editor while it is read-only", () => {
    const { container } = render(<Host readOnly />);

    expect(editorChrome()).toBeNull();
    // Not merely hidden: no editor was mounted, so nothing could be seeded
    // or commit into the form.
    expect(seeded).toEqual([]);
    expect(
      container.querySelector('[data-slot="page-miniature-surface"]')
    ).not.toBeNull();
    expect(container.textContent).toContain(CONTENT_TEXT);
    expect(container.textContent).not.toContain(BODY_TEXT);
  });
});

describe("a field with no name", () => {
  it("draws nothing rather than binding to no field", () => {
    // The declaration type allows a nameless field (an unnamed group's), which
    // has no value in the form to edit. The control is every case above, where
    // a named field draws the editor.
    const { container } = render(
      <Host field={declaration({ type: "blocks" } as BlocksFieldConfig)} />
    );

    expect(editorChrome()).toBeNull();
    expect(seeded).toEqual([]);
    expect(container.textContent).toBe("");
  });
});

describe("an empty field", () => {
  it("is seeded as the kind its declaration accepts", () => {
    // A component store seeded as a page is refused on save, so the editor
    // has to read what an empty document must be from the field it opened.
    render(
      <Host
        field={declaration({
          name: "content",
          type: "blocks",
          blocks: { kinds: ["component"] },
        })}
        stored={{ body: undefined, content: undefined }}
      />
    );

    expect(seeded.map(document => document.kind)).toEqual(["component"]);
  });

  it("is seeded as a page when the declaration names no kinds", () => {
    // The control: the kind above comes from the declaration, not from an
    // editor that seeds components whatever the field says.
    render(<Host stored={{ body: undefined, content: undefined }} />);

    expect(seeded.map(document => document.kind)).toEqual(["page"]);
  });
});
