// @vitest-environment jsdom

/**
 * The empty-container appender as this field mounts it.
 *
 * `empty-container-appender.test.tsx` (in the builder package) asserts the
 * component's own behaviour given `hidden`. What is only true HERE is the
 * WIRING: which `hidden` this field passes, and what its "+" opens. Empty
 * containers always show, so the appender is hidden only during a drag, and
 * its "+" opens Add to fill the container it sits on.
 *
 * The builder shell is replaced with recorders rather than rendered, as
 * `BlocksField.breakpoints.test` does and for its reason: what is under test
 * is which props this component passes, and rendering the real shell would
 * add a tree whose own behaviour belongs to the builder package's tests.
 *
 * @module admin/BlocksField.emptyContainerAppender.test
 */
import { cleanup, render } from "@testing-library/react";
import * as React from "react";
import { useForm, type FieldValues } from "react-hook-form";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Declared here rather than in a setup file, because neither this package nor
 * the builder configures one. `React.act` refuses to run without it, and the
 * refusal is a warning rather than a failure — so a version of this file
 * missing it would drive nothing and still assert against the FIRST render's
 * props.
 */
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

/** ONE document object for the life of the mount — see the sibling test file. */
const DOCUMENT = { formatVersion: 1, kind: "page", nodes: [] };

/** Props the recorders captured on the most recent render. */
const seen: {
  builderShell: Record<string, unknown> | undefined;
  appender: Record<string, unknown> | undefined;
  insertPanel: Record<string, unknown> | undefined;
} = { builderShell: undefined, appender: undefined, insertPanel: undefined };

/**
 * The editor's selection, which `select` writes and the next render reads, so
 * selecting a container through its "+" is seen by the panel it opens.
 */
let selectedId: string | null = null;

/**
 * What `useCanvasDrag` reports for `draggingId`, mutated per test.
 *
 * A module-level variable rather than a per-test mock rebuild: the hook is
 * read once by `BlocksField` at render time, so flipping this and asking for
 * a re-render is what stands in for a drag actually starting.
 */
let draggingId: string | null = null;

// The editor asks the session's grants for shared styles; this file is not
// about them, so the author holds the right to change the site's design.
vi.mock("@nextlyhq/plugin-sdk/client", () => ({
  useCan: (permission: string) => permission === "update-site-style",
}));

vi.mock("@nextlyhq/builder/shell", async importOriginal => {
  /*
   * The real module SPREAD, with only the surfaces this file drives replaced.
   * A closed object literal here answers `undefined` for every export it does
   * not list, so adding one to the shell breaks these tests and leaves the
   * builder's own suite green — a failure that reads as a fault in this file
   * rather than as a stale list.
   */
  const real = await importOriginal<Record<string, unknown>>();
  const nothing = (): null => null;
  const passthrough = ({
    children,
  }: {
    children?: React.ReactNode;
  }): React.JSX.Element => <>{children}</>;
  return {
    ...real,
    // Captures the WHOLE props object — `openPanelRequest` and
    // `renderPanel` are what this file drives, and a narrower
    // destructure (as the sibling files use for a shell that ignores those)
    // would silently discard them.
    BuilderShell: (
      props: Record<string, unknown> & { children?: React.ReactNode }
    ): React.JSX.Element => {
      seen.builderShell = props;
      return <>{props.children}</>;
    },
    // Renders its `overlay`, which is where `EmptyContainerAppenders` is
    // mounted — a stub dropping it, as the sibling test files' `Canvas` stub
    // does, would leave this file asserting on absence.
    Canvas: (props: Record<string, unknown>): React.JSX.Element => (
      <>{props.overlay as React.ReactNode}</>
    ),
    EmptyContainerAppenders: (
      props: Record<string, unknown>
    ): React.JSX.Element | null => {
      seen.appender = props;
      return null;
    },
    BlockToolbar: nothing,
    DropIndicator: nothing,
    SpacingOverlay: nothing,
    BlockKeyboardActions: passthrough,
    /*
     * Passed THROUGH, not stubbed to nothing: the canvas renders inside it, so
     * a stub would take the recorder below out of the tree along with it. The
     * real one reads the verbs context, which the passthrough above does not
     * provide.
     */
    BlockContextMenu: passthrough,
    EditorCommandPalette: nothing,
    BreakpointManager: nothing,
    BreakpointSwitcher: nothing,
    InspectorPanel: nothing,
    InsertPanel: (props: Record<string, unknown>): null => {
      seen.insertPanel = props;
      return null;
    },
    RepairNotice: nothing,
    LayersPanel: nothing,
    OnboardingChecklist: nothing,
    SelectionBreadcrumb: nothing,
    useBuilderChecklist: () => ({
      visible: false,
      steps: [],
      dismiss: () => {},
    }),
    useCanvasDrag: () => ({
      handlers: {},
      target: null,
      draggingId,
      // Derived from this file's own knob rather than stated separately: the
      // editor asks `draggingBlockName` whether a drag is happening, because a
      // drag from the palette has no node id at all. Left out, it reads
      // `undefined` — not `null` — and every case here runs as though a drag
      // were in flight.
      draggingBlockName: draggingId === null ? null : "core/heading",
    }),
    useEditorState: () => ({
      document: DOCUMENT,
      selectedId,
      selection: {
        ids: selectedId === null ? [] : [selectedId],
        primary: selectedId,
      },
      apply: () => null,
      applyAll: () => null,
      select: (id: string | null) => {
        selectedId = id;
      },
      undo: () => {},
      redo: () => {},
      canUndo: false,
      canRedo: false,
      undoDepth: 0,
    }),
    useInlineText: () => ({ onDoubleClick: () => {} }),
  };
});

