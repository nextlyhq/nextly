// @vitest-environment jsdom

/**
 * Pages as a person uses it: the list with each page's title, description
 * and status read from the shared problem list, its search and filters and
 * each row's actions; a page built in code given its SEO in the side panel;
 * and Edit mode, typed straight into, saved one content type at a time and
 * saying which pages a save that stopped part-way left unsaved. What each
 * write sends is read from the write itself.
 */
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@nextlyhq/plugin-sdk/admin", async importOriginal => ({
  ...(await importOriginal<typeof import("@nextlyhq/plugin-sdk/admin")>()),
  usePluginRoute: vi.fn(),
  usePluginRouteMutation: vi.fn(),
  readPluginRoute: vi.fn(),
  writePluginRoute: vi.fn(),
  useMediaItem: vi.fn(() => ({ data: undefined })),
  MediaPickerDialog: () => null,
  toastMutationResult: vi.fn(),
  navigateTo: vi.fn(),
}));

import {
  navigateTo,
  readPluginRoute,
  toastMutationResult,
  usePluginRoute,
  usePluginRouteMutation,
  writePluginRoute,
} from "@nextlyhq/plugin-sdk/admin";

import type { BulkRow } from "../../bulk/contract";
import type { SiteAddress } from "../../code-pages/contract";
import type { Problem, ProblemListBody } from "../../problems/contract";
import { SeoPagesPage } from "../SeoPagesPage";

const ITEMS: SiteAddress[] = [
  {
    path: "/",
    name: "Home",
    source: "entry",
    from: "Pages",
    standing: "listed",
    title: "Acme | Acme",
    titlePattern: "{Title} | {Site name}",
    description: "Acme makes things.",
    sources: { title: "pattern", description: "site" },
    canonical: "https://acme.example/",
    entry: { kind: "collection", slug: "pages", id: "7" },
  },
  {
    path: "/blog",
    name: "Blog",
    source: "entry",
    from: "Pages",
    standing: "listed",
    title: "Blog | Acme",
    sources: { title: "page" },
    canonical: "https://acme.example/blog",
    entry: { kind: "collection", slug: "pages", id: "8" },
  },
  {
    path: "/pricing",
    name: "Pricing",
    source: "built",
    from: "app/pricing/page.tsx",
    standing: "not-connected",
    sources: { title: "pattern" },
    canonical: "https://acme.example/pricing",
    seo: {
      typed: { hidden: false },
      automatic: {
        title: {
          value: "Pricing | Acme",
          from: "pattern",
          pattern: "{Title} | {Site name}",
        },
      },
      siteName: "Acme",
    },
  },
  {
    path: "/contact",
    name: "Contact",
    source: "built",
    from: "app/contact/page.tsx",
    standing: "listed",
    sources: {},
    canonical: "https://acme.example/contact",
    seo: { typed: { hidden: false }, automatic: {}, siteName: "Acme" },
  },
  {
    path: "/about",
    name: "About",
    source: "built",
    from: "app/about/page.tsx",
    standing: "listed",
    sources: {},
    canonical: "https://acme.example/about",
    seo: {
      typed: { hidden: false, image: "m1" },
      automatic: {
        image: { url: "https://cdn.example/route.png", from: "code" },
      },
      image: { url: "https://cdn.example/own.png", from: "page" },
      siteName: "Acme",
    },
  },
];

/** A warning about the Blog page, from the shared problem list. */
const BLOG_WARNING: Problem = {
  kind: "noDescription",
  subject: { label: "Blog", type: "pages", id: "8", detail: "/blog" },
  what: "No description",
  action: "Add a description",
  fix: { place: "page", tab: "seo", field: "metaDescription" },
};

const PROBLEMS: ProblemListBody = {
  problems: [BLOG_WARNING],
  checkedAt: "2026-11-12T18:00:00Z",
  pagesChecked: 2,
  outOfDate: false,
  due: false,
};

const ROWS: BulkRow[] = [
  {
    id: "7",
    label: "Home",
    path: "/",
    title: "",
    description: "",
    autoTitle: "Acme | Acme",
    rev: "r7",
    editable: true,
  },
  {
    id: "8",
    label: "Blog",
    path: "/blog",
    title: "Blog | Acme",
    description: "",
    autoTitle: "Blog | Acme",
    rev: "r8",
    editable: true,
  },
];

