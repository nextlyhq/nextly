// @vitest-environment jsdom

/**
 * The entry list's Design column: offered only on the lists of collections
 * with a template or own designs, decided by one read per collection rather
 * than one per list draw, taken back when a later settled read says the
 * collection has neither, and each cell marking an own design with the one
 * pill.
 *
 * The property separating this from a plausible broken column is that the
 * provider on every list adds NOTHING itself: a provider that returned the
 * column for every list would put "Design" on the users list too. And a
 * column kept for good once given would go on calling every entry
 * "Template" after its template was deleted.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { EntryDesignsResponse } from "../templates/entry-designs-contract";

type Provider = (ctx: { target: string }) => unknown[];
type Transform = (columns: { name: string }[]) => { name: string }[];
const providers: { target: string; provider: Provider }[] = [];
const transforms: { target: string; transform: Transform }[] = [];
const reads: string[] = [];
let answers: Record<string, EntryDesignsResponse | undefined> = {};
let cellRead: {
  data: EntryDesignsResponse | undefined;
  error: Error | null;
  fetching?: boolean;
} = { data: undefined, error: null };

/** `entry` added to `list`, with the removal the registry hands back. */
function listed<T>(list: T[], entry: T): () => void {
  list.push(entry);
  return () => {
    const at = list.indexOf(entry);
    if (at !== -1) list.splice(at, 1);
  };
}

vi.mock("@nextlyhq/plugin-sdk/admin", () => ({
  registerColumns: (target: string, provider: Provider) =>
    listed(providers, { target, provider }),
  transformColumns: (target: string, transform: Transform) =>
    listed(transforms, { target, transform }),
  readPluginRoute: ({ path }: { path: string }) => {
    reads.push(path);
    const collection = new URLSearchParams(path.split("?")[1]).get(
      "collection"
    );
    return Promise.resolve(answers[collection ?? ""]);
  },
  usePluginRoute: () => ({
    pending: false,
    fetching: false,
    refetch: () => {},
    ...cellRead,
  }),
}));

const { DesignCell, designAfterStatus, registerEntryDesignColumn } =
  await import("./entry-design-column");

function answer(
  template: EntryDesignsResponse["meta"]["template"],
  items: EntryDesignsResponse["items"] = [],
  hasNext = false
): EntryDesignsResponse {
  return {
    items,
    meta: {
      total: items.length,
      page: 1,
      limit: 500,
      totalPages: 1,
      hasNext,
      hasPrev: false,
      template,
      templateReadable: true,
      templateAllowed: true,
      mayCreateTemplate: false,
      mayGiveDesign: false,
      entry: null,
      templatesCollection: "templates",
      names: { singular: "Post", plural: "Posts" },
      collection: "posts",
    },
  };
}

/** Every provider registered for `target` or every list, asked once. */
function columnsOf(target: string): { name?: string; header?: unknown }[] {
  return providers
    .filter(each => each.target === target || each.target === "*")
    .flatMap(each => each.provider({ target })) as {
    name?: string;
    header?: unknown;
  }[];
}

afterEach(() => {
  cleanup();
  cellRead = { data: undefined, error: null };
});

