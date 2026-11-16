// @vitest-environment jsdom

/**
 * The SEO section's Overview as a person uses it: the setup checklist with
 * each open item linked to where it is done, hidden and shown again; the
 * health verdict whose counts link to Problems narrowed to their severity and
 * equal the counts that list is counted by; page coverage as the Pages list
 * reads it; recent addresses not found, each with a Redirect that opens a
 * new redirect from it; and the connections, each read on its own so one
 * that fails leaves the rest of the page drawn.
 */
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@nextlyhq/plugin-sdk/admin", async importOriginal => ({
  ...(await importOriginal<typeof import("@nextlyhq/plugin-sdk/admin")>()),
  usePluginRoute: vi.fn(),
  usePluginRouteMutation: vi.fn(),
  toastMutationResult: vi.fn(),
  navigateTo: vi.fn(),
}));

import {
  navigateTo,
  usePluginRoute,
  usePluginRouteMutation,
} from "@nextlyhq/plugin-sdk/admin";

import type { SiteAddress } from "../../code-pages/contract";
import type { ConnectionsBody } from "../../connections/contract";
import type { ChecklistBody } from "../../overview/contract";
import {
  severityCounts,
  WHOLE_SITE,
  type Problem,
  type ProblemListBody,
} from "../../problems/contract";
import type { NotFoundView, ProxyStatus } from "../../redirects/contract";
import { SeoOverviewPage } from "../SeoOverviewPage";

const SECTION = "/admin/plugins/nextlyhq-plugin-seo";

/** A problem of `kind` on the page `id`, or of the whole site. */
function problem(kind: Problem["kind"], id?: string): Problem {
  return {
    kind,
    subject: id === undefined ? WHOLE_SITE : { type: "posts", id, label: id },
    what: "",
    action: "",
    fix: { place: "media" },
  };
}

const PROBLEMS: ProblemListBody = {
  site: "acme.example",
  checkedAt: new Date().toISOString(),
  pagesChecked: 12,
  outOfDate: false,
  due: false,
  // One error; a warning on two pages and one on a third; a notice on four
  // pages, one of them twice.
  problems: [
    problem("proxyNotWired"),
    problem("sharedDescription", "blog"),
    problem("sharedDescription", "community"),
    problem("shareImage", "home"),
    problem("longTitle", "a"),
    problem("longTitle", "b"),
    problem("longTitle", "c"),
    problem("longTitle", "d"),
    problem("longTitle", "d"),
  ],
};

const CHECKLIST: ChecklistBody = {
  setupWaiting: false,
  hidden: false,
  items: [
    { id: "site", done: true },
    { id: "patterns", done: true, types: 2 },
    { id: "shareImage", done: true },
    { id: "brand", done: true },
    { id: "import", done: false },
    { id: "searchConsole", done: false },
  ],
};

/** A listed page whose title and description come from `title` and `description`. */
function address(
  path: string,
  title: SiteAddress["sources"]["title"],
  description: SiteAddress["sources"]["description"],
  standing: SiteAddress["standing"] = "listed"
): SiteAddress {
  return {
    path,
    name: path,
    source: "entry",
    from: "Pages",
    standing,
    sources: { title, description },
  };
}

const PAGES: SiteAddress[] = [
  address("/", "page", "page"),
  address("/about", "code", "page"),
  address("/blog", "pattern", "content"),
  address("/pricing", "page", "site"),
  address("/drafts", "page", "page", "hidden"),
];

const NOW = Date.now();
const ago = (days: number) => new Date(NOW - days * 86_400_000).toISOString();

const NOT_FOUND: NotFoundView[] = [
  {
    id: "1",
    path: "/docs/install",
    from: "/docs/install",
    hits: 9,
    lastSeen: ago(1),
    kind: "missing",
    suggestion: "/docs/getting-started",
    cameFrom: null,
    ignored: false,
  },
  {
    id: "2",
    path: "/pricing-old",
    from: "/pricing-old",
    hits: 40,
    lastSeen: ago(20),
    kind: "missing",
    suggestion: null,
    cameFrom: null,
    ignored: false,
  },
];

