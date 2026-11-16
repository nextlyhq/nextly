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
import userEvent from "@testing-library/user-event";
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
  frame: Record<string, unknown> | undefined;
  switcher: Record<string, unknown> | undefined;
  layers: Record<string, unknown> | undefined;
} = {
  inspector: undefined,
  canvas: undefined,
  frame: undefined,
  switcher: undefined,
  layers: undefined,
};

/** What `usePluginClientConfig` answers with for the test in hand. */
let clientConfig: Record<string, unknown> | undefined;
/** The device the shell restores on load, as an author left it. */
let storedDevice: string | null = null;
/** Every device the editor asked the shell for, in order. */
const deviceRequests: Array<string | null> = [];
/** Whether the shell draws its Settings dialog open. */
let settingsOpen = false;
/** What the Site tab's read answers with; nothing until a case sets it. */
let siteSettingsRead: Record<string, unknown> | undefined;
/** What the stored site style's read answers with for the test in hand. */
let storedRead: {
  data: unknown;
  isPending: boolean;
  error: Error | null;
  /** Whether the answer is the site as it is now, as the real read reports. */
  current: boolean;
} = { data: undefined, isPending: false, error: null, current: true };
/** A current answer from the route, holding `data`. */
const answered = (data: unknown): typeof storedRead => ({
  data,
  isPending: false,
  error: null,
  current: true,
});
/** The stored set without Mobile, as a removal elsewhere leaves it. */
const TABLET_ONLY = {
  breakpoints: {
    viewport: [{ id: "tablet", label: "Tablet", maxWidth: 991 }],
    container: [],
  },
};

// The editor asks the session's grants for shared styles; this file is not
// about them, so the author holds the right to change the site's design.
vi.mock("@nextlyhq/plugin-sdk/client", () => ({
  useCan: (permission: string) => permission === "update-site-style",
}));

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
      renderSettings,
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
      renderSettings?: (dialog: {
        open: boolean;
        onOpenChange: (open: boolean) => void;
        returnFocus: () => HTMLElement | null;
      }) => React.ReactNode;
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
        deviceRequests.push(editingBreakpointRequest.breakpoint);
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
          {/* Asked for on every pass, open or not, as the real shell asks. */}
          {renderSettings?.({
            open: settingsOpen,
            onOpenChange: () => {},
            returnFocus: () => null,
          })}
          {children}
        </div>
      );
    },
    // Drawn as a marker, so where the editor mounts it can be found.
    BreakpointManager: (): React.JSX.Element => (
      <div data-recorder="breakpoint-manager" />
    ),
    BreakpointSwitcher: record("switcher"),
    InspectorPanel: record("inspector"),
    Canvas: record("canvas"),
    // Recorded and passed through: the canvas renders inside the frame, which
    // is what is sized to the device.
    CanvasFrame: (props: Record<string, unknown>): React.JSX.Element => {
      seen.frame = props;
      return <>{props.children as React.ReactNode}</>;
    },
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

/** Asking the stored style again, as the editor does after a save. */
const refetchStoredStyle = async () => ({ isError: false });
// The stored site style arrives through the editor's one read, the plugin's
// route; that read's request is asserted in `site-style-read.test`.
vi.mock("./site-style-read", () => ({
  useStoredSiteStyle: () => ({
    error: null,
    ...storedRead,
    refetch: refetchStoredStyle,
  }),
}));

