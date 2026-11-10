import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AdminContributionsMeta, AdminPlaceId } from "nextly/config";
import { afterEach, describe, expect, it, vi } from "vitest";

import { registerComponent } from "@admin/lib/plugins/component-registry";

import { PlaceTabs, TargetSlot } from "..";

/** What the admin metadata delivers, set per test. */
const meta = vi.hoisted(() => ({
  contributions: undefined as AdminContributionsMeta | undefined,
}));

vi.mock("@admin/context/providers/BrandingProvider", () => ({
  useBranding: () => ({ contributions: meta.contributions }),
}));

const FIRST = "@acme/a/admin#First";
const SECOND = "@acme/a/admin#Second";
const THROWS = "@acme/a/admin#Throws";
const ECHO = "@acme/a/admin#Echo";
const TAB = "@acme/a/admin#Tab";

registerComponent(FIRST, () => <p>first block</p>);
registerComponent(SECOND, () => <p>second block</p>);
registerComponent(THROWS, () => {
  throw new Error("the block failed to draw");
});
registerComponent(ECHO, ((props: { context?: unknown; entry?: unknown }) => (
  <pre data-testid="echo">
    {JSON.stringify({ context: props.context, entry: props.entry })}
  </pre>
)) as never);
registerComponent(TAB, () => <p>plugin tab body</p>);
const PLUGIN_FORM = "@acme/a/admin#PluginForm";
const pluginSubmit = vi.fn();
registerComponent(PLUGIN_FORM, () => (
  <form
    onSubmit={event => {
      event.preventDefault();
      pluginSubmit();
    }}
  >
    <button type="submit">Send plugin form</button>
  </form>
));

afterEach(() => {
  meta.contributions = undefined;
  vi.restoreAllMocks();
});

/** A block contribution as the server delivers it, already placed. */
function block(id: string, component: string, extra: object = {}) {
  return { plugin: "@acme/a", id, kind: "block", component, ...extra } as const;
}

const CONTEXT = { userId: "u1", shownUserId: "u2" };

/** The block texts on screen, top to bottom. */
function drawn(): string[] {
  return Array.from(
    document.querySelectorAll("[data-testid='page-content'], p")
  ).map(node => node.textContent ?? "");
}

