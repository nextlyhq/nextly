// @vitest-environment jsdom

/**
 * The palette drag reaching the engine — which is wiring, and only wiring.
 *
 * `insert-drag.test.tsx` in the builder asserts the GESTURE: what a drag
 * commits, when, and what ends it. None of that runs unless this component
 * hands the panel a way to start one and hands the drag the canvas to measure
 * against, and every one of those assertions stays green while both props are
 * absent — the engine is simply never reached, and no user can drag anything.
 *
 * So what is asserted here is the composition: that the ref the drag resolves
 * its drop against is the SAME ref the rendered canvas publishes, and that the
 * panel is given the drag's own starter. Identity rather than presence, because
 * two different refs would satisfy "both are defined" while the drag measured
 * against a canvas that is not on screen.
 *
 * @module admin/BlocksField.paletteDrag.test
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import { useForm } from "react-hook-form";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** Props the recorders captured on the most recent render. */
const seen: {
  inspector: Record<string, unknown> | undefined;
  canvas: Record<string, unknown> | undefined;
  breakpoints: Record<string, unknown> | undefined;
  insertPanel: Record<string, unknown> | undefined;
  dragOptions: Record<string, unknown> | undefined;
  toolbar: Record<string, unknown> | undefined;
  spacing: Record<string, unknown> | undefined;
} = {
  inspector: undefined,
  canvas: undefined,
  breakpoints: undefined,
  insertPanel: undefined,
  dragOptions: undefined,
  toolbar: undefined,
  spacing: undefined,
};

/** What the recorded drag reports as in flight, per test. */
let draggingBlockName: string | null = null;

/** The starter the recorded drag hands back, for an identity assertion. */
const beginInsertDrag = (): void => {};

/** What `usePluginClientConfig` answers with for the test in hand. */
let clientConfig: Record<string, unknown> | undefined;

/** What the stored-style read answers with for the test in hand. */
let siteStyleRead: { data: unknown; isPending: boolean; error: Error | null } =
  {
    data: undefined,
    isPending: false,
    error: null,
  };

