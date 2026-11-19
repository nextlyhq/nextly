// @vitest-environment jsdom

/**
 * What a selection draws again of the shell beside the canvas, through the
 * page builder's real editor and the builder's real shell: not the rail, not
 * Help and not Page settings, none of which shows the selected block.
 *
 * Built on `selection-top-bar.test`'s stand-ins, with the shell left real so
 * the rail and its dialogs are the ones an author gets. The rail is counted
 * through the panel keys it registers as it draws, Help through the bindings
 * list it reads as it draws (nothing else in the editor reads it), and Page
 * settings through its dialog, stood in by one that keeps what it was handed.
 *
 * A selection draws none of them again. Settings is drawn again for an edit
 * and a rename, which change the page it shows (the share preview is built
 * from the document while it is open, the heading names the page's title),
 * and the rail and Help are drawn again for what they show: a panel opened,
 * Help opened.
 *
 * @module admin/selection-shell-subtrees.test
 */
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
  type FieldValues,
  type UseFormSetValue,
} from "react-hook-form";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { clearBlocks, registerBlocks } from "@nextlyhq/blocks-engine";
import { closedDocumentSession } from "../__tests__/closed-document-session";

const DOCUMENT = {
  formatVersion: 1,
  kind: "page",
  nodes: [
    { name: "Alpha", text: "Alpha's words" },
    { name: "Beta", text: "Beta's words" },
    { name: "Gamma", text: "Gamma's words" },
  ].map(({ name, text }) => ({
    id: name.toLowerCase(),
    type: "acme/leaf",
    version: 1,
    name,
    props: { text },
  })),
};

interface SeenEditor {
  document: { nodes: readonly { id: string; name?: string; props: object }[] };
  selectedId: string | null;
  apply: (op: unknown) => unknown;
}

const seen: {
  canvas: Record<string, unknown> | undefined;
  inspector: SeenEditor | undefined;
  setValue: UseFormSetValue<FieldValues> | undefined;
} = { canvas: undefined, inspector: undefined, setValue: undefined };

/**
 * Each column's renders, counted by one control in it; and whether the
 * editor last reported work not saved, which the stand-in Save shows.
 */
const counted = vi.hoisted(() => ({
  rail: 0,
  help: 0,
  settings: 0,
  unsaved: false,
}));

/** What Page settings was last handed: whether it is open, and the title. */
const settingsSeen = vi.hoisted(() => ({
  open: false,
  pageTitle: undefined as string | undefined,
  share: undefined as { description?: string } | undefined,
}));

/** The selected block as a surface names it: its name and its words. */
function named(editor: SeenEditor): string {
  const node = editor.document.nodes.find(
    each => each.id === editor.selectedId
  );
  if (node === undefined) return "nothing";
  return `${node.name ?? node.id}: ${String((node.props as { text?: unknown }).text)}`;
}

// The editor asks the session's grants for shared styles; this file is not
// about them, so the author holds the right to change the site's design.
vi.mock("@nextlyhq/plugin-sdk/client", () => ({
  useCan: (permission: string) => permission === "update-site-style",
}));

vi.mock("@nextlyhq/builder/shell", async importOriginal => {
  const real = await importOriginal<typeof import("@nextlyhq/builder/shell")>();
  const nothing = (): null => null;
  const passthrough = ({
    children,
  }: {
    children?: React.ReactNode;
  }): React.JSX.Element => <>{children}</>;
  // The real canvas, with the props it was last handed kept, so a case can
  // select through the canvas's own `onSelect` as a click does.
  const Canvas = (
    props: React.ComponentProps<typeof real.Canvas>
  ): React.JSX.Element => {
    seen.canvas = props as unknown as Record<string, unknown>;
    return <real.Canvas {...props} />;
  };
  return {
    ...real,
    BreakpointManager: nothing,
    BreakpointSwitcher: nothing,
    // The inspector's card: the block it was handed.
    InspectorPanel: ({ editor }: { editor: SeenEditor }) => {
      seen.inspector = editor;
      return <p data-testid="inspector-card">{named(editor)}</p>;
    },
    Canvas,
    // Passed through with its overlay, where the toolbar is drawn: the
    // canvas renders inside its frame, which jsdom never loads a page into.
    CanvasFrame: ({
      children,
      overlay,
    }: {
      children?: React.ReactNode;
      overlay?: React.ReactNode;
    }): React.JSX.Element => (
      <>
        {children}
        {overlay}
      </>
    ),
    BlockKeyboardActions: passthrough,
    BlockContextMenu: passthrough,
    // The toolbar: the block it acts on.
    BlockToolbar: ({ editor }: { editor: SeenEditor }) => (
      <p data-testid="toolbar-target">{named(editor)}</p>
    ),
    EditorCommandPalette: nothing,
    DropIndicator: nothing,
    InsertPanel: nothing,
    RepairNotice: nothing,
    LayersPanel: nothing,
    OnboardingChecklist: nothing,
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
    useInlineText: () => ({ onDoubleClick: () => {} }),
  };
});