describe("TargetSlot", () => {
  it("draws the place's built-ins, in the catalogue's order, when nothing is contributed", () => {
    render(
      <TargetSlot
        place="user.detail"
        context={CONTEXT}
        builtIns={{ content: <div data-testid="page-content">content</div> }}
      />
    );

    expect(drawn()).toEqual(["content"]);
  });

  it("draws built-ins and contributions in the order delivered", () => {
    // Out of any order the admin could work out for itself: the server
    // ordered this list, and the admin draws it as sent.
    meta.contributions = {
      "user.detail": {
        block: [
          block("acme-a.second", SECOND),
          { builtIn: "content" },
          block("acme-a.first", FIRST),
        ],
      },
    };

    render(
      <TargetSlot
        place="user.detail"
        context={CONTEXT}
        builtIns={{ content: <div data-testid="page-content">content</div> }}
      />
    );

    expect(drawn()).toEqual(["second block", "content", "first block"]);
  });

  it("a throwing contribution draws its own fallback and the rest of the page stays", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    meta.contributions = {
      "user.detail": {
        block: [
          block("acme-a.throws", THROWS),
          { builtIn: "content" },
          block("acme-a.first", FIRST),
        ],
      },
    };

    render(
      <TargetSlot
        place="user.detail"
        context={CONTEXT}
        builtIns={{ content: <div data-testid="page-content">content</div> }}
      />
    );

    expect(screen.getByText(THROWS, { exact: false })).toBeTruthy();
    expect(screen.getByTestId("page-content")).toBeTruthy();
    expect(screen.getByText("first block")).toBeTruthy();
  });

  it("a contribution receives the place's context and the entry", () => {
    meta.contributions = {
      "collection.edit": { block: [block("acme-a.echo", ECHO)] },
    };
    const context = { userId: "u1", collection: "posts", entryId: "p1" };

    render(
      <TargetSlot
        place="collection.edit"
        context={context}
        entry={{ id: "p1", status: "draft" }}
      />
    );

    expect(JSON.parse(screen.getByTestId("echo").textContent ?? "")).toEqual({
      context,
      entry: { id: "p1", status: "draft" },
    });
  });

  it("a contribution whose rule does not match the entry is not drawn", () => {
    meta.contributions = {
      "collection.edit": {
        block: [
          block("acme-a.first", FIRST, {
            visibleWhen: { field: "status", equals: "published" },
          }),
          block("acme-a.second", SECOND, {
            visibleWhen: { field: "status", equals: "draft" },
          }),
        ],
      },
    };

    render(
      <TargetSlot
        place="collection.edit"
        context={{ userId: "u1", collection: "posts", entryId: "p1" }}
        entry={{ id: "p1", status: "draft" }}
      />
    );

    expect(drawn()).toEqual(["second block"]);
  });

  it("a rule naming a field the entry lacks does not match", () => {
    // The field the reader may not read is missing from the entry they were
    // given, and a rule that needs it does not match, `not` included.
    meta.contributions = {
      "collection.edit": {
        block: [
          block("acme-a.first", FIRST, {
            visibleWhen: { not: { field: "secret", equals: "x" } },
          }),
          block("acme-a.second", SECOND),
        ],
      },
    };

    render(
      <TargetSlot
        place="collection.edit"
        context={{ userId: "u1", collection: "posts", entryId: "p1" }}
        entry={{ id: "p1" }}
      />
    );

    expect(drawn()).toEqual(["second block"]);
  });

  it("another plugin's block draws at a plugin's own place", () => {
    // A place a plugin declared, on its own page: it has no built-in parts,
    // so only what was sent there is drawn, as sent.
    meta.contributions = {
      "acme-billing.invoice": {
        block: [block("acme-a.first", FIRST), block("acme-a.echo", ECHO)],
      },
    };

    render(
      <TargetSlot
        place={"acme-billing.invoice" as AdminPlaceId}
        context={{ invoiceId: "i1" } as never}
      />
    );

    expect(screen.getByText("first block")).toBeTruthy();
    expect(JSON.parse(screen.getByTestId("echo").textContent ?? "")).toEqual({
      context: { invoiceId: "i1" },
    });
  });
});