vi.mock("@nextlyhq/builder/shell", async importOriginal => {
  /*
   * The real module SPREAD, with only the surfaces this file drives replaced.
   * A closed object literal here answers `undefined` for every export it does
   * not list, so adding one to the shell breaks these tests and leaves the
   * builder's own suite green — a failure that reads as a fault in this file
   * rather than as a stale list. Measured: the real module imports cleanly
   * under vitest and the overrides below win over the spread.
   */
  const real = await importOriginal<Record<string, unknown>>();
  const record =
    (key: "inspector" | "canvas" | "insertPanel" | "toolbar" | "spacing") =>
    (props: Record<string, unknown>): React.JSX.Element => {
      seen[key] = props;
      return <div data-recorder={key} />;
    };
  const nothing = (): null => null;
  // The canvas sits inside this one, so it has to pass its children through.
  const passthrough = ({
    children,
  }: {
    children?: React.ReactNode;
  }): React.JSX.Element => <>{children}</>;
  return {
    ...real,
    // Renders the inspector slot and its CHILDREN, because the canvas is a
    // child of the shell rather than one of its slots — a stub dropping them
    // would leave the canvas unrendered and its assertion passing on absence.
    BuilderShell: ({
      inspector,
      topBar,
      children,
      renderPanel,
    }: {
      inspector: React.ReactNode;
      topBar?: React.ReactNode;
      children?: React.ReactNode;
      renderPanel?: (panel: string) => React.ReactNode;
    }): React.JSX.Element => (
      <div>
        {/*
         * The top bar is rendered for the same reason the children are: the
         * breakpoint manager lives there, and a stub that dropped the slot
         * would leave its assertions passing on absence.
         */}
        {topBar}
        {inspector}
        {/*
         * The real shell draws one panel at a time and this mock draws none,
         * so the insert panel is asked for explicitly. Without it the recorder
         * never mounts and "the panel was given a starter" would be an
         * assertion about a component that was never rendered.
         */}
        {renderPanel?.("insert")}
        {children}
      </div>
    ),
    BreakpointManager: record("breakpoints"),
    InspectorPanel: record("inspector"),
    Canvas: (props: Record<string, unknown>): React.JSX.Element => {
      seen.canvas = props;
      /*
       * The overlay is RENDERED, not dropped. The toolbar and the spacing
       * bands are passed to the canvas as overlay content, so a recorder that
       * returned a bare div would leave them unmounted — and every assertion
       * about whether they are hidden would be an assertion about `undefined`.
       */
      return (
        <div data-recorder="canvas">{props.overlay as React.ReactNode}</div>
      );
    },
    BlockKeyboardActions: passthrough,
    /*
     * Passed THROUGH, not stubbed to nothing: the canvas renders inside it, so
     * a stub would take the recorder below out of the tree along with it. The
     * real one reads the verbs context, which the passthrough above does not
     * provide.
     */
    BlockContextMenu: passthrough,
    BlockToolbar: record("toolbar"),
    EditorCommandPalette: nothing,
    DropIndicator: nothing,
    InsertPanel: record("insertPanel"),
    LayersPanel: nothing,
    OnboardingChecklist: nothing,
    SelectionBreadcrumb: nothing,
    SpacingOverlay: record("spacing"),
    useBuilderChecklist: () => ({
      visible: false,
      steps: [],
      dismiss: () => {},
    }),
    useCanvasDrag: (options: Record<string, unknown>) => {
      seen.dragOptions = options;
      return {
        handlers: {},
        target: null,
        beginInsertDrag,
        // Null throughout a palette drag, deliberately: the block has no node
        // until the release makes one. That is exactly the state the gates
        // below must still treat as "a drag is happening".
        draggingId: null,
        draggingBlockName,
      };
    },
    useEditorState: () => ({
      document: { formatVersion: 1, kind: "page", nodes: [] },
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

vi.mock("@nextlyhq/plugin-sdk/admin", () => ({
  /*
   * Never awaited by these cases: the loader is reached only when an author
   * double-clicks a passage, and none of them do. Present because the mock
   * REPLACES the module wholesale, so an export the subject imports and this
   * omits is a missing-export error rather than an unused stub.
   */
  loadInlineRichTextEditor: () => new Promise<never>(() => {}),
  usePluginClientConfig: () => clientConfig,
  useDocumentCheckpoint: () => ({ record: () => {}, clear: () => {} }),
  useEntryFieldsPanel: () => null,
  useReportUnsavedWork: () => {},
  useSuppressAdminChrome: () => {},
  // `null` is a real answer the pill handles — "no status has been persisted",
  // which is what a create form and a preview both look like — so this mounts
  // the top bar without putting a second subject in the assertions below.
  useDocumentStatus: () => null,
  // The stored style tier. Answered as "nothing stored yet" here, because what
  // this file asserts is which props reach the two enforcing surfaces — the
  // merge of stored over defaults is `site-style-client`'s own question and has
  // its own coverage. Standing a real query client up here would put a second
  // subject in every assertion below.
  useSingleDocument: () => siteStyleRead,
  useUpdateSingleDocument: () => ({
    mutateAsync: async () => ({ success: true }),
    isPending: false,
  }),
}));

// Imported after the mocks, which is what makes them take effect: the module
// resolves the shell at import time, and a specifier already bound to the real
// module cannot be replaced afterwards.
const { BlocksField } = await import("./BlocksField");

/** A form around the field, since it reads its value through a form control. */
function Host(): React.JSX.Element {
  const { control } = useForm({ defaultValues: { body: undefined } });
  return <BlocksField name="body" control={control} />;
}

/** Mount the field and open the editor, which is where the two surfaces live. */
function openEditor(): void {
  render(<Host />);
  fireEvent.click(screen.getByRole("button", { name: "Edit blocks" }));
}

beforeEach(() => {
  seen.insertPanel = undefined;
  seen.dragOptions = undefined;
  seen.canvas = undefined;
  seen.toolbar = undefined;
  seen.spacing = undefined;
  draggingBlockName = null;
  clientConfig = undefined;
  siteStyleRead = { data: undefined, isPending: false, error: null };
});

afterEach(() => {
  cleanup();
});

describe("what makes a palette drag reachable at all", () => {
  it("gives the drag the very canvas it renders", () => {
    openEditor();

    // Population first: if the recorders caught nothing, every assertion below
    // would be about `undefined` and would read as a passing wiring check.
    expect(seen.dragOptions).toBeDefined();
    expect(seen.canvas).toBeDefined();

    const forDrag = seen.dragOptions?.canvasRoot;
    expect(forDrag).toBeDefined();
    // Identity, not presence. Two separate refs would satisfy "both defined"
    // while the drag resolved its drop against a canvas nobody is looking at.
    expect(seen.canvas?.rootRef).toBe(forDrag);
  });

  it("hides the canvas chrome during a palette drag, which has no node id", () => {
    // The gates used to read `draggingId`, which is null for the whole of a
    // palette drag — so the toolbar and the spacing bands stayed up while an
    // author dragged a new block in. The toolbar sits above the drop
    // indicator, so it covers the position being aimed at.
    draggingBlockName = "core/heading";
    openEditor();

    expect(seen.toolbar).toBeDefined();
    expect(seen.spacing).toBeDefined();
    expect(seen.toolbar?.hidden).toBe(true);
    expect(seen.spacing?.hidden).toBe(true);
  });

  it("leaves the chrome up when nothing is being dragged", () => {
    // The must-differ control. Gates wired to a constant `true` would satisfy
    // the case above while hiding the toolbar permanently.
    draggingBlockName = null;
    openEditor();

    expect(seen.toolbar?.hidden).toBe(false);
    expect(seen.spacing?.hidden).toBe(false);
  });

  it("gives the panel the drag's own starter", () => {
    openEditor();

    expect(seen.insertPanel).toBeDefined();
    // The same function the drag returned, so a row's press reaches THIS
    // gesture rather than some other callback that merely has the right name.
    expect(seen.insertPanel?.beginInsertDrag).toBe(beginInsertDrag);
  });
});