// The rail and Help, counted through what each reads as it draws: the rail
// registers its panel keys, and Help lists the bindings in effect.
vi.mock("@nextlyhq/ui", async importOriginal => {
  const real = await importOriginal<typeof import("@nextlyhq/ui")>();
  return {
    ...real,
    useShortcuts: (...args: Parameters<typeof real.useShortcuts>) => {
      // The builder's panel-key layer, "Editor panels" and the editor's id.
      if (args[1].name.startsWith("Editor panels")) counted.rail += 1;
      real.useShortcuts(...args);
    },
    useActiveShortcuts: () => {
      counted.help += 1;
      return real.useActiveShortcuts();
    },
  };
});

// Page settings: counted, keeping whether it is open and the page it names.
vi.mock("./editor/settings-dialog", () => ({
  SettingsDialog: (props: {
    open: boolean;
    pageTitle: string | undefined;
    share: { description?: string };
  }) => {
    counted.settings += 1;
    settingsSeen.open = props.open;
    settingsSeen.pageTitle = props.pageTitle;
    settingsSeen.share = props.share;
    return null;
  },
}));

/** Asking the stored style again, as the editor does after a save. */
const refetchStoredStyle = async () => ({ isError: false });
vi.mock("./site-style-read", () => ({
  useStoredSiteStyle: () => ({
    data: undefined,
    isPending: false,
    error: null,
    refetch: refetchStoredStyle,
  }),
}));

vi.mock("@nextlyhq/plugin-sdk/admin", async () => ({
  useDocumentOpensIn: () => null,
  PIN_TO_DASHBOARD_ACTION: "pin-to-dashboard",
  useMediaResolver: (
    read => () =>
      read
  )(() => Promise.resolve(null)),
  useMediaSearcher: (
    search => () =>
      search
  )(() => Promise.resolve([])),
  WEB_FONT_FORMATS: (await import("nextly/config")).WEB_FONT_FORMATS,
  usePluginRouteMutation: () => ({
    write: async () => undefined,
    pending: false,
    error: null,
  }),
  MediaPickerDialog: () => null,
  // The image states over the canvas take the media upload; nothing here
  // uploads.
  useUploadMedia: () => ({ mutateAsync: async () => undefined }),
  loadInlineRichTextEditor: () => new Promise<never>(() => {}),
  usePluginClientConfig: () => undefined,
  useDocumentIdentity: () => null,
  navigateTo: vi.fn(),
  useDocumentLocale: () => null,
  usePluginRoute: () => ({
    data: undefined,
    pending: false,
    error: null,
    refetch: () => {},
  }),
  readPluginRoute: async () => ({ reads: {} }),
  useDocumentCheckpoint: () => ({ schedule: () => {} }),
  useEntryFieldsPanel: () => null,
  // What the editor reports of its work not saved, which the stand-in Save
  // below shows as the admin's does.
  useReportUnsavedWork: (_key: string, hasWork: boolean) => {
    counted.unsaved = hasWork;
  },
  useSuppressAdminChrome: () => {},
  useTrackedWrite: () => () => {},
  useBeforeDocumentAction: () => {},
  useDocumentSession: () => closedDocumentSession(),
  // Saying whether there is work to save, as the admin's does.
  DocumentSaveAndPublish: () => (
    <p data-testid="save-state">
      {counted.unsaved ? "Unsaved changes" : "Saved"}
    </p>
  ),
  useDocumentLifeStage: () => null,
  useDocumentActions: () => null,
  useDocumentPreview: () => null,
  useCurrentUserId: () => "author-1",
  schemaVersion: () => 1,
  onSchemaChange: () => () => {},
  devicePreferenceStore: () => ({
    read: () => null,
    write: () => {},
    remove: () => {},
  }),
  useDocumentStatus: () => null,
  useDocumentRestore: () => undefined,
  useUpdateSingleDocument: () => ({
    mutateAsync: async () => ({ success: true }),
    isPending: false,
  }),
}));