describe("PlaceTabs", () => {
  it("draws no tab strip without a delivered tab", () => {
    render(
      <PlaceTabs place="user.detail" context={CONTEXT} contentLabel="Profile">
        <div data-testid="page-content">content</div>
      </PlaceTabs>
    );

    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.getByTestId("page-content")).toBeTruthy();
  });

  it("a delivered tab follows the page's own content", async () => {
    meta.contributions = {
      "user.detail": {
        tab: [
          {
            plugin: "@acme/a",
            id: "acme-a.billing",
            kind: "tab",
            label: "Billing",
            component: TAB,
          },
        ],
      },
    };
    const user = userEvent.setup();

    render(
      <PlaceTabs place="user.detail" context={CONTEXT} contentLabel="Profile">
        <div data-testid="page-content">content</div>
      </PlaceTabs>
    );

    const tabs = within(screen.getByRole("tablist"))
      .getAllByRole("tab")
      .map(tab => tab.textContent);
    expect(tabs).toEqual(["Profile", "Billing"]);
    expect(screen.getByTestId("page-content")).toBeTruthy();

    await user.click(screen.getByRole("tab", { name: "Billing" }));
    expect(await screen.findByText("plugin tab body")).toBeTruthy();
  });

  it("leaving the content for a tab keeps what was typed in it", async () => {
    meta.contributions = {
      "user.detail": {
        tab: [
          {
            plugin: "@acme/a",
            id: "acme-a.billing",
            kind: "tab",
            label: "Billing",
            component: TAB,
          },
        ],
      },
    };
    const user = userEvent.setup();

    render(
      <PlaceTabs place="user.detail" context={CONTEXT} contentLabel="Profile">
        <form id="page-form">
          <input aria-label="Name" />
        </form>
      </PlaceTabs>
    );

    await user.type(screen.getByLabelText("Name"), "Ada");
    await user.click(screen.getByRole("tab", { name: "Billing" }));
    expect(await screen.findByText("plugin tab body")).toBeTruthy();
    // Still there for a Save button outside the strip, only hidden.
    const form = document.getElementById("page-form");
    expect(form?.style.display).toBe("none");

    await user.click(screen.getByRole("tab", { name: "Profile" }));
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe(
      "Ada"
    );
  });

  it("tabs arriving after the content was typed in keep what was typed", async () => {
    // The signed-in metadata answers after the page has drawn: the strip
    // appears around content the reader is already editing.
    const user = userEvent.setup();
    // A fresh element each time, as the page's own render makes one.
    const page = () => (
      <PlaceTabs place="user.detail" context={CONTEXT} contentLabel="Profile">
        <input aria-label="Name" />
      </PlaceTabs>
    );
    const { rerender } = render(page());
    await user.type(screen.getByLabelText("Name"), "Ada");

    meta.contributions = { "user.detail": { tab: [billingTab()] } };
    rerender(page());
    expect(screen.getByRole("tablist")).toBeTruthy();
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe(
      "Ada"
    );

    // And the last tab going away again keeps it too.
    meta.contributions = undefined;
    rerender(page());
    expect(screen.queryByRole("tablist")).toBeNull();
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe(
      "Ada"
    );
  });

  it("a shown tab that is no longer sent gives the content back", async () => {
    meta.contributions = {
      "user.detail": {
        tab: [
          billingTab(),
          { ...billingTab(), id: "acme-a.usage", label: "Usage" },
        ],
      },
    };
    const user = userEvent.setup();
    const page = () => (
      <PlaceTabs place="user.detail" context={CONTEXT} contentLabel="Profile">
        <div data-testid="page-content">content</div>
      </PlaceTabs>
    );
    const { rerender } = render(page());
    await user.click(screen.getByRole("tab", { name: "Billing" }));
    expect(screen.getByTestId("page-content").style.display).toBe("none");

    meta.contributions = {
      "user.detail": {
        tab: [{ ...billingTab(), id: "acme-a.usage", label: "Usage" }],
      },
    };
    rerender(page());
    expect(screen.getByTestId("page-content").style.display).not.toBe("none");
    expect(
      screen.getByRole("tab", { name: "Profile" }).getAttribute("aria-selected")
    ).toBe("true");

    // Sent again later, it does not take the page away: the choice of it was
    // let go of when it went.
    meta.contributions = {
      "user.detail": {
        tab: [
          billingTab(),
          { ...billingTab(), id: "acme-a.usage", label: "Usage" },
        ],
      },
    };
    rerender(page());
    expect(screen.getByTestId("page-content").style.display).not.toBe("none");
    expect(
      screen.getByRole("tab", { name: "Profile" }).getAttribute("aria-selected")
    ).toBe("true");
  });

  it("the page's own tab names no panel that is not there", () => {
    meta.contributions = { "user.detail": { tab: [billingTab()] } };

    render(
      <PlaceTabs place="user.detail" context={CONTEXT} contentLabel="Profile">
        <div data-testid="page-content">content</div>
      </PlaceTabs>
    );

    const own = screen.getByRole("tab", { name: "Profile" });
    expect(own.hasAttribute("aria-controls")).toBe(false);
    // Every panel a tab does name is on the page.
    for (const tab of screen.getAllByRole("tab")) {
      const controls = tab.getAttribute("aria-controls");
      if (tab.getAttribute("aria-selected") === "true" && controls) {
        expect(document.getElementById(controls)).not.toBeNull();
      }
    }
  });

  it("draws no tab while the page's context is not known yet", () => {
    meta.contributions = { "user.detail": { tab: [billingTab()] } };

    render(
      <PlaceTabs place="user.detail" context={null} contentLabel="Profile">
        <div data-testid="page-content">content</div>
      </PlaceTabs>
    );

    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.getByTestId("page-content")).toBeTruthy();
  });
});

describe("TargetSlot while the page's context is not known yet", () => {
  it("draws the page's own part a contribution replaces, until the contribution can be drawn", () => {
    // The server's list holds the replacement in the part's place, and no
    // marker for the part; the replacement waits for the context.
    meta.contributions = {
      "user.detail": {
        block: [block("acme-a.first", FIRST, { replaces: "content" })],
      },
    };
    const page = (context: typeof CONTEXT | null) => (
      <TargetSlot
        place="user.detail"
        context={context}
        builtIns={{ content: <div data-testid="page-content">content</div> }}
      />
    );

    const { rerender } = render(page(null));
    expect(drawn()).toEqual(["content"]);

    rerender(page(CONTEXT));
    expect(drawn()).toEqual(["first block"]);
  });

  it("draws only the page's own parts", () => {
    meta.contributions = {
      "user.detail": {
        block: [
          block("acme-a.echo", ECHO),
          { builtIn: "content" },
          block("acme-a.first", FIRST),
        ],
      },
    };

    render(
      <TargetSlot
        place="user.detail"
        context={null}
        builtIns={{ content: <div data-testid="page-content">content</div> }}
      />
    );

    expect(drawn()).toEqual(["content"]);
    expect(screen.queryByTestId("echo")).toBeNull();
  });
});

