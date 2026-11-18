// @vitest-environment jsdom

/**
 * Editing a header in place, wired to its component: the way in waits for
 * the component's session (read, locked, counted), a colleague holding it
 * refuses the way in by name, a failed save keeps the editing and says so
 * with "Try again", Done asks only when work is unsaved, and a store of the
 * page asked meanwhile saves the header instead.
 *
 * The builder's own editing target and editor states are real; the session,
 * the reach read and the toasts are stood in for, since what they do on a
 * real site is the admin's tests and the e2e suite's.
 */
import {
  clearBlocks,
  registerBlocks,
  type BlockDocument,
} from "@nextlyhq/blocks-engine";
import {
  useEditingTarget,
  useEditorState,
  useRegionSelection,
} from "@nextlyhq/builder/shell";
import type {
  DocumentSession,
  DocumentSessionOutcome,
} from "@nextlyhq/plugin-sdk/admin";
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  session: undefined as unknown as DocumentSession,
  target: [] as unknown[],
  beforeAction: undefined as
    | undefined
    | ((action: string, store: unknown) => void | Promise<void>),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  fills: vi.fn(),
  locale: null as null | { code: string | null },
  inline: undefined as
    | undefined
    | {
        commit: () => never;
        editing: unknown;
        editingRich: unknown;
        inspecting?: boolean;
      },
}));

vi.mock("@nextlyhq/plugin-sdk/admin", async importOriginal => ({
  ...(await importOriginal<typeof import("@nextlyhq/plugin-sdk/admin")>()),
  useDocumentSession: (target: unknown) => {
    hoisted.target.push(target);
    return hoisted.session;
  },
  useDocumentLocale: () => hoisted.locale,
  useBeforeDocumentAction: (
    handler: (action: string, store: unknown) => void | Promise<void>
  ) => {
    hoisted.beforeAction = handler;
  },
}));
vi.mock("@nextlyhq/ui", async importOriginal => ({
  ...(await importOriginal<typeof import("@nextlyhq/ui")>()),
  toast: { error: hoisted.toastError, success: hoisted.toastSuccess },
}));
vi.mock("../component-facts-client", () => ({
  FACTS_PENDING: "pending",
  useComponentFacts: (id: string | undefined) =>
    id === undefined
      ? undefined
      : {
          reserved: { properties: [], slots: [] },
          pages: { count: 11, complete: true },
        },
}));
vi.mock("../pattern-capability-client", () => ({
  useComponentEditing: () => ({ collection: "components", field: "content" }),
}));
vi.mock("../filled-default-notice", () => ({ sayFillNotices: hoisted.fills }));

import type { RegionCardFacts } from "../page-layout";

import {
  pageInlineOf,
  useRegionEditing,
  useRegionsAsEdited,
  type RegionEditingHost,
} from "./region-editing";
import { documentToHandOver } from "./use-host-commit";

const base = { version: 1, description: "A block.", example: { props: {} } };

beforeEach(() => {
  registerBlocks(
    [
      {
        ...base,
        name: "acme/nav",
        editor: { label: "Navigation" },
        render: ({ props }: { props: { text?: string } }) =>
          createElement("nav", null, props.text),
      },
    ] as never,
    { source: "region-editing-wired" }
  );
  hoisted.target.length = 0;
  hoisted.toastError.mockReset();
  hoisted.toastSuccess.mockReset();
  hoisted.fills.mockReset();
  hoisted.locale = null;
  hoisted.inline = undefined;
  hoisted.session = sessionWith({});
});

afterEach(() => {
  cleanup();
  clearBlocks();
});

const HEADER: BlockDocument = {
  formatVersion: 1,
  kind: "component",
  nodes: [
    { id: "menu", type: "acme/nav", version: 1, props: { text: "Main menu" } },
  ],
} as BlockDocument;

const PAGE: BlockDocument = {
  formatVersion: 1,
  kind: "page",
  nodes: [],
} as BlockDocument;

const CARDS: readonly RegionCardFacts[] = [
  {
    area: "header",
    componentId: "h1",
    setId: "s1",
    setTitle: "Main",
    starter: false,
  },
  {
    area: "footer",
    componentId: "f1",
    setId: "s1",
    setTitle: "Main",
    starter: false,
  },
];

const STORED: DocumentSessionOutcome = { ok: true, values: {} };

