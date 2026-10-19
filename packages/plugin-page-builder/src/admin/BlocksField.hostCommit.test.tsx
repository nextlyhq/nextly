// @vitest-environment jsdom

/**
 * What the open editor tells the entry form it sits over.
 *
 * The editor keeps its document to itself until the author leaves, so the form
 * learns about the work in it through three side channels instead: a report
 * that unsaved work exists (which the navigation guard and the save shortcut
 * read), a recovery point holding the WHOLE document with the live layout in
 * it, and a request that the admin hide its own chrome while the editor has the
 * window. Leaving then hands the edited document back as the field's value.
 *
 * Every other suite here stubs those three channels to do nothing, so none of
 * them would notice a channel going quiet or being fed the wrong value. This
 * file records what each channel is told, at rest, at opening and after an
 * edit.
 *
 * The editor's own state is replaced with a small stateful stand-in, because
 * the subject is what this host does when the document CHANGES. Producing a
 * change through the real canvas would need the whole surface, and the change
 * would still be observed here.
 *
 * @module admin/BlocksField.hostCommit.test
 */
import type { BlockDocument } from "@nextlyhq/blocks-engine";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import * as React from "react";
import {
  useForm,
  useWatch,
  type Control,
  type FieldValues,
} from "react-hook-form";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** Each unsaved-work report, as the key it was made under and its value. */
const reports: { key: string; hasWork: boolean }[] = [];

/** Each recovery point the editor handed the form, in render order. */
const snapshots: unknown[] = [];

/** How many times a recovery point was asked to be written. */
let scheduled = 0;

/** Each request to hide the admin's chrome. */
const chromeRequests: { layers: readonly string[]; canExit: boolean }[] = [];

/** The value the field has written back to the form. */
let saved: unknown;

/**
 * The document an open inline passage would produce once written, or `null`
 * when no passage is open. Each commit hands out a NEW copy, as a real write
 * does, so two commits are two values the form can be seen to take.
 */
let passage: BlockDocument | null = null;

/** Replaces the open editor's document, as one undoable edit would. */
let edit: ((next: BlockDocument) => void) | undefined;

/**
 * What the form held for the field each time the view was asked to leave, read
 * at that moment rather than after the render that follows it.
 */
const heldAtExit: unknown[] = [];

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
    // The exit, behind a button a test can press. Asserting on the handler
    // prop instead would pass on a shell that never rendered a way out.
    BuilderShell: ({
      onExit,
      children,
    }: {
      onExit?: () => void;
      children?: React.ReactNode;
    }): React.JSX.Element => (
      <div>
        <button type="button" onClick={onExit}>
          Leave editor
        </button>
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
     * Stateful, so an edit is a NEW document object and a deeper history —
     * the two facts the host reads. A fixed document would leave every channel
     * reporting its opening state whatever the host did with a change.
     */
    useEditorState: ({
      initialDocument,
    }: {
      initialDocument: BlockDocument;
    }) => {
      const [document, setDocument] = React.useState(initialDocument);
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
      editing: passage === null ? null : { id: "h1" },
      editingRich: null,
      begin: () => false,
      commit: () =>
        passage === null
          ? { status: "unchanged" }
          : { status: "written", document: { ...passage } },
      cancel: () => {},
      onDoubleClick: () => {},
    }),
  };
});

