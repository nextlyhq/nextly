// @vitest-environment jsdom

/**
 * A new Collection list's two steps on the canvas: its sources, its starting
 * layouts, Skip and Escape, and that a layout is ONE write joined to the
 * list's insert.
 */
import {
  clearBlocks,
  registerBlocks,
  type BlockDocument,
  type BuilderOp,
} from "@nextlyhq/blocks-engine";
import {
  box,
  card,
  heading,
  image,
  paragraph,
} from "@nextlyhq/blocks-react/blocks";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { CollectionListPicker } from "./collection-list-picker";
import type { LoopCollection } from "./inspector/content/content-services";
import type { FirstAdd } from "./first-add";

beforeAll(() => {
  registerBlocks([box, card, heading, image, paragraph] as never, {
    source: "collection-list-picker-test",
  });
});

afterAll(() => {
  clearBlocks();
});

afterEach(() => {
  cleanup();
});

const POSTS: LoopCollection = {
  slug: "posts",
  label: "Posts",
  // Its timestamps, as a collection keeping them lists them to sort by.
  fields: [{ name: "createdAt", label: "Created", kind: "date" }],
  titleField: "title",
  entriesHavePages: true,
  readable: [
    { name: "title", type: "text" },
    { name: "cover", type: "upload", relationTo: "media" },
    { name: "excerpt", type: "textarea" },
  ],
};

const AUTHORS: LoopCollection = {
  slug: "authors",
  label: "Authors",
  fields: [],
  readable: [{ name: "name", type: "text" }],
};

const DOCUMENT: BlockDocument = {
  formatVersion: 1,
  kind: "page",
  nodes: [
    {
      id: "list",
      type: "core/collection-loop",
      version: 1,
      props: { as: "div", limit: 6, sort: "-createdAt" },
    },
  ],
};

function mount(
  options: {
    collections?: readonly LoopCollection[];
    custom?: boolean;
    document?: BlockDocument;
  } = {}
) {
  const choose = vi.fn((_ops: readonly BuilderOp[]) => true);
  const skip = vi.fn();
  const firstAdd: FirstAdd = {
    nodeId: "list",
    chooser: "collection-source",
    choose,
    skip,
  };
  render(
    <CollectionListPicker
      firstAdd={firstAdd}
      document={options.document ?? DOCUMENT}
      services={{
        listLoopCollections: () =>
          Promise.resolve(options.collections ?? [POSTS, AUTHORS]),
        listCustomSources: () =>
          Promise.resolve(
            options.custom === true
              ? [{ name: "featured", label: "Featured" } as never]
              : []
          ),
      }}
    />
  );
  return { choose, skip };
}

