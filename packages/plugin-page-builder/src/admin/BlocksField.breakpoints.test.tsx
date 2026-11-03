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
import { cleanup, render } from "@testing-library/react";
import * as React from "react";
import { useForm, type FieldValues } from "react-hook-form";
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
/** The device the shell restores on load, as an author left it. */
let storedDevice: string | null = null;

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
      title,
      topBar,
      topBarCenter,
      topBarEnd,
      children,
      renderPanel,
      editingBreakpointRequest,
      onEditingBreakpointChange,
    }: {
      inspector: React.ReactNode;
      title?: string;
      topBar?: React.ReactNode;
      topBarCenter?: React.ReactNode;
      topBarEnd?: React.ReactNode;
      children?: React.ReactNode;
      renderPanel?: (panel: string) => React.ReactNode;
      editingBreakpointRequest?: { breakpoint: string | null; count: number };
      onEditingBreakpointChange?: (breakpoint: string | null) => void;
    }): React.JSX.Element => {
      /*
       * The device half of the real shell: it holds what a request asks for
       * and reports it back, starting from the stored device. Without it the
       * editor's choice would go nowhere, and every case below would be
       * reading the base breakpoint whatever was chosen.
       */
      React.useEffect(() => {
        onEditingBreakpointChange?.(storedDevice);
      }, [onEditingBreakpointChange]);
      React.useEffect(() => {
        if (editingBreakpointRequest === undefined) return;
        onEditingBreakpointChange?.(editingBreakpointRequest.breakpoint);
      }, [editingBreakpointRequest, onEditingBreakpointChange]);
      return (
        <div>
          <span data-testid="shell-title">{title}</span>
          {topBar}
          {topBarCenter}
          {topBarEnd}
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
      );
    },
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
    RepairNotice: nothing,
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