vi.mock("@nextlyhq/plugin-sdk/admin", () => ({
  loadInlineRichTextEditor: () => new Promise<never>(() => {}),
  usePluginClientConfig: () => undefined,
  useDocumentIdentity: () => null,
  navigateTo: vi.fn(),
  useDocumentLocale: () => null,
  // Every plugin read answers with nothing: a site with no stored style, no
  // components and no patterns, which none of these cases is about.
  usePluginRoute: () => ({
    data: undefined,
    pending: false,
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
  useDocumentCheckpoint: ({ snapshot }: { snapshot: unknown }) => {
    snapshots.push(snapshot);
    return {
      schedule: () => {
        scheduled += 1;
      },
    };
  },
  useEntryFieldsPanel: () => null,
  useReportUnsavedWork: (key: string, hasWork: boolean) => {
    reports.push({ key, hasWork });
  },
  useSuppressAdminChrome: (request: {
    layers: readonly string[];
    canExit: boolean;
  }) => {
    chromeRequests.push(request);
  },
  useBeforeDocumentAction: () => {},
  useDocumentActions: () => null,
  useDocumentStatus: () => null,
  useSingleDocument: () => ({
    data: undefined,
    isPending: false,
    error: null,
  }),
  useUpdateSingleDocument: () => ({
    mutateAsync: async () => ({ success: true }),
    isPending: false,
  }),
}));

// Imported after the mocks, which is what makes them take effect.
const { BlocksField } = await import("./BlocksField");
const { PageBuilderView } = await import("./editor/PageBuilderView");

/**
 * The blocks field's declaration, as the admin hands it to the view. Typed at
 * the boundary because `FieldConfig` is the closed union of the built-in
 * shapes, and a contributed type such as `blocks` has no arm in it.
 */
const BODY_FIELD = { name: "body", type: "blocks" } as never;

/** A document distinct from the opening one, so a stale hand-back shows. */
const EDITED: BlockDocument = {
  formatVersion: 1,
  kind: "page",
  nodes: [{ id: "h1", type: "core/heading", props: { text: "Edited" } }],
} as BlockDocument;

/** The page once an open passage is written into it. */
const PASSAGE: BlockDocument = {
  formatVersion: 1,
  kind: "page",
  nodes: [
    { id: "h1", type: "core/heading", props: { text: "Typed in place" } },
  ],
} as BlockDocument;

/** Watches what the field writes back, which is what a save persists. */
function Saved({
  control,
}: {
  control: Control<FieldValues>;
}): React.JSX.Element | null {
  saved = useWatch({ control, name: "body" });
  return null;
}

/** The entry's form, which every case here starts from. */
function useEntryForm() {
  return useForm<FieldValues>({
    defaultValues: { title: "About us", body: undefined },
  });
}

/** The edit form with the blocks field at rest in it. */
function FieldHost(): React.JSX.Element {
  const { control } = useEntryForm();
  return (
    <>
      <BlocksField name="body" control={control} />
      <Saved control={control} />
    </>
  );
}

/**
 * The builder's document view over the same form. Its `exit` records what the
 * form held when it was called, so a case can tell a hand-back that happened
 * before leaving from one that never happened.
 */
function ViewHost(): React.JSX.Element {
  const { control, getValues } = useEntryForm();
  return (
    <>
      <PageBuilderView
        control={control}
        field={BODY_FIELD}
        readOnly={false}
        exit={() => {
          heldAtExit.push(getValues("body"));
        }}
      />
      <Saved control={control} />
    </>
  );
}

/** Mount the builder's view, which opens the editor. */
function openEditor(): void {
  render(<ViewHost />);
}

function editDocument(): void {
  act(() => edit?.(EDITED));
}

beforeEach(() => {
  reports.length = 0;
  snapshots.length = 0;
  scheduled = 0;
  chromeRequests.length = 0;
  saved = undefined;
  edit = undefined;
  passage = null;
  heldAtExit.length = 0;
});

afterEach(() => {
  cleanup();
});

describe("at rest", () => {
  it("tells the form nothing while the editor is closed", () => {
    render(<FieldHost />);

    // The field renders on every entry form holding a blocks field, open or
    // not; a channel driven from it would hide the admin's navigation and
    // claim unsaved work for every one of those forms.
    expect(reports).toEqual([]);
    expect(snapshots).toEqual([]);
    expect(chromeRequests).toEqual([]);
  });
});

describe("the unsaved-work report", () => {
  it("reports no work under the field's own key when the editor opens", () => {
    openEditor();

    expect(reports.length).toBeGreaterThan(0);
    expect(reports.every(report => report.key === "blocks:body")).toBe(true);
    expect(reports.at(-1)?.hasWork).toBe(false);
  });

  it("reports work once the document has been edited", () => {
    openEditor();
    editDocument();

    // The control for the case above: a report pinned to `false` passes it.
    expect(reports.at(-1)).toEqual({ key: "blocks:body", hasWork: true });
  });
});

describe("the recovery point", () => {
  it("asks for none for the document the editor opened with", () => {
    openEditor();

    // That document is what the server already holds; recording it would
    // offer the author their own unmodified page as unsaved changes.
    expect(scheduled).toBe(0);
  });

  it("asks for one after an edit, holding the whole document with the live layout", () => {
    openEditor();
    editDocument();

    expect(scheduled).toBeGreaterThan(0);
    // The WHOLE document, because restoring one replaces every value: a
    // snapshot of the layout alone would restore and blank the title.
    expect(snapshots.at(-1)).toEqual({ title: "About us", body: EDITED });
  });
});

describe("the admin's chrome", () => {
  it("is asked to step aside, with a way back, while the editor is open", () => {
    openEditor();

    expect(chromeRequests.at(-1)).toEqual({
      layers: [
        "primaryRail",
        "subSidebar",
        "documentSidebar",
        "header",
        "pageFrame",
      ],
      canExit: true,
    });
  });
});

describe("leaving", () => {
  it("hands the EDITED document back to the form, then leaves", () => {
    openEditor();
    editDocument();
    fireEvent.click(screen.getByRole("button", { name: "Leave editor" }));

    // The edited content, compared by value because the form stores a copy of
    // what it is handed. The opening document is an empty page, so a host
    // that handed that one back would still write a page-shaped value — and
    // fail here on the missing heading.
    expect(saved).toEqual(EDITED);
    // Left exactly once, with the edited document already in the form at that
    // moment: the hand-back is part of leaving, and the edit form the view
    // returns to draws the field from what the form holds.
    expect(heldAtExit).toEqual([EDITED]);
  });
});

describe("a colleague taking the document over", () => {
  /** Every distinct value the field took, so a commit can be counted. */
  const values: unknown[] = [];

  function Commits({ control }: { control: Control<FieldValues> }): null {
    const value = useWatch({ control, name: "body" });
    React.useEffect(() => {
      if (value !== undefined) values.push(value);
    }, [value]);
    return null;
  }

  /** The view, with the lock's read-only state as the host would hand it. */
  function TakeoverHost({
    readOnly,
    showView = true,
  }: {
    readOnly: boolean;
    showView?: boolean;
  }): React.JSX.Element {
    const { control, getValues } = useEntryForm();
    return (
      <>
        {showView ? (
          <PageBuilderView
            control={control}
            field={BODY_FIELD}
            readOnly={readOnly}
            exit={() => {
              heldAtExit.push(getValues("body"));
            }}
          />
        ) : null}
        <Saved control={control} />
        <Commits control={control} />
      </>
    );
  }

  beforeEach(() => {
    values.length = 0;
  });

  it("keeps the author's edits in the form when the view goes read-only", async () => {
    const { rerender, container } = render(<TakeoverHost readOnly={false} />);
    editDocument();

    rerender(<TakeoverHost readOnly />);

    // The banner says the unsaved changes are still here: the editor that
    // held them is gone, so the form now does.
    expect(saved).toEqual(EDITED);
    // And the read-only page SHOWS them. The hand-over lands as the editor
    // unmounts, after the page that replaces it has read the field, so a page
    // drawn in the same commit showed the work from before it while the form
    // held the edit: the screen contradicting the banner above it.
    // Read by the count the card states: the edit is one block, and the page
    // from before it was empty, which the card says in words of its own.
    await waitFor(() => expect(container.textContent).toContain("1 block"));
    expect(container.textContent).not.toContain("Nothing here yet");
    // Into this browser\'s form only. Nothing left the editor through its
    // exit, and nothing here saves.
    expect(heldAtExit).toEqual([]);
  });

  it("keeps an open passage in the form when the view goes read-only", () => {
    // The author is typing in place when the document is taken over. Their
    // words live in the passage until it is written, so the hand-over writes
    // it first: the banner promises the changes are still here.
    passage = PASSAGE;
    const { rerender } = render(<TakeoverHost readOnly={false} />);

    rerender(<TakeoverHost readOnly />);

    expect(saved).toEqual(PASSAGE);
  });

  it("commits nothing when nothing was edited", () => {
    const { rerender } = render(<TakeoverHost readOnly={false} />);
    rerender(<TakeoverHost readOnly />);
    expect(saved).toBeUndefined();
    expect(values).toEqual([]);
  });

  it("commits once, and not again when the editor comes back and goes", () => {
    const { rerender } = render(<TakeoverHost readOnly={false} />);
    editDocument();
    rerender(<TakeoverHost readOnly />);
    // Taken back: the editor reopens from the form, which holds the edit, and
    // has nothing of its own to commit when it goes again.
    rerender(<TakeoverHost readOnly={false} />);
    rerender(<TakeoverHost readOnly />);
    expect(values).toHaveLength(1);
    expect(saved).toEqual(EDITED);
  });

  it("commits once when the author leaves and the view then goes", () => {
    // The exit already handed the document over; the unmount that follows
    // it, when the admin returns to the form, has nothing left to hand.
    const { rerender } = render(<TakeoverHost readOnly={false} />);
    editDocument();
    fireEvent.click(screen.getByRole("button", { name: "Leave editor" }));
    rerender(<TakeoverHost readOnly={false} showView={false} />);
    expect(values).toHaveLength(1);
  });

  it("commits once when the author leaves with a passage open and the view then goes", () => {
    // Counted by value: each write of the passage is a new document, so a
    // second hand-over on the unmount would be a second value here.
    passage = PASSAGE;
    const { rerender } = render(<TakeoverHost readOnly={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Leave editor" }));
    rerender(<TakeoverHost readOnly={false} showView={false} />);
    expect(values).toHaveLength(1);
    expect(saved).toEqual(PASSAGE);
  });

  it("asks for no recovery write of its own when the page goes away", () => {
    const { rerender } = render(<TakeoverHost readOnly={false} />);
    editDocument();
    const before = scheduled;
    rerender(<TakeoverHost readOnly={false} showView={false} />);
    // Leaving discards what the author chose to discard: the commit lands in
    // a form that persists nothing, and asks the server for nothing.
    expect(scheduled).toBe(before);
    expect(heldAtExit).toEqual([]);
  });
});
