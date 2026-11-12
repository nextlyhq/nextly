// @vitest-environment jsdom

/**
 * The bulk edit screen as a person uses it: the automatic values in grey,
 * a typed cell counted as a change and saved with the others in one write,
 * a page they may not change shown read-only, the filters, and the import
 * panel's dry run and import of exactly what it showed. What each write
 * sends is read from the write itself.
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
      total: 4,
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
    id: "p4",
    label: "Koala row",
    title: "",
    description: "",
    autoTitle: "Koala row | Rext AI",
    rev: "2",
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
    expect(screen.getByText(/Showing 4 of 4/)).toBeTruthy();
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

describe("the bulk edit screen, when things happen in between", () => {
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
    render(<SeoBulkPage />);
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
    render(<SeoBulkPage />);
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

  it("saves a change with the version its page was read at when it was made", async () => {
    render(<SeoBulkPage />);
    await screen.findByLabelText("Title on Google for Surfer vs Rext");
    fireEvent.change(titleOf("Surfer vs Rext"), {
      target: { value: "Surfer or Rext?" },
    });
    // The table is read again (an import went through), at a newer version.
    vi.mocked(readPluginRoute).mockImplementation((async () => ({
      type: "posts",
      rows: ROWS.map(row => ({ ...row, rev: "9" })),
      total: 3,
      more: false,
    })) as unknown as typeof readPluginRoute);
    fireEvent.click(screen.getByRole("button", { name: "Do a dry run" }));
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Import 2 pages, all or nothing",
      })
    );
    await screen.findByText("Imported 2 pages in one step.");
    await waitFor(() => expect(readPluginRoute).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole("button", { name: "Save all" }));
    await waitFor(() =>
      expect(writes.some(write => write.path === "/bulk/save")).toBe(true)
    );
    expect(writes.find(write => write.path === "/bulk/save")?.body).toEqual({
      type: "posts",
      changes: [{ id: "p1", rev: "3", title: "Surfer or Rext?" }],
    });
  });

  it("keeps a row in the table while it is typed in", async () => {
    render(<SeoBulkPage />);
    await screen.findByLabelText("Title on Google for Locked post");
    fireEvent.click(screen.getByRole("button", { name: "Automatic only" }));
    fireEvent.change(titleOf("Koala row"), { target: { value: "K" } });
    expect(titleOf("Koala row").value).toBe("K");
  });

  it("locks the cells while a save runs, and offers to read the table again after a refusal", async () => {
    let refuse: (error: Error) => void = () => undefined;
    vi.mocked(writePluginRoute).mockImplementation(
      (async () =>
        new Promise((_, reject) => {
          refuse = reject;
        })) as unknown as typeof writePluginRoute
    );
    render(<SeoBulkPage />);
    await screen.findByLabelText("Title on Google for Surfer vs Rext");
    fireEvent.change(titleOf("Surfer vs Rext"), { target: { value: "New" } });
    fireEvent.click(screen.getByRole("button", { name: "Save all" }));
    await waitFor(() => expect(titleOf("Surfer vs Rext").readOnly).toBe(true));
    await act(async () => refuse(new Error("Saved by someone else.")));
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Discard changes and read again",
      })
    );
    await waitFor(() => expect(titleOf("Surfer vs Rext").value).toBe(""));
  });
});

describe("the import panel, for a file that only brings redirects", () => {
  it("offers to import the redirects a dry run found", async () => {
    vi.mocked(writePluginRoute).mockImplementation((async (request: {
      path: string;
      body?: unknown;
    }) => {
      writes.push({ path: request.path, body: request.body });
      return { ...DRY, lines: [], pages: 0, same: 0, redirects: 2 };
    }) as unknown as typeof writePluginRoute);
    render(<SeoBulkPage />);
    fireEvent.click(screen.getByRole("button", { name: "Do a dry run" }));
    const button = (await screen.findByRole("button", {
      name: "Import 2 redirects, all or nothing",
    })) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
  });
});

describe("the bulk edit screen, Codex round 1", () => {
  it("drops an edit typed back to what its page holds, and the version it captured", async () => {
    render(<SeoBulkPage />);
    await screen.findByLabelText("Title on Google for Surfer vs Rext");
    fireEvent.change(titleOf("Surfer vs Rext"), { target: { value: "X" } });
    expect(screen.getByText("1 change")).toBeTruthy();
    fireEvent.change(titleOf("Surfer vs Rext"), { target: { value: "" } });
    expect(screen.queryByText("1 change")).toBeNull();
    // Read again at a newer version: a new edit is made from that one.
    vi.mocked(readPluginRoute).mockImplementation((async () => ({
      type: "posts",
      rows: ROWS.map(row => ({ ...row, rev: "9" })),
      total: 4,
      more: false,
    })) as unknown as typeof readPluginRoute);
    fireEvent.click(screen.getByRole("button", { name: "Do a dry run" }));
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Import 2 pages, all or nothing",
      })
    );
    await waitFor(() => expect(readPluginRoute).toHaveBeenCalledTimes(2));
    fireEvent.change(titleOf("Surfer vs Rext"), { target: { value: "Y" } });
    fireEvent.click(screen.getByRole("button", { name: "Save all" }));
    await waitFor(() =>
      expect(writes.some(write => write.path === "/bulk/save")).toBe(true)
    );
    expect(writes.find(write => write.path === "/bulk/save")?.body).toEqual({
      type: "posts",
      changes: [{ id: "p1", rev: "9", title: "Y" }],
    });
  });

  it("offers a yes/no visibility field to match though none of its values is yes", async () => {
    vi.mocked(usePluginRoute).mockImplementation(((args: { path: string }) => ({
      data:
        args.path === "/bulk/types"
          ? TYPES
          : {
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
    render(<SeoBulkPage />);
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

  it("shows another type's first read when a save's reread of this type ends after it was asked", async () => {
    vi.mocked(usePluginRoute).mockImplementation(((args: { path: string }) => ({
      data:
        args.path === "/bulk/types"
          ? {
              types: [
                ...TYPES.types,
                {
                  ...TYPES.types[0]!,
                  slug: "pages",
                  label: "Pages",
                  singular: "Page",
                },
              ],
            }
          : GROUPS,
      pending: false,
      error: null,
      refetch: vi.fn(),
      fetching: false,
    })) as unknown as typeof usePluginRoute);
    let answerPages: (value: unknown) => void = () => undefined;
    vi.mocked(readPluginRoute).mockImplementation((async (args: {
      path: string;
    }) => {
      if (args.path.includes("type=pages")) {
        return new Promise(resolve => {
          answerPages = resolve;
        });
      }
      return { type: "posts", rows: ROWS, total: 4, more: false };
    }) as unknown as typeof readPluginRoute);
    let finishSave: (value: unknown) => void = () => undefined;
    vi.mocked(writePluginRoute).mockImplementation(
      (async () =>
        new Promise(resolve => {
          finishSave = resolve;
        })) as unknown as typeof writePluginRoute
    );
    render(<SeoBulkPage />);
    await screen.findByLabelText("Title on Google for Surfer vs Rext");
    fireEvent.change(titleOf("Surfer vs Rext"), { target: { value: "New" } });
    fireEvent.click(screen.getByRole("button", { name: "Save all" }));
    // Pages is opened while the save runs; its first read is on its way.
    fireEvent.change(screen.getByLabelText("Content type"), {
      target: { value: "pages" },
    });
    await act(async () =>
      finishSave({ message: "Saved 1 page.", saved: 1, revs: {} })
    );
    await act(async () =>
      answerPages({
        type: "pages",
        rows: [{ ...ROWS[0]!, id: "g1", label: "About us" }],
        total: 1,
        more: false,
      })
    );
    expect(
      await screen.findByLabelText("Title on Google for About us")
    ).toBeTruthy();
  });

  it("keeps a refused save and its way out with the type it was made on", async () => {
    vi.mocked(usePluginRoute).mockImplementation(((args: { path: string }) => ({
      data:
        args.path === "/bulk/types"
          ? {
              types: [
                ...TYPES.types,
                {
                  ...TYPES.types[0]!,
                  slug: "pages",
                  label: "Pages",
                  singular: "Page",
                },
              ],
            }
          : GROUPS,
      pending: false,
      error: null,
      refetch: vi.fn(),
      fetching: false,
    })) as unknown as typeof usePluginRoute);
    vi.mocked(writePluginRoute).mockImplementation((async () => {
      throw new Error("Saved by someone else.");
    }) as unknown as typeof writePluginRoute);
    render(<SeoBulkPage />);
    await screen.findByLabelText("Title on Google for Surfer vs Rext");
    fireEvent.change(titleOf("Surfer vs Rext"), { target: { value: "New" } });
    fireEvent.click(screen.getByRole("button", { name: "Save all" }));
    await screen.findByRole("button", {
      name: "Discard changes and read again",
    });
    fireEvent.change(screen.getByLabelText("Content type"), {
      target: { value: "pages" },
    });
    expect(
      screen.queryByRole("button", { name: "Discard changes and read again" })
    ).toBeNull();
    fireEvent.change(screen.getByLabelText("Content type"), {
      target: { value: "posts" },
    });
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Discard changes and read again",
      })
    );
    await waitFor(() => expect(titleOf("Surfer vs Rext").value).toBe(""));
  });
});

/** Two content types to choose from: posts, then pages. */
function twoTypes(): void {
  vi.mocked(usePluginRoute).mockImplementation(((args: { path: string }) => ({
    data:
      args.path === "/bulk/types"
        ? {
            types: [
              ...TYPES.types,
              {
                ...TYPES.types[0]!,
                slug: "pages",
                label: "Pages",
                singular: "Page",
              },
            ],
          }
        : GROUPS,
    pending: false,
    error: null,
    refetch: vi.fn(),
    fetching: false,
  })) as unknown as typeof usePluginRoute);
}

