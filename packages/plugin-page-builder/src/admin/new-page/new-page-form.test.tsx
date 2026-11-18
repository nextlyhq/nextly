// @vitest-environment jsdom
/**
 * The New page dialog's body, as an author meets it: what it shows for a
 * collection with drafts and without, with and without the header & footer
 * choice and starters; the address following the title until it is changed;
 * what it says about a taken address; a refused create; required fields it
 * doesn't ask for; "Create" for an author who may not change what they make;
 * "Type" where more than one kind of page opens in the builder; and the
 * question about unsaved work asked before anything is made.
 */
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { JSX } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  CreatedPageItem,
  CreatePageRequest,
  NewPageFacts,
} from "../../pages-write-contract";

/** A refusal as the admin's client raises it: its status and issues. */
class Refused extends Error {
  constructor(
    message: string,
    readonly issues: { path: string; code: string; message: string }[] = []
  ) {
    super(message);
  }
}

const navigateTo = vi.fn<(href: string) => void>();
const asked: URLSearchParams[] = [];
let facts: (query: URLSearchParams) => NewPageFacts;

vi.mock("@nextlyhq/plugin-sdk/admin", () => ({
  apiErrorMessage: (error: unknown, fallback: string) =>
    error instanceof Error ? error.message : fallback,
  validationIssues: (error: unknown) =>
    error instanceof Refused ? error.issues : [],
  navigateTo: (href: string) => navigateTo(href),
  readPluginRoute: async ({ path }: { path: string }) => {
    const query = new URL(path, "http://x").searchParams;
    asked.push(query);
    return facts(query);
  },
}));

const createPage =
  vi.fn<(request: CreatePageRequest) => Promise<CreatedPageItem>>();
vi.mock("../pages-client", () => ({
  createPage: (request: CreatePageRequest) => createPage(request),
}));

// The menu itself is the Header & footer menu's own, tested beside it; here
// it is the row in its place, holding the site default.
vi.mock("../page-layout", () => ({
  NewPageLayoutPicker: (): JSX.Element => (
    <div>
      <label htmlFor="hf">Header &amp; footer</label>
      <button id="hf" type="button">
        Site default (Main)
      </button>
    </div>
  ),
}));

const { NewPageForm } = await import("./new-page-form");

Element.prototype.hasPointerCapture ??= () => false;
Element.prototype.releasePointerCapture ??= () => {};
Element.prototype.scrollIntoView ??= () => {};

/** The plugin's own Pages, at `ridgeline.example/<address>`. */
function pagesFacts(
  query: URLSearchParams,
  over: Partial<NewPageFacts> = {}
): NewPageFacts {
  const title = query.get("title");
  const slug =
    query.get("slug") ??
    (title === null ? "" : title.toLowerCase().replace(/[^a-z0-9]+/g, "-"));
  return {
    collection: { slug: "pages", label: "Page" },
    collections: [{ slug: "pages", label: "Page" }],
    drafts: true,
    headerFooter: true,
    mayUpdate: true,
    starters: [],
    address: {
      site: "https://ridgeline.example/",
      before: "/",
      after: "",
      slug,
    },
    ...over,
  };
}

function made(over: Partial<CreatedPageItem> = {}): CreatedPageItem {
  return {
    id: "new",
    collection: "pages",
    collectionLabel: "Page",
    field: "content",
    title: "Pricing",
    status: "draft",
    mayUpdate: true,
    ...over,
  };
}

const onCreated = vi.fn<(page: CreatedPageItem) => void>();
const onCancel = vi.fn();

function mount(props: Partial<Parameters<typeof NewPageForm>[0]> = {}) {
  return render(
    <NewPageForm
      collection="pages"
      onCancel={onCancel}
      onCreated={onCreated}
      {...props}
    />
  );
}

