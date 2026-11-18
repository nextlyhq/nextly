// @vitest-environment jsdom

/**
 * The binding picker, nearest first: the innermost list's item ("Each post in
 * the list"), then this page, then Singles and the site, which start folded
 * while an item group shows; each field with its value beside it, from the
 * entry the author clicked on the canvas (else the first), a picture as a
 * small thumbnail and an empty field as "(empty)".
 */
import {
  COLLECTION_LIST_TYPE,
  LIST_ENTRY_SLOT,
  blockTypeClassName,
  type BlockDocument,
  type BlockNode,
  type PropSchema,
} from "@nextlyhq/blocks-engine";
import { NODE_ID_ATTRIBUTE } from "@nextlyhq/blocks-react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { BindingPicker } from "./binding-picker";
import type { BindingFieldSource, ListSample } from "./binding-services";
import { forgetClickedEntries, rememberClickedEntries } from "./clicked-entry";
import type { ContentServices, LoopCollection } from "./content-controls";
import { CANVAS_ROOT_CLASS } from "./shell-state";

beforeAll(() => {
  const element = window.Element.prototype as unknown as Record<
    string,
    unknown
  >;
  element.scrollIntoView = function scrollIntoView(): void {};
});

afterEach(() => {
  cleanup();
  forgetClickedEntries();
  document.body.replaceChildren();
});

const SOURCES: readonly BindingFieldSource[] = [
  {
    binding: { source: "entry" },
    label: "Page",
    fields: [
      { name: "title", type: "text", public: true, preview: "Projects" },
      // Nothing typed in it yet: said as "(empty)", not left blank.
      { name: "subtitle", type: "text", public: true, empty: true },
      {
        name: "cover",
        type: "upload",
        relationTo: "media",
        public: true,
        thumbnail: "/media/projects-cover-thumb.jpg",
      },
    ],
  },
  {
    binding: { source: "single", sourceKey: "homepage" },
    label: "Homepage",
    fields: [{ name: "title", type: "text", public: true, preview: "Home" }],
  },
  {
    binding: { source: "site" },
    label: "Site",
    fields: [
      {
        name: "applicationName",
        type: "text",
        public: true,
        preview: "Foursight",
      },
    ],
  },
];

const PROJECTS: LoopCollection = {
  slug: "projects",
  label: "Projects",
  singular: "Project",
  fields: [],
  readable: [
    { name: "title", type: "text" },
    { name: "summary", type: "text" },
    { name: "cover", type: "upload", relationTo: "media" },
    // A group with a picture inside, as a named query's declared rows carry
    // one; the readable shape a host lists for a collection is flat.
    {
      name: "seo",
      type: "group",
      fields: [{ name: "ogImage", type: "upload", relationTo: "media" }],
    } as NonNullable<LoopCollection["readable"]>[number],
  ],
};

const CATEGORIES: LoopCollection = {
  slug: "categories",
  label: "Categories",
  singular: "Category",
  fields: [],
  readable: [{ name: "name", type: "text" }],
};

const TEXT: PropSchema = { label: "Text", role: "content", type: "text" };
const IMAGE: PropSchema = {
  label: "Image",
  role: "content",
  type: "media",
  accept: "image/*",
};

/** Each project as the canvas reads the list, in its order. */
const ENTRIES: readonly ListSample[] = [
  {
    title: "Highway 9 realignment",
    summary: { empty: true },
    cover: { thumbnail: "/media/highway-thumb.jpg" },
  },
  { title: "Cedar Ridge subdivision", summary: "Boundary" },
];

const HEADING: BlockNode = {
  id: "h",
  type: "acme/title",
  version: 1,
  props: { text: "A section title" },
};

/** A Projects list holding the heading, the list itself as given. */
function projectsList(children: BlockNode[] = [HEADING]): BlockNode {
  return {
    id: "projects",
    type: COLLECTION_LIST_TYPE,
    version: 1,
    props: { collection: "projects", limit: 3 },
    slots: { [LIST_ENTRY_SLOT]: children },
  } as BlockNode;
}