function sessionWith(overrides: Partial<DocumentSession>): DocumentSession {
  return {
    open: {
      status: "ready",
      values: { title: "Main header", content: HEADER },
      published: true,
      unpublishedChanges: false,
      changedAt: null,
      draftable: true,
    },
    lock: { status: "held" },
    mayPublish: true,
    saveDraft: vi.fn(() => Promise.resolve(STORED)),
    publish: vi.fn(() => Promise.resolve(STORED)),
    record: vi.fn(),
    discard: vi.fn(() => Promise.resolve()),
    ...overrides,
  };
}

/** What the test host exposes after each render. */
const seen: {
  host?: RegionEditingHost;
  editing?: ReturnType<typeof useEditingTarget>;
} = {};

const INLINE = {
  commit: () => ({ status: "none" }) as never,
  editing: null,
  editingRich: null,
};

function Host(): React.JSX.Element {
  const page = useEditorState({ initialDocument: PAGE });
  const editing = useEditingTarget(page);
  const selection = useRegionSelection(page, ["header"]);
  const host = useRegionEditing({
    editing,
    inline: hoisted.inline ?? INLINE,
    definitions: new Map(),
    cards: CARDS,
    selection,
    canvas: null,
    requestLayers: () => undefined,
    sets: {
      requestPanel: () => undefined,
      pages: { revealSets: () => undefined },
    },
    rereadRegions: () => undefined,
  });
  seen.host = host;
  seen.editing = editing;
  return <>{host.dialogs}</>;
}

function current(): {
  host: RegionEditingHost;
  editing: ReturnType<typeof useEditingTarget>;
} {
  if (seen.host === undefined || seen.editing === undefined) {
    throw new Error("the host has not rendered");
  }
  return { host: seen.host, editing: seen.editing };
}

async function enterHeader(): Promise<void> {
  act(() => current().host.requestEdit?.("header"));
  await waitFor(() => expect(current().host.area).toBe("header"));
}

/** An edit inside the header, so it holds work not saved. */
function editHeader(id = "cart"): void {
  const before = current().editing.active.document.nodes.length;
  act(() => {
    current().editing.active.apply({
      kind: "insert",
      node: {
        id,
        type: "acme/nav",
        version: 1,
        props: { text: id },
      },
      at: { index: before },
    } as never);
  });
  expect(current().editing.active.document.nodes).toHaveLength(before + 1);
}

/** The node ids of the header a store was sent. */
function sentIds(store: ReturnType<typeof vi.fn>, call: number): string[] {
  const changes = store.mock.calls[call]?.[0] as {
    content: BlockDocument;
  };
  return changes.content.nodes.map(node => node.id);
}

describe("entering header editing", () => {
  it("opens the header's component and says how far a change reaches", async () => {
    render(<Host />);
    await enterHeader();

    expect(hoisted.target).toContainEqual({
      collection: "components",
      id: "h1",
    });
    const target = current().editing.target;
    expect(target.kind === "region" ? target.words.bar : "").toBe(
      "Editing the site header · changes show on 11 pages"
    );
    expect(current().editing.active.document.nodes[0]?.id).toBe("menu");
  });

  it("says when the latest version has unpublished changes", async () => {
    const at = "2026-11-17T09:30:00.000Z";
    hoisted.session = sessionWith({
      open: {
        status: "ready",
        values: { content: HEADER },
        published: true,
        unpublishedChanges: true,
        changedAt: at,
        draftable: true,
      },
    });
    render(<Host />);
    await enterHeader();

    const target = current().editing.target;
    expect(target.kind === "region" ? target.words.bar : "").toContain(
      "· Unpublished changes from "
    );
  });

  it("opens the header in the language the page is edited in", async () => {
    hoisted.locale = { code: "fr" };
    render(<Host />);
    await enterHeader();

    expect(hoisted.target).toContainEqual({
      collection: "components",
      id: "h1",
      locale: "fr",
    });
  });

  it("stays on the page when the page's open passage could not be written", async () => {
    hoisted.inline = {
      commit: () => ({ status: "refused", reason: "rejected" }) as never,
      editing: "intro",
      editingRich: null,
    };
    render(<Host />);
    act(() => current().host.requestEdit?.("header"));

    await waitFor(() => expect(hoisted.target.at(-1)).toBeNull());
    expect(current().host.area).toBeUndefined();
  });

  it("tries a failed opening again only while nothing else is edited", async () => {
    hoisted.session = sessionWith({
      open: { status: "failed", message: "Offline." } as never,
    });
    const { rerender } = render(<Host />);
    act(() => current().host.requestEdit?.("header"));
    await waitFor(() => expect(hoisted.toastError).toHaveBeenCalled());
    const [, options] = hoisted.toastError.mock.calls[0] as [
      string,
      { action: { onClick: () => void } },
    ];
    hoisted.session = sessionWith({});
    rerender(<Host />);
    act(() => current().host.requestEdit?.("footer"));
    await waitFor(() => expect(current().host.area).toBe("footer"));

    act(() => options.action.onClick());

    expect(current().host.area).toBe("footer");
    expect(hoisted.target.at(-1)).toEqual({
      collection: "components",
      id: "f1",
    });
  });

  it("hands the inspector the header's own component facts while it is edited", async () => {
    render(<Host />);
    expect(current().host.componentFacts).toBeUndefined();
    await enterHeader();

    expect(current().host.componentFacts).toMatchObject({
      reserved: { properties: [], slots: [] },
      pages: { count: 11, complete: true },
    });
  });

  it("does not enter while a colleague holds the header, and says who", async () => {
    hoisted.session = sessionWith({
      lock: { status: "held-by-other", holder: "Ana Diaz" },
    });
    render(<Host />);
    act(() => current().host.requestEdit?.("header"));

    await waitFor(() =>
      expect(hoisted.toastError).toHaveBeenCalledWith(
        "Ana Diaz is editing this header. Try again when they're done."
      )
    );
    expect(current().host.area).toBeUndefined();
    // The session is let go again, and with it the lock it asked for.
    expect(hoisted.target.at(-1)).toBeNull();
  });
});

