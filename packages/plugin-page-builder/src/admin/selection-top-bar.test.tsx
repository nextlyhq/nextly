// @vitest-environment jsdom

/**
 * What a selection draws again, through the page builder's real editor: the
 * surfaces that follow the selected block, and not the top bar, which shows
 * nothing about it.
 *
 * Built on `speed-counters.test`'s stand-ins: the editor and its state are
 * the plugin's real ones, and only the admin's hooks and the panels around
 * the canvas are stood in for. The shell is stood in by one that draws the
 * slots this file reads: the top bar's three columns, the inspector and the
 * trail. The inspector and the toolbar are stood in by what names the block
 * each was handed; the trail is the real one.
 *
 * The top bar is counted by one control in each column: the page's status at
 * the start, the devices in the centre, and Save and Publish at the end. A
 * selection draws none of them again, and an edit, an undo and a rename each
 * do, with what they changed shown: a top bar holding an old document would
 * say nothing about the edit.
 *
 * @module admin/selection-top-bar.test
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
  start: 0,
  centre: 0,
  end: 0,
  unsaved: false,
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
    BuilderShell: ({
      topBar,
      topBarCenter,
      topBarEnd,
      inspector,
      breadcrumb,
      children,
    }: Record<
      | "topBar"
      | "topBarCenter"
      | "topBarEnd"
      | "inspector"
      | "breadcrumb"
      | "children",
      React.ReactNode
    >): React.JSX.Element => (
      <div>
        <header>
          {topBar}
          {topBarCenter}
          {topBarEnd}
        </header>
        {inspector}
        <nav data-testid="trail">{breadcrumb}</nav>
        {children}
      </div>
    ),
    BreakpointManager: nothing,
    // The centre column's counted control.
    BreakpointSwitcher: () => {
      counted.centre += 1;
      return null;
    },
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
  // The end column's counted control, saying whether there is work to save.
  DocumentSaveAndPublish: () => {
    counted.end += 1;
    return (
      <p data-testid="save-state">
        {counted.unsaved ? "Unsaved changes" : "Saved"}
      </p>
    );
  },
  // The start column's counted control: the page's status reads it.
  useDocumentLifeStage: () => {
    counted.start += 1;
    return null;
  },
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

/** Each column's renders so far. */
function topBarRenders(): { start: number; centre: number; end: number } {
  return { start: counted.start, centre: counted.centre, end: counted.end };
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
    .getByTestId("trail")
    .querySelector('[aria-current="true"]');
  expect(current?.textContent).toBe(block.split(":")[0]);
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
  counted.start = 0;
  counted.centre = 0;
  counted.end = 0;
  counted.unsaved = false;
});
afterEach(cleanup);

describe("a selection draws the surfaces that follow it, and not the top bar", () => {
  it("follows A, B, an edit of B, C, an undo and A again, drawing the top bar only for the edit, the undo and a rename", async () => {
    await act(async () => {
      render(<Host />);
    });
    // The controls: each column drew, and the bar says the work is saved.
    expect(counted.start).toBeGreaterThan(0);
    expect(counted.centre).toBeGreaterThan(0);
    expect(counted.end).toBeGreaterThan(0);
    expect(screen.getByTestId("save-state").textContent).toBe("Saved");

    // Selecting A, then B: every surface follows; the top bar draws nothing.
    let before = topBarRenders();
    select("alpha");
    expectEverySurfaceOn("alpha", "Alpha: Alpha's words");
    expect(topBarRenders()).toEqual(before);

    select("beta");
    expectEverySurfaceOn("beta", "Beta: Beta's words");
    expect(topBarRenders()).toEqual(before);

    // An edit of B's words: the surfaces show them, and the columns that
    // show the document draw again, saying there is work to save and
    // offering Undo. The devices in the centre show nothing of it.
    act(() => {
      seen.inspector?.apply({
        kind: "update",
        id: "beta",
        patch: { props: { text: "Beta, edited" } },
      });
    });
    expectEverySurfaceOn("beta", "Beta: Beta, edited");
    expect(counted.start).toBeGreaterThan(before.start);
    expect(counted.end).toBeGreaterThan(before.end);
    expect(screen.getByTestId("save-state").textContent).toBe(
      "Unsaved changes"
    );
    const undo = screen.getByRole("button", { name: "Undo" });
    expect((undo as HTMLButtonElement).disabled).toBe(false);

    // Selecting C: every surface follows; the top bar draws nothing.
    before = topBarRenders();
    select("gamma");
    expectEverySurfaceOn("gamma", "Gamma: Gamma's words");
    expect(topBarRenders()).toEqual(before);

    // Undo, pressed in the top bar: B's words come back, the surfaces stay
    // on C, and the top bar draws again with nothing to save.
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    });
    expectEverySurfaceOn("gamma", "Gamma: Gamma's words");
    expect(seen.inspector?.document.nodes[1]?.props).toEqual({
      text: "Beta's words",
    });
    expect(counted.end).toBeGreaterThan(before.end);
    expect(screen.getByTestId("save-state").textContent).toBe("Saved");
    expect(
      (screen.getByRole("button", { name: "Undo" }) as HTMLButtonElement)
        .disabled
    ).toBe(true);

    // Selecting A again: every surface follows; the top bar draws nothing.
    before = topBarRenders();
    select("alpha");
    expectEverySurfaceOn("alpha", "Alpha: Alpha's words");
    expect(topBarRenders()).toEqual(before);

    // A rename of the page: the top bar draws again with the new title.
    act(() => {
      seen.setValue?.("title", "Our story");
    });
    expect(
      screen.getByRole("button", { name: "Our story: switch page" })
    ).toBeTruthy();
    expect(counted.start).toBeGreaterThan(before.start);
    expectEverySurfaceOn("alpha", "Alpha: Alpha's words");
  });
});