/*
 * A closed object literal rather than the real module spread, unlike the shell
 * mock above — the two modules are not interchangeable here. Importing
 * `@nextlyhq/plugin-sdk/admin` for real under jsdom throws
 * `ReferenceError: EventSource is not defined` while the module is still
 * evaluating: the admin bundle it re-exports opens a dev-mode SSE connection at
 * module scope behind a `window` guard that jsdom satisfies. So `importOriginal`
 * here would not fill the gaps in this list, it would take the whole file down
 * before a single test ran. The shared `scripts/vitest-dom-setup.ts` this
 * package loads stubs no `EventSource` — `plugin-form-builder`'s own setup file
 * is where one exists — so until these suites have one, every export the
 * subject imports has to be named below.
 */
/** Asking the stored style again, as the editor does after a save. */
const refetchStoredStyle = async () => ({ isError: false });
// The stored site style arrives through the editor's one read, the plugin's
// route; that read's request is asserted in `site-style-read.test`.
vi.mock("./site-style-read", () => ({
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
  // The editor mount asks for the variant-use writer; no case here opens a
  // component, so it is never called.
  usePluginRouteMutation: () => ({
    write: async () => undefined,
    pending: false,
    error: null,
  }),
  /*
   * Never awaited by these cases: the loader is reached only when an author
   * double-clicks a passage, and none of them do. Present because the mock
   * REPLACES the module wholesale, so an export the subject imports and this
   * omits is a missing-export error rather than an unused stub.
   */
  // The media library, drawn as nothing: these cases never open it.
  MediaPickerDialog: () => null,
  loadInlineRichTextEditor: () => new Promise<never>(() => {}),
  usePluginClientConfig: () => ({ siteStyle: undefined }),
  // No document around the field: the state every case here was written
  // against, and the one that offers every component.
  useDocumentIdentity: () => null,
  navigateTo: vi.fn(),
  // Nor a language the field could know: the component read asks for the
  // app default.
  useDocumentLocale: () => null,
  /*
   * The library read. Absent here rather than stubbed with patterns, because
   * these cases are about other surfaces and an offered pattern would change
   * what the palette contains. `pending: false` says the read ANSWERED with
   * nothing, which is the site with an empty library — the state every one of
   * these cases was written against.
   */
  usePluginRoute: () => ({
    data: undefined,
    pending: false,
    error: null,
    refetch: () => {},
  }),
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
  // No preview here: the top bar's Preview draws nothing.
  useDocumentPreview: () => null,
  // No one signed in: the editor keeps no preferences.
  useCurrentUserId: () => null,
  useDocumentStatus: () => null,
  // The editor registers its restore; nothing here offers one.
  useDocumentRestore: () => undefined,
  // Nothing stored, read successfully — so `siteStylePending` and
  // `siteStyleError` both resolve to their "ready" values on the first
  // render, and the editor renders `Canvas` rather than its loading
  // paragraph.
  useUpdateSingleDocument: () => ({
    mutateAsync: async () => ({ success: true }),
    isPending: false,
  }),
}));