/** The dialog's controls, in the order Tab reaches them. */
function tabOrder(): string[] {
  const form = document.querySelector("form");
  if (form === null) return [];
  return [
    ...form.querySelectorAll<HTMLElement>(
      "input:not([type=radio]):not([disabled]), button, [role=combobox], input[type=radio]:checked"
    ),
  ].map(element => {
    if (element instanceof HTMLInputElement && element.type === "radio") {
      return "Start from";
    }
    const label = element.id
      ? document.querySelector(`label[for="${element.id}"]`)?.textContent
      : null;
    return (
      element.getAttribute("aria-label") ??
      label ??
      element.textContent ??
      ""
    ).trim();
  });
}

beforeEach(() => {
  facts = query => pagesFacts(query);
  asked.length = 0;
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("what the dialog shows", () => {
  it("for a collection with drafts: Title focused, Address, Header & footer, how it is saved, Cancel and Create and open builder", async () => {
    mount();
    await screen.findByText("Saved as a draft.");
    expect(document.activeElement).toBe(
      screen.getByRole("textbox", { name: "Title" })
    );
    expect(
      screen.getByText("Made from the title. Change it any time.")
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Header & footer" }).textContent
    ).toBe("Site default (Main)");
    // No starters: no Start from, and the page starts blank.
    expect(screen.queryByText("Start from")).toBeNull();
    expect(tabOrder()).toEqual([
      "Title",
      "Change the address",
      "Header & footer",
      "Cancel",
      "Create and open builder",
    ]);
  });

  it("for a collection without drafts, says visitors see it at once", async () => {
    facts = query => pagesFacts(query, { drafts: false });
    mount();
    expect(
      await screen.findByText("Visitors can see it as soon as it is created.")
    ).toBeTruthy();
    expect(screen.queryByText("Saved as a draft.")).toBeNull();
  });

  it("leaves out Header & footer where the collection has no such choice", async () => {
    facts = query => pagesFacts(query, { headerFooter: false });
    mount();
    await screen.findByText("Saved as a draft.");
    expect(screen.queryByText("Header & footer")).toBeNull();
  });

  it("offers Start from, Blank first, once the site has starters, and sends the one chosen", async () => {
    facts = query =>
      pagesFacts(query, {
        starters: [
          { id: "landing", label: "Landing" },
          { id: "about", label: "About", picture: "/about.png" },
        ],
      });
    createPage.mockResolvedValue(made());
    mount();
    const row = await screen.findByRole("group", { name: "Start from" });
    const choices = within(row).getAllByRole("radio");
    expect(choices.map(choice => choice.closest("label")?.textContent)).toEqual(
      ["Blank", "Landing", "About"]
    );
    expect((choices[0] as HTMLInputElement).checked).toBe(true);
    await userEvent.type(screen.getByRole("textbox", { name: "Title" }), "Hi");
    await userEvent.click(within(row).getByRole("radio", { name: "Landing" }));
    await userEvent.click(
      screen.getByRole("button", { name: "Create and open builder" })
    );
    expect(createPage).toHaveBeenCalledWith(
      expect.objectContaining({ starter: "landing" })
    );
  });

  it("keeps Create and open builder disabled while the title is empty, saying why", async () => {
    mount();
    const create = await screen.findByRole("button", {
      name: "Create and open builder",
    });
    expect((create as HTMLButtonElement).disabled).toBe(true);
    const reason = create.getAttribute("aria-describedby");
    expect(reason && document.getElementById(reason)?.textContent).toBe(
      "Give the page a title to create it."
    );
    await userEvent.type(screen.getByRole("textbox", { name: "Title" }), "  ");
    expect((create as HTMLButtonElement).disabled).toBe(true);
    await userEvent.type(screen.getByRole("textbox", { name: "Title" }), "A");
    expect((create as HTMLButtonElement).disabled).toBe(false);
    expect(create.getAttribute("aria-describedby")).toBeNull();
  });

  it("shows Type first where more than one kind of page opens in the builder, and not where one does", async () => {
    facts = query =>
      pagesFacts(query, {
        collections: [
          { slug: "pages", label: "Page" },
          { slug: "landing", label: "Landing page" },
        ],
      });
    mount({ offerType: true });
    const type = await screen.findByRole("combobox", { name: "Type" });
    expect(type.textContent).toBe("Page");
    expect(tabOrder()[0]).toBe("Type");
    cleanup();

    facts = query => pagesFacts(query);
    mount({ offerType: true });
    await screen.findByText("Saved as a draft.");
    expect(screen.queryByRole("combobox", { name: "Type" })).toBeNull();
  });
});

describe("the address", () => {
  /** The address as the dialog shows it, in one line. */
  const addressText = () =>
    document.querySelector("[data-slot=new-page-address-text]")?.textContent;

  it("follows the title, by the route's rule, until it is changed; then it is the author's", async () => {
    createPage.mockResolvedValue(made());
    mount();
    await screen.findByText("Saved as a draft.");
    const title = screen.getByRole("textbox", { name: "Title" });
    await userEvent.type(title, "Café Menu");
    expect(addressText()).toBe("ridgeline.example/cafe-menu");

    await userEvent.click(
      screen.getByRole("button", { name: "Change the address" })
    );
    const address = screen.getByRole("textbox", { name: "Address" });
    await userEvent.clear(address);
    await userEvent.type(address, "menu");
    await userEvent.type(title, " Today");
    expect((address as HTMLInputElement).value).toBe("menu");
    await userEvent.type(address, "{Enter}");
    expect(createPage).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Café Menu Today", slug: "menu" })
    );
  });

  it("says before creating that an address made from the title moves on", async () => {
    facts = query =>
      pagesFacts(query, {
        address: {
          site: "https://ridgeline.example/",
          before: "/",
          after: "",
          slug: "pricing-2",
          wanted: "pricing",
        },
      });
    mount();
    await userEvent.type(
      screen.getByRole("textbox", { name: "Title" }),
      "Pricing"
    );
    expect(
      await screen.findByText(
        "/pricing is in use, so this page gets /pricing-2."
      )
    ).toBeTruthy();
    await waitFor(() =>
      expect(addressText()).toBe("ridgeline.example/pricing-2")
    );
  });

  it("names the page holding a typed address, and a create refused for it keeps what was typed", async () => {
    facts = query =>
      pagesFacts(query, {
        address: {
          site: null,
          before: "/",
          after: "",
          slug: query.get("slug") ?? "",
          ...(query.get("slug") === "pricing" ? { takenBy: "Our prices" } : {}),
        },
      });
    createPage.mockRejectedValue(
      new Refused("Validation failed.", [
        {
          path: "slug",
          code: "TAKEN",
          message: "That address is used by another page",
        },
      ])
    );
    mount();
    await userEvent.type(
      screen.getByRole("textbox", { name: "Title" }),
      "Prices"
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Change the address" })
    );
    const address = screen.getByRole("textbox", { name: "Address" });
    await userEvent.clear(address);
    await userEvent.type(address, "pricing");
    expect((await screen.findByRole("alert")).textContent).toBe(
      "That address is used by Our prices"
    );

    await userEvent.clear(address);
    await userEvent.type(address, "plans{Enter}");
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe(
        "That address is used by another page"
      )
    );
    expect((address as HTMLInputElement).value).toBe("plans");
    expect(
      (screen.getByRole("textbox", { name: "Title" }) as HTMLInputElement).value
    ).toBe("Prices");
    expect(onCreated).not.toHaveBeenCalled();
  });
});

