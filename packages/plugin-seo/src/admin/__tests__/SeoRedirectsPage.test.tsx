// @vitest-environment jsdom

/**
 * The redirects screen as a person uses it. On Redirects: each redirect with
 * the status the server answers, who made it and how often it is used; the
 * note that they are saved but not served where the Proxy does not run; a
 * redirect added, edited, made Gone (with no To) or removed through its
 * dialog or row menu; a refusal with the way to the redirect already there;
 * and a CSV file imported only once its dry run is clean. On Not found: the
 * addresses with where visitors came from, narrowed by when they were last
 * asked for, Ignore and Show ignored, and Redirect opening the form filled
 * in. What each write sends is read from the write itself.
 *
 * The lists are drawn as a table and, for a narrow screen, as cards, both in
 * the document; the table is read here.
 */
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@nextlyhq/plugin-sdk/admin", async importOriginal => ({
  ...(await importOriginal<typeof import("@nextlyhq/plugin-sdk/admin")>()),
  usePluginRoute: vi.fn(),
  writePluginRoute: vi.fn(),
  toastMutationResult: vi.fn(),
  navigateTo: vi.fn(),
}));

import {
  toastMutationResult,
  usePluginRoute,
  writePluginRoute,
} from "@nextlyhq/plugin-sdk/admin";

import { PROXY_WIRING_NOTE } from "../../problems/site-checks";
import {
  newRedirectHref,
  REDIRECTS_PAGE_HREF,
  type ImportResult,
  type NotFoundView,
  type ProxyStatus,
  type RedirectView,
} from "../../redirects/contract";
import {
  madeBy,
  redirectAskedFor,
  SeoRedirectsPage,
  shownNotFound,
} from "../SeoRedirectsPage";

const NOW = Date.parse("2026-11-12T12:00:00.000Z");
const hoursAgo = (hours: number) =>
  new Date(NOW - hours * 3_600_000).toISOString();

const AUTO: RedirectView = {
  id: "r1",
  from: "/testimonial",
  to: "/customers",
  type: "permanent",
  origin: "automatic",
  addedBy: null,
  byYou: false,
  addedAt: hoursAgo(500),
  hits: 12,
  lastHit: hoursAgo(2),
};
const MINE: RedirectView = {
  id: "r2",
  from: "/webinar",
  to: "/events/spring-webinar",
  type: "temporary",
  origin: "person",
  addedBy: "Sara Khan",
  byYou: true,
  addedAt: hoursAgo(300),
  hits: 0,
  lastHit: null,
};
const GONE: RedirectView = {
  id: "r3",
  from: "/use-cases/personas",
  to: "",
  type: "gone",
  origin: "import",
  addedBy: "Sara Khan",
  byYou: true,
  addedAt: hoursAgo(200),
  hits: 3,
  lastHit: hoursAgo(30),
};
const MISSING: NotFoundView = {
  id: "n1",
  path: "/pricing-plans",
  from: "/pricing-plans",
  hits: 17,
  lastSeen: hoursAgo(3),
  kind: "missing",
  suggestion: "/pricing",
  cameFrom: "news.example.com",
  ignored: false,
};
const OLD: NotFoundView = {
  ...MISSING,
  id: "n2",
  path: "/2019/launch",
  from: "/2019/launch",
  hits: 4,
  lastSeen: hoursAgo(24 * 40),
  suggestion: null,
  cameFrom: null,
};
const IGNORED: NotFoundView = {
  ...MISSING,
  id: "n3",
  path: "/old-feed.xml",
  from: "/old-feed.xml",
  hits: 9,
  lastSeen: hoursAgo(1),
  cameFrom: "/blog",
  ignored: true,
};

/** What the fake server answers each read with. */
let reads: {
  redirects: RedirectView[];
  notFound: NotFoundView[];
  proxy: ProxyStatus;
};
/** Every write the screen made, in order. */
let writes: { path: string; method?: string; body?: unknown }[];
/** How the fake server answers a write. */
let answer: (request: {
  path: string;
  method?: string;
  body?: unknown;
}) => unknown;

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
  // jsdom implements neither pointer capture nor scrollIntoView, and the
  // admin's Select and menus open through both.
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
  writes = [];
  answer = () => ({ message: "Done.", item: {} });
  reads = {
    redirects: [AUTO, MINE, GONE],
    notFound: [MISSING, OLD, IGNORED],
    proxy: { state: "running", lastSeen: hoursAgo(1) },
  };
  vi.mocked(usePluginRoute).mockImplementation(((args: { path: string }) => {
    const data =
      args.path === "/not-found"
        ? { items: reads.notFound }
        : args.path === "/proxy-status"
          ? reads.proxy
          : { items: reads.redirects };
    return { data, pending: false, error: null, refetch: vi.fn() };
  }) as unknown as typeof usePluginRoute);
  vi.mocked(writePluginRoute).mockImplementation((async (request: {
    path: string;
    method?: string;
    body?: unknown;
  }) => {
    writes.push({
      path: request.path,
      method: request.method,
      body: request.body,
    });
    const result = answer(request);
    if (result instanceof Error) throw result;
    return result;
  }) as unknown as typeof writePluginRoute);
  vi.mocked(toastMutationResult).mockClear();
});