/** A tab contribution as the server delivers it. */
function billingTab() {
  return {
    plugin: "@acme/a",
    id: "acme-a.billing",
    kind: "tab",
    label: "Billing",
    component: TAB,
  } as const;
}

describe("a contribution whose component cannot be found", () => {
  // Not in the generated component map, or never registered: the place says
  // so where it would stand, and the registry names the path in a warning.
  const MISSING = "@acme/a/admin#NotRegistered";

  it("a block draws the place's fallback, and the path is named in a warning", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    meta.contributions = {
      "user.detail": {
        block: [{ builtIn: "content" }, block("acme-a.missing", MISSING)],
      },
    };

    render(
      <TargetSlot
        place="user.detail"
        context={CONTEXT}
        builtIns={{ content: <div data-testid="page-content">content</div> }}
      />
    );

    expect(screen.getByTestId("page-content")).toBeTruthy();
    expect(
      screen.getByText("This part of the page couldn't be loaded.")
    ).toBeTruthy();
    expect(
      warn.mock.calls.some(([message]) => String(message).includes(MISSING))
    ).toBe(true);
  });

  it("a tab's panel draws the place's fallback rather than standing empty", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    meta.contributions = {
      "user.detail": {
        tab: [{ ...billingTab(), component: MISSING }],
      },
    };
    const user = userEvent.setup();

    render(
      <PlaceTabs place="user.detail" context={CONTEXT} contentLabel="Profile">
        <div data-testid="page-content">content</div>
      </PlaceTabs>
    );
    await user.click(screen.getByRole("tab", { name: "Billing" }));

    expect(
      await screen.findByText("This part of the page couldn't be loaded.")
    ).toBeTruthy();
  });
});

describe("a plugin's own form inside a place", () => {
  // The edit pages draw their places inside the document's own form, whose
  // handler saves the document. A plugin's submit must stay the plugin's.
  afterEach(() => pluginSubmit.mockReset());

  it("a plugin's form submits without saving the document", async () => {
    const saveDocument = vi.fn((event: { preventDefault: () => void }) =>
      event.preventDefault()
    );
    meta.contributions = {
      "user.detail": {
        block: [{ builtIn: "content" }, block("acme-a.form", PLUGIN_FORM)],
        tab: [{ ...billingTab(), component: PLUGIN_FORM }],
      },
    };
    const user = userEvent.setup();

    render(
      <form onSubmit={saveDocument}>
        <PlaceTabs place="user.detail" context={CONTEXT} contentLabel="Profile">
          <TargetSlot
            place="user.detail"
            context={CONTEXT}
            builtIns={{
              content: <div data-testid="page-content">content</div>,
            }}
          />
        </PlaceTabs>
      </form>
    );

    // A block's form.
    await user.click(screen.getByRole("button", { name: "Send plugin form" }));
    expect(pluginSubmit).toHaveBeenCalledTimes(1);
    expect(saveDocument).not.toHaveBeenCalled();

    // A tab's form.
    await user.click(screen.getByRole("tab", { name: "Billing" }));
    const inTab = within(screen.getByRole("tabpanel"));
    await user.click(inTab.getByRole("button", { name: "Send plugin form" }));
    expect(pluginSubmit).toHaveBeenCalledTimes(2);
    expect(saveDocument).not.toHaveBeenCalled();
  });

  it("with nothing contributed, the page's own parts are not wrapped", () => {
    const { container } = render(
      <TargetSlot
        place="user.detail"
        context={CONTEXT}
        builtIns={{ content: <div data-testid="page-content">content</div> }}
      />
    );

    expect(screen.getByTestId("page-content").parentElement).toBe(container);
  });
});