describe("saving the header", () => {
  it("stays in header editing with the changes when a save fails, and offers Try again", async () => {
    const saveDraft = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        reason: "refused",
        message: "The server is down.",
      })
      .mockResolvedValueOnce(STORED);
    hoisted.session = sessionWith({ saveDraft });
    render(<Host />);
    await enterHeader();
    editHeader();

    act(() => current().host.topBar?.save());
    await waitFor(() => expect(hoisted.toastError).toHaveBeenCalled());

    const [message, options] = hoisted.toastError.mock.calls[0] as [
      string,
      { action: { label: string; onClick: () => void } },
    ];
    expect(message).toBe("The header wasn't saved. The server is down.");
    expect(options.action.label).toBe("Try again");
    expect(current().host.area).toBe("header");
    expect(current().host.dirty).toBe(true);

    act(() => options.action.onClick());
    await waitFor(() => expect(saveDraft).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(current().host.dirty).toBe(false));
  });

  it("tries again with the header as it is now, not as the failed save sent it", async () => {
    const saveDraft = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        reason: "refused",
        message: "The server is down.",
      })
      .mockResolvedValueOnce(STORED);
    hoisted.session = sessionWith({ saveDraft });
    render(<Host />);
    await enterHeader();
    editHeader();

    act(() => current().host.topBar?.save());
    await waitFor(() => expect(hoisted.toastError).toHaveBeenCalled());
    editHeader("shop");
    const [, options] = hoisted.toastError.mock.calls[0] as [
      string,
      { action: { onClick: () => void } },
    ];
    act(() => options.action.onClick());

    await waitFor(() => expect(saveDraft).toHaveBeenCalledTimes(2));
    expect(sentIds(saveDraft, 1)).toEqual(["menu", "cart", "shop"]);
    await waitFor(() => expect(current().host.dirty).toBe(false));
  });

  it("keeps an edit made while a save is on its way unsaved", async () => {
    let answer: (outcome: DocumentSessionOutcome) => void = () => undefined;
    const saveDraft = vi.fn(
      () =>
        new Promise<DocumentSessionOutcome>(resolve => {
          answer = resolve;
        })
    );
    hoisted.session = sessionWith({ saveDraft });
    render(<Host />);
    await enterHeader();
    editHeader();

    act(() => current().host.topBar?.save());
    await waitFor(() => expect(saveDraft).toHaveBeenCalledTimes(1));
    editHeader("shop");
    await act(async () => answer(STORED));

    await waitFor(() => expect(hoisted.toastSuccess).toHaveBeenCalled());
    expect(sentIds(saveDraft, 0)).toEqual(["menu", "cart"]);
    expect(current().host.dirty).toBe(true);
  });

  it("asks before leaving while a save is on its way, and an undo meanwhile stays unsaved", async () => {
    let answer: (outcome: DocumentSessionOutcome) => void = () => undefined;
    const saveDraft = vi.fn(
      () =>
        new Promise<DocumentSessionOutcome>(resolve => {
          answer = resolve;
        })
    );
    hoisted.session = sessionWith({ saveDraft });
    render(<Host />);
    await enterHeader();
    editHeader();

    act(() => current().host.topBar?.save());
    await waitFor(() => expect(saveDraft).toHaveBeenCalledTimes(1));
    act(() => current().editing.active.undo());
    act(() => current().host.done());
    expect(await screen.findByRole("alertdialog")).toBeTruthy();
    expect(current().host.area).toBe("header");

    await act(async () => answer(STORED));
    await waitFor(() => expect(hoisted.toastSuccess).toHaveBeenCalled());
    expect(current().host.dirty).toBe(true);
  });

  it("counts a passage open in the inspector as unsaved", async () => {
    hoisted.inline = { ...INLINE, inspecting: false };
    const { rerender } = render(<Host />);
    await enterHeader();
    expect(current().host.dirty).toBe(false);

    hoisted.inline = { ...INLINE, inspecting: true };
    rerender(<Host />);

    expect(current().host.dirty).toBe(true);
  });

  it("asks how far a publish reaches, publishes, and says any fill", async () => {
    const publish = vi.fn(() => Promise.resolve(STORED));
    hoisted.session = sessionWith({ publish });
    render(<Host />);
    await enterHeader();
    editHeader();

    act(() => current().host.topBar?.publish());
    fireEvent.click(
      await screen.findByRole("button", { name: "Publish header" })
    );

    await waitFor(() => expect(publish).toHaveBeenCalledTimes(1));
    expect(publish.mock.calls[0]?.[0]).toMatchObject({
      content: expect.objectContaining({ kind: "component" }),
    });
    await waitFor(() => expect(hoisted.fills).toHaveBeenCalledTimes(1));
  });

  it("saves the header, not the page, when the page is stored meanwhile", async () => {
    const saveDraft = vi.fn(() => Promise.resolve(STORED));
    hoisted.session = sessionWith({ saveDraft });
    render(<Host />);
    await enterHeader();
    editHeader();

    expect(() => hoisted.beforeAction?.("save", {})).toThrow(
      "The page is saved after Done."
    );
    await waitFor(() => expect(saveDraft).toHaveBeenCalledTimes(1));
  });
});

