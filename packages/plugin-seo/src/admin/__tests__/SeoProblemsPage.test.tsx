// @vitest-environment jsdom

/**
 * The problem list's screen as a person uses it: one row per kind of
 * problem, the most serious first, with its severity, where it is, how many
 * pages, and the way to its fix; a row naming several pages opens on each
 * page's own fix; the filter narrows to one severity with the counts the
 * Overview counts by; a list never checked whole is checked as it opens, and
 * "Check again" checks it again.
 *
 * The list is drawn as a table and, for a narrow screen, as cards, both in
 * the document; the table is read here.
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
  toastMutationResult,
  usePluginRoute,
  usePluginRouteMutation,
} from "@nextlyhq/plugin-sdk/admin";

import {
  severityCounts,
  type Problem,
  type ProblemListBody,
} from "../../problems/contract";
import { SeoProblemsPage } from "../SeoProblemsPage";

/** A broken link on page `id`. */
const broken = (id: string, at: string): Problem => ({
  kind: "brokenLink",
  subject: { type: "posts", id, label: `Post ${id}`, detail: `/blog/${id}` },
  what: `Links to ${at}, which is not found`,
  action: "Edit the link",
  fix: { place: "page", tab: "content" },
});

const LIST: ProblemListBody = {
  site: "example.com",
  checkedAt: new Date(Date.now() - 3 * 60_000).toISOString(),
  pagesChecked: 83,
  outOfDate: false,
  due: false,
  problems: [
    {
      kind: "sharedTitle",
      subject: {
        type: "posts",
        id: "1",
        label: "Harbour",
        detail: "/blog/harbour",
      },
      what: "Title: “Harbour”, also on Boats",
      action: "Change the title",
      fix: { place: "page", tab: "seo", field: "metaTitle" },
    },
    {
      kind: "sharedTitle",
      subject: {
        type: "posts",
        id: "2",
        label: "Boats",
        detail: "/blog/boats",
      },
      what: "Title: “Harbour”, also on Harbour",
      action: "Change the title",
      fix: { place: "page", tab: "seo", field: "metaTitle" },
    },
    {
      kind: "noAddress",
      subject: { type: "cases", label: "Case studies", detail: "3 entries" },
      what: "No public address",
      action: "Copy a note for a developer",
      fix: { place: "developer", note: "Add publicAddress to cases." },
    },
    {
      kind: "longTitle",
      subject: { type: "posts", id: "3", label: "Ships", detail: "/ships" },
      what: "Title is 71 characters",
      action: "Shorten the title",
      fix: { place: "page", tab: "seo", field: "metaTitle" },
    },
  ],
};

let write: ReturnType<typeof vi.fn>;

function serving(list: ProblemListBody | undefined) {
  vi.mocked(usePluginRoute).mockReturnValue({
    data: list,
    pending: list === undefined,
    error: null,
  } as unknown as ReturnType<typeof usePluginRoute>);
  write = vi.fn(async () => ({ ...LIST, message: "Checked 83 pages." }));
  vi.mocked(usePluginRouteMutation).mockReturnValue({
    write,
    pending: false,
    error: null,
  } as unknown as ReturnType<typeof usePluginRouteMutation>);
}

/** The table's rows of problems, each as the text of its cells. */
function tableRows(): string[][] {
  const table = screen.getByRole("table");
  return within(table)
    .getAllByRole("row")
    .filter(row => !row.hidden && row.querySelector("td") !== null)
    .filter(row => !row.hasAttribute("data-row-detail"))
    .map(row =>
      [...row.querySelectorAll("td")]
        // The cell holding a row's Details toggle is the table's, not the page's.
        .filter(cell => cell.querySelector("button[aria-expanded]") === null)
        .map(cell => seenText(cell))
        .filter(text => text !== "")
    );
}

/** What a cell shows, leaving out what only a screen reader is told. */
function seenText(cell: Element): string {
  const copy = cell.cloneNode(true) as Element;
  for (const hidden of copy.querySelectorAll(".sr-only")) hidden.remove();
  return copy.textContent?.trim() ?? "";
}

/** The table's row for the problem titled `title`. */
function rowOf(title: string): HTMLElement {
  const table = screen.getByRole("table");
  const row = within(table).getByText(title).closest("tr");
  if (row === null) throw new Error(`No row for ${title}`);
  return row;
}

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText: vi.fn(async () => undefined) },
    configurable: true,
  });
});

