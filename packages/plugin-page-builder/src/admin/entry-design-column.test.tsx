// @vitest-environment jsdom

/**
 * The entry list's Design column: offered only on the lists of collections
 * with a template or own designs, decided by one read per collection rather
 * than one per list draw, taken back when a later settled read says the
 * collection has neither, each cell marking an own design with the one
 * pill, and, where the collection's answer is capped, the rows on screen
 * looked up by their ids in one request for the page.
 *
 * The property separating this from a plausible broken column is that the
 * provider on every list adds NOTHING itself: a provider that returned the
 * column for every list would put "Design" on the users list too. And a
 * column kept for good once given would go on calling every entry
 * "Template" after its template was deleted. And a column that looked up
 * each row on its own would ask the server once per row.
 */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { EntryDesignsResponse } from "../templates/entry-designs-contract";

type Provider = (ctx: {
  target: string;
  deciding?: (until: Promise<unknown>) => unknown[];
}) => unknown[];
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
/** The lookup of the rows on screen: what it answers, and each path asked. */
let lookupRead: {
  data: EntryDesignsResponse | undefined;
  error: Error | null;
} = { data: undefined, error: null };
const lookups: string[] = [];

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
  usePluginRoute: ({ path, enabled }: { path: string; enabled?: boolean }) => {
    const settled = { pending: false, fetching: false, refetch: () => {} };
    if (!path.includes("&entries=")) return { ...settled, ...cellRead };
    // A held read asks nothing and has nothing.
    if (enabled === false) return { ...settled, data: undefined, error: null };
    lookups.push(path);
    return { ...settled, ...lookupRead };
  },
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

/** What the providers said their columns wait on, by list, as last asked. */
const decidingOn = new Map<string, Promise<unknown>>();

/** Every provider registered for `target` or every list, asked once. */
function columnsOf(target: string): { name?: string; header?: unknown }[] {
  decidingOn.delete(target);
  return providers
    .filter(each => each.target === target || each.target === "*")
    .flatMap(each =>
      each.provider({
        target,
        deciding: until => {
          decidingOn.set(target, until);
          return [];
        },
      })
    ) as {
    name?: string;
    header?: unknown;
  }[];
}

afterEach(() => {
  cleanup();
  cellRead = { data: undefined, error: null };
  lookupRead = { data: undefined, error: null };
  lookups.length = 0;
});

const BLOG_POST = {
  id: "t1",
  title: "Blog post",
  status: "published",
} as const;

/** An own design of `entryId`, as the read lists it. */
function ownDesign(entryId: string): EntryDesignsResponse["items"][number] {
  return {
    id: `d-${entryId}`,
    entryId,
    title: entryId,
    status: "published",
    updatedAt: null,
  };
}

/** One cell for each of `ids`, as a list page draws them. */
function page(ids: string[]) {
  return (
    <>
      {ids.map(id => (
        <DesignCell key={id} collection="posts" row={{ id }} />
      ))}
    </>
  );
}

describe("the Design column", () => {
  it("is added only to a collection with a template, after one read of it", async () => {
    answers = {
      posts: answer({ id: "t1", title: "Blog post", status: "published" }),
      users: answer(null),
    };
    registerEntryDesignColumn();
    registerEntryDesignColumn();
    expect(providers.filter(each => each.target === "*")).toHaveLength(1);

    // The first draw of each list asks; nothing is added yet, and each list
    // is told its columns wait on that read, so it holds its rows for it.
    expect(columnsOf("posts")).toEqual([]);
    expect(columnsOf("users")).toEqual([]);
    expect(decidingOn.has("users")).toBe(true);
    // A redraw asks nothing more, and waits on the same read.
    const waitedOn = decidingOn.get("users");
    columnsOf("users");
    expect(decidingOn.get("users")).toBe(waitedOn);
    columnsOf("posts");
    await vi.waitFor(() =>
      expect(providers.some(each => each.target === "posts")).toBe(true)
    );
    // Once it has answered, neither list waits any more: one has its column,
    // the other none.
    await decidingOn.get("posts");
    expect(columnsOf("posts").map(column => column.header)).toEqual(["Design"]);
    expect(decidingOn.has("posts")).toBe(false);
    await waitedOn;
    columnsOf("users");
    expect(decidingOn.has("users")).toBe(false);
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

  it("says Collection template for an entry drawn with the template", () => {
    cellRead = {
      data: answer({ id: "t1", title: "Blog post", status: "published" }),
      error: null,
    };
    render(<DesignCell collection="posts" row={{ id: 7 }} />);
    expect(screen.getByText("Collection template")).toBeTruthy();
  });

  it("draws on the server, before any row on screen is known", () => {
    // React asks a store its server snapshot here, and refuses to render a
    // store that has none, so a list loaded directly would fail to draw.
    cellRead = { data: answer(BLOG_POST, [ownDesign("p1")]), error: null };
    const html = renderToString(
      <DesignCell collection="posts" row={{ id: "p1" }} />
    );
    expect(html).toContain("Own design");
  });

  it("asks no lookup of the rows when the collection's answer is whole", () => {
    cellRead = { data: answer(BLOG_POST, [ownDesign("p1")]), error: null };
    render(page(["p1", "p2"]));
    expect(screen.getByText("Own design")).toBeTruthy();
    expect(screen.getByText("Collection template")).toBeTruthy();
    expect(lookups).toEqual([]);
  });

  it("holds the pill's place while the read is out", () => {
    // A collection whose list was never decided: nothing to draw from yet.
    const { container } = render(
      <DesignCell collection="notes" row={{ id: "n1" }} />
    );
    expect(container.querySelector("[aria-hidden='true']")).not.toBeNull();
    expect(container.textContent).toBe("");
  });

  it("draws from the latest settled answer, not the cache, while its own read is asked again", () => {
    // The latest settled answer: the collection has its template now.
    cellRead = { data: answer(BLOG_POST), error: null };
    render(<DesignCell collection="posts" row={{ id: "p1" }} />);
    cleanup();
    // The list opened again: the cache still shows an older answer with no
    // template while the cell's read is asked again.
    cellRead = { data: answer(null), error: null, fetching: true };
    render(<DesignCell collection="posts" row={{ id: "p1" }} />);
    expect(screen.getByText("Collection template")).toBeTruthy();
  });

  it("draws from the read that gave its list the column while its own read is out", () => {
    // The posts list's latest answer: its template, and no own designs.
    cellRead = { data: answer(BLOG_POST), error: null };
    render(<DesignCell collection="posts" row={{ id: "p1" }} />);
    cleanup();
    // The next cell's own read is out: it draws "Template" from its first
    // frame, not the pill's placeholder, so the column does not change width
    // when its own read lands.
    cellRead = { data: undefined, error: null };
    const { container } = render(
      <DesignCell collection="posts" row={{ id: "p1" }} />
    );
    expect(screen.getByText("Collection template")).toBeTruthy();
    expect(container.querySelector("[aria-hidden='true']")).toBeNull();
  });
});

describe("a read of the collection that fails", () => {
  // The list is asked again once the read settles, failed or not, so the
  // property separating this from a plausible broken column is that the
  // failure is remembered: one that forgot it would ask the server again on
  // every draw while the failure lasts.
  it("is not asked again at once when the list draws again", async () => {
    answers = {};
    const failing = "failing";
    let refuse: (reason: Error) => void = () => {};
    const before = reads.length;
    const mocked = await import("@nextlyhq/plugin-sdk/admin");
    const spy = vi.spyOn(mocked, "readPluginRoute").mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          refuse = reject;
        })
    );
    try {
      columnsOf(failing);
      const out = decidingOn.get(failing);
      expect(out).toBeDefined();
      refuse(new Error("offline"));
      await out;
      // Drawn again, as the list is once the read settles.
      expect(columnsOf(failing)).toEqual([]);
      expect(decidingOn.has(failing)).toBe(false);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(reads.length).toBe(before);
    } finally {
      spy.mockRestore();
    }
  });
});

