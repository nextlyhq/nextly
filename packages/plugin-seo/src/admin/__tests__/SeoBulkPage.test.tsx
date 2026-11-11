// @vitest-environment jsdom

/**
 * The bulk edit screen as a person uses it: the automatic values in grey,
 * a typed cell counted as a change and saved with the others in one write,
 * a page they may not change shown read-only, the filters, and the import
 * panel's dry run and import of exactly what it showed. What each write
 * sends is read from the write itself.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@nextlyhq/plugin-sdk/admin", async importOriginal => ({
  ...(await importOriginal<typeof import("@nextlyhq/plugin-sdk/admin")>()),
  usePluginRoute: vi.fn(),
  readPluginRoute: vi.fn(),
  writePluginRoute: vi.fn(),
  toastMutationResult: vi.fn(),
}));

import {
  readPluginRoute,
  usePluginRoute,
  writePluginRoute,
} from "@nextlyhq/plugin-sdk/admin";

import type { BulkRow, BulkTypesBody } from "../../bulk/contract";
import type { DryRunBody, ImportGroupsBody } from "../../import/contract";
import { SeoBulkPage } from "../SeoBulkPage";

const TYPES: BulkTypesBody = {
  types: [
    {
      slug: "posts",
      label: "Blog posts",
      singular: "Post",
      total: 3,
      titlePattern: "{Title} | {Site name}",
      drafts: false,
    },
  ],
};

const ROWS: BulkRow[] = [
  {
    id: "p1",
    label: "Surfer vs Rext",
    path: "/blog/surfer",
    title: "",
    description: "Typed description",
    autoTitle: "Surfer vs Rext | Rext AI",
    autoDescription: "From the excerpt",
    rev: "3",
    editable: true,
  },
  {
    id: "p2",
    label: "Jasper vs Rext",
    path: "/blog/jasper",
    title: "Jasper, compared",
    description: "",
    autoTitle: "Jasper vs Rext | Rext AI",
    rev: "1",
    editable: true,
  },
  {
    id: "p3",
    label: "Locked post",
    title: "",
    description: "",
    autoTitle: "Locked post | Rext AI",
    editable: false,
  },
];

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
  vi.mocked(usePluginRoute).mockImplementation(((args: { path: string }) => ({
    data: args.path === "/bulk/types" ? TYPES : GROUPS,
    pending: false,
    error: null,
    refetch: vi.fn(),
    fetching: false,
  })) as unknown as typeof usePluginRoute);
  vi.mocked(readPluginRoute).mockImplementation((async () => ({
    type: "posts",
    rows: ROWS,
    total: 3,
    more: false,
  })) as unknown as typeof readPluginRoute);
  vi.mocked(writePluginRoute).mockImplementation((async (request: {
    path: string;
    body?: unknown;
  }) => {
    writes.push({ path: request.path, body: request.body });
    if (request.path === "/import/dry-run") return DRY;
    if (request.path === "/import/apply") {
      return {
        message: "Imported 2 pages in one step.",
        pages: 2,
        redirects: 0,
      };
    }
    return { message: "Saved 1 page.", saved: 1, revs: {} };
  }) as unknown as typeof writePluginRoute);
});

const titleOf = (label: string) =>
  screen.getByLabelText(`Title on Google for ${label}`) as HTMLTextAreaElement;

describe("the bulk edit screen", () => {
  it("shows typed values, and the automatic ones in grey", async () => {
    render(<SeoBulkPage />);
    await screen.findByLabelText("Title on Google for Surfer vs Rext");
    expect(titleOf("Surfer vs Rext").value).toBe("");
    expect(titleOf("Surfer vs Rext").placeholder).toBe(
      "Surfer vs Rext | Rext AI"
    );
    expect(titleOf("Jasper vs Rext").value).toBe("Jasper, compared");
    expect(screen.getByText(/Showing 3 of 3/)).toBeTruthy();
    expect(screen.getByText("{Title} | {Site name}")).toBeTruthy();
  });

  it("counts each typed cell as a change and saves the changes in one write", async () => {
    render(<SeoBulkPage />);
    await screen.findByLabelText("Title on Google for Surfer vs Rext");
    fireEvent.change(titleOf("Surfer vs Rext"), {
      target: { value: "Surfer or Rext?" },
    });
    expect(screen.getByText("1 change")).toBeTruthy();
    fireEvent.change(
      screen.getByLabelText("Description on Google for Jasper vs Rext"),
      { target: { value: "Which one writes with sources." } }
    );
    expect(screen.getByText("2 changes")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save all" }));
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]).toEqual({
      path: "/bulk/save",
      body: {
        type: "posts",
        changes: [
          { id: "p1", rev: "3", title: "Surfer or Rext?" },
          {
            id: "p2",
            rev: "1",
            description: "Which one writes with sources.",
          },
        ],
      },
    });
  });

  it("discards the changes without writing", async () => {
    render(<SeoBulkPage />);
    await waitFor(() => titleOf("Jasper vs Rext"));
    fireEvent.change(titleOf("Jasper vs Rext"), { target: { value: "" } });
    expect(screen.getByText("1 change")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(screen.queryByText("1 change")).toBeNull();
    expect(titleOf("Jasper vs Rext").value).toBe("Jasper, compared");
    expect(writes).toEqual([]);
  });

  it("shows a page the person may not change read-only", async () => {
    render(<SeoBulkPage />);
    await waitFor(() => titleOf("Locked post"));
    expect(titleOf("Locked post").readOnly).toBe(true);
    expect(titleOf("Surfer vs Rext").readOnly).toBe(false);
  });

  it("filters the rows to those typed, or automatic only", async () => {
    render(<SeoBulkPage />);
    await waitFor(() => titleOf("Locked post"));
    fireEvent.click(screen.getByRole("button", { name: "Automatic only" }));
    expect(
      screen.queryByLabelText("Title on Google for Surfer vs Rext")
    ).toBeNull();
    expect(titleOf("Locked post")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Typed" }));
    expect(
      screen.queryByLabelText("Title on Google for Locked post")
    ).toBeNull();
    expect(titleOf("Surfer vs Rext")).toBeTruthy();
  });

  it("dry-runs the matching the person chose, then imports exactly what it showed", async () => {
    render(<SeoBulkPage />);
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
    render(<SeoBulkPage />);
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
});