describe("SeoProblemsPage", () => {
  it("draws one row per kind, the most serious first, with its severity, where, pages and fix", () => {
    serving(LIST);
    render(<SeoProblemsPage />);
    expect(tableRows()).toEqual([
      [
        "Error",
        "Content type with no public addressNo public address",
        "Whole site",
        "—",
        "Copy a note for a developer",
      ],
      [
        "Warning",
        "Same title on several pagesGoogle may show only one of them. Give each page its own title.",
        "Pages",
        "2",
        "Review 2 pages",
      ],
      [
        "Notice",
        "Title longer than Google showsTitle is 71 characters",
        "Pages",
        "1",
        "Shorten the title",
      ],
    ]);
    expect(screen.getByRole("status").textContent).toBe(
      "Checked 3 minutes ago, and after every save"
    );
    expect(screen.queryByText(/score/i)).toBeNull();
    expect(write).not.toHaveBeenCalled();
  });

  it("counts a page that fails one check three times as one page", () => {
    serving({
      ...LIST,
      problems: [broken("1", "/a"), broken("1", "/b"), broken("2", "/c")],
    });
    render(<SeoProblemsPage />);
    expect(tableRows()[0]).toEqual([
      "Warning",
      "Broken internal linkA link on your site points to a page that doesn't exist.",
      "Pages",
      "2",
      "Review 2 pages",
    ]);
  });

  it("links a fix to its place, and opens it within the admin", () => {
    serving(LIST);
    render(<SeoProblemsPage />);
    const link = within(rowOf("Title longer than Google shows")).getByRole(
      "link",
      { name: "Shorten the title" }
    );
    expect(link.getAttribute("href")).toBe(
      "/admin/collections/posts/3?tab=nextlyhq-plugin-seo.tab"
    );
    fireEvent.click(link);
    expect(navigateTo).toHaveBeenCalledWith(
      "/admin/collections/posts/3?tab=nextlyhq-plugin-seo.tab"
    );
  });

  it("opens a row naming several pages on each page, with its own fix", () => {
    serving(LIST);
    render(<SeoProblemsPage />);
    const row = rowOf("Same title on several pages");
    fireEvent.click(
      within(row).getByRole("button", { name: "Review 2 pages" })
    );
    const region = screen
      .getAllByRole("region", { name: /Same title on several pages/ })
      .find(element => element.closest("table") !== null);
    expect(region).toBeDefined();
    const links = within(region!).getAllByRole("link", {
      name: "Change the title",
    });
    expect(links.map(link => link.getAttribute("href"))).toEqual([
      "/admin/collections/posts/1?tab=nextlyhq-plugin-seo.tab",
      "/admin/collections/posts/2?tab=nextlyhq-plugin-seo.tab",
    ]);
    expect(within(region!).getByText("/blog/boats")).toBeTruthy();
    expect(
      within(region!).getByText("Title: “Harbour”, also on Boats")
    ).toBeTruthy();
  });

  it("opens a whole-site row on the thing it names, such as the content type", () => {
    serving(LIST);
    render(<SeoProblemsPage />);
    const row = rowOf("Content type with no public address");
    fireEvent.click(within(row).getByRole("button", { expanded: false }));
    const region = screen
      .getAllByRole("region", { name: /Content type with no public address/ })
      .find(element => element.closest("table") !== null);
    expect(region).toBeDefined();
    expect(within(region!).getByText("Case studies")).toBeTruthy();
    expect(within(region!).getByText("3 entries")).toBeTruthy();
  });

  it("copies a note for a developer where the fix is in code", async () => {
    serving(LIST);
    render(<SeoProblemsPage />);
    fireEvent.click(
      within(rowOf("Content type with no public address")).getByRole("button", {
        name: "Copy a note for a developer",
      })
    );
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      "Add publicAddress to cases."
    );
    await vi.waitFor(() =>
      expect(toastMutationResult).toHaveBeenCalledWith(
        "Copied: “Add publicAddress to cases.”",
        []
      )
    );
  });

  it("shows the developer note where the clipboard can't be written", async () => {
    serving(LIST);
    Object.defineProperty(navigator, "clipboard", {
      value: undefined,
      configurable: true,
    });
    render(<SeoProblemsPage />);
    fireEvent.click(
      within(rowOf("Content type with no public address")).getByRole("button", {
        name: "Copy a note for a developer",
      })
    );
    await vi.waitFor(() =>
      expect(toastMutationResult).toHaveBeenCalledWith(
        "Add publicAddress to cases.",
        []
      )
    );
  });

  it("checks the site as it opens where the list is due, and again on Check again", async () => {
    serving({ ...LIST, due: true });
    render(<SeoProblemsPage />);
    expect(write).toHaveBeenCalledTimes(1);
    await vi.waitFor(() =>
      expect(toastMutationResult).toHaveBeenCalledWith("Checked 83 pages.", [])
    );
    fireEvent.click(screen.getByRole("button", { name: "Check again" }));
    expect(write).toHaveBeenCalledTimes(2);
  });

  it("says when pages changed after the last full check", () => {
    serving({ ...LIST, outOfDate: true });
    render(<SeoProblemsPage />);
    expect(screen.getByRole("status").textContent).toBe(
      "Checked 3 minutes ago, and pages have changed since"
    );
  });

  it("shows the list a check answered, though the read it refreshes has not arrived", async () => {
    serving(LIST);
    write.mockImplementation(async () => ({
      ...LIST,
      problems: LIST.problems.slice(0, 1),
      message: "Checked 83 pages.",
    }));
    render(<SeoProblemsPage />);
    expect(tableRows()).toHaveLength(3);
    fireEvent.click(screen.getByRole("button", { name: "Check again" }));
    await vi.waitFor(() => expect(tableRows()).toHaveLength(1));
  });

  it("keeps the list shown when a refresh fails, saying why above it", () => {
    serving(LIST);
    vi.mocked(usePluginRoute).mockReturnValue({
      data: LIST,
      pending: false,
      error: new Error("The server could not be reached."),
    } as unknown as ReturnType<typeof usePluginRoute>);
    render(<SeoProblemsPage />);
    expect(screen.getByRole("alert").textContent).toContain(
      "The server could not be reached."
    );
    expect(tableRows()).toHaveLength(3);
  });

  it("says so where nothing was found", () => {
    serving({ ...LIST, problems: [] });
    render(<SeoProblemsPage />);
    expect(screen.getByText("No problems found")).toBeTruthy();
    expect(screen.getByText("Checked 83 pages.")).toBeTruthy();
  });
});