describe("the rows on screen, past a capped answer", () => {
  it("marks a row whose own design lies past the cap, from one lookup for the page", async () => {
    // The collection's answer is cut at its bound and lists none of these
    // rows; the lookup by id finds p9's own design.
    cellRead = { data: answer(BLOG_POST, [], true), error: null };
    lookupRead = { data: answer(BLOG_POST, [ownDesign("p9")]), error: null };
    render(page(["p2", "p9", "p1"]));

    await waitFor(() => expect(screen.getByText("Own design")).toBeTruthy());
    // The rows it finds none for are drawn with the template, which only the
    // lookup can say.
    expect(screen.getAllByText("Collection template")).toHaveLength(2);
    // One path for the whole page, never one per row.
    expect([...new Set(lookups)]).toEqual([
      "/templates/entry-designs?collection=posts&entries=p1,p2,p9",
    ]);
  });

  it("asks again for the next page's rows alone", async () => {
    cellRead = { data: answer(BLOG_POST, [], true), error: null };
    lookupRead = { data: answer(BLOG_POST, [ownDesign("p4")]), error: null };
    const { rerender } = render(page(["p1", "p2"]));
    await waitFor(() => expect(lookups.length).toBeGreaterThan(0));

    lookups.length = 0;
    rerender(page(["p3", "p4"]));
    await waitFor(() => expect(screen.getByText("Own design")).toBeTruthy());
    expect([...new Set(lookups)]).toEqual([
      "/templates/entry-designs?collection=posts&entries=p3,p4",
    ]);
  });

  it("holds the pill's place while the lookup is out, and claims nothing if it fails", async () => {
    cellRead = { data: answer(BLOG_POST, [], true), error: null };
    const { container } = render(page(["p1"]));
    await waitFor(() => expect(lookups.length).toBeGreaterThan(0));
    expect(container.querySelector("[aria-hidden='true']")).not.toBeNull();
    expect(container.textContent).toBe("");
    cleanup();

    // A capped answer cannot say a row has none, so a failed lookup leaves
    // the cell empty rather than calling it "Template".
    lookupRead = { data: undefined, error: new Error("offline") };
    lookups.length = 0;
    const failed = render(page(["p1"]));
    await waitFor(() => expect(lookups.length).toBeGreaterThan(0));
    expect(failed.container.innerHTML).toBe("");
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

  it("sits after the first shown column, past a hidden one before it", () => {
    // The entry list keeps its ID column first and hidden unless shown.
    expect(
      designAfterStatus([
        { name: "id", hidden: true },
        { name: "title" },
        { name: "slug" },
        design,
      ]).map(column => column.name)
    ).toEqual(["id", "title", "__pageBuilderOwnDesign", "slug"]);
  });

  it("stays the only column of a list that has no other", () => {
    expect(designAfterStatus([design])).toEqual([design]);
  });

  it("leaves a list without the Design column as it came", () => {
    const columns = [{ name: "status" }, { name: "title" }];
    expect(designAfterStatus(columns)).toEqual(columns);
  });
});
