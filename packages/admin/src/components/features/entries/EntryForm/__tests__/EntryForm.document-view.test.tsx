/**
 * The entry editor hosting a plugin's document view.
 *
 * What these pin is that the view replaces the form BODY and nothing the
 * editor keeps around it: the save shortcut still saves, the claim still
 * speaks, the recovery offer is still made — and a `<form>` the view renders
 * is the view's own, never a way to save the document.
 */
import { ShortcutProvider } from "@nextlyhq/ui";
import { QueryClientProvider } from "@tanstack/react-query";
// RTL's own `render`: the shared one fixes its wrapper, and these need a
// shortcut owner that listens.
import { fireEvent, render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  useEffect,
  type ComponentProps,
  type ReactElement,
  type ReactNode,
} from "react";
import { useFormContext } from "react-hook-form";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  act,
  cleanup,
  createTestQueryClient,
  screen,
  waitFor,
} from "@admin/__tests__/utils";
import type { RefusedForm } from "@admin/hooks/useSharedFieldsRecovery";
import {
  clearRegistry,
  registerComponent,
  type DocumentViewProps,
} from "@admin/lib/plugins/component-registry";
import {
  clearDocumentViews,
  registerDocumentViews,
} from "@admin/lib/plugins/document-view-registry";

const { useDocumentLock, update, recovery, updateOptions } = vi.hoisted(() => ({
  useDocumentLock: vi.fn(),
  update: vi.fn(),
  // What the editor hands its update mutation, a refused publish's way out
  // among it.
  updateOptions: {
    current: undefined as { refusedForm?: RefusedForm } | undefined,
  },
  recovery: {
    current: {
      offer: null as { savedAt: Date; snapshot: unknown } | null,
      isResolved: true,
      dismiss: () => {},
      restore: () => {},
    },
  },
}));

vi.mock("@admin/hooks/queries/useDocumentLock", () => ({ useDocumentLock }));
// The save is observed where it leaves the editor: the update mutation.
vi.mock("@admin/hooks/queries/useUpdateEntry", () => ({
  useUpdateEntry: (options: { refusedForm?: RefusedForm }) => {
    updateOptions.current = options;
    return { mutateAsync: update, isPending: false };
  },
}));
vi.mock("@admin/hooks/useAutosaveRecovery", () => ({
  useAutosaveRecovery: () => recovery.current,
}));
vi.mock("@admin/hooks/useDocumentAutosave", async importOriginal => ({
  ...(await importOriginal<
    typeof import("@admin/hooks/useDocumentAutosave")
  >()),
  useDocumentAutosave: () => ({ status: "idle", lastSavedAt: null }),
}));
vi.mock("@admin/hooks/useLocalization", () => ({
  useLocalization: () => ({
    enabled: false,
    locales: [],
    defaultLocale: "en",
    fallback: true,
    getLocale: () => undefined,
  }),
}));

import { useHostedDocumentActions } from "../DocumentActionsContext";
import { EntryForm } from "../EntryForm";
import { useDocumentStatus } from "../EntryFormContext";

const VIEW = "@acme/pb/admin#Builder";
const collection = {
  name: "pages",
  label: "Pages",
  fields: [{ name: "title", type: "text", label: "Title" }],
} as never;
const entry = { id: "e1", title: "Hello" } as never;
const bob = { ownerId: "u2", ownerLabel: "Bob", expiresInSeconds: 90 };

const received = vi.fn();
const mounted = vi.fn();
/** What happened to the view and the recovery, in order. */
const lifecycle: string[] = [];

/**
 * A view with the shapes a real one has: a field written through the
 * document form, a form of its own, and a way out.
 */
function BuilderView(props: DocumentViewProps): ReactElement {
  received(props);
  useEffect(() => {
    mounted();
    lifecycle.push("mount");
    return () => {
      lifecycle.push("unmount");
    };
  }, []);
  const { register } = useFormContext();
  return (
    <div data-testid="builder-view">
      <input aria-label="Page heading" {...register("title")} />
      <form
        aria-label="Find a block"
        onSubmit={event => event.preventDefault()}
      >
        <input aria-label="Block name" />
        <button type="submit">Find</button>
      </form>
      <button type="button" onClick={props.exit}>
        Done
      </button>
    </div>
  );
}