/** Let the host's lists answer. */
async function settled(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("the first step", () => {
  it("names itself and offers a button per collection, by name", async () => {
    mount();
    await settled();
    const step = screen.getByRole("group", { name: "Show entries from" });
    expect(step).toBeTruthy();
    expect(
      screen.getAllByRole("button").map(button => button.textContent)
    ).toEqual(["Authors", "Posts", "Skip"]);
    // The first source is where the keyboard starts.
    expect(document.activeElement?.textContent).toBe("Authors");
  });

  it("says More sources… where the site registers custom sources", async () => {
    mount({ custom: true });
    await settled();
    expect(screen.getByText("More sources…")).toBeTruthy();
  });

  it("moves between sources with the arrow keys", async () => {
    mount();
    await settled();
    fireEvent.keyDown(screen.getByRole("button", { name: "Authors" }), {
      key: "ArrowRight",
    });
    expect(document.activeElement?.textContent).toBe("Posts");
  });

  it("leaves a blank list on Escape, writing nothing", async () => {
    const { choose, skip } = mount();
    await settled();
    fireEvent.keyDown(screen.getByRole("button", { name: "Authors" }), {
      key: "Escape",
    });
    expect(skip).toHaveBeenCalledTimes(1);
    expect(choose).not.toHaveBeenCalled();
  });
});

describe("the second step", () => {
  it("names the collection and offers the three layouts and Skip", async () => {
    mount();
    await settled();
    fireEvent.click(screen.getByRole("button", { name: "Posts" }));
    expect(
      screen.getByRole("group", { name: "Posts · choose a starting layout" })
    ).toBeTruthy();
    for (const name of [
      "Cards, 3 across",
      "List rows",
      "Titles only",
      "Skip",
    ]) {
      expect(screen.getByRole("button", { name })).toBeTruthy();
    }
    expect(document.activeElement?.textContent).toBe("Cards, 3 across");
  });

  it("fills the list as ONE write: the source, the layout's grid and the bound item", async () => {
    const { choose } = mount();
    await settled();
    fireEvent.click(screen.getByRole("button", { name: "Posts" }));
    fireEvent.click(screen.getByRole("button", { name: "Cards, 3 across" }));
    expect(choose).toHaveBeenCalledTimes(1);
    const ops = choose.mock.calls[0]?.[0] ?? [];
    expect(ops[0]).toMatchObject({
      kind: "update",
      id: "list",
      patch: {
        props: { collection: "posts", limit: 6, sort: "-createdAt" },
        styles: { base: { base: { display: "grid" } } },
      },
    });
    expect(ops.slice(1)).toEqual([
      expect.objectContaining({
        kind: "insert",
        at: { parentId: "list", slot: "children", index: 0 },
        node: expect.objectContaining({ type: "core/card" }),
      }),
    ]);
  });

  it("binds a title of a plugin's field type, kept by the primitive it is stored as", async () => {
    const products: LoopCollection = {
      slug: "products",
      label: "Products",
      fields: [],
      titleField: "label",
      readable: [{ name: "label", type: "brand-label", storage: "text" }],
    };
    const { choose } = mount({ collections: [products] });
    await settled();
    fireEvent.click(screen.getByRole("button", { name: "Products" }));
    fireEvent.click(screen.getByRole("button", { name: "Titles only" }));
    const ops = choose.mock.calls[0]?.[0] ?? [];
    expect(JSON.stringify(ops.slice(1))).toContain('"$bind":"label"');
  });

  it("says a layout replaces an item the author built, which Skip keeps", async () => {
    const built: BlockDocument = {
      ...DOCUMENT,
      nodes: [
        {
          id: "list",
          type: "core/collection-loop",
          version: 1,
          props: { limit: 6 },
          slots: {
            children: [
              {
                id: "mine",
                type: "core/heading",
                version: 1,
                props: { text: "Mine" },
              },
            ],
          },
        },
      ],
    };
    const { choose } = mount({ document: built });
    await settled();
    fireEvent.click(screen.getByRole("button", { name: "Posts" }));
    expect(
      screen.getByText(
        /Choosing one replaces the blocks already in this list's item/
      )
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    expect(choose.mock.calls[0]?.[0]).toHaveLength(1);
  });

  it("says nothing of replacing for a new list's empty item", async () => {
    mount();
    await settled();
    fireEvent.click(screen.getByRole("button", { name: "Posts" }));
    expect(screen.queryByText(/replaces the blocks already/)).toBeNull();
  });

  it("sets the source and leaves an empty item on Skip", async () => {
    const { choose } = mount();
    await settled();
    fireEvent.click(screen.getByRole("button", { name: "Authors" }));
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    const ops = choose.mock.calls[0]?.[0] ?? [];
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({
      patch: { props: { collection: "authors" } },
    });
  });

  it("goes back to the sources on Escape", async () => {
    const { choose, skip } = mount();
    await settled();
    fireEvent.click(screen.getByRole("button", { name: "Posts" }));
    fireEvent.keyDown(screen.getByRole("button", { name: "Cards, 3 across" }), {
      key: "Escape",
    });
    expect(
      screen.getByRole("group", { name: "Show entries from" })
    ).toBeTruthy();
    expect(choose).not.toHaveBeenCalled();
    expect(skip).not.toHaveBeenCalled();
  });
});

describe("without the host's collections", () => {
  it("says they couldn't be listed, and Skip still leaves a blank list", async () => {
    const skip = vi.fn();
    render(
      <CollectionListPicker
        firstAdd={{
          nodeId: "list",
          chooser: "collection-source",
          choose: vi.fn(),
          skip,
        }}
        document={DOCUMENT}
      />
    );
    await settled();
    expect(
      screen.getByText("The collections couldn't be listed.")
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    expect(skip).toHaveBeenCalledTimes(1);
  });
});
