// @vitest-environment jsdom

/**
 * The canvas width reaching the three surfaces that answer to it.
 *
 * `canvas-width.test.ts` in the builder asserts the DERIVATIONS — which tiers a
 * box of a given width applies, and which one an edit lands in. What is only
 * true HERE is the wiring: that one width drives the canvas box, the control
 * that sets it and the panel that writes into the tier it implies, and that the
 * panel is told about the same container the canvas was compiled against.
 *
 * Every derivation can be correct while the props are absent or crossed, and
 * the failure is silent in the worst direction — the canvas resizes, the author
 * watches the page reflow, and their edits go on landing in the widest tier.
 *
 * The builder shell is replaced with recorders rather than rendered, as
 * `BlocksField.policy.test` does and for its reason: what is under test is
 * which props this component passes.
 *
 * @module admin/BlocksField.breakpoints.test
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import { useForm } from "react-hook-form";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Declared here rather than in a setup file, because neither this package nor
 * the builder configures one. `React.act` refuses to run without it, and the
 * refusal is a warning rather than a failure — so a version of this file
 * missing it would drive nothing and still assert against the FIRST render's
 * props, passing for two of the cases below.
 */
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

/*
 * ONE document object for the life of the mount.
 *
 * The editor replaces its state rather than mutating it, so this component
 * treats a new document IDENTITY as an edit and asks for a checkpoint. Rebuilt
 * inside the hook stub it would be a fresh object on every render, and every
 * width change below would be read as the author having typed.
 */
const DOCUMENT = { formatVersion: 1, kind: "page", nodes: [] };

/** Props the recorders captured on the most recent render. */
const seen: {
  inspector: Record<string, unknown> | undefined;
  canvas: Record<string, unknown> | undefined;
  switcher: Record<string, unknown> | undefined;
} = { inspector: undefined, canvas: undefined, switcher: undefined };

/** What `usePluginClientConfig` answers with for the test in hand. */
let clientConfig: Record<string, unknown> | undefined;

