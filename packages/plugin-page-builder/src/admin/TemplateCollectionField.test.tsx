// @vitest-environment jsdom
/**
 * The template form's collection control: a saved template's collection by
 * its name and read-only; a choice of collections by name while one is made;
 * the choice again where a saved template's collection is no longer listed;
 * and typing the slug where the collections cannot be listed.
 */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { useForm, type FieldValues } from "react-hook-form";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

vi.mock("@nextlyhq/plugin-sdk/admin", () => ({
  usePluginRoute: vi.fn(),
  useDocumentIdentity: vi.fn(),
}));

import {
  useDocumentIdentity,
  usePluginRoute,
} from "@nextlyhq/plugin-sdk/admin";

import { PAGE_COLLECTION_ROUTE_PATH } from "../layout-choices-contract";
import type { LoopCollectionItem } from "../loop-collections-contract";

import {
  collectionFieldView,
  LIST_FAILED_NOTE,
  offeredCollections,
  TemplateCollectionField,
  TYPE_SLUG_NOTE,
  unlistedNote,
  type CollectionChoices,
} from "./TemplateCollectionField";

const read = vi.mocked(usePluginRoute);
const identity = vi.mocked(useDocumentIdentity);

function item(
  slug: string,
  label: string,
  declared: string[] = ["title", "slug"]
): LoopCollectionItem {
  return {
    slug,
    label,
    singular: label,
    fields: [],
    relations: [],
    declared,
    readable: [],
  };
}

const LISTED: LoopCollectionItem[] = [
  item("posts", "Posts"),
  item("pages", "Pages"),
  item("authors", "Authors", ["name"]),
  item("events", "Events"),
];

/** What the list route answers: the items, a failure, or nothing yet. */
let listed: { data?: unknown; error: Error | null } = {
  data: { items: LISTED, meta: {} },
  error: null,
};
let values: () => FieldValues = () => ({});

beforeAll(() => {
  // Radix Select measures and captures the pointer; jsdom does neither.
  const proto = Element.prototype as unknown as Record<string, unknown>;
  proto.hasPointerCapture = () => false;
  proto.releasePointerCapture = () => {};
  proto.scrollIntoView = () => {};
});

beforeEach(() => {
  read.mockImplementation((({ path }: { path: string }) => ({
    ...(path === PAGE_COLLECTION_ROUTE_PATH
      ? {
          data: {
            pagesCollection: "pages",
            layoutsCollection: "layouts",
            templatesCollection: "templates",
          },
          error: null,
        }
      : listed),
    pending: false,
    fetching: false,
    refetch: () => {},
  })) as unknown as typeof usePluginRoute);
});

afterEach(() => {
  cleanup();
  listed = { data: { items: LISTED, meta: {} }, error: null };
  identity.mockReset();
});

function Form({ defaults }: { defaults: FieldValues }) {
  const form = useForm({ defaultValues: defaults });
  values = form.getValues;
  return (
    <TemplateCollectionField
      name="collection"
      control={form.control}
      field={{ label: "Collection" }}
    />
  );
}

function renderField(collection: string, documentId?: string) {
  identity.mockReturnValue({
    kind: "collection",
    slug: "templates",
    ...(documentId === undefined ? {} : { documentId }),
  });
  return render(<Form defaults={{ collection }} />);
}

const answered: CollectionChoices = {
  state: "answered",
  named: new Map([
    ["posts", "Posts"],
    ["events", "Events"],
  ]),
  offered: [
    { slug: "events", label: "Events" },
    { slug: "posts", label: "Posts" },
  ],
};

describe("collectionFieldView", () => {
  it("shows a saved template's collection by its name, read-only", () => {
    expect(
      collectionFieldView({ saved: true, value: "posts" }, answered)
    ).toEqual({ kind: "fixed", label: "Posts", slug: "posts", note: null });
  });

  it("offers the choice on a saved template whose collection is not listed, saying why", () => {
    expect(
      collectionFieldView({ saved: true, value: "articles" }, answered)
    ).toEqual({
      kind: "choose",
      options: answered.offered,
      loading: false,
      note: unlistedNote("articles"),
    });
  });

  it("keeps a saved template's slug read-only while the names load or fail", () => {
    expect(
      collectionFieldView({ saved: true, value: "posts" }, { state: "pending" })
    ).toEqual({ kind: "fixed", label: null, slug: "posts", note: null });
    expect(
      collectionFieldView({ saved: true, value: "posts" }, { state: "failed" })
    ).toEqual({
      kind: "fixed",
      label: null,
      slug: "posts",
      note: LIST_FAILED_NOTE,
    });
  });

  it("offers a choice by name while a template is made, and typing when none can be listed", () => {
    expect(collectionFieldView({ saved: false, value: "" }, answered)).toEqual({
      kind: "choose",
      options: answered.offered,
      loading: false,
      note: null,
    });
    expect(
      collectionFieldView({ saved: false, value: "" }, { state: "pending" })
    ).toEqual({ kind: "choose", options: [], loading: true, note: null });
    expect(
      collectionFieldView({ saved: false, value: "" }, { state: "failed" })
    ).toEqual({ kind: "type", note: TYPE_SLUG_NOTE });
  });

  it("changes nothing on a version being read, whether saved or not", () => {
    expect(
      collectionFieldView(
        { readOnly: true, saved: true, value: "articles" },
        answered
      )
    ).toEqual({ kind: "fixed", label: null, slug: "articles", note: null });
  });
});

describe("offeredCollections", () => {
  it("offers the collections with an address field, less the pages, by name", () => {
    expect(offeredCollections(LISTED, "pages")).toEqual([
      { slug: "events", label: "Events" },
      { slug: "posts", label: "Posts" },
    ]);
    // The control: without the pages slug, Pages is offered, so the filter
    // above is the pages slug's and not the address field's.
    expect(offeredCollections(LISTED, undefined).map(c => c.slug)).toEqual([
      "events",
      "pages",
      "posts",
    ]);
  });
});

describe("the collection control", () => {
  it("draws a saved template's collection as its name with its slug, and no input", () => {
    renderField("posts", "t1");
    const shown = screen.getByRole("textbox", { name: "Collection" });
    expect(shown.getAttribute("aria-readonly")).toBe("true");
    expect(shown.textContent).toBe("Posts posts");
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("chooses a new template's collection by name, storing its slug", async () => {
    renderField("");
    const trigger = screen.getByRole("combobox", { name: "Collection" });
    expect(trigger.textContent).toBe("Choose a collection");
    await act(async () => {
      fireEvent.keyDown(trigger, { key: "Enter" });
    });
    // Each by name, with its slug beside it; Pages and a collection with no
    // address are not offered.
    expect(screen.getAllByRole("option").map(o => o.textContent)).toEqual([
      "Events events",
      "Posts posts",
    ]);
    await act(async () => {
      fireEvent.click(screen.getByRole("option", { name: "Posts posts" }));
    });
    expect(values().collection).toBe("posts");
  });

  it("falls back to typing the slug when the collections cannot be listed", () => {
    listed = { error: new Error("refused"), data: undefined };
    renderField("");
    const input = screen.getByRole("textbox", { name: "Collection" });
    fireEvent.change(input, { target: { value: "posts" } });
    expect(values().collection).toBe("posts");
    expect(screen.getByText(TYPE_SLUG_NOTE)).toBeTruthy();
  });
});