/** Every body a panel save sent, in order. */
let sent: unknown[];
/** Every write Edit mode sent, in order. */
let writes: { path: string; body?: unknown }[];
/** The list the addresses route answers: replaced to model a read after a save. */
let listed: SiteAddress[];
/** Whether the addresses route is being read: true while a read runs. */
let fetching: boolean;

beforeEach(() => {
  listed = ITEMS;
  fetching = false;
  sent = [];
  writes = [];
  vi.mocked(usePluginRoute).mockImplementation(((args: { path: string }) => ({
    data: args.path === "/problems" ? PROBLEMS : { items: listed },
    pending: false,
    error: null,
    refetch: () => {},
    fetching: args.path === "/problems" ? false : fetching,
  })) as unknown as typeof usePluginRoute);
  vi.mocked(usePluginRouteMutation).mockImplementation(((args: {
    path: string;
  }) => ({
    write: vi.fn(async (body: unknown) => {
      // The problem list checked again after a save answers the list.
      if (args.path === "/problems/check") {
        return { ...PROBLEMS, message: "Checked." };
      }
      sent.push(body);
      return { path: "/pricing" };
    }),
    pending: false,
    error: null,
  })) as unknown as typeof usePluginRouteMutation);
  vi.mocked(readPluginRoute).mockImplementation((async () => ({
    type: "pages",
    rows: ROWS,
    total: 2,
    more: false,
  })) as unknown as typeof readPluginRoute);
  vi.mocked(writePluginRoute).mockImplementation((async (request: {
    path: string;
    body?: unknown;
  }) => {
    writes.push({ path: request.path, body: request.body });
    return { message: "Saved.", saved: 1, revs: {} };
  }) as unknown as typeof writePluginRoute);
});

/** The desktop table: both the table and the cards are drawn in jsdom. */
const table = () => within(screen.getByRole("table"));

/** The row of the page named `name`. */
const rowOf = (name: string) => {
  const cell = table().getByText(name);
  const row = cell.closest("tr");
  if (row === null) throw new Error(`no row for ${name}`);
  return within(row);
};

/** Chooses `action` from the menu of the row of the page named `name`. */
async function rowAction(name: string, action: string): Promise<void> {
  const user = userEvent.setup();
  await user.click(rowOf(name).getByRole("button", { name: "Row actions" }));
  await user.click(await screen.findByRole("menuitem", { name: action }));
}

/** Opens the side panel of the page built in code named `name`. */
const editSeo = (name: string) => rowAction(name, "Edit SEO");