vi.mock("@nextlyhq/builder/shell", async importOriginal => {
  /*
   * The real module SPREAD, with only the surfaces this file drives replaced —
   * which also keeps the DERIVATIONS real. `editedBreakpointAtWidth` and
   * `breakpointsAtWidth` are what turn a measured width into the values
   * asserted below, and stubbing them would leave this file asserting its own
   * fixtures.
   */
  const real = await importOriginal<Record<string, unknown>>();
  const record =
    (key: "inspector" | "canvas" | "switcher") =>
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
    BreakpointSwitcher: record("switcher"),
    InspectorPanel: record("inspector"),
    Canvas: record("canvas"),
    BlockKeyboardActions: passthrough,
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
    useCanvasDrag: () => ({ handlers: {}, target: null }),
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

vi.mock("@nextlyhq/plugin-sdk/admin", () => ({
  usePluginClientConfig: () => clientConfig,
  useDocumentCheckpoint: () => ({ schedule: () => {} }),
  useEntryFieldsPanel: () => null,
  useReportUnsavedWork: () => {},
  useSuppressAdminChrome: () => {},
  useDocumentStatus: () => null,
  // Nothing stored, read successfully — so the merged style is the host's
  // config alone and `status` is "ready". A pending read would disable the
  // switcher, which is a different test's subject.
  useSingleDocument: () => ({ data: undefined, isPending: false, error: null }),
  useUpdateSingleDocument: () => ({
    mutateAsync: async () => ({ success: true }),
    isPending: false,
  }),
}));

const { BlocksField } = await import("./BlocksField");

/**
 * A site defining two viewport tiers, supplied through the host's config.
 *
 * Real numbers rather than round ones, because the boundary is inclusive and a
 * bound of 1000 would let an off-by-one comparison pass against a measured
 * 1000.
 */
const SITE = {
  breakpoints: {
    viewport: [
      { id: "tablet", label: "Tablet", maxWidth: 991 },
      { id: "mobile", label: "Mobile", maxWidth: 575 },
    ],
    container: [],
  },
};

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

/** The box inputs the canvas was handed. */
function box(): {
  container?: string;
  width?: number;
  onMeasured?: (width: number | undefined) => void;
} {
  return (seen.canvas?.preview ?? {}) as {
    container?: string;
    width?: number;
    onMeasured?: (width: number | undefined) => void;
  };
}

/** What the canvas reports its box actually measured. */
function measure(width: number | undefined): void {
  const report = box().onMeasured;
  if (report === undefined) throw new Error("the canvas was given no reporter");
  React.act(() => {
    report(width);
  });
}

/** What the author asks the switcher for. */
function choose(width: number | undefined): void {
  const select = seen.switcher?.onSelect as
    | ((width: number | undefined) => void)
    | undefined;
  if (select === undefined)
    throw new Error("the switcher was given no handler");
  React.act(() => {
    select(width);
  });
}

beforeEach(() => {
  seen.inspector = undefined;
  seen.canvas = undefined;
  seen.switcher = undefined;
  clientConfig = { siteStyle: SITE };
});

afterEach(() => {
  cleanup();
});

describe("the container the canvas is compiled against", () => {
  it("tells the inspector about the SAME one it compiled with", () => {
    /*
     * The panel decides whether the window may answer for which tiers are live.
     * Given a name the canvas did not compile with — or given none while the
     * canvas compiled with one — it evaluates `@media` rules a container-query
     * compile never wrote, and a wide admin window around a narrow canvas then
     * reports the desktop tier live while the box is painting tablet.
     *
     * Asserted as equality AND as present, because two `undefined`s are equal
     * and would pass a comparison alone while nothing was previewing at all.
     */
    openEditor();

    const context = (
      seen.canvas?.render as {
        styleContext?: { previewContainer?: string };
      }
    )?.styleContext;
    expect(context?.previewContainer).toBeTypeOf("string");
    expect(seen.inspector?.previewContainer).toBe(context?.previewContainer);
    /*
     * And the BOX establishes that same container. The sheet's rules name it;
     * an element establishing a different one — or none — leaves every preview
     * rule matching nothing, with the sheet valid and the canvas resizing.
     */
    expect(box().container).toBe(context?.previewContainer);
  });
});

describe("what one width drives", () => {
  it("sizes the canvas to the tier the author chooses", () => {
    openEditor();

    choose(991);

    expect(box().width).toBe(991);
  });

  it("releases the canvas back to the region at the widest tier", () => {
    /*
     * The control on the case above: a mount that pinned a number here would
     * satisfy it while making the widest option narrower than the space
     * available, which is a permanent gutter around a canvas that was already
     * the right size.
     */
    openEditor();

    choose(991);
    choose(undefined);

    expect(box().width).toBeUndefined();
  });

  it("edits the tier the box was MEASURED in, not the one requested", () => {
    /*
     * The property this whole mount exists for. The request is a ceiling: an
     * editor region narrower than the widest tier hands the box less, and the
     * narrower tier is then what the browser paints.
     *
     * Deriving the edited tier from the request instead would tell an author at
     * the full width that they are editing the base tier while every value they
     * type lands in tablet — invisible, because the canvas looks correct.
     */
    openEditor();

    choose(undefined);
    measure(900);

    expect(seen.inspector?.breakpoint).toBe("tablet");
    expect(seen.inspector?.liveBreakpoints).toContain("tablet");
  });

  it("names no narrower tier before the box has been measured", () => {
    /*
     * The control on the case above, and an honest state rather than a default:
     * nothing has been observed on the first render, and a panel that named a
     * tier there would be describing a box nobody has looked at.
     */
    openEditor();

    expect(seen.inspector?.breakpoint).toBe("base");
    expect(seen.inspector?.liveBreakpoints).not.toContain("tablet");
  });

  it("keeps the requested and the measured width APART at the switcher", () => {
    /*
     * The two are different facts and the control needs both. Fed the measured
     * width as its selection, it would unselect the option the author just
     * clicked whenever the region could not honour it — the tier would look
     * unchosen while the canvas was showing it. Fed only the request, its tier
     * indicator could never report the narrow-region case, which is the one
     * case it exists for.
     */
    openEditor();

    choose(991);
    measure(900);

    expect(seen.switcher?.width).toBe(991);
    expect(seen.switcher?.appliedWidth).toBe(900);
  });
});

describe("a width the site stops offering", () => {
  it("releases the canvas when the selected tier is deleted", () => {
    /*
     * The switcher renders nothing once a site defines no viewport tiers, and
     * it cannot clear state it does not own. So an author who selects a tier
     * and then deletes it is left with a canvas pinned to a bound the
     * stylesheet no longer has, and no control on screen to release it — the
     * only way out is to close the editor and reopen it.
     *
     * Driven through the CONFIG the editor reads its breakpoints from, rather
     * than by calling the release directly, because what is under test is that
     * the width is reconciled against the site as it now stands.
     */
    const view = openEditor();
    choose(991);
    expect(box().width).toBe(991);

    clientConfig = {
      siteStyle: { breakpoints: { viewport: [], container: [] } },
    };
    view.rerender();

    expect(box().width).toBeUndefined();
  });

  it("KEEPS a width the site still offers", () => {
    /*
     * The control. Without it, a version that released on every breakpoint
     * change — or on every render — would satisfy the case above while making
     * the switcher unusable: every selection would be undone by the next
     * render.
     */
    const view = openEditor();
    choose(991);

    view.rerender();

    expect(box().width).toBe(991);
  });
});