const { PageBuilderView } = await import("./editor/PageBuilderView");

const BODY_FIELD = { name: "body", type: "blocks" } as never;

/** The builder's document view, open on a form holding the page and its title. */
function Host(): React.JSX.Element {
  const { control, setValue } = useForm<FieldValues>({
    defaultValues: { title: "About us", body: DOCUMENT },
  });
  seen.setValue = setValue;
  return (
    <PageBuilderView
      control={control}
      field={BODY_FIELD}
      readOnly={false}
      exit={() => {}}
    />
  );
}

/** Selects `id` through the canvas's own `onSelect`, as a click on it does. */
function select(id: string): void {
  const onSelect = seen.canvas?.onSelect as
    | ((id: string, mode: string) => void)
    | undefined;
  if (onSelect === undefined) throw new Error("the canvas was not drawn");
  act(() => {
    onSelect(id, "replace");
  });
}

/** The rail's, Help's and Page settings' draws so far. */
function shellDraws(): { rail: number; help: number; settings: number } {
  return {
    rail: counted.rail,
    help: counted.help,
    settings: counted.settings,
  };
}

/**
 * The inspector's card, the toolbar's target and the trail's current crumb,
 * each naming `block`, with the canvas holding it selected.
 */
function expectEverySurfaceOn(id: string, block: string): void {
  expect(seen.canvas?.selectedId).toBe(id);
  expect(screen.getByTestId("inspector-card").textContent).toBe(block);
  expect(screen.getByTestId("toolbar-target").textContent).toBe(block);
  const current = screen
    .getByRole("list", { name: "Current location", hidden: true })
    .querySelector('[aria-current="true"]');
  expect(current?.textContent).toBe(block.split(":")[0]);
}

/** A rail item, found while a dialog over the editor hides the rail too. */
function railItem(name: string): HTMLElement {
  return screen.getByRole("button", { name, hidden: true });
}

/** Every observed element wide enough for the whole editor, so it is drawn. */
class WideResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}
  observe(target: Element): void {
    this.callback(
      [
        {
          target,
          borderBoxSize: [{ inlineSize: 1800, blockSize: 900 }],
          contentRect: { width: 1800, height: 900 },
        } as unknown as ResizeObserverEntry,
      ],
      this as never
    );
  }
  unobserve(): void {}
  disconnect(): void {}
}

beforeAll(() => {
  clearBlocks();
  registerBlocks(
    [
      {
        name: "acme/leaf",
        version: 1,
        description: "A block.",
        props: { text: { type: "text", label: "Text" } },
        example: { props: { text: "" } },
        render: () => <p>leaf</p>,
        // Its words describe the page, so the share preview Settings builds
        // while open reads them from the document.
        seo: (props: { text?: string }) => ({ description: props.text }),
      },
    ] as never,
    { source: "selection-top-bar-test" }
  );
});
afterAll(clearBlocks);