describe("the Design column", () => {
  it("is added only to a collection with a template, after one read of it", async () => {
    answers = {
      posts: answer({ id: "t1", title: "Blog post", status: "published" }),
      users: answer(null),
    };
    registerEntryDesignColumn();
    registerEntryDesignColumn();
    expect(providers.filter(each => each.target === "*")).toHaveLength(1);

    // The first draw of each list asks; nothing is added yet.
    expect(columnsOf("posts")).toEqual([]);
    expect(columnsOf("users")).toEqual([]);
    // A redraw asks nothing more.
    columnsOf("posts");
    await vi.waitFor(() =>
      expect(providers.some(each => each.target === "posts")).toBe(true)
    );
    expect(reads).toEqual([
      "/templates/entry-designs?collection=posts",
      "/templates/entry-designs?collection=users",
    ]);

    expect(columnsOf("posts").map(column => column.header)).toEqual(["Design"]);
    expect(columnsOf("users")).toEqual([]);

    // Moved to right after Status on the list given it, and only there: the
    // list's own columns, with the provider's appended after every field.
    expect(transforms.map(each => each.target)).toEqual(["posts"]);
    const listed = [
      { name: "title" },
      { name: "status" },
      { name: "excerpt" },
      { name: "metaTitle" },
      ...(columnsOf("posts") as { name: string }[]),
    ];
    expect(transforms[0]!.transform(listed).map(column => column.name)).toEqual(
      ["title", "status", "__pageBuilderOwnDesign", "excerpt", "metaTitle"]
    );
  });

  it("adds the column to a collection given a template later, on a later list view", async () => {
    // Continues from the case above: "users" answered no template.
    answers = {
      ...answers,
      users: answer({ id: "t2", title: "Profile", status: "published" }),
    };
    // A redraw of the same list view asks nothing more.
    expect(columnsOf("users")).toEqual([]);
    expect(reads.filter(path => path.endsWith("=users"))).toHaveLength(1);

    // Opened again a while later, it asks again, and gets the column.
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(Date.now() + 31_000);
      columnsOf("users");
      await vi.waitFor(() =>
        expect(providers.some(each => each.target === "users")).toBe(true)
      );
    } finally {
      vi.useRealTimers();
    }
    expect(reads.filter(path => path.endsWith("=users"))).toHaveLength(2);
    expect(columnsOf("users").map(column => column.header)).toEqual(["Design"]);
    // A list with its column is not asked about again.
    columnsOf("posts");
    expect(reads.filter(path => path.endsWith("=posts"))).toHaveLength(1);
  });

  it("takes the column back when a settled read says there is no template and no own design", () => {
    // Continues from above: "users" has its column. Its template is then
    // deleted, and its list is drawn again.
    answers = { ...answers, users: answer(null) };

    // A cached answer shown while the read is asked again moves nothing.
    cellRead = { data: answer(null), error: null, fetching: true };
    render(<DesignCell collection="users" row={{ id: "u1" }} />);
    expect(providers.some(each => each.target === "users")).toBe(true);
    cleanup();

    // The settled answer takes it back, its move with it, and the row is not
    // called "Template" while it is still drawn.
    cellRead = { data: answer(null), error: null };
    const { container } = render(
      <DesignCell collection="users" row={{ id: "u1" }} />
    );
    expect(container.textContent).toBe("");
    expect(providers.some(each => each.target === "users")).toBe(false);
    expect(transforms.some(each => each.target === "users")).toBe(false);
    expect(columnsOf("users")).toEqual([]);
    // The redraw that follows asks nothing more for a while.
    expect(reads.filter(path => path.endsWith("=users"))).toHaveLength(2);
    // Another list keeps its column.
    expect(columnsOf("posts").map(column => column.header)).toEqual(["Design"]);
  });

  it("gives the column back when a later view finds a template again", async () => {
    answers = {
      ...answers,
      users: answer({ id: "t3", title: "Profile", status: "published" }),
    };
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(Date.now() + 31_000);
      columnsOf("users");
      await vi.waitFor(() =>
        expect(providers.some(each => each.target === "users")).toBe(true)
      );
    } finally {
      vi.useRealTimers();
    }
    expect(reads.filter(path => path.endsWith("=users"))).toHaveLength(3);
    expect(columnsOf("users").map(column => column.header)).toEqual(["Design"]);
    expect(transforms.filter(each => each.target === "users").length).toBe(1);
  });

  it("keeps the column for own designs whose template is gone, marking only them", () => {
    const kept = answer(null, [
      {
        id: "d1",
        entryId: "p1",
        title: "Hello",
        status: "published",
        updatedAt: null,
      },
    ]);
    cellRead = { data: kept, error: null };
    render(<DesignCell collection="posts" row={{ id: "p1" }} />);
    expect(screen.getByText("Own design")).toBeTruthy();
    expect(providers.some(each => each.target === "posts")).toBe(true);
    cleanup();

    // An entry without one is drawn with no template at all: no mark.
    const { container } = render(
      <DesignCell collection="posts" row={{ id: "p2" }} />
    );
    expect(container.textContent).toBe("");
    expect(providers.some(each => each.target === "posts")).toBe(true);
  });

  it("marks an own design with the one pill, dashed while not published", () => {
    cellRead = {
      data: answer({ id: "t1", title: "Blog post", status: "published" }, [
        {
          id: "d1",
          entryId: "p1",
          title: "Hello",
          status: "draft",
          updatedAt: null,
        },
      ]),
      error: null,
    };
    render(<DesignCell collection="posts" row={{ id: "p1" }} />);
    expect(screen.getByText("Own design · not published")).toBeTruthy();
    expect(
      screen
        .getByText("Own design · not published")
        .closest("[data-own-design]")
        ?.getAttribute("title")
    ).toBe("Not published yet: visitors see the Blog post template");
  });

  it("says Template for an entry drawn with the template", () => {
    cellRead = {
      data: answer({ id: "t1", title: "Blog post", status: "published" }),
      error: null,
    };
    render(<DesignCell collection="posts" row={{ id: 7 }} />);
    expect(screen.getByText("Template")).toBeTruthy();
  });

  it("says nothing of an entry past a list cut at its bound", () => {
    cellRead = {
      data: answer(
        { id: "t1", title: "Blog post", status: "published" },
        [],
        true
      ),
      error: null,
    };
    const { container } = render(
      <DesignCell collection="posts" row={{ id: "p9" }} />
    );
    expect(container.innerHTML).toBe("");
  });

  it("holds the pill's place while the read is out", () => {
    const { container } = render(
      <DesignCell collection="posts" row={{ id: "p1" }} />
    );
    expect(container.querySelector("[aria-hidden='true']")).not.toBeNull();
    expect(container.textContent).toBe("");
  });
});

describe("the Design column's place", () => {
  const design = { name: "__pageBuilderOwnDesign" };

  it("sits right after Status, whatever came between them", () => {
    expect(
      designAfterStatus([
        { name: "title" },
        { name: "status" },
        { name: "excerpt" },
        { name: "updatedAt" },
        design,
      ]).map(column => column.name)
    ).toEqual([
      "title",
      "status",
      "__pageBuilderOwnDesign",
      "excerpt",
      "updatedAt",
    ]);
  });

  it("sits right after the first column on a list with no Status column", () => {
    expect(
      designAfterStatus([
        { name: "title" },
        { name: "slug" },
        { name: "createdAt" },
        { name: "excerpt" },
        design,
      ]).map(column => column.name)
    ).toEqual([
      "title",
      "__pageBuilderOwnDesign",
      "slug",
      "createdAt",
      "excerpt",
    ]);
  });

  it("stays the only column of a list that has no other", () => {
    expect(designAfterStatus([design])).toEqual([design]);
  });

  it("leaves a list without the Design column as it came", () => {
    const columns = [{ name: "status" }, { name: "title" }];
    expect(designAfterStatus(columns)).toEqual(columns);
  });
});
