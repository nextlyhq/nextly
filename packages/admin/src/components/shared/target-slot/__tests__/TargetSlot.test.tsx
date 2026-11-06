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
    expect(form?.closest("[role='tabpanel']")?.hasAttribute("hidden")).toBe(
      true
    );

    await user.click(screen.getByRole("tab", { name: "Profile" }));
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe(
      "Ada"
    );
  });
});