/** The picker for the heading's `prop` in `nodes`, with the host's reads. */
function mount(
  nodes: BlockNode[],
  prop: PropSchema = TEXT,
  entries: readonly ListSample[] = ENTRIES
): { readListSample: ReturnType<typeof vi.fn> } {
  const readListSample = vi.fn(
    async (_props: Readonly<Record<string, unknown>>, entry?: number) =>
      entries[entry ?? 0]
  );
  const services: ContentServices = {
    listBindingFields: async () => SOURCES,
    listLoopCollections: async () => [PROJECTS, CATEGORIES],
    readListSample,
    // The author's own read of a media item, as the canvas draws pictures.
    readMedia: async id =>
      id === "m7"
        ? { name: "cover.jpg", thumbnail: "/media/m7-thumb.jpg" }
        : null,
  };
  const document = { formatVersion: 1, kind: "page", nodes } as BlockDocument;
  render(
    <BindingPicker
      prop={{
        name: "text",
        schema: prop,
        value: undefined,
        supported: true,
        options: [],
        offered: true,
        readOnly: false,
      }}
      blockLabel="Heading"
      document={document}
      nodeId="h"
      services={services}
      current={undefined}
      entryLink={undefined}
      onPick={() => undefined}
    />
  );
  return { readListSample };
}

async function picker(): Promise<HTMLElement> {
  return screen.findByRole("listbox", { name: /^Fields for / });
}

function groupNames(list: HTMLElement): (string | null)[] {
  return within(list)
    .getAllByRole("group")
    .map(group => group.getAttribute("aria-label"));
}

function rows(list: HTMLElement, group: string): (string | null)[] {
  return within(within(list).getByRole("group", { name: group }))
    .getAllByRole("option")
    .map(option => option.textContent);
}

describe("the groups, nearest first", () => {
  it("lists the list's item, this page, then Singles and the site folded", async () => {
    mount([projectsList()]);
    const list = await picker();
    await within(list).findByRole("group", {
      name: "Each project in the list",
    });
    expect(groupNames(list)).toEqual([
      "Each project in the list",
      "This page",
      "Singles · Site",
    ]);
    // Folded: one row each, the Single by name, and none of their fields.
    expect(rows(list, "Singles · Site")).toEqual(["Homepage", "Site settings"]);
    expect(within(list).queryByText("Foursight")).toBeNull();
  });

  it("lists the INNER list's item first for a block in a list inside a list", async () => {
    const inner = projectsList();
    mount([
      {
        id: "categories",
        type: COLLECTION_LIST_TYPE,
        version: 1,
        props: { collection: "categories", limit: 3 },
        slots: { [LIST_ENTRY_SLOT]: [inner] },
      } as BlockNode,
    ]);
    const list = await picker();
    await within(list).findByRole("group", {
      name: "Each project in the list",
    });
    // Then the outer list's, then this page; the Singles and site folded.
    expect(groupNames(list)).toEqual([
      "Each project in the list",
      "Each category in the list",
      "This page",
      "Singles · Site",
    ]);
  });

  it("opens a folded source in place, by click or by key", async () => {
    mount([projectsList()]);
    const list = await picker();
    const homepage = await within(list).findByRole("option", {
      name: "Homepage",
    });
    // An option may not carry aria-expanded, so a folded row says in its
    // description what choosing it does, and its name stays the Single's.
    expect(homepage.hasAttribute("aria-expanded")).toBe(false);
    const described = homepage.getAttribute("aria-describedby") ?? "";
    expect(document.getElementById(described)?.textContent).toBe(
      "Shows its fields here."
    );
    fireEvent.click(homepage);
    expect(groupNames(list)).toEqual([
      "Each project in the list",
      "This page",
      "Homepage",
      "Site",
    ]);
    expect(rows(list, "Homepage")).toEqual(["TitleHome"]);
    // The site, from the keyboard: End reaches its folded row, Enter opens it.
    fireEvent.keyDown(list, { key: "End" });
    fireEvent.keyDown(list, { key: "Enter" });
    expect(rows(list, "Site")).toEqual(["Application nameFoursight"]);
  });

  it("folds nothing for a block outside every list", async () => {
    mount([HEADING]);
    const list = await picker();
    await within(list).findByRole("group", { name: "This page" });
    expect(groupNames(list)).toEqual(["This page", "Homepage", "Site"]);
  });

  it("finds a folded source's field by search", async () => {
    mount([projectsList()]);
    const list = await picker();
    await within(list).findByRole("group", {
      name: "Each project in the list",
    });
    fireEvent.change(screen.getByRole("combobox", { name: "Find a field" }), {
      target: { value: "Foursight" },
    });
    expect(groupNames(list)).toEqual(["Site"]);
    expect(rows(list, "Site")).toEqual(["Application nameFoursight"]);
  });
});

