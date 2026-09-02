// @vitest-environment jsdom

/**
 * `showEmptyElements` reaching the empty-container appender.
 *
 * `empty-container-appender.test.tsx` (in the builder package) asserts the
 * component's own behaviour given `hidden`. What is only true HERE is the
 * WIRING: that this field folds the author's "Show empty containers"
 * preference into that prop at all. The component was mounted with no
 * awareness of the preference — it reads only `hidden` and the document — so
 * without this wiring the dashed placeholder box collapses to zero height
 * when the preference is off (that CSS rule already matches the preference)
 * while the appender's own "+" keeps floating over nothing, defeating the
 * preference's whole point: seeing the page as a visitor would.
 *
 * The builder shell is replaced with recorders rather than rendered, as
 * `BlocksField.breakpoints.test` does and for its reason: what is under test
 * is which props this component passes, and rendering the real shell would
 * add a tree whose own behaviour belongs to the builder package's tests.
 *
 * @module admin/BlocksField.emptyContainerAppender.test
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import { useForm } from "react-hook-form";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OPEN_BUILDER_ACTION } from "./PageBuilderCard";

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
} = { builderShell: undefined, appender: undefined };

/**
 * What `useCanvasDrag` reports for `draggingId`, mutated per test.
 *
 * A module-level variable rather than a per-test mock rebuild: the hook is
 * read once by `BlocksField` at render time, so flipping this and asking for
 * a re-render is what stands in for a drag actually starting.
 */
let draggingId: string | null = null;

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
    // Captures the WHOLE props object — `onShowEmptyElementsChange` and
    // `openPanelRequest` are what this file drives, and a narrower
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
    InsertPanel: nothing,
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
      selectedId: null,
      selection: { ids: [], primary: null },
      apply: () => null,
      applyAll: () => null,
      select: () => {},
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
vi.mock("@nextlyhq/plugin-sdk/admin", () => ({
  /*
   * Never awaited by these cases: the loader is reached only when an author
   * double-clicks a passage, and none of them do. Present because the mock
   * REPLACES the module wholesale, so an export the subject imports and this
   * omits is a missing-export error rather than an unused stub.
   */
  loadInlineRichTextEditor: () => new Promise<never>(() => {}),
  usePluginClientConfig: () => ({ siteStyle: undefined }),
  useDocumentCheckpoint: () => ({ schedule: () => {} }),
  useEntryFieldsPanel: () => null,
  useReportUnsavedWork: () => {},
  useSuppressAdminChrome: () => {},
  useDocumentStatus: () => null,
  // Nothing stored, read successfully — so `siteStylePending` and
  // `siteStyleError` both resolve to their "ready" values on the first
  // render, and `BlocksField` renders `Canvas` rather than its loading
  // paragraph.
  useSingleDocument: () => ({ data: undefined, isPending: false, error: null }),
  useUpdateSingleDocument: () => ({
    mutateAsync: async () => ({ success: true }),
    isPending: false,
  }),
}));

const { BlocksField } = await import("./BlocksField");

function Host(): React.JSX.Element {
  const { control } = useForm({ defaultValues: { body: undefined } });
  return <BlocksField name="body" control={control} />;
}

function openEditor(): { rerender: () => void } {
  const view = render(<Host />);
  fireEvent.click(screen.getByRole("button", { name: OPEN_BUILDER_ACTION }));
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
  draggingId = null;
});

afterEach(() => {
  cleanup();
});

describe("the empty-container appender and the show-empty-elements preference", () => {
  it("starts visible, matching the preference's own default of shown", () => {
    openEditor();

    expect(seen.appender?.hidden).toBe(false);
  });

  it("hides the appender once the shell reports the preference switched off", () => {
    const { rerender } = openEditor();

    const report = seen.builderShell?.onShowEmptyElementsChange as
      | ((value: boolean) => void)
      | undefined;
    if (report === undefined) {
      throw new Error("the shell was given no onShowEmptyElementsChange");
    }
    React.act(() => {
      report(false);
    });
    rerender();

    expect(seen.appender?.hidden).toBe(true);
  });

  it("shows the appender again once the shell reports the preference switched back on", () => {
    // Asserted at EACH step rather than only at the end: a fold that ORs the
    // wrong thing, or one that was never wired at all, can still leave the
    // FINAL value `false` here purely because it never became `true` in
    // between — which is exactly the shape of a test that would pass whether
    // or not the fix under test exists. Requiring the intermediate `true` is
    // what makes "back on" mean something distinct from "was never off".
    const { rerender } = openEditor();

    const report = seen.builderShell?.onShowEmptyElementsChange as (
      value: boolean
    ) => void;
    React.act(() => {
      report(false);
    });
    rerender();
    expect(seen.appender?.hidden).toBe(true);

    React.act(() => {
      report(true);
    });
    rerender();

    expect(seen.appender?.hidden).toBe(false);
  });

  it("stays hidden during a drag even while the preference is on", () => {
    // The regression this guards: folding the preference into `hidden`
    // must OR with the drag condition, not replace it — a control that
    // reappeared mid-drag because the preference happened to be on would be
    // exactly the failure `hidden` exists to prevent.
    draggingId = "some-node";

    openEditor();

    expect(seen.appender?.hidden).toBe(true);
  });
});
