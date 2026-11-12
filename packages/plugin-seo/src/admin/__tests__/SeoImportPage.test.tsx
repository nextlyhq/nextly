// @vitest-environment jsdom

/**
 * Import, reached from Pages, as a person uses it: the import panel's dry
 * run of the matching chosen, and the import of exactly what it showed.
 * What each write sends is read from the write itself.
 */
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@nextlyhq/plugin-sdk/admin", async importOriginal => ({
  ...(await importOriginal<typeof import("@nextlyhq/plugin-sdk/admin")>()),
  usePluginRoute: vi.fn(),
  writePluginRoute: vi.fn(),
  toastMutationResult: vi.fn(),
}));

import { usePluginRoute, writePluginRoute } from "@nextlyhq/plugin-sdk/admin";

import type { DryRunBody, ImportGroupsBody } from "../../import/contract";
import { SeoImportPage } from "../SeoImportPage";

const GROUPS: ImportGroupsBody = {
  groups: [
    {
      field: "metaData",
      label: "Search and sharing",
      types: [{ slug: "posts", label: "Blog posts" }],
      pages: 3,
      own: false,
      fields: [
        { name: "seoTitle", label: "Seo title", filled: 2, suggested: "title" },
        { name: "keywords", label: "Keywords", filled: 1, suggested: "skip" },
        { name: "ogType", label: "Og type", filled: 0, suggested: "skip" },
      ],
    },
  ],
};

const DRY: DryRunBody = {
  checked: 3,
  fromFile: false,
  lines: [{ target: "title", from: ["seoTitle"], pages: 2 }],
  pages: 2,
  same: 1,
  kept: 0,
  redirects: 0,
  left: ["keywords"],
  warnings: ["2 titles are longer than Google shows."],
  plan: "digest",
};

let writes: { path: string; body?: unknown }[];

beforeEach(() => {
  writes = [];
  vi.mocked(usePluginRoute).mockImplementation((() => ({
    data: GROUPS,
    pending: false,
    error: null,
    refetch: vi.fn(),
    fetching: false,
  })) as unknown as typeof usePluginRoute);
  vi.mocked(writePluginRoute).mockImplementation((async (request: {
    path: string;
    body?: unknown;
  }) => {
    writes.push({ path: request.path, body: request.body });
    if (request.path === "/import/dry-run") return DRY;
    return {
      message: "Imported 2 pages in one step.",
      pages: 2,
      redirects: 0,
    };
  }) as unknown as typeof writePluginRoute);
});

describe("the import panel", () => {
  it("dry-runs the matching the person chose, then imports exactly what it showed", async () => {
    render(<SeoImportPage />);
    expect(
      screen.getByText(/Found metaData on Blog posts, 3 fields/)
    ).toBeTruthy();
    // A field with no values is not offered, and is said to be left out.
    expect(screen.queryByLabelText("Import ogType into")).toBeNull();
    fireEvent.change(screen.getByLabelText("Import keywords into"), {
      target: { value: "description" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Do a dry run" }));
    await screen.findByText("Pages that would change");
    expect(writes[0]).toEqual({
      path: "/import/dry-run",
      body: {
        source: {
          kind: "group",
          field: "metaData",
          map: { seoTitle: "title", keywords: "description", ogType: "skip" },
        },
      },
    });
    expect(screen.getByText("Title on Google ← seoTitle")).toBeTruthy();
    expect(screen.getByText("Same as automatic, left automatic")).toBeTruthy();
    expect(screen.getByText(/2 titles are longer/)).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Import 2 pages, all or nothing" })
    );
    await screen.findByText("Imported 2 pages in one step.");
    expect(writes[1]).toEqual({
      path: "/import/apply",
      body: {
        source: {
          kind: "group",
          field: "metaData",
          map: { seoTitle: "title", keywords: "description", ogType: "skip" },
        },
        plan: "digest",
      },
    });
  });

  it("asks for the export file before a dry run of a file", async () => {
    render(<SeoImportPage />);
    fireEvent.click(screen.getByLabelText(/Yoast SEO/));
    expect(
      (
        screen.getByRole("button", {
          name: "Do a dry run",
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true);
    expect(
      screen.getByText("Choose the export file first; the dry run reads it.")
    ).toBeTruthy();
  });

  it("drops a dry run's answer once the source it was asked for is left", async () => {
    let answer: (body: DryRunBody) => void = () => undefined;
    vi.mocked(writePluginRoute).mockImplementation((async (request: {
      path: string;
      body?: unknown;
    }) => {
      writes.push({ path: request.path, body: request.body });
      return new Promise(resolve => {
        answer = resolve as (body: DryRunBody) => void;
      });
    }) as unknown as typeof writePluginRoute);
    render(<SeoImportPage />);
    fireEvent.click(screen.getByRole("button", { name: "Do a dry run" }));
    await waitFor(() => expect(writes).toHaveLength(1));
    // Leaving the source once the answer is on its way.
    fireEvent.click(screen.getByLabelText(/Yoast SEO/));
    await act(async () => answer(DRY));
    expect(screen.queryByText("Pages that would change")).toBeNull();
  });

  it("offers another dry run once an import is refused", async () => {
    vi.mocked(writePluginRoute).mockImplementation((async (request: {
      path: string;
    }) => {
      if (request.path === "/import/dry-run") return DRY;
      throw new Error("Pages have changed since the dry run.");
    }) as unknown as typeof writePluginRoute);
    render(<SeoImportPage />);
    fireEvent.click(screen.getByRole("button", { name: "Do a dry run" }));
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Import 2 pages, all or nothing",
      })
    );
    await screen.findByRole("button", { name: "Do a dry run" });
    expect(screen.getByRole("alert").textContent).toContain(
      "Pages have changed"
    );
  });

  it("offers to import the redirects a dry run found", async () => {
    vi.mocked(writePluginRoute).mockImplementation((async (request: {
      path: string;
      body?: unknown;
    }) => {
      writes.push({ path: request.path, body: request.body });
      return { ...DRY, lines: [], pages: 0, same: 0, redirects: 2 };
    }) as unknown as typeof writePluginRoute);
    render(<SeoImportPage />);
    fireEvent.click(screen.getByRole("button", { name: "Do a dry run" }));
    const button = (await screen.findByRole("button", {
      name: "Import 2 redirects, all or nothing",
    })) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
  });

  it("offers a yes/no visibility field to match though none of its values is yes", async () => {
    vi.mocked(usePluginRoute).mockImplementation((() => ({
      data: {
        groups: [
          {
            ...GROUPS.groups[0]!,
            fields: [
              ...GROUPS.groups[0]!.fields,
              {
                name: "noIndex",
                label: "No index",
                filled: 0,
                suggested: "hidden",
              },
            ],
          },
        ],
      },
      pending: false,
      error: null,
      refetch: vi.fn(),
      fetching: false,
    })) as unknown as typeof usePluginRoute);
    render(<SeoImportPage />);
    expect(screen.getByLabelText("Import noIndex into")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Do a dry run" }));
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]?.body).toEqual({
      source: {
        kind: "group",
        field: "metaData",
        map: {
          seoTitle: "title",
          keywords: "skip",
          ogType: "skip",
          noIndex: "hidden",
        },
      },
    });
  });
});