/**
 * The shared providers, with a shortcut owner that listens: the default test
 * wrapper attaches none, and the save shortcut is one of the things on trial.
 */
function Providers({ children }: { children: ReactNode }): ReactElement {
  return (
    <QueryClientProvider client={createTestQueryClient()}>
      <ShortcutProvider isApple={false}>{children}</ShortcutProvider>
    </QueryClientProvider>
  );
}

const onExit = vi.fn();

const onCancel = vi.fn();

/** Translation mode as the page passes it once the URL asks for it. */
const translatingFromFrench = {
  from: "fr",
  sourceDocument: { title: "Bonjour" },
};

function renderView(extra: Partial<ComponentProps<typeof EntryForm>> = {}) {
  return render(
    <EntryForm
      collection={collection}
      entry={entry}
      mode="edit"
      onCancel={onCancel}
      documentView={{ component: VIEW, onExit }}
      {...extra}
    />,
    { wrapper: Providers }
  );
}

function press(target: HTMLElement | Document, key: string): void {
  target.dispatchEvent(
    new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })
  );
}

function pressSave(target: HTMLElement): void {
  target.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "s",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    })
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  registerComponent(VIEW, BuilderView);
  useDocumentLock.mockReturnValue({
    state: { status: "held-by-me" },
    takeOver: vi.fn(),
    requestAccess: vi.fn(),
  });
  update.mockResolvedValue({ item: { id: "e1", title: "Saved" } });
  recovery.current = { ...recovery.current, offer: null };
});

afterEach(() => {
  cleanup();
  clearRegistry();
});