const CONNECTIONS: ConnectionsBody = {
  searchConsole: { configured: true },
  indexNow: {
    switchedOn: true,
    last: { at: ago(0), result: "refused-key" },
  },
};

/** What each route answers, by its path; an Error is a failed read. */
let answers: Record<string, unknown>;
let write: ReturnType<typeof vi.fn>;
let check: ReturnType<typeof vi.fn>;

function serve(overrides: Record<string, unknown> = {}) {
  answers = {
    "/overview/checklist": CHECKLIST,
    "/problems": PROBLEMS,
    "/pages": { items: PAGES },
    "/not-found": { items: NOT_FOUND },
    "/connections": CONNECTIONS,
    "/proxy-status": { state: "running", lastSeen: ago(0) } as ProxyStatus,
    ...overrides,
  };
  vi.mocked(usePluginRoute).mockImplementation((({
    path,
  }: {
    path: string;
  }) => {
    const answer = answers[path];
    if (answer instanceof Error) {
      return { data: undefined, pending: false, error: answer };
    }
    // An earlier answer kept beside a refresh that failed.
    if (
      typeof answer === "object" &&
      answer !== null &&
      "stale" in answer &&
      "error" in answer
    ) {
      const { stale, error } = answer as { stale: unknown; error: Error };
      return { data: stale, pending: false, error };
    }
    return { data: answer, pending: false, error: null };
  }) as unknown as typeof usePluginRoute);
  write = vi.fn(async (body: { hidden: boolean }) => ({ ...body }));
  check = vi.fn(async () => ({ ...PROBLEMS, message: "Checked 12 pages." }));
  vi.mocked(usePluginRouteMutation).mockImplementation((({
    path,
  }: {
    path: string;
  }) => ({
    write: path === "/problems/check" ? check : write,
    pending: false,
    error: null,
  })) as unknown as typeof usePluginRouteMutation);
}

/** The card named `name`. */
const card = (name: string) => screen.getByRole("region", { name });

beforeEach(() => {
  vi.clearAllMocks();
  serve();
});

