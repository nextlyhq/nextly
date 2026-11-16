// @vitest-environment jsdom

/**
 * "Show when" in a block's Content tab: what it shows for a block with no
 * conditions, one AND group, groups set through the API and a condition the
 * page can't check, and what it writes.
 */
import {
  defineNamedQuery,
  findNode,
  namedQueryDeclaration,
  type BlockDocument,
} from "@nextlyhq/blocks-engine";
import { act, cleanup, render, screen } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it } from "vitest";

import { ShowWhen } from "./condition-controls";
import type { ContentServices, LoopCollection } from "./content-controls";
import { useEditorState, type EditorState } from "./editor-state";
import type { CustomSource } from "./named-query-model";

afterEach(cleanup);

const POSTS: LoopCollection = {
  slug: "posts",
  label: "Posts",
  singular: "Post",
  fields: [
    { name: "title", label: "Title", kind: "text" },
    { name: "rating", label: "Reading time", kind: "number" },
    { name: "featured", label: "Featured", kind: "boolean" },
    { name: "author", label: "Author", kind: "entry", relationTo: "authors" },
  ],
  declared: ["id", "title", "rating", "featured", "author", "tags", "secret"],
  readable: [
    { name: "title", label: "Title", type: "text" },
    { name: "rating", label: "Reading time", type: "number" },
    { name: "featured", label: "Featured", type: "checkbox" },
    {
      name: "author",
      label: "Author",
      type: "relationship",
      relationTo: "authors",
    },
    // Several entries: no list filters by it, and a condition may ask
    // whether it has a value.
    {
      name: "tags",
      label: "Tags",
      type: "relationship",
      relationTo: "tags",
      hasMany: true,
    },
  ],
};

const AUTHORS: Readonly<Record<string, string>> = { a1: "Ada", a2: "Grace" };

const services: ContentServices = {
  listLoopCollections: async () => [POSTS],
  entryCollection: "posts",
  findEntries: async query =>
    (query.ids ?? []).flatMap(id =>
      AUTHORS[id] === undefined ? [] : [{ id, title: AUTHORS[id] }]
    ),
};

let editorRef: EditorState | null = null;

function Host({ document }: { document: BlockDocument }): React.JSX.Element {
  const editor = useEditorState({ initialDocument: document });
  editorRef = editor;
  return <ShowWhen editor={editor} nodeId="a" services={services} />;
}

function withConditions(conditions?: unknown): BlockDocument {
  return {
    formatVersion: 1,
    kind: "page",
    nodes: [
      {
        id: "a",
        type: "core/heading",
        version: 1,
        props: {},
        ...(conditions === undefined ? {} : { visibility: { conditions } }),
      },
    ],
  } as BlockDocument;
}

async function shown(document: BlockDocument): Promise<void> {
  render(<Host document={document} />);
  // The collections are read once, then the rows and their sentences draw.
  await act(async () => {
    await Promise.resolve();
  });
}