describe("Done", () => {
  it("leaves at once when nothing is unsaved", async () => {
    render(<Host />);
    await enterHeader();

    act(() => current().host.done());

    await waitFor(() => expect(current().host.area).toBeUndefined());
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("asks about unsaved changes, and Discard throws them away and leaves", async () => {
    const discard = vi.fn(() => Promise.resolve());
    hoisted.session = sessionWith({ discard });
    render(<Host />);
    await enterHeader();
    editHeader();

    act(() => current().host.done());
    fireEvent.click(await screen.findByRole("button", { name: "Discard" }));

    await waitFor(() => expect(current().host.area).toBeUndefined());
    expect(discard).toHaveBeenCalledTimes(1);
  });

  it("keeps editing on Keep editing", async () => {
    render(<Host />);
    await enterHeader();
    editHeader();

    act(() => current().host.done());
    fireEvent.click(
      await screen.findByRole("button", { name: "Keep editing" })
    );

    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(current().host.area).toBe("header");
  });
});

describe("the page while a header is edited", () => {
  const REGIONS = [
    { area: "header" as const, document: PAGE },
    { area: "footer" as const, document: PAGE },
  ];

  it("reads the bindings of the header as it is edited, and the footer as published", () => {
    const { result } = renderHook(() => {
      const page = useEditorState({ initialDocument: PAGE });
      const editing = useEditingTarget(page);
      return { editing, regions: useRegionsAsEdited(REGIONS, editing) };
    });
    expect(result.current.regions).toBe(REGIONS);

    act(() =>
      result.current.editing.enter({
        area: "header",
        document: HEADER,
        definitions: new Map(),
        label: "Site header",
        words: { bar: "", done: "Done", entered: "", left: "" },
      })
    );

    const [header, footer] = result.current.regions;
    expect(header?.document).toBe(result.current.editing.active.document);
    expect(header?.document.kind).toBe("component");
    expect(footer?.document).toBe(PAGE);
  });

  it("hands over only the page's own work, never finishing the header's passage into it", () => {
    const headerPassage = {
      commit: vi.fn(() => ({ status: "written", document: HEADER }) as never),
      editing: "menu",
      editingRich: null,
    };

    const inline = pageInlineOf("header", headerPassage);

    expect(
      documentToHandOver({ document: PAGE, undoDepth: 0 }, inline, 0, undefined)
    ).toBeNull();
    expect(
      documentToHandOver({ document: PAGE, undoDepth: 1 }, inline, 0, undefined)
    ).toBe(PAGE);
    expect(headerPassage.commit).not.toHaveBeenCalled();
    expect(pageInlineOf(undefined, headerPassage)).toBe(headerPassage);
  });
});
