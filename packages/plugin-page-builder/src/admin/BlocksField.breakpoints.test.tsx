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
  layers: Record<string, unknown> | undefined;
} = {
  inspector: undefined,
  canvas: undefined,
  switcher: undefined,
  layers: undefined,
};

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
    (key: "inspector" | "canvas" | "switcher" | "layers") =>
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
      renderPanel,
    }: {
      inspector: React.ReactNode;
      topBar?: React.ReactNode;
      children?: React.ReactNode;
      renderPanel?: (panel: string) => React.ReactNode;
    }): React.JSX.Element => (
      <div>
        {topBar}
        {inspector}
        {/*
          The panel region, drawn as a SIBLING of the children — which is what
          the real shell does, and the whole reason a panel cannot read what the
          children provide. A mock that dropped `renderPanel` could not see a
          panel wired wrongly, or wired not at all.
        */}
        {renderPanel?.("layers")}
        {children}
      </div>
    ),
    BreakpointManager: nothing,
    BreakpointSwitcher: record("switcher"),
    InspectorPanel: record("inspector"),
    Canvas: record("canvas"),
    BlockKeyboardActions: passthrough,
    /*
     * Passed THROUGH, not stubbed to nothing: the canvas renders inside it, so
     * a stub would take the recorder below out of the tree along with it. The
     * real one reads the verbs context, which the passthrough above does not
     * provide.
     */
    BlockContextMenu: passthrough,
    BlockToolbar: nothing,
    EditorCommandPalette: nothing,
    DropIndicator: nothing,
    InsertPanel: nothing,
    LayersPanel: record("layers"),
    OnboardingChecklist: nothing,
    SelectionBreadcrumb: nothing,
    SpacingOverlay: nothing,
    useBuilderChecklist: () => ({
      visible: false,
      steps: [],
      dismiss: () => {},
    }),
    // `draggingBlockName` is part of the state this hook reports and is what
    // the editor asks "is a drag happening" — a stub omitting it answers
    // `undefined`, which is not `null`, so the editor hides its chrome for a
    // drag that is not happening.
    useCanvasDrag: () => ({
      handlers: {},
      target: null,
      draggingId: null,
      draggingBlockName: null,
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

vi.mock("@nextlyhq/plugin-sdk/admin", () => ({
  /*
   * Never awaited by these cases: the loader is reached only when an author
   * double-clicks a passage, and none of them do. Present because the mock
   * REPLACES the module wholesale, so an export the subject imports and this
   * omits is a missing-export error rather than an unused stub.
   */
  loadInlineRichTextEditor: () => new Promise<never>(() => {}),
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
  it("gives the canvas the reporter the zoom control reads", () => {
    /*
     * The scale the canvas paints at is reported back so the control can name
     * it — including while FITTING, where it is derived from a region only the
     * canvas measures.
     *
     * Asserted on the CANVAS's own props rather than inside `preview`, because
     * that is exactly where it was wrong: an extra key on an inferred object is
     * accepted and ignored rather than refused, so the reporter never ran and
     * the control sat at 100% while the canvas zoomed.
     */
    openEditor();

    expect(seen.canvas?.onScale).toBeTypeOf("function");
  });

  it("tells the layers panel that the move keystrokes are bound", () => {
    /*
     * The panel cannot work this out where it sits. It is drawn in the shell's
     * panel region while `BlockKeyboardActions` wraps the shell's CHILDREN, and
     * the real shell renders those as siblings — so anything the panel reads
     * from its own position answers about the wrong subtree.
     *
     * This file is where that is observable, because it is the only place the
     * two halves are composed the way the product composes them. A case living
     * beside the panel can assert what the panel does with the fact and never
     * whether it is given one, which is how the legend came to be invisible to
     * every real author while its own tests passed.
     */
    openEditor();

    expect(seen.layers).toBeDefined();
    expect(seen.layers?.moveHints).toBe(true);
  });

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

  it("FOLLOWS the base width when the widest bound is edited", () => {
    /*
     * A width identifies an option only until the site's bounds move. Editing
     * the widest breakpoint changes the width the unconditional tier applies
     * FROM, so the number the author's choice produced is suddenly nobody's.
     *
     * Reconciled by number, that reads as a deleted tier and releases the
     * canvas — which, in a region narrower than the new bound, drops the editor
     * straight back into the bounded tier while the option they chose still
     * exists and still reads as selected. Every edit after that lands in a tier
     * they did not pick.
     *
     * Stored as the TIER, the width simply follows.
     */
    const view = openEditor();
    choose(992);
    expect(box().width).toBe(992);

    // The site's widest tier widens: base now applies from 1201 rather than 992.
    clientConfig = {
      siteStyle: {
        breakpoints: {
          viewport: [{ id: "tablet", label: "Tablet", maxWidth: 1200 }],
          container: [],
        },
      },
    };
    view.rerender();

    expect(box().width).toBe(1201);
  });

  it("KEEPS the unconditional tier's width, which is no tier's BOUND", () => {
    /*
     * The width that reaches the base tier is one PAST the widest bound, so it
     * is not among the bounded tiers — and a reconciliation that compares
     * against those alone clears it on the very next render.
     *
     * Measured before this case existed: choosing the unconditional tier set
     * the width, the effect below cleared it, and the canvas returned to
     * filling the region. Nothing failed. The one option that reaches the tier
     * an author most often edits responded to the press and did nothing, which
     * is indistinguishable from the option not working at all.
     *
     * The rerender is what makes it a test of the RECONCILIATION rather than of
     * the setter: the clearing happens in an effect, so a case asserting
     * immediately after the press passes whether or not it exists.
     */
    const view = openEditor();

    choose(992);
    view.rerender();

    expect(box().width).toBe(992);
  });

  it("EDITS the base tier at that width, which is the point of offering it", () => {
    /*
     * The width surviving is necessary and not sufficient: a number that
     * survived but resolved to a bounded tier would satisfy the case above
     * while leaving base exactly as unreachable as it was.
     *
     * Measured through the box, because the canvas is scaled rather than capped
     * — the layout width is the requested one, so what the container queries
     * resolve against is 992 even where the region is narrower.
     */
    openEditor();

    choose(992);
    measure(992);

    expect(seen.inspector?.breakpoint).toBe("base");
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

describe("a site with nothing to simulate", () => {
  it("stays PUBLISHED when no viewport tier is emitted", () => {
    /*
     * A preview compile rewrites every CONTAINER-axis rule to
     * `@container nx-not-previewable (width < 0px)`, which matches nothing.
     * That is the engine refusing to answer a question a preview box cannot —
     * a container query resolves against an element's own query container —
     * and it is the right trade when there are viewport tiers to gain.
     *
     * With none, the same price is paid for nothing: a site whose only
     * breakpoints are container ones would have every one of them silently
     * stop matching on the canvas while they keep working on the published
     * page.
     */
    clientConfig = {
      siteStyle: {
        breakpoints: {
          viewport: [],
          container: [{ id: "narrow", label: "Narrow", maxWidth: 400 }],
        },
      },
    };

    openEditor();

    const context = (
      seen.canvas?.render as { styleContext?: { previewContainer?: string } }
    )?.styleContext;
    expect(context?.previewContainer).toBeUndefined();
    expect(seen.canvas?.preview).toBeUndefined();
    expect(seen.inspector?.previewContainer).toBeUndefined();
  });

  it("PREVIEWS when the site emits a viewport tier alongside a container one", () => {
    /*
     * The control. Without it, a mount that never previewed would satisfy the
     * case above — and the whole feature would be off with every assertion
     * about it still green.
     */
    clientConfig = {
      siteStyle: {
        breakpoints: {
          viewport: [{ id: "tablet", label: "Tablet", maxWidth: 991 }],
          container: [{ id: "narrow", label: "Narrow", maxWidth: 400 }],
        },
      },
    };

    openEditor();

    const context = (
      seen.canvas?.render as { styleContext?: { previewContainer?: string } }
    )?.styleContext;
    expect(context?.previewContainer).toBeTypeOf("string");
    expect(box().container).toBe(context?.previewContainer);
  });
});

describe("going to the tier a value came from", () => {
  it("SIZES THE CANVAS to that tier rather than storing a second answer", () => {
    /*
     * The whole architecture is one width with everything derived from it. A
     * jump that wrote its own "which tier am I editing" would put the two back
     * in the disagreement deriving them from one width exists to remove — the
     * canvas would keep showing one tier while the inspector claimed another.
     *
     * Asserted on the BOX's requested width, which is the only thing a jump is
     * allowed to change.
     */
    openEditor();

    const jump = seen.inspector?.onJumpToBreakpoint as
      | ((breakpoint: string) => void)
      | undefined;
    expect(jump).toBeTypeOf("function");
    React.act(() => {
      jump?.("tablet");
    });

    expect(box().width).toBe(991);
  });

  it("SIZES the canvas for the unconditional tier too, not releases it", () => {
    /*
     * It used to release the canvas here, on the reasoning that no width puts
     * the unconditional tier on screen. There is one: the width it applies
     * FROM, one past the widest bound.
     *
     * Releasing sends the box back to the region — and wherever the region is
     * narrower than the widest bound, which is the ordinary case, the tier that
     * then applies is the one the author was jumping AWAY from. The control
     * would look like it had worked and land on the wrong tier.
     *
     * A jump and a choice are the same act reached two ways, so this has to
     * agree with what pressing the option in the switcher sets.
     */
    openEditor();
    const jump = seen.inspector?.onJumpToBreakpoint as
      | ((breakpoint: string) => void)
      | undefined;
    React.act(() => {
      jump?.("tablet");
    });
    expect(box().width).toBe(991);

    React.act(() => {
      jump?.("base");
    });

    expect(box().width).toBe(992);
  });

  it("RELEASES the canvas for a tier that is genuinely unreachable", () => {
    /*
     * The control, and the case the old reasoning was right about. A tier the
     * compiler emits no bound for — one the site does not define at all here —
     * has no width that shows it, so the box goes back to the region rather
     * than being pinned to a number nothing responds to.
     */
    openEditor();
    const jump = seen.inspector?.onJumpToBreakpoint as
      | ((breakpoint: string) => void)
      | undefined;
    React.act(() => {
      jump?.("tablet");
    });
    expect(box().width).toBe(991);

    React.act(() => {
      jump?.("no-such-tier");
    });

    expect(box().width).toBeUndefined();
  });
});
