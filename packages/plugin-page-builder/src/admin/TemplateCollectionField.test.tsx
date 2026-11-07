// @vitest-environment jsdom
/**
 * The template form's collection control: a saved template's collection by
 * its name and read-only; a choice of collections by name while one is made,
 * offered only once the pages slug is known; a saved template's collection
 * the list leaves out kept fixed unless the retarget answer allows a change,
 * when the choice is offered again, with a note saying why where it does
 * not; and typing the slug where the collections cannot be listed.
 */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { useForm, type FieldValues, type UseFormReset } from "react-hook-form";
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
import {
  loopCollectionsPath,
  type LoopCollectionItem,
} from "../loop-collections-contract";
import {
  TEMPLATE_COLLECTION_RETARGET_ROUTE_PATH,
  templateCollectionRetargetPath,
} from "../templates/template-actions-contract";

import {
  addressHeldNote,
  clearAddressNote,
  collectionFieldView,
  LIST_FAILED_NOTE,
  offeredCollections,
  removedNote,
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

/** One read's answer: data, a failure, or nothing yet. */
type Answer = { data?: unknown; error: Error | null };

const LISTED_ANSWER: Answer = {
  data: { items: LISTED, meta: {} },
  error: null,
};
const PAGES_ANSWER: Answer = {
  data: {
    pagesCollection: "pages",
    layoutsCollection: "layouts",
    templatesCollection: "templates",
  },
  error: null,
};

/** What the list route answers. */
let listed: Answer = LISTED_ANSWER;
/** What the pages slug route answers. */
let pages: Answer = PAGES_ANSWER;
/** What the retarget question answers, for any template. */
let retarget: Answer = {
  data: { retarget: "collection-exists" },
  error: null,
};
let values: () => FieldValues = () => ({});
let reset: UseFormReset<FieldValues> = () => {};
/** Each time the control asked a read again. */
const refetch = vi.fn();

beforeAll(() => {
  // Radix Select measures and captures the pointer; jsdom does neither.
  const proto = Element.prototype as unknown as Record<string, unknown>;
  proto.hasPointerCapture = () => false;
  proto.releasePointerCapture = () => {};
  proto.scrollIntoView = () => {};
});

/** The answer a read gets by its path; a disabled read gets nothing, as the hook does. */
function answerFor(path: string, enabled: boolean): Answer {
  if (!enabled) return { data: undefined, error: null };
  if (path === PAGE_COLLECTION_ROUTE_PATH) return pages;
  if (path.startsWith(TEMPLATE_COLLECTION_RETARGET_ROUTE_PATH)) return retarget;
  return listed;
}

beforeEach(() => {
  read.mockImplementation((({
    path,
    enabled = true,
  }: {
    path: string;
    enabled?: boolean;
  }) => ({
    ...answerFor(path, enabled),
    pending: false,
    fetching: false,
    refetch,
  })) as unknown as typeof usePluginRoute);
});

afterEach(() => {
  cleanup();
  listed = LISTED_ANSWER;
  pages = PAGES_ANSWER;
  retarget = { data: { retarget: "collection-exists" }, error: null };
  refetch.mockReset();
  identity.mockReset();
  read.mockReset();
});

/** The retarget question's reads the control made while enabled, by path. */
function retargetAsked(): string[] {
  return read.mock.calls
    .map(([options]) => options)
    .filter(
      options =>
        options.path.startsWith(TEMPLATE_COLLECTION_RETARGET_ROUTE_PATH) &&
        options.enabled !== false
    )
    .map(options => options.path);
}

function Form({ defaults }: { defaults: FieldValues }) {
  const form = useForm({ defaultValues: defaults });
  values = form.getValues;
  reset = form.reset;
  return (
    <TemplateCollectionField
      name="collection"
      control={form.control}
      field={{ label: "Collection" }}
    />
  );
}

function renderField(
  collection: string,
  documentId?: string,
  address: string | null = null
) {
  identity.mockReturnValue({
    kind: "collection",
    slug: "templates",
    ...(documentId === undefined ? {} : { documentId }),
  });
  return render(<Form defaults={{ collection, address }} />);
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

/** A saved template's flags, its value as saved unless `value` says otherwise. */
function savedAt(stored: string, value: string = stored) {
  return { saved: true, value, stored };
}

const NEW = { saved: false, value: "", stored: "" };

describe("collectionFieldView", () => {
  it("shows a saved template's collection by its name, read-only, whatever the retarget answer says", () => {
    const named = {
      kind: "fixed",
      label: "Posts",
      slug: "posts",
      note: null,
    };
    expect(collectionFieldView(savedAt("posts"), answered, "pending")).toEqual(
      named
    );
    // Listed is listed: a retarget answer is never asked for it, and a
    // stray one changes nothing.
    expect(collectionFieldView(savedAt("posts"), answered, "allowed")).toEqual(
      named
    );
  });

  it("keeps an unlisted collection fixed by its slug unless a change is allowed", () => {
    // The list leaves out collections the author may not read, so one missing
    // from it that still exists stays as saved: the guard refuses a change.
    const unlisted = {
      kind: "fixed",
      label: null,
      slug: "articles",
      note: unlistedNote("articles"),
    };
    expect(
      collectionFieldView(savedAt("articles"), answered, "collection-exists")
    ).toEqual(unlisted);
    // Unanswered is not allowed: nothing is offered that may not save.
    expect(
      collectionFieldView(savedAt("articles"), answered, "failed")
    ).toEqual(unlisted);
    expect(
      collectionFieldView(savedAt("articles"), answered, "pending")
    ).toEqual({ kind: "fixed", label: null, slug: "articles", note: null });
  });

  it("keeps a gone collection fixed while its address holds it, saying who clears it", () => {
    // Gone, but the guard refuses the change until the stored address is
    // removed: a choice here would offer only saves that fail.
    expect(
      collectionFieldView(savedAt("articles"), answered, "clear-address")
    ).toEqual({
      kind: "fixed",
      label: null,
      slug: "articles",
      note: clearAddressNote("articles"),
    });
    expect(
      collectionFieldView(savedAt("articles"), answered, "address-held")
    ).toEqual({
      kind: "fixed",
      label: null,
      slug: "articles",
      note: addressHeldNote("articles"),
    });
  });

  it("offers the choice again, saying why, where a change is allowed", () => {
    const reopened = {
      kind: "choose",
      options: answered.offered,
      loading: false,
      note: removedNote("articles"),
    };
    expect(
      collectionFieldView(savedAt("articles"), answered, "allowed")
    ).toEqual(reopened);
    // Once another is chosen the choice stays open until the template is
    // saved: what is offered follows the saved value, not the edited one.
    expect(
      collectionFieldView(savedAt("articles", "posts"), answered, "allowed")
    ).toEqual(reopened);
  });

  it("keeps a saved template's slug read-only while the names load or fail", () => {
    expect(
      collectionFieldView(savedAt("posts"), { state: "pending" }, "allowed")
    ).toEqual({ kind: "fixed", label: null, slug: "posts", note: null });
    expect(
      collectionFieldView(savedAt("posts"), { state: "failed" }, "allowed")
    ).toEqual({
      kind: "fixed",
      label: null,
      slug: "posts",
      note: LIST_FAILED_NOTE,
    });
  });

  it("offers a choice by name while a template is made, and typing when none can be listed", () => {
    expect(collectionFieldView(NEW, answered, "pending")).toEqual({
      kind: "choose",
      options: answered.offered,
      loading: false,
      note: null,
    });
    expect(collectionFieldView(NEW, { state: "pending" }, "pending")).toEqual({
      kind: "choose",
      options: [],
      loading: true,
      note: null,
    });
    expect(collectionFieldView(NEW, { state: "failed" }, "pending")).toEqual({
      kind: "type",
      note: TYPE_SLUG_NOTE,
    });
  });

  it("changes nothing on a version being read, whether saved or not", () => {
    expect(
      collectionFieldView(
        { readOnly: true, ...savedAt("articles") },
        answered,
        "allowed"
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

describe("offeredCollections, by the slug field's type", () => {
  it("leaves out a collection whose readable slug field is not text, keeping one whose type is not known", () => {
    const numbered: LoopCollectionItem = {
      ...item("issues", "Issues"),
      readable: [{ name: "slug", type: "number" }],
    };
    const texted: LoopCollectionItem = {
      ...item("notes", "Notes"),
      readable: [{ name: "slug", type: "text" }],
    };
    expect(
      offeredCollections(
        [numbered, texted, item("posts", "Posts")],
        "pages"
      ).map(c => c.slug)
    ).toEqual(["notes", "posts"]);
  });
});

describe("the collection list read", () => {
  it("is asked again on every mount, since schema edits do not refresh it", () => {
    renderField("", undefined);
    const asked = read.mock.calls.map(([options]) => options);
    expect(
      asked.some(
        options =>
          options.path === loopCollectionsPath() && options.staleTime === 0
      )
    ).toBe(true);
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

  it("offers nothing until the pages slug is known, even with the list in hand", async () => {
    // The list answered first, as it can on a cold load: Pages would be
    // offered, and a template for it cannot be saved.
    pages = { data: undefined, error: null };
    renderField("");
    const trigger = screen.getByRole("combobox", { name: "Collection" });
    expect(trigger.textContent).toBe("Loading collections…");
    expect(trigger.hasAttribute("disabled")).toBe(true);
    await act(async () => {
      fireEvent.keyDown(trigger, { key: "Enter" });
    });
    expect(screen.queryAllByRole("option")).toEqual([]);
  });

  it("falls back to typing the slug when the pages slug cannot be read", () => {
    // Refused, and answered without a slug: neither says what Pages is.
    for (const answer of [
      { data: undefined, error: new Error("refused") },
      { data: null, error: null },
    ]) {
      pages = answer;
      renderField("");
      expect(screen.getByRole("textbox", { name: "Collection" })).toBeTruthy();
      expect(screen.queryByRole("combobox")).toBeNull();
      expect(screen.getByText(TYPE_SLUG_NOTE)).toBeTruthy();
      cleanup();
    }
  });

  it("asks the retarget question by template, only where the list leaves its collection out", () => {
    renderField("posts", "t1");
    expect(retargetAsked()).toEqual([]);
    cleanup();
    read.mockClear();
    renderField("articles", "t1");
    // By the template's id, never the collection's slug: the server reads
    // the collection from the template the author may change.
    expect(retargetAsked()).toContain(templateCollectionRetargetPath("t1"));
    expect(retargetAsked().some(path => path.includes("articles"))).toBe(false);
  });

  it("keeps an unlisted collection that still exists fixed, saying why", () => {
    retarget = { data: { retarget: "collection-exists" }, error: null };
    renderField("articles", "t1");
    const shown = screen.getByRole("textbox", { name: "Collection" });
    expect(shown.getAttribute("aria-readonly")).toBe("true");
    expect(shown.textContent).toBe("articles");
    expect(screen.getByText(unlistedNote("articles"))).toBeTruthy();
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("keeps an unlisted collection fixed while the question is asked, or when its answer is not one", () => {
    retarget = { data: undefined, error: null };
    renderField("articles", "t1");
    const shown = screen.getByRole("textbox", { name: "Collection" });
    expect(shown.getAttribute("aria-busy")).toBe("true");
    expect(screen.queryByRole("combobox")).toBeNull();
    cleanup();
    // An older server's answer to another question reads as unanswered.
    retarget = { data: { exists: false }, error: null };
    renderField("articles", "t1");
    expect(screen.getByText(unlistedNote("articles"))).toBeTruthy();
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("keeps a gone collection fixed while its address holds it, by who may clear it", () => {
    for (const [mayClearAddress, note] of [
      [true, clearAddressNote("articles")],
      [false, addressHeldNote("articles")],
    ] as const) {
      retarget = {
        data: { retarget: "address-blocks", mayClearAddress },
        error: null,
      };
      renderField("articles", "t1", "/blog");
      const shown = screen.getByRole("textbox", { name: "Collection" });
      expect(shown.getAttribute("aria-readonly")).toBe("true");
      expect(screen.getByText(note)).toBeTruthy();
      expect(screen.queryByRole("combobox")).toBeNull();
      cleanup();
    }
  });

  it("asks again once the template is saved with its address cleared", async () => {
    retarget = {
      data: { retarget: "address-blocks", mayClearAddress: true },
      error: null,
    };
    renderField("articles", "t1", "/blog");
    expect(refetch).not.toHaveBeenCalled();
    // A save that keeps the address asks nothing new.
    await act(async () => {
      reset({ collection: "articles", address: "/blog" });
    });
    expect(refetch).not.toHaveBeenCalled();
    await act(async () => {
      reset({ collection: "articles", address: null });
    });
    expect(refetch).toHaveBeenCalledOnce();
  });

  it("lets a template be pointed at another collection where a change is allowed, keeping the choice open", async () => {
    retarget = { data: { retarget: "allowed" }, error: null };
    renderField("articles", "t1");
    expect(screen.getByText(removedNote("articles"))).toBeTruthy();
    const trigger = screen.getByRole("combobox", { name: "Collection" });
    // The removed slug is no option, so the placeholder shows.
    expect(trigger.textContent).toBe("Choose a collection");
    await act(async () => {
      fireEvent.keyDown(trigger, { key: "Enter" });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("option", { name: "Posts posts" }));
    });
    expect(values().collection).toBe("posts");
    // Still a choice, now showing the one chosen, until the template saves.
    expect(
      screen.getByRole("combobox", { name: "Collection" }).textContent
    ).toBe("Posts posts");
  });
});