const chooseType = (slug: string) =>
  fireEvent.change(screen.getByLabelText("Content type"), {
    target: { value: slug },
  });

describe("the bulk edit screen, Codex round 2", () => {
  it("reads a type opened before an import again when it is chosen after", async () => {
    twoTypes();
    let imported = false;
    vi.mocked(readPluginRoute).mockImplementation((async (args: {
      path: string;
    }) => {
      if (args.path.includes("type=pages")) {
        return {
          type: "pages",
          rows: [{ ...ROWS[0]!, id: "g1", label: "About us" }],
          total: 1,
          more: false,
        };
      }
      return {
        type: "posts",
        rows: imported
          ? ROWS.map(row =>
              row.id === "p1" ? { ...row, title: "Imported title" } : row
            )
          : ROWS,
        total: 4,
        more: false,
      };
    }) as unknown as typeof readPluginRoute);
    render(<SeoBulkPage />);
    await screen.findByLabelText("Title on Google for Surfer vs Rext");
    chooseType("pages");
    await screen.findByLabelText("Title on Google for About us");
    imported = true;
    fireEvent.click(screen.getByRole("button", { name: "Do a dry run" }));
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Import 2 pages, all or nothing",
      })
    );
    await waitFor(() =>
      expect(writes.some(write => write.path === "/import/apply")).toBe(true)
    );
    chooseType("posts");
    await waitFor(() =>
      expect(titleOf("Surfer vs Rext").value).toBe("Imported title")
    );
  });

  it("asks before the page is left with changes on any type", async () => {
    twoTypes();
    const leave = () => {
      const event = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    };
    render(<SeoBulkPage />);
    await screen.findByLabelText("Title on Google for Surfer vs Rext");
    expect(leave()).toBe(false);
    fireEvent.change(titleOf("Surfer vs Rext"), { target: { value: "New" } });
    chooseType("pages");
    expect(leave()).toBe(true);
    chooseType("posts");
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(leave()).toBe(false);
  });

  it("offers to read the pages again when their first read is refused", async () => {
    let refuse = true;
    vi.mocked(readPluginRoute).mockImplementation((async () => {
      if (refuse) throw new Error("The pages could not be read.");
      return { type: "posts", rows: ROWS, total: 4, more: false };
    }) as unknown as typeof readPluginRoute);
    render(<SeoBulkPage />);
    const again = await screen.findByRole("button", { name: "Read again" });
    refuse = false;
    fireEvent.click(again);
    expect(
      await screen.findByLabelText("Title on Google for Surfer vs Rext")
    ).toBeTruthy();
  });
});