beforeEach(() => {
  seen.canvas = undefined;
  seen.inspector = undefined;
  seen.setValue = undefined;
  counted.rail = 0;
  counted.help = 0;
  counted.settings = 0;
  counted.unsaved = false;
  settingsSeen.open = false;
  settingsSeen.pageTitle = undefined;
  settingsSeen.share = undefined;
  vi.stubGlobal("ResizeObserver", WideResizeObserver);
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }))
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("a selection draws none of the rail, Help or Page settings again", () => {
  it("follows A, B, an edit of B, C and a rename, drawing Settings again only for the edit and the rename", async () => {
    await act(async () => {
      render(<Host />);
    });
    // The controls: each counter sees its surface drawn, by the real shell.
    expect(counted.rail).toBeGreaterThan(0);
    expect(counted.help).toBeGreaterThan(0);
    expect(counted.settings).toBeGreaterThan(0);
    expect(settingsSeen.pageTitle).toBe("About us");

    // Selecting A, then B: every surface follows; none of the three draws.
    let before = shellDraws();
    select("alpha");
    expectEverySurfaceOn("alpha", "Alpha: Alpha's words");
    expect(shellDraws()).toEqual(before);

    select("beta");
    expectEverySurfaceOn("beta", "Beta: Beta's words");
    expect(shellDraws()).toEqual(before);

    // An edit of B's words: the page Settings shows changed, so it draws
    // again. The rail and Help show nothing of it.
    act(() => {
      seen.inspector?.apply({
        kind: "update",
        id: "beta",
        patch: { props: { text: "Beta, edited" } },
      });
    });
    expectEverySurfaceOn("beta", "Beta: Beta, edited");
    expect(screen.getByTestId("save-state").textContent).toBe(
      "Unsaved changes"
    );
    expect(counted.settings).toBeGreaterThan(before.settings);
    expect(counted.rail).toBe(before.rail);
    expect(counted.help).toBe(before.help);

    // Selecting C: every surface follows; none of the three draws.
    before = shellDraws();
    select("gamma");
    expectEverySurfaceOn("gamma", "Gamma: Gamma's words");
    expect(shellDraws()).toEqual(before);

    // A rename of the page: Settings draws again and names the new title.
    act(() => {
      seen.setValue?.("title", "Our story");
    });
    expect(counted.settings).toBeGreaterThan(before.settings);
    expect(settingsSeen.pageTitle).toBe("Our story");
    expectEverySurfaceOn("gamma", "Gamma: Gamma's words");
  });

  it("draws Settings again for an edit while it is open, and the rail and Help for what they show", async () => {
    await act(async () => {
      render(<Host />);
    });

    // Opening a panel: the rail shows it pressed, so it draws again.
    let before = shellDraws();
    act(() => {
      fireEvent.click(railItem("Layers"));
    });
    expect(railItem("Layers").getAttribute("aria-pressed")).toBe("true");
    expect(counted.rail).toBeGreaterThan(before.rail);
    expect(counted.help).toBe(before.help);
    expect(counted.settings).toBe(before.settings);

    // Opening Settings from the rail: it is handed the open state.
    act(() => {
      fireEvent.click(railItem("Settings"));
    });
    expect(settingsSeen.open).toBe(true);

    // A selection while it is open draws none of the three.
    select("alpha");
    before = shellDraws();
    select("beta");
    expectEverySurfaceOn("beta", "Beta: Beta's words");
    expect(shellDraws()).toEqual(before);

    // The control: the open preview is built from the page, its description
    // from the first block's words.
    expect(settingsSeen.share?.description).toBe("Alpha's words");

    // An edit of those words while it is open: Settings draws again with a
    // preview built from the edited page, not from the one it was opened on.
    act(() => {
      seen.inspector?.apply({
        kind: "update",
        id: "alpha",
        patch: { props: { text: "Alpha, edited" } },
      });
    });
    expect(counted.settings).toBeGreaterThan(before.settings);
    expect(settingsSeen.open).toBe(true);
    expect(settingsSeen.share?.description).toBe("Alpha, edited");

    // Closing Settings, then opening Help from the rail: Help draws again.
    act(() => {
      fireEvent.keyDown(document.activeElement ?? document.body, {
        key: "Escape",
      });
    });
    before = shellDraws();
    act(() => {
      fireEvent.click(railItem("Help"));
    });
    expect(counted.help).toBeGreaterThan(before.help);
  });
});