vi.mock("@nextlyhq/plugin-sdk/admin", async () => ({
  // Settings' place for other plugins' tabs, with none added: the page's own
  // settings alone, as the admin draws them with no tab.
  PlaceTabs: ({ children }: { children: unknown }) => children,
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
  usePluginRoute: ({ path }: { path: string }) => ({
    data: path === "/site/settings" ? siteSettingsRead : undefined,
    pending: false,
    fetching: false,
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
  // Nothing stored, read successfully — so the merged style is the host's
  // config alone and `status` is "ready". A pending read would disable the
  // switcher, which is a different test's subject.
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

/** The size the canvas's frame was handed. */
function box(): { width?: number } {
  return (seen.frame ?? {}) as { width?: number };
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
  seen.frame = undefined;
  seen.switcher = undefined;
  clientConfig = { siteStyle: SITE };
  storedDevice = null;
  deviceRequests.length = 0;
  storedRead = answered(undefined);
  settingsOpen = false;
  siteSettingsRead = undefined;
});

afterEach(() => {
  cleanup();
});

describe("the sheet the canvas is compiled with", () => {
  it("gives the canvas's frame the reporter the zoom control reads", () => {
    /*
     * The scale the frame paints at is reported back so the control can name
     * it — including while FITTING, where it is derived from a region only the
     * frame measures.
     */
    openEditor();

    expect(seen.frame?.onScale).toBeTypeOf("function");
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

  it("compiles the page as published, with no preview container", () => {
    /*
     * The canvas is a frame at the device's own size, so `@media` and the
     * site's container queries answer for the device exactly as on the
     * published page. A preview compile would rewrite them for a box the
     * frame no longer establishes, and every container rule would match
     * nothing.
     *
     * Asserted with the control that the context is there at all, so an
     * absent one does not pass for a published compile.
     */
    openEditor();

    const context = (
      seen.canvas?.render as {
        styleContext?: { previewContainer?: string; breakpoints?: unknown };
      }
    )?.styleContext;
    expect(context?.breakpoints).toBeDefined();
    expect(context?.previewContainer).toBeUndefined();
    expect(seen.inspector?.previewContainer).toBeUndefined();
  });
});

describe("the top bar's title", () => {
  it("shows the document's title as the form holds it, as the page switcher", async () => {
    const { screen } = await import("@testing-library/react");
    openEditor();
    expect(
      screen.getByRole("button", { name: "About us: switch page" }).textContent
    ).toBe("About us");
    // The shell's own read-only title is not drawn beside it.
    expect(screen.getByTestId("shell-title").textContent).toBe("");
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

describe("where the breakpoints are edited", () => {
  /** The breakpoint editors mounted anywhere in the editor. */
  const managers = (): Element[] => [
    ...document.querySelectorAll('[data-recorder="breakpoint-manager"]'),
  ];

  it("offers no breakpoint editor in the top bar", async () => {
    const { screen } = await import("@testing-library/react");
    openEditor();

    // The top bar is drawn: its device buttons are there.
    expect(seen.switcher).toBeDefined();
    expect(managers()).toHaveLength(0);
    expect(
      screen.queryByRole("button", { name: /edit breakpoints/i })
    ).toBeNull();
  });

  it("edits them in Settings, on the Site tab", async () => {
    /*
     * The control on the case above: the marker is found where the editor
     * does mount the manager, so its absence there is not a marker that
     * cannot be found.
     */
    const { screen } = await import("@testing-library/react");
    settingsOpen = true;
    siteSettingsRead = {
      mayManageSite: true,
      mayChooseDefaultLayout: false,
      defaultLayout: null,
      breakpoints: null,
      layouts: [],
    };
    openEditor();
    expect(managers()).toHaveLength(0);

    await userEvent.click(screen.getByRole("tab", { name: "Site" }));

    expect(managers()).toHaveLength(1);
    expect(screen.getByRole("dialog").contains(managers()[0] ?? null)).toBe(
      true
    );
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

    expect(seen.inspector?.breakpoint).toBe("base");
    expect(box().width).toBe(1280);
  });

  it("edits a narrower device only once it is chosen", () => {
    // The control on the case above: the inspector does follow a choice.
    openEditor();

    choose("tablet");

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
  it("goes back to Desktop when no breakpoint wider than the removed one remains", () => {
    /*
     * Deterministic, and never a breakpoint nothing draws: an edit stored
     * under an id the site no longer defines would never reach the page.
     * Mobile remains, and is narrower, so the edit goes to the base rather
     * than to it.
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

  it("moves to the next wider breakpoint when one remains, and shows it chosen", () => {
    /*
     * Mobile removed while it is being edited: Tablet, the next one up, is
     * where the edits go, and the device buttons show it as the device chosen.
     * The base would also be a defined breakpoint, so only the next wider one
     * separates this from going back to Desktop.
     */
    const view = openEditor();
    choose("mobile");
    expect(seen.inspector?.breakpoint).toBe("mobile");

    clientConfig = {
      siteStyle: {
        breakpoints: {
          viewport: [{ id: "tablet", label: "Tablet", maxWidth: 991 }],
          container: [],
        },
      },
    };
    view.rerender();

    expect(seen.inspector?.breakpoint).toBe("tablet");
    expect(seen.switcher?.selected).toBe("tablet");
    expect(box().width).toBe(991);
    // Chosen through the shell, so it is stored as the author's device.
    expect(deviceRequests.at(-1)).toBe("tablet");
  });

  it("keeps a device that was restored on load for a breakpoint already gone at the base", () => {
    /*
     * The fallback answers a removal seen in this session. A device stored
     * for a breakpoint the site had already removed has no width to compare
     * against, so it is edited at the base, and a later change to the set
     * does not move it to some other breakpoint.
     */
    storedDevice = "watch";
    const view = openEditor();
    expect(seen.inspector?.breakpoint).toBe("base");

    clientConfig = {
      siteStyle: {
        breakpoints: {
          viewport: [{ id: "tablet", label: "Tablet", maxWidth: 991 }],
          container: [],
        },
      },
    };
    view.rerender();

    expect(seen.inspector?.breakpoint).toBe("base");
    expect(seen.switcher?.selected).toBe("base");
    // Nothing was asked of the shell: the stored choice is left as it was.
    expect(deviceRequests).toEqual([]);
  });

  it("does not take the stored set's arrival for a removal", () => {
    /*
     * Until the stored style answers, the set in hand is the host's config
     * defaults. A device restored on load that the stored set does not have
     * was removed before this session, so it goes to the base, and the
     * arrival of the read is not a removal to fall back from.
     */
    storedDevice = "mobile";
    storedRead = {
      data: undefined,
      isPending: true,
      error: null,
      current: false,
    };
    const view = openEditor();

    storedRead = answered(TABLET_ONLY);
    view.rerender();

    expect(seen.inspector?.breakpoint).toBe("base");
    expect(deviceRequests).toEqual([]);
  });

  it("does not take a retried read's answer, after the first failed, for a removal", () => {
    /*
     * A failed first read leaves the host's config defaults in hand, as a
     * pending one does. A device restored on load that the stored set does not
     * have was removed before this session, so when a retry answers it goes to
     * the base rather than to the next wider breakpoint.
     */
    storedDevice = "mobile";
    storedRead = {
      data: undefined,
      isPending: false,
      error: new Error("offline"),
      current: false,
    };
    const view = openEditor();

    storedRead = answered(TABLET_ONLY);
    view.rerender();

    expect(seen.inspector?.breakpoint).toBe("base");
    expect(deviceRequests).toEqual([]);
  });

  it("does not take a stale cached answer, shown while a new read runs, for the set before", () => {
    /*
     * Reopened after the cache went stale: the cached answer still has Mobile,
     * which another author removed meanwhile. It is shown while the editor
     * reads again, and is not current, so the read's answer is a removal made
     * while this author was away: the base, not the next wider breakpoint.
     */
    storedDevice = "mobile";
    storedRead = {
      data: undefined,
      isPending: false,
      error: null,
      current: false,
    };
    const view = openEditor();
    expect(seen.inspector?.breakpoint).toBe("mobile");

    storedRead = answered(TABLET_ONLY);
    view.rerender();

    expect(seen.inspector?.breakpoint).toBe("base");
    expect(deviceRequests).toEqual([]);
  });

  it("keeps the last current set across a read that fails, for the removal a retry confirms", () => {
    /*
     * Mobile chosen against a current answer; a later read fails, keeping that
     * answer beside the failure; a retry then answers without Mobile. The
     * removal is compared with the set before the failure, so it moves to
     * Tablet rather than to the base.
     */
    const view = openEditor();
    choose("mobile");
    expect(seen.inspector?.breakpoint).toBe("mobile");

    storedRead = {
      data: undefined,
      isPending: false,
      error: new Error("offline"),
      current: false,
    };
    view.rerender();
    expect(seen.inspector?.breakpoint).toBe("mobile");

    storedRead = answered(TABLET_ONLY);
    view.rerender();

    expect(seen.inspector?.breakpoint).toBe("tablet");
    expect(deviceRequests.at(-1)).toBe("tablet");
  });

  it("shows Desktop when the site removes its last breakpoint", () => {
    const view = openEditor();
    choose("tablet");

    clientConfig = {
      siteStyle: { breakpoints: { viewport: [], container: [] } },
    };
    view.rerender();

    expect(seen.inspector?.breakpoint).toBe("base");
    // Nothing to simulate, so the page is shown as a laptop would show it.
    expect(box().width).toBe(1280);
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

describe("a site whose only breakpoints are container ones", () => {
  it("is compiled as published, so its container rules still answer", () => {
    /*
     * Its container queries resolve against the page's own containers in the
     * frame, exactly as on the published page.
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
      seen.canvas?.render as {
        styleContext?: { previewContainer?: string; breakpoints?: unknown };
      }
    )?.styleContext;
    expect(context?.breakpoints).toBeDefined();
    expect(context?.previewContainer).toBeUndefined();
    expect(box().width).toBe(1280);
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