describe("the bulk edit screen, Codex round 3", () => {
  it("edits a saved row from its new version while the table is read again", async () => {
    let reads = 0;
    vi.mocked(readPluginRoute).mockImplementation((async () => {
      reads++;
      if (reads > 1) return new Promise(() => undefined);
      return { type: "posts", rows: ROWS, total: 4, more: false };
    }) as unknown as typeof readPluginRoute);
    vi.mocked(writePluginRoute).mockImplementation((async (request: {
      path: string;
      body?: unknown;
    }) => {
      writes.push({ path: request.path, body: request.body });
      return { message: "Saved 1 page.", saved: 1, revs: { p1: "4" } };
    }) as unknown as typeof writePluginRoute);
    render(<SeoBulkPage />);
    await screen.findByLabelText("Title on Google for Surfer vs Rext");
    fireEvent.change(titleOf("Surfer vs Rext"), { target: { value: "New" } });
    fireEvent.click(screen.getByRole("button", { name: "Save all" }));
    await waitFor(() => expect(reads).toBe(2));
    await waitFor(() => expect(titleOf("Surfer vs Rext").readOnly).toBe(false));
    expect(titleOf("Surfer vs Rext").value).toBe("New");
    fireEvent.change(
      screen.getByLabelText("Description on Google for Surfer vs Rext"),
      { target: { value: "Saved after" } }
    );
    fireEvent.click(screen.getByRole("button", { name: "Save all" }));
    await waitFor(() => expect(writes).toHaveLength(2));
    expect(writes[1]?.body).toEqual({
      type: "posts",
      changes: [{ id: "p1", rev: "4", description: "Saved after" }],
    });
  });
});