describe("the list", () => {
  it("leads to Import, which is reached from here", () => {
    render(<SeoPagesPage />);
    expect(
      screen.getByRole("link", { name: "Import" }).getAttribute("href")
    ).toBe("/admin/plugins/nextlyhq-plugin-seo/pages/import");
  });

  it("shows each page's title, where it comes from, its description and its status", () => {
    render(<SeoPagesPage />);
    const home = rowOf("Home");
    expect(home.getByText("Acme | Acme")).toBeTruthy();
    expect(home.getByText("Pattern: {Title} | {Site name}")).toBeTruthy();
    expect(home.getByText("Acme makes things.")).toBeTruthy();
    expect(home.getByText("Good")).toBeTruthy();
    // The shared problem list's warning about the Blog page is its status.
    expect(rowOf("Blog").getByText("Warning")).toBeTruthy();
    expect(rowOf("Blog").getByText("Own value")).toBeTruthy();
    expect(rowOf("Pricing").getByText("Not connected")).toBeTruthy();
    expect(screen.getByText("5 pages")).toBeTruthy();
  });

  it("says each status is unknown, and why, where the problem list can't be read", () => {
    vi.mocked(usePluginRoute).mockImplementation(((args: { path: string }) =>
      args.path === "/problems"
        ? {
            data: undefined,
            pending: false,
            error: new Error("The problem list is down."),
            refetch: () => {},
            fetching: false,
          }
        : {
            data: { items: ITEMS },
            pending: false,
            error: null,
            refetch: () => {},
            fetching: false,
          }) as unknown as typeof usePluginRoute);
    render(<SeoPagesPage />);
    expect(screen.getByRole("alert").textContent).toContain(
      "The problem list is down."
    );
    expect(table().queryByText("Good")).toBeNull();
    expect(rowOf("Home").getByText("Not checked")).toBeTruthy();
  });

  it("says no status is known while the site has never been checked, and why a first check failed", () => {
    vi.mocked(usePluginRoute).mockImplementation(((args: { path: string }) => ({
      data:
        args.path === "/problems"
          ? { problems: [], pagesChecked: 0, outOfDate: false, due: true }
          : { items: listed },
      pending: false,
      error: null,
      refetch: () => {},
      fetching: false,
    })) as unknown as typeof usePluginRoute);
    vi.mocked(usePluginRouteMutation).mockImplementation((() => ({
      write: vi.fn(async () => undefined),
      pending: false,
      error: new Error("The check couldn't run."),
    })) as unknown as typeof usePluginRouteMutation);
    render(<SeoPagesPage />);
    expect(table().queryByText("Good")).toBeNull();
    expect(rowOf("Home").getByText("Not checked")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain(
      "The check couldn't run."
    );
  });

  it("finds a page by part of its address or name", async () => {
    render(<SeoPagesPage />);
    fireEvent.change(screen.getByPlaceholderText("Search pages"), {
      target: { value: "pric" },
    });
    // The admin's search field waits for typing to pause.
    await vi.waitFor(() => expect(table().queryByText("Home")).toBeNull());
    expect(table().getByText("Pricing")).toBeTruthy();
    expect(screen.getByText("1 page")).toBeTruthy();
  });

  it("opens an entry's SEO tab, inspects a page and adds a redirect from it", async () => {
    render(<SeoPagesPage />);
    await rowAction("Home", "Edit SEO");
    expect(navigateTo).toHaveBeenLastCalledWith(
      "/admin/collections/pages/7?tab=nextlyhq-plugin-seo.tab"
    );
    await rowAction("Home", "Inspect what search engines receive");
    expect(navigateTo).toHaveBeenLastCalledWith(
      "/admin/plugins/nextlyhq-plugin-seo/pages/inspect?address=%2F"
    );
    await rowAction("Blog", "Add a redirect");
    expect(navigateTo).toHaveBeenLastCalledWith(
      "/admin/plugins/nextlyhq-plugin-seo/redirects?from=%2Fblog"
    );
    await rowAction("Blog", "Open entry");
    expect(navigateTo).toHaveBeenLastCalledWith("/admin/collections/pages/8");
  });

  it("opens a translation's entry in its own language", async () => {
    vi.mocked(usePluginRoute).mockImplementation(((args: { path: string }) => ({
      data:
        args.path === "/problems"
          ? PROBLEMS
          : {
              items: [
                {
                  path: "/de/ueber",
                  name: "Über uns",
                  source: "entry",
                  from: "Pages",
                  standing: "listed",
                  sources: {},
                  entry: {
                    kind: "collection",
                    slug: "pages",
                    id: "7",
                    locale: "de",
                  },
                },
              ],
            },
      pending: false,
      error: null,
      refetch: () => {},
      fetching: false,
    })) as unknown as typeof usePluginRoute);
    render(<SeoPagesPage />);
    await rowAction("Über uns", "Open entry");
    expect(navigateTo).toHaveBeenCalledWith(
      "/admin/collections/pages/7?locale=de"
    );
  });
});

describe("Edit mode", () => {
  const editMode = () =>
    fireEvent.click(
      screen.getByRole("radio", { name: "Edit titles and descriptions" })
    );

  it("types into a page's title, the automatic value in grey, and saves its type in one write", async () => {
    render(<SeoPagesPage />);
    editMode();
    const home = (await screen.findByLabelText(
      "Title for Home"
    )) as HTMLInputElement;
    expect(home.placeholder).toBe("Acme | Acme");
    expect(screen.getAllByText("Pattern: {Title} | {Site name}")).toBeTruthy();

    fireEvent.change(home, { target: { value: "Acme, the maker" } });
    expect(screen.getByText("15 characters · Good · changed")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("1 page changed");

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await vi.waitFor(() =>
      expect(toastMutationResult).toHaveBeenCalledWith("Saved 1 page.", [])
    );
    expect(writes).toEqual([
      {
        path: "/bulk/save",
        body: {
          type: "pages",
          changes: [{ id: "7", rev: "r7", title: "Acme, the maker" }],
        },
      },
    ]);
  });

  it("saves a page built in code through its own save, its visibility as it is", async () => {
    render(<SeoPagesPage />);
    editMode();
    fireEvent.change(await screen.findByLabelText("Title for Pricing"), {
      target: { value: "Plans" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await vi.waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]).toEqual({
      path: "/pages/seo",
      body: {
        path: "/pricing",
        title: "Plans",
        description: "",
        hidden: false,
      },
    });
  });

  it("lets a saved page built in code go once the list has been read again, though nothing in it changed", async () => {
    const { rerender } = render(<SeoPagesPage />);
    editMode();
    const pricing = (await screen.findByLabelText(
      "Title for Pricing"
    )) as HTMLInputElement;
    fireEvent.change(pricing, { target: { value: " " } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await vi.waitFor(() =>
      expect(toastMutationResult).toHaveBeenCalledWith("Saved 1 page.", [])
    );
    expect(pricing.readOnly).toBe(true);
    // The read after the save runs, and answers the list as it was.
    fetching = true;
    rerender(<SeoPagesPage />);
    fetching = false;
    rerender(<SeoPagesPage />);
    await vi.waitFor(() => expect(pricing.readOnly).toBe(false));
  });

  it("holds a saved page built in code until the list is read again with what it saved", async () => {
    const { rerender } = render(<SeoPagesPage />);
    editMode();
    const pricing = (await screen.findByLabelText(
      "Title for Pricing"
    )) as HTMLInputElement;
    fireEvent.change(pricing, { target: { value: "Plans" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await vi.waitFor(() =>
      expect(toastMutationResult).toHaveBeenCalledWith("Saved 1 page.", [])
    );
    // The list still holds the page as it was: its box stays as typed, and
    // locked, so nothing is sent over the save from the older values.
    expect(pricing.readOnly).toBe(true);
    expect(pricing.value).toBe("Plans");

    listed = ITEMS.map(item =>
      item.path === "/pricing" && item.seo !== undefined
        ? {
            ...item,
            seo: { ...item.seo, typed: { ...item.seo.typed, title: "Plans" } },
          }
        : item
    );
    fetching = true;
    rerender(<SeoPagesPage />);
    fetching = false;
    rerender(<SeoPagesPage />);
    await vi.waitFor(() => expect(pricing.readOnly).toBe(false));
    expect(pricing.value).toBe("Plans");
    expect(screen.queryByText(/page changed/)).toBeNull();
  });

  it("says which pages a save left unsaved, and keeps their changes", async () => {
    vi.mocked(writePluginRoute).mockImplementation((async (request: {
      path: string;
      body?: unknown;
    }) => {
      writes.push({ path: request.path, body: request.body });
      if (request.path === "/pages/seo") {
        throw new Error("The database didn't answer.");
      }
      return { message: "Saved.", saved: 1, revs: {} };
    }) as unknown as typeof writePluginRoute);
    render(<SeoPagesPage />);
    editMode();
    fireEvent.change(await screen.findByLabelText("Title for Home"), {
      target: { value: "Home of Acme" },
    });
    fireEvent.change(screen.getByLabelText("Title for Pricing"), {
      target: { value: "Plans" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("1 page saved, 1 page not");
    expect(alert.textContent).toContain("Pricing: The database didn't answer.");
    // The page not saved keeps its change; the one saved lets go of it.
    expect(
      (screen.getByLabelText("Title for Pricing") as HTMLInputElement).value
    ).toBe("Plans");
    expect(screen.getByRole("status").textContent).toContain("1 page changed");
  });

  it("discards every change without writing", async () => {
    render(<SeoPagesPage />);
    editMode();
    fireEvent.change(await screen.findByLabelText("Title for Home"), {
      target: { value: "Something" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(
      (screen.getByLabelText("Title for Home") as HTMLInputElement).value
    ).toBe("");
    expect(writes).toEqual([]);
  });

  it("shows a page the person may not change, and a translation, read-only with why", async () => {
    vi.mocked(readPluginRoute).mockImplementation((async () => ({
      type: "pages",
      rows: [{ ...ROWS[0], editable: false }, ROWS[1]],
      total: 2,
      more: false,
    })) as unknown as typeof readPluginRoute);
    render(<SeoPagesPage />);
    editMode();
    const home = (await screen.findByLabelText(
      "Title for Home"
    )) as HTMLInputElement;
    await vi.waitFor(() => expect(home.readOnly).toBe(true));
    expect(
      screen.getAllByText(
        "You can't change this page's SEO here. Open the page to change it."
      ).length
    ).toBeGreaterThan(0);
  });
});

describe("the panel of a page built in code", () => {
  it("says the route is not connected, previews what is typed and saves it", async () => {
    render(<SeoPagesPage />);
    await editSeo("Pricing");

    const panel = screen.getByRole("dialog", { name: "SEO for /pricing" });
    expect(
      within(panel).getByText(/doesn't call the SEO function yet/)
    ).toBeTruthy();
    // Nothing typed: the automatic title, shown in the preview.
    expect(within(panel).getByText("Pricing | Acme")).toBeTruthy();

    fireEvent.change(within(panel).getByLabelText("Title on Google"), {
      target: { value: "Plans and prices" },
    });
    expect(within(panel).getByText("Plans and prices")).toBeTruthy();
    expect(within(panel).getByText("Typed for this address")).toBeTruthy();

    fireEvent.click(within(panel).getByRole("button", { name: "Save" }));
    await vi.waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    expect(sent).toEqual([
      {
        path: "/pricing",
        title: "Plans and prices",
        description: "",
        hidden: false,
        image: null,
      },
    ]);
    expect(toastMutationResult).toHaveBeenCalledWith(
      "Saved for /pricing. It reaches the page once the route calls the SEO function.",
      undefined
    );
  });

  it("hides the page from search under Advanced, the preview saying so", async () => {
    render(<SeoPagesPage />);
    await editSeo("Contact");
    const panel = screen.getByRole("dialog", { name: "SEO for /contact" });
    expect(within(panel).getByText(/calls the SEO function, so/)).toBeTruthy();

    fireEvent.click(within(panel).getByRole("button", { name: /Advanced/ }));
    fireEvent.click(
      within(panel).getByRole("switch", { name: "Hide this page from search" })
    );

    expect(within(panel).getByText(/^Hidden from search/)).toBeTruthy();
    fireEvent.keyDown(panel, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("the share image of a page built in code", () => {
  it("falls back to the image the page gets automatically once its own is removed", async () => {
    render(<SeoPagesPage />);
    await editSeo("About");
    const panel = screen.getByRole("dialog", { name: "SEO for /about" });
    fireEvent.click(within(panel).getByRole("tab", { name: "When shared" }));
    fireEvent.click(within(panel).getByRole("button", { name: /Advanced/ }));

    fireEvent.click(within(panel).getByRole("button", { name: "Remove" }));

    expect(
      within(panel)
        .getByTestId("seo-share-card")
        .querySelector("img")
        ?.getAttribute("src")
    ).toBe("https://cdn.example/route.png");
    expect(
      within(panel).getByText("Uses the share image the route's code sets.")
    ).toBeTruthy();
  });
});

describe("while a save is on its way", () => {
  it("takes no edits, so what it sends is what the panel holds", async () => {
    vi.mocked(usePluginRouteMutation).mockImplementation(
      () =>
        ({
          write: vi.fn(),
          pending: true,
          error: null,
        }) as unknown as ReturnType<typeof usePluginRouteMutation>
    );
    render(<SeoPagesPage />);
    await editSeo("Pricing");
    const panel = screen.getByRole("dialog", { name: "SEO for /pricing" });

    // Disabled by the fieldset holding them, as a browser reads it.
    expect(
      within(panel).getByLabelText("Title on Google").matches(":disabled")
    ).toBe(true);
    expect(
      within(panel)
        .getByRole("switch", {
          name: "Hide this page from search",
          hidden: true,
        })
        .matches(":disabled")
    ).toBe(true);
  });
});