const { PageBuilderView } = await import("./editor/PageBuilderView");

/**
 * The blocks field's declaration, as the admin hands it to the view. Typed at
 * the boundary because `FieldConfig` is the closed union of the built-in
 * shapes, and a contributed type such as `blocks` has no arm in it.
 */
const BODY_FIELD = { name: "body", type: "blocks" } as never;

/** The builder's document view, open on the form's `body` field. */
function Host(): React.JSX.Element {
  const { control } = useForm<FieldValues>({
    defaultValues: { body: undefined },
  });
  return (
    <PageBuilderView
      control={control}
      field={BODY_FIELD}
      readOnly={false}
      exit={() => {}}
    />
  );
}

function openEditor(): { rerender: () => void } {
  const view = render(<Host />);
  return {
    rerender: () => {
      React.act(() => {
        view.rerender(<Host />);
      });
    },
  };
}

beforeEach(() => {
  seen.builderShell = undefined;
  seen.appender = undefined;
  seen.insertPanel = undefined;
  selectedId = null;
  draggingId = null;
});

afterEach(() => {
  cleanup();
});

describe("the empty-container appender's visibility", () => {
  it("is shown outside a drag, since empty containers always show", () => {
    openEditor();

    expect(seen.appender?.hidden).toBe(false);
  });

  it("stays hidden during a drag", () => {
    // A control left over the canvas mid-drag would sit on a layout that is
    // about to change, which is the failure `hidden` exists to prevent.
    draggingId = "some-node";

    openEditor();

    expect(seen.appender?.hidden).toBe(true);
  });
});

/** Draw the Add panel as the shell would, and answer what it was handed. */
function drawAddPanel(): Record<string, unknown> | undefined {
  const renderPanel = seen.builderShell?.renderPanel as
    | ((panel: string, view?: string) => React.ReactNode)
    | undefined;
  if (renderPanel === undefined) {
    throw new Error("the shell was given no renderPanel");
  }
  seen.insertPanel = undefined;
  render(<>{renderPanel("add")}</>);
  return seen.insertPanel;
}

/** Press the "+" of the empty container `id`. */
function pressAppender(id: string): void {
  const onAppend = seen.appender?.onAppend as
    | ((nodeId: string) => void)
    | undefined;
  if (onAppend === undefined) {
    throw new Error("the appender was given no onAppend");
  }
  React.act(() => {
    onAppend(id);
  });
}

describe('the empty-container appender\'s "+"', () => {
  it("opens Add to add INSIDE its container", () => {
    openEditor();

    pressAppender("box");

    expect(seen.builderShell?.openPanelRequest).toMatchObject({ panel: "add" });
    expect(drawAddPanel()?.inside).toBe("box");
  });

  it("adds after the selection again once the selection moves, even back to the container", () => {
    // Selecting the container is never "inside" by itself: only its "+"
    // says so, and only until the author selects something else.
    const { rerender } = openEditor();
    pressAppender("box");

    selectedId = "other";
    rerender();
    expect(drawAddPanel()).toBeDefined();
    expect(drawAddPanel()).not.toHaveProperty("inside");

    selectedId = "box";
    rerender();
    expect(drawAddPanel()).not.toHaveProperty("inside");
  });

  it("is not inside for an Add opened any other way", () => {
    openEditor();
    selectedId = "box";

    expect(drawAddPanel()).toBeDefined();
    expect(drawAddPanel()).not.toHaveProperty("inside");
  });
});