describe("the bulk edit screen, Codex round 4", () => {
  it("reads as many pages of a type put away by an import as were read before", async () => {
    twoTypes();
    vi.mocked(readPluginRoute).mockImplementation((async (args: {
      path: string;
    }) => {
      if (args.path.includes("type=pages")) {
        return {
          type: "pages",
          rows: [{ ...ROWS[0]!, id: "g1", label: "About us" }],
          total: 1,
          more: false,
        };
      }
      return args.path.includes("page=2")
        ? { type: "posts", rows: [ROWS[1]!], total: 2, more: false }
        : { type: "posts", rows: [ROWS[0]!], total: 2, more: true };
    }) as unknown as typeof readPluginRoute);
    render(<SeoBulkPage />);
    await screen.findByLabelText("Title on Google for Surfer vs Rext");
    fireEvent.click(screen.getByRole("button", { name: "Show more" }));
    await screen.findByLabelText("Title on Google for Jasper vs Rext");
    fireEvent.change(titleOf("Jasper vs Rext"), {
      target: { value: "Jasper, again" },
    });
    chooseType("pages");
    await screen.findByLabelText("Title on Google for About us");
    fireEvent.click(screen.getByRole("button", { name: "Do a dry run" }));
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Import 2 pages, all or nothing",
      })
    );
    await waitFor(() =>
      expect(writes.some(write => write.path === "/import/apply")).toBe(true)
    );
    chooseType("posts");
    await screen.findByLabelText("Title on Google for Jasper vs Rext");
    expect(titleOf("Jasper vs Rext").value).toBe("Jasper, again");
    expect(screen.getByText("1 change")).toBeTruthy();
  });
});