vi.mock("@nextlyhq/plugin-sdk/admin", async () => ({
  // The host's font table, which the real entry re-exports from core.
  WEB_FONT_FORMATS: (await import("nextly/config")).WEB_FONT_FORMATS,
  /*
   * Never awaited by these cases: the loader is reached only when an author
   * double-clicks a passage, and none of them do. Present because the mock
   * REPLACES the module wholesale, so an export the subject imports and this
   * omits is a missing-export error rather than an unused stub.
   */
  // The media library, drawn as nothing: these cases never open it.
  MediaPickerDialog: () => null,
  loadInlineRichTextEditor: () => new Promise<never>(() => {}),
  usePluginClientConfig: () => clientConfig,
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
  // Nothing stored, read successfully — so the merged style is the host's
  // config alone and `status` is "ready". A pending read would disable the
  // switcher, which is a different test's subject.
  useSingleDocument: () => ({ data: undefined, isPending: false, error: null }),
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

/** The builder's document view, open on the form's `body` field. */
function Host(): React.JSX.Element {
  const { control } = useForm<FieldValues>({
    defaultValues: { body: undefined, title: "About us" },
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
function choose(breakpoint: string): void {
  const select = seen.switcher?.onSelect as
    | ((breakpoint: string) => void)
    | undefined;
  if (select === undefined)
    throw new Error("the switcher was given no handler");
  React.act(() => {
    select(breakpoint);
  });
}

beforeEach(() => {
  seen.inspector = undefined;
  seen.canvas = undefined;
  seen.switcher = undefined;
  clientConfig = { siteStyle: SITE };
  storedDevice = null;
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

describe("the top bar's title", () => {
  it("shows the document's title as the form holds it", async () => {
    const { screen } = await import("@testing-library/react");
    openEditor();
    expect(screen.getByTestId("shell-title").textContent).toBe("About us");
  });
});

describe("the top bar's history", () => {
  it("draws undo and redo, unavailable on a fresh document", async () => {
    const { screen } = await import("@testing-library/react");
    openEditor();
    const undo = screen.getByRole("button", { name: "Undo" });
    const redo = screen.getByRole("button", { name: "Redo" });
    expect((undo as HTMLButtonElement).disabled).toBe(true);
    expect((redo as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("the device being edited", () => {
  it("lays the canvas out at the device the author chooses", () => {
    openEditor();

    choose("tablet");

    expect(box().width).toBe(991);
    expect(seen.switcher?.selected).toBe("tablet");
  });

  it("lays Desktop out at 1280, not at whatever the region allows", () => {
    // The region narrows as panels open; a fixed width keeps the device's
    // layout the same, and the zoom fits it into the room there is.
    openEditor();

    choose("tablet");
    choose("base");

    expect(box().width).toBe(1280);
    expect(seen.switcher?.selected).toBe("base");
  });

  it("edits the device the author chose, whatever width the box measured", () => {
    /*
     * The defect this replaces: the edited breakpoint was read off the width
     * the canvas measured, so at the 1280px minimum (a region of about 912px)
     * or with a panel open, an author on Desktop was silently styling the
     * 991px tablet breakpoint.
     */
    openEditor();

    choose("base");
    measure(900);

    expect(seen.inspector?.breakpoint).toBe("base");
  });

  it("edits a narrower device only once it is chosen", () => {
    // The control on the case above: the inspector does follow a choice.
    openEditor();

    choose("tablet");
    measure(900);

    expect(seen.inspector?.breakpoint).toBe("tablet");
    expect(seen.inspector?.liveBreakpoints).toContain("tablet");
  });

  it("starts on the device the author left", () => {
    storedDevice = "mobile";

    openEditor();

    expect(seen.inspector?.breakpoint).toBe("mobile");
    expect(box().width).toBe(575);
  });
});

describe("a device the site stops offering", () => {
  it("goes back to Desktop when the chosen breakpoint is removed", () => {
    /*
     * Deterministic, and never a breakpoint nothing draws: an edit stored
     * under an id the site no longer defines would never reach the page.
     */
    const view = openEditor();
    choose("tablet");
    expect(seen.inspector?.breakpoint).toBe("tablet");

    clientConfig = {
      siteStyle: {
        breakpoints: {
          viewport: [{ id: "mobile", label: "Mobile", maxWidth: 575 }],
          container: [],
        },
      },
    };
    view.rerender();

    expect(seen.inspector?.breakpoint).toBe("base");
    expect(seen.switcher?.selected).toBe("base");
    expect(box().width).toBe(1280);
  });

  it("stops simulating when the site removes its last breakpoint", () => {
    const view = openEditor();
    choose("tablet");

    clientConfig = {
      siteStyle: { breakpoints: { viewport: [], container: [] } },
    };
    view.rerender();

    expect(seen.inspector?.breakpoint).toBe("base");
    expect(box().width).toBeUndefined();
  });

  it("follows a breakpoint whose bound is edited", () => {
    // Stored as the breakpoint, not the width it was shown at, so moving its
    // bound moves the canvas with it rather than losing the choice.
    const view = openEditor();
    choose("tablet");

    clientConfig = {
      siteStyle: {
        breakpoints: {
          viewport: [
            { id: "tablet", label: "Tablet", maxWidth: 1023 },
            { id: "mobile", label: "Mobile", maxWidth: 575 },
          ],
          container: [],
        },
      },
    };
    view.rerender();

    expect(seen.inspector?.breakpoint).toBe("tablet");
    expect(box().width).toBe(1023);
  });

  it("keeps the base outside a breakpoint that grows past 1280", () => {
    const view = openEditor();
    choose("base");

    clientConfig = {
      siteStyle: {
        breakpoints: {
          viewport: [{ id: "laptop", label: "Laptop", maxWidth: 1439 }],
          container: [],
        },
      },
    };
    view.rerender();

    expect(box().width).toBe(1440);
    expect(seen.inspector?.breakpoint).toBe("base");
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

describe("going to the breakpoint a value came from", () => {
  function jump(breakpoint: string): void {
    const go = seen.inspector?.onJumpToBreakpoint as
      | ((breakpoint: string) => void)
      | undefined;
    if (go === undefined) throw new Error("the inspector was given no jump");
    React.act(() => {
      go(breakpoint);
    });
  }

  it("chooses that device, as the device buttons would", () => {
    // A jump and a choice are the same act reached two ways, so both go
    // through the shell's one device rather than a second answer here.
    openEditor();

    jump("tablet");

    expect(seen.switcher?.selected).toBe("tablet");
    expect(seen.inspector?.breakpoint).toBe("tablet");
    expect(box().width).toBe(991);
  });

  it("goes to Desktop for the base breakpoint", () => {
    openEditor();
    jump("tablet");

    jump("base");

    expect(seen.inspector?.breakpoint).toBe("base");
    expect(box().width).toBe(1280);
  });

  it("edits Desktop for a breakpoint the site does not define", () => {
    openEditor();
    jump("tablet");

    jump("no-such-breakpoint");

    expect(seen.inspector?.breakpoint).toBe("base");
    expect(box().width).toBe(1280);
  });
});
