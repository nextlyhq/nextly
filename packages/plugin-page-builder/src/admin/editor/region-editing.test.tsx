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
        cancel?: () => void;
        editing: unknown;
        editingRich: unknown;
        inspecting?: boolean;
      },
  hold: vi.fn(),
  offer: vi.fn(),
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
vi.mock("../publish-offer", () => ({
  usePublishQuestion: () => ({ offer: hoisted.offer, dialog: null }),
}));
vi.mock("../removal-hold-client", () => ({
  useRemovalQuestion: () => ({ hold: hoisted.hold, dialog: null }),
}));

import type { RegionCardFacts } from "../page-layout";

import { offeredSelfOf } from "./offered-library";
import {
  inspectedBindingsOf,
  inspectedVariantsOf,
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
  hoisted.hold.mockReset();
  hoisted.hold.mockResolvedValue(undefined);
  hoisted.offer.mockReset();
  hoisted.offer.mockResolvedValue(undefined);
  hoisted.session = sessionWith({});
});

afterEach(() => {
  cleanup();
  clearBlocks();
  writeHeld = undefined;
});

/** The page's held component settings' write, where a test gives one. */
let writeHeld: (() => true | Promise<boolean>) | undefined;

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
    writesSettled: vi.fn(() => Promise.resolve(null)),
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
    page: {
      rereadRegions: () => undefined,
      // None held unless a test holds one.
      writeHeldSettings: writeHeld ?? (() => true),
    },
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

  it("writes the held component settings before saving the header, and saves nothing when one is refused", async () => {
    // A setting made on a placement in the header, bound to a field, is
    // made by the header's Save; refused, its binding is taken off instead.
    const saveDraft = vi.fn(() => Promise.resolve(STORED));
    hoisted.session = sessionWith({ saveDraft });
    const held = vi
      .fn<() => Promise<boolean>>()
      .mockResolvedValueOnce(false)
      .mockResolvedValue(true);
    writeHeld = held;
    render(<Host />);
    await enterHeader();
    editHeader();

    act(() => current().host.topBar?.save());
    await waitFor(() => expect(held).toHaveBeenCalledTimes(1));
    await act(async () => undefined);
    expect(saveDraft).not.toHaveBeenCalled();
    expect(current().host.dirty).toBe(true);

    act(() => current().host.topBar?.save());
    await waitFor(() => expect(saveDraft).toHaveBeenCalledTimes(1));
    expect(held).toHaveBeenCalledTimes(2);
  });

  it("is busy while the held component settings are written, so a second Save or a Discard waits", async () => {
    const saveDraft = vi.fn(() => Promise.resolve(STORED));
    hoisted.session = sessionWith({ saveDraft });
    let answer: (written: boolean) => void = () => undefined;
    writeHeld = vi.fn(
      () =>
        new Promise<boolean>(resolve => {
          answer = resolve;
        })
    );
    render(<Host />);
    await enterHeader();
    editHeader();

    act(() => current().host.topBar?.save());
    await waitFor(() => expect(current().host.topBar?.busy).toBe(true));

    await act(async () => answer(false));
    await waitFor(() => expect(current().host.topBar?.busy).toBe(false));
    expect(saveDraft).not.toHaveBeenCalled();
  });

  it("waits for a shared style's write on its way before saving the header", async () => {
    let landed: () => void = () => undefined;
    const writesSettled = vi.fn(
      () =>
        new Promise<null>(resolve => {
          landed = () => resolve(null);
        })
    );
    const saveDraft = vi.fn(() => Promise.resolve(STORED));
    hoisted.session = sessionWith({ saveDraft, writesSettled });
    render(<Host />);
    await enterHeader();
    editHeader();

    act(() => current().host.topBar?.save());
    await waitFor(() => expect(writesSettled).toHaveBeenCalledTimes(1));
    expect(saveDraft).not.toHaveBeenCalled();

    await act(async () => landed());
    await waitFor(() => expect(saveDraft).toHaveBeenCalledTimes(1));
  });

  it("saves nothing while a shared style's write failed, says so, and offers Try again", async () => {
    const writesSettled = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        reason: "refused",
        message: "Site colours wasn't saved: The server is down.",
      })
      .mockResolvedValue(null);
    const saveDraft = vi.fn(() => Promise.resolve(STORED));
    hoisted.session = sessionWith({ saveDraft, writesSettled });
    render(<Host />);
    await enterHeader();
    editHeader();

    act(() => current().host.topBar?.save());
    await waitFor(() => expect(hoisted.toastError).toHaveBeenCalled());

    const [message, options] = hoisted.toastError.mock.calls[0] as [
      string,
      { action: { label: string; onClick: () => void } },
    ];
    expect(message).toBe(
      "The header wasn't saved. Site colours wasn't saved: The server is down."
    );
    expect(saveDraft).not.toHaveBeenCalled();
    expect(current().host.dirty).toBe(true);

    act(() => options.action.onClick());
    await waitFor(() => expect(saveDraft).toHaveBeenCalledTimes(1));
  });

  it("asks about no part and publishes nothing while a shared style's write failed", async () => {
    const publish = vi.fn(() => Promise.resolve(STORED));
    const writesSettled = vi.fn(() =>
      Promise.resolve({
        ok: false as const,
        reason: "refused" as const,
        message: "Site colours wasn't saved: The server is down.",
      })
    );
    hoisted.session = sessionWith({ publish, writesSettled });
    render(<Host />);
    await enterHeader();
    editHeader();

    act(() => current().host.topBar?.publish());
    fireEvent.click(
      await screen.findByRole("button", { name: "Publish header" })
    );

    await waitFor(() =>
      expect(hoisted.toastError).toHaveBeenCalledWith(
        "The header wasn't published. Site colours wasn't saved: The server is down.",
        expect.anything()
      )
    );
    expect(hoisted.offer).not.toHaveBeenCalled();
    expect(hoisted.hold).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
    expect(current().host.area).toBe("header");
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

  it("holds the header's removed fields before publishing it", async () => {
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
    expect(hoisted.hold).toHaveBeenCalledTimes(1);
    const [id, document] = hoisted.hold.mock.calls[0] as [
      string,
      () => BlockDocument,
    ];
    expect(id).toBe("h1");
    expect(document().nodes.map(node => node.id)).toEqual(["menu", "cart"]);
  });

  it("publishes nothing when the removal's hold is called off, and keeps editing", async () => {
    const publish = vi.fn(() => Promise.resolve(STORED));
    hoisted.session = sessionWith({ publish });
    hoisted.hold.mockRejectedValue(
      new DOMException("Publishing was cancelled.", "AbortError")
    );
    render(<Host />);
    await enterHeader();
    editHeader();

    act(() => current().host.topBar?.publish());
    fireEvent.click(
      await screen.findByRole("button", { name: "Publish header" })
    );

    await waitFor(() => expect(hoisted.hold).toHaveBeenCalledTimes(1));
    expect(publish).not.toHaveBeenCalled();
    expect(current().host.area).toBe("header");
    expect(current().host.dirty).toBe(true);
  });

  it("asks about the header's unpublished parts before publishing it, and publishes nothing when called off", async () => {
    const publish = vi.fn(() => Promise.resolve(STORED));
    hoisted.session = sessionWith({ publish });
    hoisted.offer.mockRejectedValue(
      new DOMException("Publishing was cancelled.", "AbortError")
    );
    render(<Host />);
    await enterHeader();
    editHeader();

    act(() => current().host.topBar?.publish());
    fireEvent.click(
      await screen.findByRole("button", { name: "Publish header" })
    );

    await waitFor(() => expect(hoisted.offer).toHaveBeenCalledTimes(1));
    const [documents] = hoisted.offer.mock.calls[0] as [BlockDocument[]];
    expect(documents.map(d => d.nodes.length)).toEqual([2]);
    expect(publish).not.toHaveBeenCalled();
    expect(hoisted.toastError).not.toHaveBeenCalled();
    expect(current().host.area).toBe("header");
  });

  it("tries a failed publish again only in the header it failed in", async () => {
    const publish = vi.fn(() =>
      Promise.resolve({
        ok: false,
        reason: "refused",
        message: "The server is down.",
      } as DocumentSessionOutcome)
    );
    hoisted.session = sessionWith({ publish });
    render(<Host />);
    await enterHeader();

    act(() => current().host.topBar?.publish());
    fireEvent.click(
      await screen.findByRole("button", { name: "Publish header" })
    );
    await waitFor(() => expect(hoisted.toastError).toHaveBeenCalled());
    const [, options] = hoisted.toastError.mock.calls[0] as [
      string,
      { action: { onClick: () => void } },
    ];
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    act(() => current().host.done());
    await waitFor(() => expect(current().host.area).toBeUndefined());
    act(() => current().host.requestEdit?.("footer"));
    await waitFor(() => expect(current().host.area).toBe("footer"));

    act(() => options.action.onClick());

    await act(async () => Promise.resolve());
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it("asks nothing and publishes nothing once a colleague holds the header", async () => {
    const publish = vi.fn(() => Promise.resolve(STORED));
    hoisted.session = sessionWith({ publish });
    const { rerender } = render(<Host />);
    await enterHeader();
    editHeader();
    hoisted.session = sessionWith({
      publish,
      lock: { status: "held-by-other", holder: "Ana Diaz" },
    });
    rerender(<Host />);

    act(() => current().host.topBar?.publish());
    fireEvent.click(
      await screen.findByRole("button", { name: "Publish header" })
    );

    await waitFor(() =>
      expect(hoisted.toastError).toHaveBeenCalledWith(
        "Ana Diaz is editing this header. Try again when they're done."
      )
    );
    expect(hoisted.offer).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });

  it("hands the parts question a check of the header's lock as it is then", async () => {
    const { rerender } = render(<Host />);
    await enterHeader();
    editHeader();

    act(() => current().host.topBar?.publish());
    fireEvent.click(
      await screen.findByRole("button", { name: "Publish header" })
    );
    await waitFor(() => expect(hoisted.offer).toHaveBeenCalledTimes(1));
    const stillMay = hoisted.offer.mock.calls[0]?.[1] as () => boolean;
    expect(stillMay()).toBe(true);

    hoisted.session = sessionWith({
      lock: { status: "held-by-other", holder: "Ana Diaz" },
    });
    rerender(<Host />);
    expect(stillMay()).toBe(false);
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

  it("ends the header's open passage on Discard, so it never lands in the page", async () => {
    const cancel = vi.fn();
    hoisted.inline = { ...INLINE, cancel };
    render(<Host />);
    await enterHeader();
    editHeader();

    act(() => current().host.done());
    fireEvent.click(await screen.findByRole("button", { name: "Discard" }));

    await waitFor(() => expect(current().host.area).toBeUndefined());
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("empties the header's recovery point once an undo takes it back to what was opened", async () => {
    const discard = vi.fn(() => Promise.resolve());
    const record = vi.fn();
    hoisted.session = sessionWith({ discard, record });
    render(<Host />);
    await enterHeader();
    editHeader();
    expect(record).toHaveBeenCalled();

    act(() => current().editing.active.undo());

    await waitFor(() => expect(discard).toHaveBeenCalledTimes(1));
    expect(current().host.dirty).toBe(false);
  });

  it("waits on Discard before anything else is answered", async () => {
    let emptied: () => void = () => undefined;
    const discard = vi.fn(
      () =>
        new Promise<void>(resolve => {
          emptied = resolve;
        })
    );
    hoisted.session = sessionWith({ discard });
    render(<Host />);
    await enterHeader();
    editHeader();

    act(() => current().host.done());
    fireEvent.click(await screen.findByRole("button", { name: "Discard" }));
    await waitFor(() => expect(discard).toHaveBeenCalled());

    const keep = screen.getByRole("button", { name: "Keep editing" });
    expect(keep).toHaveProperty("disabled", true);
    fireEvent.click(keep);
    expect(screen.getByRole("alertdialog")).toBeTruthy();

    await act(async () => emptied());
    await waitFor(() => expect(current().host.area).toBeUndefined());
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

describe("the header when the editor goes away", () => {
  // A colleague taking over the page unmounts the editor mid-edit: the
  // header's work is handed to its own recovery point then, never the page.
  it("records the header's open passage, finished, as it goes away", async () => {
    const record = vi.fn();
    hoisted.session = sessionWith({ record });
    const typed: BlockDocument = {
      ...HEADER,
      nodes: [
        { id: "menu", type: "acme/nav", version: 1, props: { text: "Typed" } },
      ],
    } as BlockDocument;
    const commit = vi.fn(
      () => ({ status: "written", document: typed }) as never
    );
    hoisted.inline = { ...INLINE, editing: "menu" };
    const view = render(<Host />);
    await enterHeader();
    hoisted.inline = { commit, editing: "menu", editingRich: null };
    view.rerender(<Host />);
    record.mockClear();

    view.unmount();

    expect(commit).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledWith({ content: typed });
  });

  it("records the header's unsaved edits as they stand when no passage is open", async () => {
    const record = vi.fn();
    hoisted.session = sessionWith({ record });
    const view = render(<Host />);
    await enterHeader();
    editHeader();
    record.mockClear();

    view.unmount();

    expect(record).toHaveBeenCalledTimes(1);
    expect(sentIds(record, 0)).toEqual(["menu", "cart"]);
  });

  it("records nothing when the header holds no unsaved work", async () => {
    const record = vi.fn();
    hoisted.session = sessionWith({ record });
    const view = render(<Host />);
    await enterHeader();

    view.unmount();

    expect(record).not.toHaveBeenCalled();
  });
});

describe("what Add offers while a header is edited", () => {
  it("leaves out the header's own component, judged as that component", () => {
    const page = { document: PAGE, identity: { documentId: "p1" } };
    const target = {
      kind: "region" as const,
      area: "header" as const,
      document: HEADER,
      label: "Site header",
      words: { bar: "", done: "Done", entered: "", left: "" },
    };

    expect(offeredSelfOf({ kind: "page" }, CARDS, page)).toBe(page);
    expect(offeredSelfOf(target, CARDS, page)).toEqual({
      document: HEADER,
      identity: { documentId: "h1" },
    });
  });
});

describe("the inspector's bindings while a header is edited", () => {
  it("belong to no page: no entry offered, no unbind planned against it, lists judged as a component's", () => {
    const page = {
      entryCollection: "pages",
      bindingEntry: { kind: "collection", slug: "pages", documentId: "p1" },
      editedDocument: { documentId: "p1" },
    };

    expect(inspectedBindingsOf(undefined, page)).toBe(page);
    expect(inspectedBindingsOf("header", page)).toEqual({
      entryCollection: undefined,
      bindingEntry: null,
      editedDocument: null,
    });
  });
});

describe("the inspector's variants while a header is edited", () => {
  // The canvas previews no variant of a header edited in place, so its
  // variants are edited in its own view alone.
  it("are kept to the component's own view, and the page's host is left as it is", () => {
    const host = { preview: { open: undefined, onOpen: () => undefined } };

    expect(inspectedVariantsOf("header", host)).toEqual({
      editedInOwnView: true,
    });
    expect(inspectedVariantsOf(undefined, host)).toBe(host);
  });
});