describe("Show when", () => {
  it("says a block with no conditions is always shown, and names its entry", async () => {
    await shown(withConditions());
    expect(screen.getByText("Always shown.")).toBeTruthy();
    expect(screen.getByText("This post")).toBeTruthy();
  });

  it("draws one AND group as sentences", async () => {
    await shown(
      withConditions([
        [
          { field: "title", op: "contains", value: "guide" },
          { field: "rating", op: "gt", value: 5 },
        ],
      ])
    );
    expect(
      screen.getByText(
        "Show this block only when all of these match this post."
      )
    ).toBeTruthy();
    expect(screen.getByTitle("Title contains “guide”")).toBeTruthy();
    // An older spelling reads as the operator it names.
    expect(screen.getByTitle("Reading time is more than 5")).toBeTruthy();
  });

  it("removes a condition, and the block's visibility with the last one", async () => {
    await shown(withConditions([[{ field: "title", op: "exists" }]]));
    act(() => {
      screen
        .getByRole("button", { name: "Remove condition: Title has a value" })
        .click();
    });
    expect(
      findNode(editorRef!.document.nodes, "a")?.visibility
    ).toBeUndefined();
  });

  it("says visitors never see a block whose condition the page can't check", async () => {
    await shown(withConditions([[{ field: "secret", op: "exists" }]]));
    expect(screen.getByRole("alert").textContent).toContain(
      "Visitors never see this block."
    );
  });

  it("shows groups set through the API, and keeps the first when asked", async () => {
    await shown(
      withConditions([
        [{ field: "title", op: "exists" }],
        [{ field: "rating", op: "less_than", value: 3 }],
      ])
    );
    expect(
      screen.getByText(
        "Shown when any of these groups match. They were set through the API."
      )
    ).toBeTruthy();
    act(() => {
      screen.getByRole("button", { name: "Edit as one group" }).click();
    });
    expect(findNode(editorRef!.document.nodes, "a")?.visibility).toEqual({
      conditions: [[{ field: "title", op: "exists" }]],
    });
  });

  it("shows conditions it can't read as such, and removes them when asked", async () => {
    // A group holding something other than a condition, and a flat list.
    const hidden = {
      ...withConditions(),
      nodes: [{ ...withConditions().nodes[0]!, visibility: "hidden" }],
    } as unknown as BlockDocument;
    for (const unreadable of [
      withConditions([[null]]),
      withConditions([{ field: "title", op: "exists" }]),
      // A visibility that is not a record at all.
      hidden,
    ]) {
      await shown(unreadable);
      expect(screen.queryByText("Always shown.")).toBeNull();
      expect(screen.getByRole("alert").textContent).toContain(
        "Visitors never see this block."
      );
      act(() => {
        screen.getByRole("button", { name: "Remove conditions" }).click();
      });
      expect(
        findNode(editorRef!.document.nodes, "a")?.visibility
      ).toBeUndefined();
      cleanup();
    }
  });

  it("stops adding at the most conditions a block may have", async () => {
    const most = Array.from({ length: 20 }, () => ({
      field: "title",
      op: "exists",
    }));
    await shown(withConditions([most]));
    const add = screen.getByRole("button", { name: "Add condition" });
    expect((add as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Up to 20 conditions.")).toBeTruthy();
  });

  it("reads a yes-or-no field's equals Yes as is Yes, and equals No as it stands", async () => {
    await shown(
      withConditions([
        [
          { field: "featured", op: "equals", value: true },
          { field: "featured", op: "equals", value: false },
        ],
      ])
    );
    expect(screen.getByTitle("Featured is Yes")).toBeTruthy();
    // Unlike "is No", it doesn't hold for an entry with no value.
    expect(screen.getByTitle("Featured is set to No")).toBeTruthy();
  });

  it("offers a field no list filters by, which a condition asks has a value", async () => {
    await shown(withConditions([[{ field: "tags", op: "exists" }]]));
    // CONTROL: named as the admin names it, not "not offered here".
    expect(screen.getByTitle("Tags has a value")).toBeTruthy();
  });

  it("reads a group with a hole in it as conditions it can't show", async () => {
    const sparse: unknown[] = [];
    sparse[1] = { field: "title", op: "exists" };
    await shown(withConditions([sparse]));
    expect(
      screen.getByRole("button", { name: "Remove conditions" })
    ).toBeTruthy();
  });

  it("offers the lone yes-or-no operator to repair a row holding another", async () => {
    // An operator conditions don't have reads as not chosen yet.
    await shown(withConditions([[{ field: "featured", op: "bogus" }]]));
    act(() => {
      screen.getByTitle("Featured").click();
    });
    const compare = screen.getByRole("combobox", {
      name: "How Featured is compared",
    }) as HTMLButtonElement;
    expect(compare.disabled).toBe(false);
  });

  it("names related entries by their titles in groups set through the API", async () => {
    await shown(
      withConditions([
        [{ field: "author", op: "equals", value: "a1" }],
        [{ field: "author", op: "equals", value: "a2" }],
      ])
    );
    await act(async () => {
      await Promise.resolve();
    });
    const text = document.querySelector(".nx-show-when__groups")?.textContent;
    expect(text).toContain("Ada");
    expect(text).toContain("Grace");
  });

  it("says when the site's collections couldn't be listed, rather than blaming the conditions", async () => {
    function Unlisted(): React.JSX.Element {
      const editor = useEditorState({
        initialDocument: withConditions([[{ field: "title", op: "exists" }]]),
      });
      return (
        <ShowWhen
          editor={editor}
          nodeId="a"
          services={{
            listLoopCollections: () => Promise.reject(new Error("offline")),
            entryCollection: "posts",
          }}
        />
      );
    }
    render(<Unlisted />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(
      screen.getByText(
        "The site's collections could not be listed, so conditions can't be chosen here."
      )
    ).toBeTruthy();
  });

  it("offers conditions stored as null for removal, without saying visitors never see the block", async () => {
    // The page reads `null` as no restriction; the save refuses it.
    await shown(withConditions(null));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText(/Visitors see this block/)).toBeTruthy();
    act(() => {
      screen.getByRole("button", { name: "Remove conditions" }).click();
    });
    expect(
      findNode(editorRef!.document.nodes, "a")?.visibility
    ).toBeUndefined();
  });
});

describe("Show when, in a list whose source is a custom source", () => {
  /** A query whose rows are a schema of its own: no collection holds them. */
  const soon: CustomSource = {
    declaration: namedQueryDeclaration(
      defineNamedQuery({
        name: "events.soon",
        label: "Events soon",
        reads: {},
        rows: {
          key: "id",
          fields: [
            { name: "id", type: "text" },
            { name: "startsAt", type: "date" },
          ],
        },
        run: () => Promise.resolve({ rows: [] }),
      })
    ),
    readsHidden: [],
  };

  /** Block `a` inside a list of `events.soon`, hidden by `conditions`. */
  const inList = (conditions: unknown): BlockDocument =>
    ({
      formatVersion: 1,
      kind: "page",
      nodes: [
        {
          id: "list",
          type: "core/collection-loop",
          version: 1,
          props: { namedQuery: { name: "events.soon", params: {} } },
          slots: {
            children: [
              {
                id: "a",
                type: "core/heading",
                version: 1,
                props: {},
                visibility: { conditions },
              },
            ],
          },
        },
      ],
    }) as BlockDocument;

  function ListHost({
    document,
    lent,
  }: {
    document: BlockDocument;
    lent: ContentServices;
  }): React.JSX.Element {
    const editor = useEditorState({ initialDocument: document });
    return <ShowWhen editor={editor} nodeId="a" services={lent} />;
  }

  async function shownWith(lent: ContentServices): Promise<void> {
    render(
      <ListHost
        document={inList([[{ field: "startsAt", op: "exists" }]])}
        lent={lent}
      />
    );
    // The collections and the custom sources are each read once.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  it("offers and judges the fields its query's rows declare", async () => {
    await shownWith({ ...services, listCustomSources: async () => [soon] });
    expect(screen.getByTitle("startsAt has a value")).toBeTruthy();
    // Judged by the rows' own fields, as the save judges it: checkable.
    expect(screen.queryByRole("alert")).toBeNull();
    const add = screen.getByRole("button", { name: "Add condition" });
    expect((add as HTMLButtonElement).disabled).toBe(false);
  });

  it("has nothing to offer before the site's custom sources are known", async () => {
    // The control: the same list, with no custom sources lent.
    await shownWith(services);
    const add = screen.getByRole("button", { name: "Add condition" });
    expect((add as HTMLButtonElement).disabled).toBe(true);
  });
});