afterEach(() => {
  vi.useRealTimers();
  window.history.replaceState(null, "", "/");
});

/** The table's rows, each as the text of its cells. */
function tableRows(): string[][] {
  const table = screen.getByRole("table");
  return within(table)
    .getAllByRole("row")
    .filter(row => row.querySelector("td") !== null)
    .map(row =>
      [...row.querySelectorAll("td")]
        .map(cell => cell.textContent?.trim() ?? "")
        .filter(text => text !== "")
    );
}

/** The table's row holding `text`. */
function rowWith(text: string): HTMLElement {
  const row = within(screen.getByRole("table")).getByText(text).closest("tr");
  if (row === null) throw new Error(`No row holds ${text}`);
  return row;
}

/** Opens the Not found tab, as its address does. */
function onNotFound() {
  window.history.replaceState(
    null,
    "",
    "/admin/plugins/nextlyhq-plugin-seo/redirects?tab=notfound"
  );
}

describe("the Redirects tab", () => {
  it("lists each redirect with the status served, who made it and its hits", () => {
    render(<SeoRedirectsPage />);
    expect(tableRows()).toEqual([
      ["/testimonial", "/customers", "301", "Page moved", "12", "2 hours ago"],
      ["/webinar", "/events/spring-webinar", "302", "You", "—", "—"],
      ["/use-cases/personas", "—", "410 Gone", "Imported", "3", "Yesterday"],
    ]);
    // Each tab says how many it holds; ignored addresses are not counted.
    const tabs = screen.getByRole("navigation", { name: "Redirects" });
    expect(
      within(tabs).getByRole("link", { name: "Redirects 3" })
    ).toBeTruthy();
    expect(
      within(tabs).getByRole("link", { name: "Not found 2" })
    ).toBeTruthy();
  });

  it("names who made a redirect: a page's move, a file, you, or the person", () => {
    expect(madeBy(AUTO)).toBe("Page moved");
    expect(madeBy(GONE)).toBe("Imported");
    expect(madeBy(MINE)).toBe("You");
    expect(madeBy({ ...MINE, byYou: false })).toBe("Sara Khan");
  });

  it("says redirects are saved but not served where the Proxy never ran, with the note to copy", async () => {
    reads.proxy = { state: "not-wired", lastSeen: null };
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn(async () => undefined) },
      configurable: true,
    });
    render(<SeoRedirectsPage />);
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain(
      "These redirects are saved but not served"
    );
    fireEvent.click(
      within(alert).getByRole("button", { name: "Copy a note for a developer" })
    );
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      PROXY_WIRING_NOTE
    );
  });

  it("says nothing of the Proxy where it runs, or where no redirect is saved", () => {
    render(<SeoRedirectsPage />);
    expect(screen.queryByRole("alert")).toBeNull();
    reads.proxy = { state: "not-wired", lastSeen: null };
    reads.redirects = [];
    render(<SeoRedirectsPage />);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("adds a redirect from its dialog, and says what was done", async () => {
    answer = () => ({
      message: "Added. It works from the next visit.",
      item: {},
    });
    render(<SeoRedirectsPage />);
    fireEvent.click(screen.getByRole("button", { name: "Add redirect" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("From"), {
      target: { value: "/old" },
    });
    fireEvent.change(within(dialog).getByLabelText("To"), {
      target: { value: "/new" },
    });
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Add redirect" })
    );
    await waitFor(() =>
      expect(toastMutationResult).toHaveBeenCalledWith(
        "Added. It works from the next visit.",
        undefined
      )
    );
    expect(writes).toEqual([
      {
        path: "/redirects",
        method: "POST",
        body: { from: "/old", to: "/new", type: "permanent" },
      },
    ]);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("adds an address as Gone, asking for no To", async () => {
    const user = userEvent.setup({ advanceTimers: () => undefined });
    render(<SeoRedirectsPage />);
    await user.click(screen.getByRole("button", { name: "Add redirect" }));
    const dialog = screen.getByRole("dialog");
    await user.type(within(dialog).getByLabelText("From"), "/retired");
    await user.click(within(dialog).getByRole("combobox", { name: "Type" }));
    await user.click(screen.getByRole("option", { name: "Gone (410)" }));
    expect(within(dialog).queryByLabelText("To")).toBeNull();
    await user.click(
      within(dialog).getByRole("button", { name: "Add redirect" })
    );
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]?.body).toEqual({ from: "/retired", to: "", type: "gone" });
  });

  it("shows a refusal as the server says it, with the way to the redirect already there", async () => {
    answer = () =>
      Object.assign(
        new Error(
          "/webinar already has a redirect. Remove it first, or edit it in the list."
        ),
        { status: 409 }
      );
    render(<SeoRedirectsPage />);
    fireEvent.click(screen.getByRole("button", { name: "Add redirect" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("From"), {
      target: { value: "/webinar" },
    });
    fireEvent.change(within(dialog).getByLabelText("To"), {
      target: { value: "/elsewhere" },
    });
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Add redirect" })
    );
    const refusal = await within(dialog).findByRole("alert");
    expect(refusal.textContent).toContain("/webinar already has a redirect.");
    fireEvent.click(
      within(refusal).getByRole("button", { name: "Edit that redirect" })
    );
    // The form now edits the redirect already there, its From kept.
    const editing = screen.getByRole("dialog");
    expect(within(editing).getByText("Edit redirect")).toBeTruthy();
    expect(
      (within(editing).getByLabelText("To") as HTMLInputElement).value
    ).toBe("/events/spring-webinar");
  });

  it("edits a redirect from its row menu, sending its To and type", async () => {
    const user = userEvent.setup({ advanceTimers: () => undefined });
    render(<SeoRedirectsPage />);
    await user.click(
      within(rowWith("/testimonial")).getByRole("button", { name: /actions/i })
    );
    await user.click(screen.getByRole("menuitem", { name: "Edit" }));
    const dialog = screen.getByRole("dialog");
    const toField = within(dialog).getByLabelText("To");
    await user.clear(toField);
    await user.type(toField, "/clients");
    await user.click(
      within(dialog).getByRole("button", { name: "Save redirect" })
    );
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]).toEqual({
      path: "/redirects/r1",
      method: "PATCH",
      body: { to: "/clients", type: "permanent" },
    });
  });

  it("removes a redirect from its row menu", async () => {
    const user = userEvent.setup({ advanceTimers: () => undefined });
    render(<SeoRedirectsPage />);
    await user.click(
      within(rowWith("/webinar")).getByRole("button", { name: /actions/i })
    );
    await user.click(screen.getByRole("menuitem", { name: "Remove" }));
    await waitFor(() =>
      expect(writes).toEqual([
        { path: "/redirects/r2", method: "DELETE", body: undefined },
      ])
    );
  });

  it("shows a file's dry run, imports nothing while a row is refused, and imports a clean file", async () => {
    const refused: ImportResult = {
      applied: false,
      rows: [
        {
          line: 1,
          from: "/old-blog/*",
          to: "/blog/*",
          kind: "new",
          says: "New pattern: every old address goes to the same place under the new one.",
        },
        {
          line: 2,
          from: "/customers",
          to: "/testimonial",
          kind: "refused",
          refusal: "loop",
          says: "Loop: /customers → /testimonial → /customers.",
        },
      ],
    };
    answer = () => ({ message: "2 rows read.", item: refused });
    render(<SeoRedirectsPage />);
    const input = document.querySelector(
      'input[type="file"]'
    ) as HTMLInputElement;
    fireEvent.change(input, {
      target: { files: [new File(["x"], "redirects.csv")] },
    });
    const dialog = await screen.findByRole("dialog", {
      name: "Import redirects.csv",
    });
    expect(
      within(dialog).getByText("Loop: /customers → /testimonial → /customers.")
    ).toBeTruthy();
    expect(
      (
        within(dialog).getByRole("button", {
          name: "Import 1 redirect",
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true);

    const clean: ImportResult = {
      applied: false,
      rows: [refused.rows[0] as ImportResult["rows"][number]],
    };
    answer = request =>
      (request.body as { apply?: boolean }).apply === true
        ? {
            message: "Imported 1 redirect in one step",
            item: { ...clean, applied: true },
          }
        : { message: "1 row read.", item: clean };
    fireEvent.change(input, {
      target: { files: [new File(["/old-blog/*,/blog/*"], "fixed.csv")] },
    });
    const fixed = await screen.findByRole("dialog", {
      name: "Import fixed.csv",
    });
    fireEvent.click(
      within(fixed).getByRole("button", { name: "Import 1 redirect" })
    );
    await waitFor(() =>
      expect(toastMutationResult).toHaveBeenCalledWith(
        "Imported 1 redirect in one step",
        undefined
      )
    );
    expect(writes.at(-1)?.body).toEqual({
      file: "/old-blog/*,/blog/*",
      apply: true,
    });
  });
});

describe("the Not found tab", () => {
  it("lists the addresses asked for in the last week, with where visitors came from", () => {
    onNotFound();
    render(<SeoRedirectsPage />);
    expect(tableRows()).toEqual([
      [
        "/pricing-plans",
        "17",
        "3 hours ago",
        "news.example.com",
        "RedirectIgnore",
      ],
    ]);
    expect(
      screen.getByText(/Bots probing for admin pages of other systems/)
    ).toBeTruthy();
  });

  it("narrows by when an address was last asked for, and shows ignored ones when asked", () => {
    const at = NOW;
    expect(shownNotFound(reads.notFound, "7", false, at)).toEqual([MISSING]);
    expect(shownNotFound(reads.notFound, "all", false, at)).toEqual([
      MISSING,
      OLD,
    ]);
    expect(shownNotFound(reads.notFound, "1", true, at)).toEqual([
      MISSING,
      IGNORED,
    ]);
  });

  it("says Direct where no page sent the visitor", () => {
    onNotFound();
    reads.notFound = [{ ...MISSING, cameFrom: null }];
    render(<SeoRedirectsPage />);
    expect(tableRows()[0]?.[3]).toBe("Direct");
  });

  it("ignores an address, and lists it again from Show ignored", async () => {
    onNotFound();
    answer = () => ({ message: "Ignored /pricing-plans.", item: {} });
    render(<SeoRedirectsPage />);
    fireEvent.click(
      within(rowWith("/pricing-plans")).getByRole("button", {
        name: "Ignore /pricing-plans",
      })
    );
    await waitFor(() =>
      expect(writes).toEqual([
        { path: "/not-found/n1", method: "PATCH", body: { ignored: true } },
      ])
    );
    fireEvent.click(screen.getByRole("checkbox", { name: "Show ignored" }));
    fireEvent.click(
      within(rowWith("/old-feed.xml")).getByRole("button", {
        name: "Show again /old-feed.xml",
      })
    );
    await waitFor(() => expect(writes).toHaveLength(2));
    expect(writes[1]).toEqual({
      path: "/not-found/n3",
      method: "PATCH",
      body: { ignored: false },
    });
  });

  it("opens a redirect from an address, its To the closest live page", async () => {
    onNotFound();
    render(<SeoRedirectsPage />);
    fireEvent.click(
      within(rowWith("/pricing-plans")).getByRole("button", {
        name: "Redirect /pricing-plans",
      })
    );
    const dialog = screen.getByRole("dialog");
    expect(
      (within(dialog).getByLabelText("From") as HTMLInputElement).value
    ).toBe("/pricing-plans");
    expect(
      (within(dialog).getByLabelText("To") as HTMLInputElement).value
    ).toBe("/pricing");
    expect(
      within(dialog).getByText(
        "Suggested: /pricing, the closest live page. Change it if it's wrong."
      )
    ).toBeTruthy();
    // What is left to type, the To address, has the focus.
    await waitFor(() =>
      expect(document.activeElement).toBe(within(dialog).getByLabelText("To"))
    );
  });
});

describe("a link asking for a new redirect", () => {
  it("reads From and the suggested To from the address", () => {
    expect(redirectAskedFor("?from=%2Fold&to=%2Fnew")).toEqual({
      from: "/old",
      suggestion: "/new",
    });
    expect(redirectAskedFor("?from=%2Fold")).toEqual({
      from: "/old",
      suggestion: null,
    });
    expect(redirectAskedFor("?tab=notfound")).toBeNull();
  });

  it("is read as every screen writes it, To or none", () => {
    const asked = (href: string) => {
      const url = new URL(href, "https://acme.example");
      expect(url.pathname).toBe(REDIRECTS_PAGE_HREF);
      return redirectAskedFor(url.search);
    };
    expect(asked(newRedirectHref("/old page?x=1", "/new"))).toEqual({
      from: "/old page?x=1",
      suggestion: "/new",
    });
    expect(asked(newRedirectHref("/old", null))).toEqual({
      from: "/old",
      suggestion: null,
    });
    expect(asked(newRedirectHref("/old"))).toEqual({
      from: "/old",
      suggestion: null,
    });
  });

  it("opens the form filled from it", () => {
    window.history.replaceState(
      null,
      "",
      "/admin/plugins/nextlyhq-plugin-seo/redirects?from=%2Fgone&to=%2Fhere"
    );
    render(<SeoRedirectsPage />);
    const dialog = screen.getByRole("dialog");
    expect(
      (within(dialog).getByLabelText("From") as HTMLInputElement).value
    ).toBe("/gone");
    expect(
      (within(dialog).getByLabelText("To") as HTMLInputElement).value
    ).toBe("/here");
  });
});