describe("EntryForm with a document view", () => {
  it("draws the view in place of the form body, outside the entry form element", () => {
    renderView();

    expect(screen.getByTestId("builder-view")).toBeInTheDocument();
    // No entry form at all: no header title input, no fields, no rail, and no
    // `<form>` element whose submit is the save.
    expect(document.querySelector("form#entry-form")).toBeNull();
    expect(screen.queryByLabelText("Title")).toBeNull();
    expect(received).toHaveBeenLastCalledWith(
      expect.objectContaining({
        collectionSlug: "pages",
        entryId: "e1",
        readOnly: false,
      })
    );
  });

  it("does not save the document when the view's own form submits", async () => {
    const user = userEvent.setup();
    renderView();

    // Dirty, so a save that the submit DID reach would have something to send.
    await user.type(screen.getByLabelText("Page heading"), " world");
    await user.click(screen.getByRole("button", { name: "Find" }));
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 50));
    });
    expect(update).not.toHaveBeenCalled();

    // The positive control: the same spy sees a save the editor does make, so
    // the silence above is the submit not reaching it.
    pressSave(screen.getByLabelText("Page heading"));
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
  });

  it("saves on Mod+S what the view wrote through the document form", async () => {
    const user = userEvent.setup();
    renderView();

    await user.type(screen.getByLabelText("Page heading"), " world");
    pressSave(document.body);

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Hello world" })
    );
  });

  it("names a colleague's claim above the view and hands the view readOnly", () => {
    useDocumentLock.mockReturnValue({
      state: { status: "held-by-other", holder: bob, requestSent: false },
      takeOver: vi.fn(),
      requestAccess: vi.fn(),
    });
    renderView();

    const banner = screen.getByTestId("document-lock-banner");
    expect(banner).toHaveTextContent("Bob");
    // Above, in document order: read before the view whose edits it qualifies.
    expect(
      banner.compareDocumentPosition(screen.getByTestId("builder-view")) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(received).toHaveBeenLastCalledWith(
      expect.objectContaining({ readOnly: true })
    );
  });

  it("holds the view read-only, and marks it busy, while a recovery takes the live values", async () => {
    renderView();
    const busyAround = () =>
      screen.getByTestId("builder-view").closest("[aria-busy='true']");
    expect(busyAround()).toBeNull();

    // Made before the recovery starts, which runs its work a task later.
    let done: () => void = () => {};
    const held = new Promise<void>(resolve => {
      done = resolve;
    });
    let running: Promise<unknown> | undefined;
    act(() => {
      running = updateOptions.current?.refusedForm?.run(() => held);
    });
    expect(busyAround()).not.toBeNull();
    expect(received).toHaveBeenLastCalledWith(
      expect.objectContaining({ readOnly: true })
    );

    await act(async () => {
      done();
      await running;
    });
    expect(busyAround()).toBeNull();
    expect(received).toHaveBeenLastCalledWith(
      expect.objectContaining({ readOnly: false })
    );
  });

  it("offers recovered work above the view", () => {
    recovery.current = {
      ...recovery.current,
      offer: { savedAt: new Date(), snapshot: { title: "Recovered" } },
    };
    renderView();

    expect(
      screen.getByText(/you have unsaved changes from/i)
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Restore" })).toBeInTheDocument();
  });

  it("draws the view afresh when recovered work is restored", async () => {
    // A restore replaces the form's values from outside the view, and a view
    // may keep a working copy read once at mount, as the Page Builder does. So
    // the restore must reach the recovery AND give the view a new mount.
    //
    // In that order: the outgoing view unmounts BEFORE the values are
    // replaced. A view that hands its unsaved work to the form as it goes (the
    // Page Builder does, for a takeover) would otherwise write its pre-restore
    // copy over the restored values, and the new mount would read those.
    lifecycle.length = 0;
    const restore = vi.fn(() => {
      lifecycle.push("restore");
    });
    recovery.current = {
      ...recovery.current,
      offer: { savedAt: new Date(), snapshot: { title: "Recovered" } },
      restore,
    };
    renderView();
    expect(mounted).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole("button", { name: "Restore" }));

    expect(restore).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(mounted).toHaveBeenCalledTimes(2));
    expect(lifecycle).toEqual(["mount", "unmount", "restore", "mount"]);
  });

  it("leaves through the page's exit with unsaved work, without the leave warning", async () => {
    // The page's exit navigates to the edit address, which renders the same
    // page and so keeps this form mounted: the work is not lost, and the
    // guard's "will be lost" dialog would be untrue. The guard knows the view
    // is this document's from the registry, as the router does.
    registerDocumentViews([
      { slug: "pages", path: "builder", component: VIEW },
    ]);
    onExit.mockImplementation(() => {
      window.history.pushState(null, "", "/admin/collections/pages/e1");
    });
    window.history.pushState(null, "", "/admin/collections/pages/e1/builder");
    const user = userEvent.setup();
    try {
      renderView();

      await user.type(screen.getByLabelText("Page heading"), " world");
      await user.click(screen.getByRole("button", { name: "Done" }));

      expect(onExit).toHaveBeenCalledTimes(1);
      expect(window.location.pathname).toBe("/admin/collections/pages/e1");
      expect(screen.queryByText("Unsaved Changes")).toBeNull();

      // The work is still unsaved, so the very next leave is asked about: the
      // exit switched nothing off on its way out.
      act(() => {
        window.history.pushState(null, "", "/admin/collections/pages");
      });
      expect(await screen.findByText("Unsaved Changes")).toBeInTheDocument();
      expect(window.location.pathname).toBe("/admin/collections/pages/e1");
    } finally {
      clearDocumentViews();
    }
  });

  it("leaves Escape to the view rather than cancelling to the list", () => {
    renderView();

    press(document.body, "Escape");

    expect(onCancel).not.toHaveBeenCalled();
  });

  it("cancels on Escape in the ordinary editor", () => {
    // The control for the case above: the same keystroke reaches the cancel
    // binding when no view is routed.
    renderView({ documentView: undefined });

    press(document.body, "Escape");

    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("draws the view alone when the address asks for translation mode", () => {
    renderView({ translation: translatingFromFrench });

    expect(screen.getByTestId("builder-view")).toBeInTheDocument();
    expect(
      screen.queryByRole("separator", { name: "Source and translation" })
    ).toBeNull();
    expect(screen.queryByText("Bonjour")).toBeNull();
  });

  it("splits the ordinary editor in translation mode", () => {
    // The control: the same translation state does reach the split when no
    // view is routed, so its absence above is the view mode withholding it.
    renderView({ documentView: undefined, translation: translatingFromFrench });

    expect(
      screen.getByRole("separator", { name: "Source and translation" })
    ).toBeInTheDocument();
  });

  it("says the screen is unavailable, rather than drawing nothing, when its component is missing", () => {
    // Declared, routed and loaded, but not in this admin's component map: the
    // first draw of a plugin added without regenerating the map. The control
    // is the first case in this suite, where the registered view draws.
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      renderView({
        documentView: { component: "@acme/missing/admin#View", onExit },
      });

      expect(screen.getByRole("alert").textContent).toContain(
        "This screen isn't available. Ask your developer."
      );
      expect(screen.queryByTestId("builder-view")).toBeNull();
      expect(error).toHaveBeenCalledWith(
        expect.stringContaining("@acme/missing/admin#View")
      );
    } finally {
      error.mockRestore();
    }
  });

  it("tells the view the document's status, as the embedded editor and a Single do", () => {
    const STATUS_VIEW = "@acme/pb/admin#Status";
    function StatusView(): ReactElement {
      const status = useDocumentStatus();
      return (
        <p data-testid="status">
          {status === null
            ? "unknown"
            : `${status.status}${status.hasWorkingDraft ? " with a draft" : ""}`}
        </p>
      );
    }
    registerComponent(STATUS_VIEW, StatusView);
    renderView({
      entry: { id: "e1", title: "Hello", status: "published" } as never,
      documentView: { component: STATUS_VIEW, onExit },
    });
    expect(screen.getByTestId("status")).toHaveTextContent("published");
  });

  it("lets the view run the document's save, with no header drawn, and hear how it went", async () => {
    const ACTIONS_VIEW = "@acme/pb/admin#Actions";
    const heard = vi.fn();
    function ActionsView(): ReactElement {
      const { run } = useHostedDocumentActions();
      return (
        <button
          type="button"
          onClick={() => {
            void run("save").then(heard);
          }}
        >
          Save from the view
        </button>
      );
    }
    registerComponent(ACTIONS_VIEW, ActionsView);
    update.mockResolvedValue({ item: { id: "e1", title: "Hello" } });
    renderView({ documentView: { component: ACTIONS_VIEW, onExit } });

    expect(screen.queryByRole("textbox", { name: "Title" })).toBeNull();
    await userEvent.click(
      screen.getByRole("button", { name: "Save from the view" })
    );

    await waitFor(() =>
      expect(heard).toHaveBeenCalledWith({
        ok: true,
        item: { id: "e1", title: "Hello" },
      })
    );
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("keeps the ordinary editor when no view is routed", () => {
    // The control for the first case: the same render without a view does
    // produce the entry form element and its fields.
    render(<EntryForm collection={collection} entry={entry} mode="edit" />, {
      wrapper: Providers,
    });

    expect(document.querySelector("form#entry-form")).not.toBeNull();
    expect(screen.queryByTestId("builder-view")).toBeNull();
    expect(screen.queryByTestId("document-view-frame")).toBeNull();
  });
});

describe("a field-type view on a document with two fields of its type", () => {
  const twoBlocks = {
    name: "pages",
    label: "Pages",
    fields: [
      { name: "title", type: "text", label: "Title" },
      { name: "hero", type: "blocks", label: "Hero" },
      { name: "body", type: "blocks", label: "Body" },
    ],
  } as never;

  function openAt(search: string) {
    window.history.pushState(
      null,
      "",
      `/admin/collections/pages/e1/builder${search}`
    );
    return renderView({
      collection: twoBlocks,
      documentView: { component: VIEW, onExit, fieldType: "blocks" },
    });
  }

  afterEach(() => {
    window.history.pushState(null, "", "/");
  });

  it.each(["hero", "body"])("edits %s when the address names it", name => {
    openAt(`?field=${name}`);
    expect(screen.getByTestId("builder-view")).toBeInTheDocument();
    expect(received).toHaveBeenLastCalledWith(
      expect.objectContaining({
        field: expect.objectContaining({ name: name, type: "blocks" }),
      })
    );
  });

  it.each([
    ["names no field", ""],
    ["names a field that is not one of them", "?field=title"],
    ["names a field the document does not have", "?field=nope"],
  ])(
    "asks which field when the address %s, drawing no view",
    (_case, search) => {
      openAt(search);
      expect(
        screen.getByRole("heading", {
          name: "Which field do you want to edit?",
        })
      ).toBeInTheDocument();
      expect(screen.queryByTestId("builder-view")).toBeNull();
      expect(screen.getByRole("button", { name: "Hero" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Body" })).toBeInTheDocument();
    }
  );

  it("opens the chosen field and records it in the address", () => {
    openAt("");
    fireEvent.click(screen.getByRole("button", { name: "Body" }));
    // The admin's router announces every history move with this event; the
    // test has no router, so it announces the one the click made.
    act(() => {
      window.dispatchEvent(new Event("locationchange"));
    });
    expect(new URLSearchParams(window.location.search).get("field")).toBe(
      "body"
    );
    expect(received).toHaveBeenLastCalledWith(
      expect.objectContaining({
        field: expect.objectContaining({ name: "body", type: "blocks" }),
      })
    );
  });

  it.each([
    ["names a field the document does not have", "?field=stale"],
    ["names no field", ""],
  ])(
    "corrects the address in place when it %s, on a document with one",
    (_case, search) => {
      window.history.pushState(
        null,
        "",
        `/admin/collections/pages/e1/builder${search}`
      );
      const depth = window.history.length;
      renderView({
        collection: {
          name: "pages",
          fields: [{ name: "layout", type: "blocks" }],
        } as never,
        documentView: { component: VIEW, onExit, fieldType: "blocks" },
      });
      // The editor opens the only field, and the address now names it, so a
      // reload or a shared link reaches exactly what is on screen.
      expect(received).toHaveBeenLastCalledWith(
        expect.objectContaining({
          field: expect.objectContaining({ name: "layout" }),
        })
      );
      expect(new URLSearchParams(window.location.search).get("field")).toBe(
        "layout"
      );
      // Replaced, not pushed: Back does not return to the stale address.
      expect(window.history.length).toBe(depth);
    }
  );

  it("opens the only field of its type without asking", () => {
    window.history.pushState(null, "", "/admin/collections/pages/e1/builder");
    renderView({
      collection: {
        name: "pages",
        fields: [{ name: "layout", type: "blocks" }],
      } as never,
      documentView: { component: VIEW, onExit, fieldType: "blocks" },
    });
    expect(received).toHaveBeenLastCalledWith(
      expect.objectContaining({
        field: expect.objectContaining({ name: "layout", type: "blocks" }),
      })
    );
  });
});

describe("a field the form would not let the author edit", () => {
  function openWith(fields: unknown[], title = "Hello") {
    window.history.pushState(
      null,
      "",
      "/admin/collections/pages/e1/builder?field=layout"
    );
    return renderView({
      collection: { name: "pages", fields } as never,
      entry: { id: "e1", title } as never,
      documentView: { component: VIEW, onExit, fieldType: "blocks" },
    });
  }

  function refusedSaying(reason: RegExp): void {
    expect(
      screen.getByRole("heading", { name: "This field can't be edited" })
    ).toBeInTheDocument();
    expect(screen.getByText(reason)).toBeInTheDocument();
    // Refused, not handed over: the view is never drawn, so it cannot edit
    // the field however it treats what it is given.
    expect(screen.queryByTestId("builder-view")).toBeNull();
  }

  afterEach(() => {
    window.history.pushState(null, "", "/");
  });

  it("refuses a read-only field, and offers the way back", () => {
    openWith([
      { name: "title", type: "text" },
      { name: "layout", type: "blocks", admin: { readOnly: true } },
    ]);
    refusedSaying(/read-only/);
    fireEvent.click(
      screen.getByRole("button", { name: "Back to the document" })
    );
    expect(onExit).toHaveBeenCalled();
  });

  it("refuses a disabled field", () => {
    openWith([
      { name: "title", type: "text" },
      { name: "layout", type: "blocks", admin: { disabled: true } },
    ]);
    refusedSaying(/turned off for editing/);
  });

  it("follows a condition while the view is up, as the form does", () => {
    // Typed into the mounted document, not set up in two separate mounts: a
    // gate that read the condition once would pass two mounts and fail here.
    openWith(
      [
        { name: "title", type: "text" },
        {
          name: "layout",
          type: "blocks",
          admin: { condition: { field: "title", equals: "Show" } },
        },
      ],
      "Show"
    );
    expect(screen.getByTestId("builder-view")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Page heading"), {
      target: { value: "Hide" },
    });

    refusedSaying(/isn't shown for this document/);
  });

  it("asks the condition of the field the address names now, not the one it named first", () => {
    // Two fields hidden by different values. Moving between them keeps the
    // view's host mounted, so each must be answered from its own condition.
    window.history.pushState(
      null,
      "",
      "/admin/collections/pages/e1/builder?field=first"
    );
    renderView({
      collection: {
        name: "pages",
        fields: [
          { name: "title", type: "text" },
          { name: "subtitle", type: "text" },
          {
            name: "first",
            type: "blocks",
            admin: { condition: { field: "title", equals: "Show" } },
          },
          {
            name: "second",
            type: "blocks",
            admin: { condition: { field: "subtitle", equals: "Show" } },
          },
        ],
      } as never,
      entry: { id: "e1", title: "Show", subtitle: "Hide" } as never,
      documentView: { component: VIEW, onExit, fieldType: "blocks" },
    });
    expect(screen.getByTestId("builder-view")).toBeInTheDocument();

    const moveTo = (name: string) => {
      window.history.pushState(
        null,
        "",
        `/admin/collections/pages/e1/builder?field=${name}`
      );
      act(() => {
        window.dispatchEvent(new Event("locationchange"));
      });
    };
    moveTo("second");
    refusedSaying(/isn't shown for this document/);

    moveTo("first");
    expect(screen.getByTestId("builder-view")).toBeInTheDocument();
  });

  it("offers only the fields the author may edit, and opens the only one", () => {
    window.history.pushState(null, "", "/admin/collections/pages/e1/builder");
    renderView({
      collection: {
        name: "pages",
        fields: [
          { name: "title", type: "text" },
          { name: "hero", type: "blocks", admin: { hidden: true } },
          { name: "body", type: "blocks" },
        ],
      } as never,
      documentView: { component: VIEW, onExit, fieldType: "blocks" },
    });
    // One field of two may be edited, so there is nothing to ask.
    expect(received).toHaveBeenLastCalledWith(
      expect.objectContaining({
        field: expect.objectContaining({ name: "body" }),
      })
    );
  });

  it("leaves a field the author may not edit out of the question", () => {
    window.history.pushState(null, "", "/admin/collections/pages/e1/builder");
    renderView({
      collection: {
        name: "pages",
        fields: [
          { name: "title", type: "text" },
          {
            name: "hero",
            label: "Hero",
            type: "blocks",
            admin: { readOnly: true },
          },
          { name: "body", label: "Body", type: "blocks" },
          { name: "aside", label: "Aside", type: "blocks" },
        ],
      } as never,
      documentView: { component: VIEW, onExit, fieldType: "blocks" },
    });
    expect(screen.getByRole("button", { name: "Body" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Aside" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Hero" })).toBeNull();
  });

  it("refuses a gated field the address names, rather than opening another", () => {
    // The author followed an address to this field; meeting a different one
    // in its place would hide why theirs did not open.
    window.history.pushState(
      null,
      "",
      "/admin/collections/pages/e1/builder?field=hero"
    );
    renderView({
      collection: {
        name: "pages",
        fields: [
          { name: "title", type: "text" },
          { name: "hero", type: "blocks", admin: { readOnly: true } },
          { name: "body", type: "blocks" },
        ],
      } as never,
      documentView: { component: VIEW, onExit, fieldType: "blocks" },
    });
    refusedSaying(/read-only/);
  });

  it("refuses a field the form never draws", () => {
    openWith([
      { name: "title", type: "text" },
      { name: "layout", type: "blocks", admin: { hidden: true } },
    ]);
    refusedSaying(/isn't shown for this document/);
  });

  it("refuses a field inside a read-only unnamed group, as the form draws it", () => {
    openWith([
      { name: "title", type: "text" },
      {
        type: "group",
        admin: { readOnly: true },
        fields: [{ name: "layout", type: "blocks" }],
      },
    ]);
    refusedSaying(/read-only/);
  });
});