describe("creating", () => {
  it("creates with the title, the address it follows and the header & footer, and hands the page back", async () => {
    createPage.mockResolvedValue(made());
    mount();
    await screen.findByText("Saved as a draft.");
    await userEvent.type(
      screen.getByRole("textbox", { name: "Title" }),
      "Pricing{Enter}"
    );
    expect(createPage).toHaveBeenCalledWith({
      collection: "pages",
      title: "Pricing",
      layout: null,
      noHeaderFooter: false,
    });
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(made()));
  });

  it("never creates because focus left a field", async () => {
    mount();
    await screen.findByText("Saved as a draft.");
    await userEvent.type(
      screen.getByRole("textbox", { name: "Title" }),
      "Pricing"
    );
    await userEvent.click(document.body);
    await userEvent.tab();
    expect(createPage).not.toHaveBeenCalled();
  });

  it("keeps the dialog open with the server's reason when a create is refused", async () => {
    createPage.mockRejectedValue(new Refused("You can't create pages."));
    mount();
    await screen.findByText("Saved as a draft.");
    await userEvent.type(
      screen.getByRole("textbox", { name: "Title" }),
      "Pricing{Enter}"
    );
    expect((await screen.findByRole("alert")).textContent).toBe(
      "You can't create pages."
    );
    expect(onCreated).not.toHaveBeenCalled();
    expect(
      (screen.getByRole("textbox", { name: "Title" }) as HTMLInputElement).value
    ).toBe("Pricing");
  });

  it("names a required field it doesn't ask for with the server's words, and offers the form", async () => {
    createPage.mockRejectedValue(
      new Refused("Validation failed.", [
        { path: "category", code: "REQUIRED", message: "Category is required" },
      ])
    );
    mount();
    await screen.findByText("Saved as a draft.");
    await userEvent.type(
      screen.getByRole("textbox", { name: "Title" }),
      "Launch{Enter}"
    );
    const needed = await screen.findByText("This page also needs:");
    const box = needed.closest(
      "[data-slot=new-page-also-needed]"
    ) as HTMLElement;
    expect(within(box).getByText("Category")).toBeTruthy();
    expect(within(box).getByText("Category is required")).toBeTruthy();
    await userEvent.click(
      within(box).getByRole("button", { name: "Open the form" })
    );
    expect(navigateTo).toHaveBeenCalledWith("/admin/collections/pages/create");
  });

  it("says Create, not Create and open builder, for an author who may not change what they make", async () => {
    facts = query => pagesFacts(query, { mayUpdate: false });
    mount();
    expect(await screen.findByRole("button", { name: "Create" })).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Create and open builder" })
    ).toBeNull();
  });

  it("closes on Cancel without creating", async () => {
    mount();
    await userEvent.type(screen.getByRole("textbox", { name: "Title" }), "A");
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalled();
    expect(createPage).not.toHaveBeenCalled();
  });
});