describe("the severity filter", () => {
  it("counts each severity as the Overview counts it", () => {
    const problems = [...LIST.problems, broken("1", "/a"), broken("1", "/b")];
    serving({ ...LIST, problems });
    render(<SeoProblemsPage />);
    const counts = severityCounts(problems);
    const choices = within(
      screen.getByRole("radiogroup", { name: "Show problems" })
    ).getAllByRole("radio");
    expect(choices.map(choice => choice.textContent)).toEqual([
      `All ${counts.error + counts.warning + counts.notice}`,
      `Errors ${counts.error}`,
      `Warnings ${counts.warning}`,
      `Notices ${counts.notice}`,
    ]);
    // Two shared titles, and one page's two broken links counted once.
    expect(counts.warning).toBe(3);
  });

  it("narrows the list to the severity chosen, keeping every count", () => {
    serving(LIST);
    render(<SeoProblemsPage />);
    fireEvent.click(screen.getByRole("radio", { name: "Warnings 2" }));
    expect(tableRows().map(row => row[0])).toEqual(["Warning"]);
    expect(screen.getByRole("radio", { name: "All 4" })).toBeTruthy();
  });

  it("starts narrowed to the severity the address names", () => {
    window.history.replaceState(
      null,
      "",
      "/admin/plugins/nextlyhq-plugin-seo/problems?severity=error"
    );
    try {
      serving(LIST);
      render(<SeoProblemsPage />);
      expect(
        screen
          .getByRole("radio", { name: "Errors 1" })
          .getAttribute("aria-checked")
      ).toBe("true");
      expect(tableRows().map(row => row[1])).toEqual([
        "Content type with no public addressNo public address",
      ]);
    } finally {
      window.history.replaceState(null, "", "/");
    }
  });

  it("says when a severity has none, with the way back to all", () => {
    serving({ ...LIST, problems: LIST.problems.slice(0, 2) });
    render(<SeoProblemsPage />);
    fireEvent.click(screen.getByRole("radio", { name: "Errors 0" }));
    expect(screen.getByText("No errors found")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Show all problems" }));
    expect(tableRows()).toHaveLength(1);
  });
});