describe("SeoOverviewPage", () => {
  it("names the site by its production host", () => {
    render(<SeoOverviewPage />);
    expect(
      screen.getByText(
        "How acme.example shows up in search, and what to do next."
      )
    ).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Open pages" }).getAttribute("href")
    ).toBe(`${SECTION}/pages`);
  });

  it("shows the checklist's progress, each open item linking to where it is done", () => {
    render(<SeoOverviewPage />);
    const setup = card("Set up SEO");
    expect(within(setup).getByText("4 of 6 done")).toBeTruthy();
    const steps = within(setup).getAllByRole("listitem");
    expect(steps.map(step => step.getAttribute("data-status"))).toEqual([
      "done",
      "done",
      "done",
      "done",
      "open",
      "open",
    ]);
    expect(
      within(setup).getByRole("link", { name: "Import" }).getAttribute("href")
    ).toBe(`${SECTION}/pages/import`);
    const connect = within(setup).getByRole("link", { name: "Connect" });
    expect(connect.getAttribute("href")).toBe(
      `${SECTION}/settings?tab=connections`
    );
    // A done item offers nothing to do.
    expect(within(setup).queryByRole("link", { name: "Name it" })).toBeNull();
    fireEvent.click(connect);
    expect(navigateTo).toHaveBeenCalledWith(
      `${SECTION}/settings?tab=connections`
    );
  });

  it("hides the checklist through its route, and shows it again from the header with its progress", async () => {
    const shown = render(<SeoOverviewPage />);
    // No way back is offered while the checklist shows.
    expect(screen.queryByRole("button", { name: /^Show setup/ })).toBeNull();
    fireEvent.click(
      within(card("Set up SEO")).getByRole("button", { name: "Hide" })
    );
    await vi.waitFor(() =>
      expect(write).toHaveBeenCalledWith({ hidden: true })
    );
    shown.unmount();

    serve({ "/overview/checklist": { ...CHECKLIST, hidden: true } });
    render(<SeoOverviewPage />);
    expect(screen.queryByRole("region", { name: "Set up SEO" })).toBeNull();
    const back = screen.getByRole("button", { name: "Show setup · 4 of 6" });
    // Beside Open pages, in the page's header.
    expect(back.closest("header")).toBe(
      screen.getByRole("link", { name: "Open pages" }).closest("header")
    );
    fireEvent.click(back);
    await vi.waitFor(() =>
      expect(write).toHaveBeenCalledWith({ hidden: false })
    );
  });

  it("offers no way back to a hidden checklist once every step is done", () => {
    serve({
      "/overview/checklist": {
        ...CHECKLIST,
        hidden: true,
        items: CHECKLIST.items.map(item => ({ ...item, done: true })),
      },
    });
    render(<SeoOverviewPage />);
    expect(screen.queryByRole("button", { name: /^Show setup/ })).toBeNull();
    expect(screen.queryByRole("region", { name: "Set up SEO" })).toBeNull();
  });

  it("draws each connection's state as connected, not connected or failing", () => {
    serve({
      "/connections": {
        searchConsole: {
          configured: true,
          connected: { email: "sara@acme.example" },
        },
        indexNow: { switchedOn: false },
      } satisfies ConnectionsBody,
      "/proxy-status": { state: "quiet", lastSeen: ago(30) },
    });
    render(<SeoOverviewPage />);
    const connections = card("Connections");
    expect(
      within(connections).getByRole("link", { name: "Connected" })
    ).toBeTruthy();
    expect(
      within(connections).getByRole("link", { name: "Not connected" })
    ).toBeTruthy();
    expect(
      within(connections)
        .getByRole("link", { name: "Failing · not running" })
        .getAttribute("href")
    ).toBe(`${SECTION}/redirects`);
  });

  it("gives the health verdict, each count equal to the list's and linking to it narrowed", () => {
    render(<SeoOverviewPage />);
    const health = card("Search health");
    expect(within(health).getByText("Should improve")).toBeTruthy();
    const expected = severityCounts(PROBLEMS.problems);
    expect(expected).toEqual({ error: 1, warning: 3, notice: 4 });
    for (const [name, severity] of [
      ["Errors", "error"],
      ["Warnings", "warning"],
      ["Notices", "notice"],
    ] as const) {
      const link = within(health).getByRole("link", { name });
      expect(link.getAttribute("href")).toBe(
        `${SECTION}/problems?severity=${severity}`
      );
      expect(link.closest("li")?.textContent).toBe(
        `${name}${expected[severity]}`
      );
    }
  });

  it("crosses off done steps, in two columns where the card is wide enough", () => {
    render(<SeoOverviewPage />);
    const setup = card("Set up SEO");
    const list = within(setup).getByRole("list", { name: "Setup steps" });
    expect(list).toHaveClass("@2xl:grid-cols-2");
    const names = within(list)
      .getAllByRole("listitem")
      .map(step => step.querySelector("p"));
    // Four done, then two open.
    expect(names.map(name => name?.classList.contains("line-through"))).toEqual(
      [true, true, true, true, false, false]
    );
  });

  it("marks the verdict with a dot in its colour, and writes each count in its severity's colour", () => {
    render(<SeoOverviewPage />);
    const health = card("Search health");
    const dot = health.querySelector("[data-stat-tone]");
    expect(dot?.getAttribute("data-stat-tone")).toBe("warning");
    // The count is the line's end: the element after the linked name.
    const countOf = (name: string) =>
      within(health).getByRole("link", { name }).closest("li")?.lastElementChild
        ?.firstElementChild as HTMLElement;
    // Coloured numbers, not chips.
    expect(countOf("Errors")).toHaveClass("text-danger-text", "font-semibold");
    expect(countOf("Warnings")).toHaveClass("text-warning-text");
    expect(countOf("Notices")).toHaveClass("text-muted-foreground");
    expect(health.querySelector('[data-slot^="badge."]')).toBeNull();
    for (const name of ["Errors", "Warnings", "Notices"]) {
      expect(countOf(name).textContent).toMatch(/^\d+$/);
    }
  });

  it("marks a good verdict in the success colour, and writes no count of zero in a warning colour", () => {
    serve({
      "/problems": { ...PROBLEMS, problems: [problem("longTitle", "a")] },
    });
    render(<SeoOverviewPage />);
    const health = card("Search health");
    expect(
      health.querySelector("[data-stat-tone]")?.getAttribute("data-stat-tone")
    ).toBe("success");
    const errors = within(health)
      .getByRole("link", { name: "Errors" })
      .closest("li")?.lastElementChild?.firstElementChild;
    expect(errors).toHaveClass("text-muted-foreground");
    expect(errors).not.toHaveClass("text-danger-text");
  });

  it("checks a site never checked whole as it opens, and waits for it rather than calling it good", async () => {
    const { checkedAt: _never, ...unchecked } = PROBLEMS;
    serve({ "/problems": { ...unchecked, problems: [], due: true } });
    render(<SeoOverviewPage />);
    const health = card("Search health");
    expect(within(health).getByRole("status").textContent).toBe(
      "Checking the site…"
    );
    expect(within(health).queryByText("Good")).toBeNull();
    await vi.waitFor(() => expect(check).toHaveBeenCalledTimes(1));
    // The check's answer is the list counted.
    await vi.waitFor(() =>
      expect(within(health).getByText("Should improve")).toBeTruthy()
    );
  });

  it("calls a site with no errors or warnings good, and counts zeros", () => {
    serve({
      "/problems": { ...PROBLEMS, problems: [problem("longTitle", "a")] },
    });
    render(<SeoOverviewPage />);
    const health = card("Search health");
    expect(within(health).getByText("Good")).toBeTruthy();
    expect(
      within(health).getByRole("link", { name: "Errors" }).closest("li")
        ?.textContent
    ).toBe("Errors0");
  });

  it("counts the pages as the Pages list reads them, the groups adding up", () => {
    render(<SeoOverviewPage />);
    const pages = card("Pages");
    expect(within(pages).getByText("5 public pages")).toBeTruthy();
    const line = (name: string) =>
      within(pages).getByText(name).closest("li")?.textContent;
    expect(line("Hidden from search")).toBe("Hidden from search1");
    expect(line("Both set for the page")).toBe("Both set for the page2");
    expect(line("Both worked out")).toBe("Both worked out1");
    expect(line("One of each")).toBe("One of each1");
  });

  it("counts the pages of types with SEO off as their own group, linking to them in Pages", () => {
    serve({
      "/pages": {
        items: [
          ...PAGES,
          address("/authors/a", undefined, undefined, "seo-off"),
          address("/authors/b", undefined, undefined, "seo-off"),
        ],
      },
    });
    render(<SeoOverviewPage />);
    const pages = card("Pages");
    expect(within(pages).getByText("7 public pages")).toBeTruthy();
    const off = within(pages).getByRole("link", { name: "Pages with SEO off" });
    expect(off.closest("li")?.textContent).toBe("Pages with SEO off2");
    expect(off.getAttribute("href")).toBe(
      "/admin/plugins/nextlyhq-plugin-seo/pages?status=seo-off"
    );
    // The other groups count the rest, as before.
    expect(
      within(pages).getByText("Hidden from search").closest("li")?.textContent
    ).toBe("Hidden from search1");
  });

  it("leaves the SEO off line out where no type has SEO off", () => {
    render(<SeoOverviewPage />);
    expect(within(card("Pages")).queryByText("Pages with SEO off")).toBeNull();
  });

  it("lists the week's addresses not found, each opening a new redirect from it", () => {
    render(<SeoOverviewPage />);
    const missing = card("Not found, last 7 days");
    expect(within(missing).getByText("/docs/install")).toBeTruthy();
    // Visited more, but three weeks ago.
    expect(within(missing).queryByText("/pricing-old")).toBeNull();
    const redirect = within(missing).getByRole("link", {
      name: "Redirect /docs/install",
    });
    expect(redirect.getAttribute("href")).toBe(
      `${SECTION}/redirects?from=%2Fdocs%2Finstall&to=%2Fdocs%2Fgetting-started`
    );
    expect(
      within(missing)
        .getByRole("link", { name: "All not found" })
        .getAttribute("href")
    ).toBe(`${SECTION}/redirects?tab=notfound`);
  });

  it("says when nothing was not found lately", () => {
    serve({ "/not-found": { items: [] } });
    render(<SeoOverviewPage />);
    expect(
      within(card("Not found, last 7 days")).getByText(
        "No addresses not found in the last 7 days."
      )
    ).toBeTruthy();
  });

  it("shows each connection as connected, not connected or failing, linked to its settings", () => {
    render(<SeoOverviewPage />);
    const connections = card("Connections");
    const console = within(connections).getByRole("link", {
      name: "Not connected",
    });
    expect(console.closest("li")?.textContent).toContain("Search Console");
    expect(console.getAttribute("href")).toBe(
      `${SECTION}/settings?tab=connections`
    );
    const indexNow = within(connections).getByRole("link", {
      name: "Failing · check the key",
    });
    expect(indexNow.closest("li")?.textContent).toContain("IndexNow");
    expect(within(connections).getByText("Running")).toBeTruthy();
  });

  it("says a connection couldn't be checked when its refresh failed, over the answer before it", () => {
    serve({
      "/connections": {
        stale: {
          searchConsole: { configured: true, connected: {} },
          indexNow: { switchedOn: true },
        },
        error: new Error("offline"),
      },
      "/proxy-status": {
        stale: { state: "running", lastSeen: ago(0) },
        error: new Error("offline"),
      },
    });
    render(<SeoOverviewPage />);
    const connections = card("Connections");
    expect(within(connections).getAllByText("Couldn't check")).toHaveLength(3);
    expect(within(connections).queryByText("Connected")).toBeNull();
    expect(within(connections).queryByText("Running")).toBeNull();
  });

  it("says why a hidden checklist could not be shown again", () => {
    serve({ "/overview/checklist": { ...CHECKLIST, hidden: true } });
    vi.mocked(usePluginRouteMutation).mockImplementation((({
      path,
    }: {
      path: string;
    }) => ({
      write: path === "/problems/check" ? check : write,
      pending: false,
      error: path === "/problems/check" ? null : new Error("Network down"),
    })) as unknown as typeof usePluginRouteMutation);
    render(<SeoOverviewPage />);
    expect(screen.getByRole("alert").textContent).toContain(
      "The setup checklist could not be shown."
    );
  });

  it("keeps the rest of the page when one read fails", () => {
    serve({
      "/connections": new Error("Search Console could not be reached"),
      "/problems": new Error("The list is unavailable"),
    });
    render(<SeoOverviewPage />);
    const connections = card("Connections");
    expect(within(connections).getAllByText("Couldn't check")).toHaveLength(2);
    expect(within(connections).getByText("Running")).toBeTruthy();
    expect(within(card("Search health")).getByRole("alert")).toBeTruthy();
    expect(within(card("Pages")).getByText("5 public pages")).toBeTruthy();
    expect(within(card("Set up SEO")).getByText("4 of 6 done")).toBeTruthy();
  });

  it("keeps a card's title in view while its figure cannot be drawn", () => {
    serve({
      "/problems": new Error("The list is unavailable"),
      "/pages": new Error("The pages are unavailable"),
    });
    render(<SeoOverviewPage />);
    // The figure, which carries the title when drawn, is absent; the card
    // still says what it is, as its heading.
    for (const name of ["Search health", "Pages"]) {
      const region = card(name);
      expect(within(region).getByRole("heading", { name })).toBeTruthy();
      expect(within(region).getByRole("alert")).toBeTruthy();
    }
  });

  it("titles a card with its figure once drawn, not twice", () => {
    render(<SeoOverviewPage />);
    const health = card("Search health");
    expect(within(health).getAllByText("Search health")).toHaveLength(1);
    expect(within(health).queryByRole("heading")).toBeNull();
  });

  it("sends a first visit on to setup while it still waits, once", () => {
    serve({ "/overview/checklist": { ...CHECKLIST, setupWaiting: true } });
    const first = render(<SeoOverviewPage />);
    expect(navigateTo).toHaveBeenCalledWith(`${SECTION}/settings`, {
      replace: true,
    });
    first.unmount();
    // Back from setup, a read cached before it was answered still says it
    // waits: the reader is not sent away again.
    render(<SeoOverviewPage />);
    expect(navigateTo).toHaveBeenCalledTimes(1);
  });

  it("stays on the Overview once setup is answered", () => {
    render(<SeoOverviewPage />);
    expect(navigateTo).not.toHaveBeenCalled();
  });
});
