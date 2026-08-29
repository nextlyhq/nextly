// @vitest-environment jsdom

/**
 * The interaction state reaching the canvas and the panel as ONE value.
 *
 * `state-switcher.test.tsx` asserts the control, and `inspector-panel.test.tsx`
 * asserts that the panel offers and withholds it. What is only true HERE is the
 * wiring: that the state the panel edits and the state the canvas forces are
 * the same value, and that it is suppressed when the control that explains it
 * is not on screen.
 *
 * The failure this guards is silent in the worst direction. Every derivation
 * can be right while the two props disagree — the panel reports hover values,
 * the canvas draws the base appearance, and nothing says so.
 *
 * The builder shell is replaced with recorders rather than rendered, as
 * `BlocksField.breakpoints.test` does and for its reason: what is under test is
 * which props this component passes.
 *
 * @module admin/BlocksField.styleState.test
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import { useForm } from "react-hook-form";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const DOCUMENT = { formatVersion: 1, kind: "page", nodes: [] };

const seen: {
  inspector: Record<string, unknown> | undefined;
  canvas: Record<string, unknown> | undefined;
} = { inspector: undefined, canvas: undefined };

/**
 * The selection the editor reports, which each case sets.
 *
 * A module-level box rather than a mock factory argument, because the mock is
 * hoisted above every binding in this file — reading it at call time is what
 * lets a case change the selection between renders.
 */
let selectionIds: string[] = ["a"];

vi.mock("@nextlyhq/builder/shell", async importOriginal => {
  const real = await importOriginal<Record<string, unknown>>();
  const record =
    (key: "inspector" | "canvas") =>
    (props: Record<string, unknown>): React.JSX.Element => {
      seen[key] = props;
      return <div data-recorder={key} />;
    };
  const nothing = (): null => null;
  const passthrough = ({
    children,
  }: {
    children?: React.ReactNode;
  }): React.JSX.Element => <>{children}</>;
  return {
    ...real,
    BuilderShell: ({
      inspector,
      topBar,
      children,
    }: {
      inspector: React.ReactNode;
      topBar?: React.ReactNode;
      children?: React.ReactNode;
    }): React.JSX.Element => (
      <div>
        {topBar}
        {inspector}
        {children}
      </div>
    ),
    BreakpointManager: nothing,
    BreakpointSwitcher: nothing,
    InspectorPanel: record("inspector"),
    Canvas: record("canvas"),
    BlockKeyboardActions: passthrough,
    BlockContextMenu: passthrough,
    BlockToolbar: nothing,
    EditorCommandPalette: nothing,
    DropIndicator: nothing,
    InsertPanel: nothing,
    LayersPanel: nothing,
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
    useEditorState: () => ({
      document: DOCUMENT,
      selectedId: selectionIds[0] ?? null,
      selection: { ids: selectionIds, primary: selectionIds[0] ?? null },
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
  loadInlineRichTextEditor: () => new Promise<never>(() => {}),
  usePluginClientConfig: () => undefined,
  useDocumentCheckpoint: () => ({ schedule: () => {} }),
  useEntryFieldsPanel: () => null,
  useReportUnsavedWork: () => {},
  useSuppressAdminChrome: () => {},
  useDocumentStatus: () => null,
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
  fireEvent.click(screen.getByRole("button", { name: "Edit blocks" }));
  return {
    rerender: () => {
      React.act(() => {
        view.rerender(<Host />);
      });
    },
  };
}

/** The state the panel was told to edit. */
const panelState = (): unknown =>
  (seen.inspector?.styleState as { state?: unknown } | undefined)?.state;

/** The state the canvas was told to draw. */
const canvasState = (): unknown => seen.canvas?.forcedState;

/** Choose a state through the binding the panel was handed. */
function chooseState(next: string): void {
  const binding = seen.inspector?.styleState as
    | { onChange?: (state: string) => void }
    | undefined;
  React.act(() => {
    binding?.onChange?.(next);
  });
}

beforeEach(() => {
  selectionIds = ["a"];
  seen.inspector = undefined;
  seen.canvas = undefined;
});
afterEach(cleanup);

describe("the interaction state reaching both surfaces", () => {
  it("starts at base on both", () => {
    openEditor();

    expect(panelState()).toBe("base");
    expect(canvasState()).toBe("base");
  });

  it("carries a chosen state to the panel AND the canvas", () => {
    /*
     * The whole wiring. The panel states no `liveStates`, so its provenance
     * falls back to the edited state plus base — correct exactly while the
     * canvas is simulating the state being edited, and wrong the moment it is
     * not. Asserted on both props in one case, because a version that moved
     * only one of them is the defect.
     */
    openEditor();

    chooseState("hover");

    expect(panelState()).toBe("hover");
    expect(canvasState()).toBe("hover");
  });

  it("suppresses the state while SEVERAL blocks are selected", () => {
    /*
     * The inspector replaces its whole tab strip with a multi-selection
     * summary, so the state control goes with it — and the panel's own tab
     * handler cannot catch this, because the stored tab value is still `style`
     * and no tab change happens. A forced state that outlives its control is a
     * canvas drawn mid-hover with nothing on screen explaining why.
     */
    const view = openEditor();
    chooseState("hover");
    expect(canvasState()).toBe("hover");

    selectionIds = ["a", "b"];
    view.rerender();

    expect(canvasState()).toBe("base");
    expect(panelState()).toBe("base");
  });

  it("RESTORES the chosen state when the selection narrows again", () => {
    /*
     * Suppressed, not reset. Writing `base` into the state instead would
     * silently discard what the author was editing, so shift-clicking a second
     * block and clicking back would lose their place.
     */
    const view = openEditor();
    chooseState("hover");

    selectionIds = ["a", "b"];
    view.rerender();
    expect(canvasState()).toBe("base");

    selectionIds = ["a"];
    view.rerender();

    expect(canvasState()).toBe("hover");
    expect(panelState()).toBe("hover");
  });
});
