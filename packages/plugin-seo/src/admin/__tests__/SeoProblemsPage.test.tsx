// @vitest-environment jsdom

/**
 * The problem list's screen as a person uses it: problems grouped by kind,
 * each with a link to its fix or a note to copy; a list never checked whole
 * is checked as it opens, and "Check now" checks it again.
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

import type { ProblemListBody } from "../../problems/contract";
import { SeoProblemsPage } from "../SeoProblemsPage";

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

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText: vi.fn(async () => undefined) },
    configurable: true,
  });
});

describe("SeoProblemsPage", () => {
  it("groups the problems by kind, the site-wide one first, with its count and when it was checked", () => {
    serving(LIST);
    render(<SeoProblemsPage />);
    const groups = screen.getAllByRole("heading", { level: 2 });
    expect(groups.map(heading => heading.textContent)).toEqual([
      "Content type with no public address",
      "Same title on several pages 2",
    ]);
    expect(screen.getByText("3 problems")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe(
      "Last checked 3 minutes ago"
    );
    expect(screen.getByText(/how example\.com shows up/)).toBeTruthy();
    expect(screen.queryByText(/score/i)).toBeNull();
    expect(write).not.toHaveBeenCalled();
  });

  it("links each fix to its place, and opens it within the admin", () => {
    serving(LIST);
    render(<SeoProblemsPage />);
    const [first] = screen.getAllByRole("link", { name: /Change the title/ });
    expect(first?.getAttribute("href")).toBe(
      "/admin/collections/posts/1?tab=nextlyhq-plugin-seo.tab"
    );
    fireEvent.click(first!);
    expect(navigateTo).toHaveBeenCalledWith(
      "/admin/collections/posts/1?tab=nextlyhq-plugin-seo.tab"
    );
  });

  it("copies a note for a developer where the fix is in code", async () => {
    serving(LIST);
    render(<SeoProblemsPage />);
    // Found by text: naming a heading by role makes jsdom compute styles it
    // cannot parse.
    const group = screen
      .getByText("Content type with no public address")
      .closest("section")!;
    fireEvent.click(within(group).getByText("Copy a note for a developer"));
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

  it("checks the site as it opens where the list is due, and again on Check now", async () => {
    serving({ ...LIST, due: true });
    render(<SeoProblemsPage />);
    expect(write).toHaveBeenCalledTimes(1);
    await vi.waitFor(() =>
      expect(toastMutationResult).toHaveBeenCalledWith("Checked 83 pages.", [])
    );
    fireEvent.click(screen.getByRole("button", { name: /Check now/ }));
    expect(write).toHaveBeenCalledTimes(2);
  });

  it("says so where nothing was found", () => {
    serving({ ...LIST, problems: [] });
    render(<SeoProblemsPage />);
    expect(screen.getByText("No problems found in 83 pages.")).toBeTruthy();
  });
});
