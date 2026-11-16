// @vitest-environment jsdom

/**
 * How often the page is drawn again when the author selects a block, counted
 * through the page builder's own editor rather than timed. The budget is none:
 * a selection changes the marks and the panel, not the page.
 *
 * The editor is the plugin's real one, its state included; only its
 * surroundings (the admin's hooks, the panels around the canvas) are stood in
 * for, as `BlocksField.styleState.test` stands them in. The canvas is the real
 * one too, and every draw of the page through the renderer is counted.
 *
 * Today the editor hands the canvas a new site stylesheet object on each of
 * its renders, so the canvas's drawn page cannot be kept, and a selection
 * draws the whole page again. The case is a known miss (`expectKnownMiss`):
 * held above its budget, so it turns red the day the page is no longer drawn
 * again, and the fix replaces it with `expect(count).toBe(0)`. A case that throws
 * for any other reason fails, rather than passing as "still slow".
 *
 * @module admin/speed-counters.test
 */
import { act, cleanup, render } from "@testing-library/react";
import * as React from "react";
import { useForm, type FieldValues } from "react-hook-form";
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

const DOCUMENT = {
  formatVersion: 1,
  kind: "page",
  nodes: Array.from({ length: 12 }, (_, i) => ({
    id: `block-${String(i + 1)}`,
    type: "acme/leaf",
    version: 1,
    props: {},
  })),
};

const seen: { canvas: Record<string, unknown> | undefined } = {
  canvas: undefined,
};

/** Every draw of a page document by the renderer, counted and passed through. */
const counted = vi.hoisted(() => ({ pageDraws: 0 }));

vi.mock("@nextlyhq/blocks-react", async importOriginal => {
  const real = await importOriginal<typeof import("@nextlyhq/blocks-react")>();
  const PageRenderer: typeof real.PageRenderer = props => {
    if (props.document.kind === "page") counted.pageDraws += 1;
    return real.PageRenderer(props);
  };
  return { ...real, PageRenderer };
});

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
      inspector,
      children,
    }: {
      inspector: React.ReactNode;
      children?: React.ReactNode;
    }): React.JSX.Element => (
      <div>
        {inspector}
        {children}
      </div>
    ),
    BreakpointManager: nothing,
    BreakpointSwitcher: nothing,
    InspectorPanel: nothing,
    Canvas,
    // Passed through: the canvas renders inside its frame, which jsdom never
    // loads a page into.
    CanvasFrame: passthrough,
    BlockKeyboardActions: passthrough,
    BlockContextMenu: passthrough,
    BlockToolbar: nothing,
    EditorCommandPalette: nothing,
    DropIndicator: nothing,
    InsertPanel: nothing,
    RepairNotice: nothing,
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
    useInlineText: () => ({ onDoubleClick: () => {} }),
  };
});

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
  // The media library, drawn as nothing: these cases never open it.
  MediaPickerDialog: () => null,
  loadInlineRichTextEditor: () => new Promise<never>(() => {}),
  usePluginClientConfig: () => undefined,
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
  DocumentSaveAndPublish: () => null,
  useDocumentLifeStage: () => null,
  useDocumentActions: () => null,
  // No preview here: the top bar's Preview draws nothing.
  useDocumentPreview: () => null,
  // No one signed in: the editor keeps no preferences.
  useCurrentUserId: () => null,
  useDocumentStatus: () => null,
  // The editor registers its restore; nothing here offers one.
  useDocumentRestore: () => undefined,
  useUpdateSingleDocument: () => ({
    mutateAsync: async () => ({ success: true }),
    isPending: false,
  }),
}));

const { PageBuilderView } = await import("./editor/PageBuilderView");

const BODY_FIELD = { name: "body", type: "blocks" } as never;

/** The builder's document view, open on a form whose `body` holds the page. */
function Host(): React.JSX.Element {
  const { control } = useForm<FieldValues>({
    defaultValues: { body: DOCUMENT },
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

beforeAll(() => {
  clearBlocks();
  registerBlocks(
    [
      {
        name: "acme/leaf",
        version: 1,
        description: "A block.",
        example: { props: {} },
        render: () => <p>leaf</p>,
      },
    ] as never,
    { source: "speed-counters-test" }
  );
});
afterAll(clearBlocks);

beforeEach(() => {
  seen.canvas = undefined;
  counted.pageDraws = 0;
});
afterEach(cleanup);

/**
 * A count the editor still spends beyond its budget today, held there: the
 * day the work is gone this fails, and the fix replaces it with an assertion
 * of the budget, which holds it from then on.
 */
function expectKnownMiss(count: number, budget = 0): void {
  expect(
    count,
    `now within its budget of ${String(budget)}: replace expectKnownMiss with an assertion of the budget`
  ).toBeGreaterThan(budget);
}

describe("the page drawn again per selection, in the page builder's editor", () => {
  it("the counter sees the page drawn: opening the editor draws it", () => {
    render(<Host />);
    expect(counted.pageDraws).toBeGreaterThan(0);
    // The control for the cases below: the canvas holds the page's blocks.
    expect(document.querySelectorAll("[data-nx-node]").length).toBe(12);
  });

  it("a selection draws the page again: budget none (known miss)", () => {
    render(<Host />);
    select("block-1");
    counted.pageDraws = 0;
    select("block-7");
    expect(seen.canvas?.selectedId).toBe("block-7");
    expectKnownMiss(counted.pageDraws);
  });
});