describe("unsaved work on the page on screen", () => {
  function unsaved(answer: "saved" | "discard" | "keep") {
    const order: string[] = [];
    createPage.mockImplementation(async () => {
      order.push("create");
      return made();
    });
    onCreated.mockImplementation(() => order.push("open"));
    return {
      order,
      ask: {
        ask: vi.fn(async () => {
          order.push("ask");
          return answer;
        }),
        leaveWithoutWarning: vi.fn(() => order.push("leave without warning")),
      },
    };
  }

  async function press() {
    await screen.findByText("Saved as a draft.");
    await userEvent.type(
      screen.getByRole("textbox", { name: "Title" }),
      "Pricing{Enter}"
    );
  }

  it("makes nothing on Keep editing", async () => {
    const { order, ask } = unsaved("keep");
    mount({ unsaved: ask });
    await press();
    await waitFor(() => expect(ask.ask).toHaveBeenCalled());
    expect(order).toEqual(["ask"]);
    expect(createPage).not.toHaveBeenCalled();
  });

  it("creates once the page is saved", async () => {
    const { order, ask } = unsaved("saved");
    mount({ unsaved: ask });
    await press();
    await waitFor(() => expect(order).toEqual(["ask", "create", "open"]));
  });

  it("on Discard creates first, and only then lets the move go unasked", async () => {
    const { order, ask } = unsaved("discard");
    mount({ unsaved: ask });
    await press();
    await waitFor(() =>
      expect(order).toEqual(["ask", "create", "leave without warning", "open"])
    );
  });

  it("on Discard keeps the page on screen as it was when the create fails", async () => {
    const { order, ask } = unsaved("discard");
    createPage.mockImplementation(async () => {
      order.push("create");
      throw new Refused("The server is busy.");
    });
    mount({ unsaved: ask });
    await press();
    expect((await screen.findByRole("alert")).textContent).toBe(
      "The server is busy."
    );
    expect(order).toEqual(["ask", "create"]);
    expect(ask.leaveWithoutWarning).not.toHaveBeenCalled();
  });
});