describe("each field's live value", () => {
  it("shows the first entry's values, empty ones as (empty)", async () => {
    const { readListSample } = mount([projectsList()]);
    const list = await picker();
    await within(list).findByText("Highway 9 realignment");
    expect(rows(list, "Each project in the list")).toEqual([
      "TitleHighway 9 realignment",
      "Summary(empty)",
    ]);
    expect(rows(list, "This page")).toEqual([
      "TitleProjects",
      "Subtitle(empty)",
    ]);
    expect(readListSample).toHaveBeenCalledWith({
      collection: "projects",
      limit: 3,
    });
  });

  it("shows the values of the entry the author clicked on the canvas", async () => {
    // The canvas as drawn: the list's second entry holds the heading clicked.
    const canvas = document.createElement("div");
    canvas.className = CANVAS_ROOT_CLASS;
    const listElement = document.createElement("div");
    const listClass = blockTypeClassName(COLLECTION_LIST_TYPE);
    listElement.className = listClass;
    listElement.setAttribute(NODE_ID_ATTRIBUTE, "projects");
    const pressed = document.createElement("h3");
    for (const holds of [[], [pressed]]) {
      const entry = document.createElement("div");
      entry.className = listClass;
      entry.append(...holds);
      listElement.append(entry);
    }
    canvas.append(listElement);
    document.body.append(canvas);
    act(() => rememberClickedEntries("h", pressed));
    const { readListSample } = mount([projectsList()]);
    const list = await picker();
    await within(list).findByText("Cedar Ridge subdivision");
    expect(readListSample).toHaveBeenLastCalledWith(
      { collection: "projects", limit: 3 },
      1
    );
  });

  it("shows a picture as a small thumbnail beside its name", async () => {
    mount([projectsList()], IMAGE);
    const list = await picker();
    const cover = await within(
      await within(list).findByRole("group", {
        name: "Each project in the list",
      })
    ).findByRole("option", { name: /^Cover/ });
    await vi.waitFor(() => {
      const thumb = cover.querySelector("img");
      expect(thumb?.getAttribute("src")).toBe("/media/highway-thumb.jpg");
      // Decorative: the field's name says what it is.
      expect(thumb?.getAttribute("alt")).toBe("");
    });
    const pageCover = within(
      within(list).getByRole("group", { name: "This page" })
    ).getByRole("option", { name: /^Cover/ });
    expect(pageCover.querySelector("img")?.getAttribute("src")).toBe(
      "/media/projects-cover-thumb.jpg"
    );
  });

  it("shows a picture stored by its id through the author's media read, never the id", async () => {
    mount([projectsList()], IMAGE, [{ title: "Highway 9", cover: "m7" }]);
    const list = await picker();
    const cover = await within(
      await within(list).findByRole("group", {
        name: "Each project in the list",
      })
    ).findByRole("option", { name: /^Cover/ });
    await vi.waitFor(() => {
      expect(cover.querySelector("img")?.getAttribute("src")).toBe(
        "/media/m7-thumb.jpg"
      );
    });
    expect(cover.textContent).not.toContain("m7");
  });

  it("shows a picture inside a group, stored by its id, the same way", async () => {
    mount([projectsList()], IMAGE, [
      { title: "Highway 9", "seo.ogImage": "m7" },
    ]);
    const list = await picker();
    const og = await within(
      await within(list).findByRole("group", {
        name: "Each project in the list",
      })
    ).findByRole("option", { name: /Og image/ });
    await vi.waitFor(() => {
      expect(og.querySelector("img")?.getAttribute("src")).toBe(
        "/media/m7-thumb.jpg"
      );
    });
  });
});
