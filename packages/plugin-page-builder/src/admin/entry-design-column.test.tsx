// @vitest-environment jsdom

/**
 * The entry list's Design column: offered only on the lists of collections
 * with a template, decided by one read per collection rather than one per
 * list draw, and each cell marking an own design with the one pill.
 *
 * The property separating this from a plausible broken column is that the
 * provider on every list adds NOTHING itself: a provider that returned the
 * column for every list would put "Design" on the users list too.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { EntryDesignsResponse } from "../templates/entry-designs-contract";

type Provider = (ctx: { target: string }) => unknown[];
const providers: { target: string; provider: Provider }[] = [];
const reads: string[] = [];
let answers: Record<string, EntryDesignsResponse | undefined> = {};
let cellRead: {
  data: EntryDesignsResponse | undefined;
  error: Error | null;
} = { data: undefined, error: null };

vi.mock("@nextlyhq/plugin-sdk/admin", () => ({
  registerColumns: (target: string, provider: Provider) => {
    providers.push({ target, provider });
  },
  readPluginRoute: ({ path }: { path: string }) => {
    reads.push(path);
    const collection = new URLSearchParams(path.split("?")[1]).get(
      "collection"
    );
    return Promise.resolve(answers[collection ?? ""]);
  },
  usePluginRoute: () => ({
    ...cellRead,
    pending: false,
    fetching: false,
    refetch: () => {},
  }),
}));

const { DesignCell, registerEntryDesignColumn } = await import(
  "./entry-design-column"
);

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
      templateAllowed: true,
      mayCreateTemplate: false,
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
