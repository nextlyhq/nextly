// @vitest-environment jsdom
/**
 * The template form's collection control: a saved template's collection by
 * its name and read-only; a choice of collections by name while one is made,
 * exactly the ones the choices route answers, and none while a cached answer
 * is being refreshed; a saved template's collection the list leaves out kept
 * fixed unless the retarget answer allows a change, when the choice is
 * offered again, with a note saying why where it does not; and typing the
 * slug where the collections cannot be listed.
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

import {
  loopCollectionsPath,
  type LoopCollectionItem,
} from "../loop-collections-contract";
import {
  TEMPLATE_COLLECTION_CHOICES_ROUTE_PATH,
  TEMPLATE_COLLECTION_RETARGET_ROUTE_PATH,
  templateCollectionRetargetPath,
} from "../templates/template-actions-contract";

import {
  addressHeldNote,
  clearAddressNote,
  collectionFieldView,
  LIST_FAILED_NOTE,
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

/**
 * One read's answer: data, a failure, or nothing yet; `fetching` while the
 * hook refreshes it, cached data and all.
 */
type Answer = { data?: unknown; error: Error | null; fetching?: boolean };

const LISTED_ANSWER: Answer = {
  data: { items: LISTED, meta: {} },
  error: null,
};
/**
 * What the choices route answers: in ITS order, which is not by name, and
 * without Pages or Authors, which the list above holds.
 */
const CHOICES_ANSWER: Answer = {
  data: {
    items: [
      { slug: "posts", label: "Posts" },
      { slug: "events", label: "Events" },
    ],
    meta: {},
  },
  error: null,
};

/** What the list route answers. */
let listed: Answer = LISTED_ANSWER;
/** What the choices route answers. */
let choices: Answer = CHOICES_ANSWER;
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
  if (path === TEMPLATE_COLLECTION_CHOICES_ROUTE_PATH) return choices;
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
  }) => {
    const { fetching = false, ...answer } = answerFor(path, enabled);
    return { ...answer, pending: false, fetching, refetch };
  }) as unknown as typeof usePluginRoute);
});

afterEach(() => {
  cleanup();
  listed = LISTED_ANSWER;
  choices = CHOICES_ANSWER;
  retarget = { data: { retarget: "collection-exists" }, error: null };
  refetch.mockReset();
  identity.mockReset();
  read.mockReset();
});

/** The reads under `route` the control made while enabled, by path. */
function askedUnder(route: string): string[] {
  return read.mock.calls
    .map(([options]) => options)
    .filter(
      options => options.path.startsWith(route) && options.enabled !== false
    )
    .map(options => options.path);
}

/** The retarget question's reads the control made while enabled, by path. */
function retargetAsked(): string[] {
  return askedUnder(TEMPLATE_COLLECTION_RETARGET_ROUTE_PATH);
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

const OFFERED = [
  { slug: "events", label: "Events" },
  { slug: "posts", label: "Posts" },
];

const answered: CollectionChoices = {
  named: {
    state: "answered",
    value: new Map([
      ["posts", "Posts"],
      ["events", "Events"],
    ]),
  },
  offered: { state: "answered", value: OFFERED },
};

/** `answered`, with one of its reads in another state. */
function withState(
  read: keyof CollectionChoices,
  state: "pending" | "failed"
): CollectionChoices {
  return read === "named"
    ? { ...answered, named: { state } }
    : { ...answered, offered: { state } };
}

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
      options: OFFERED,
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

  it("keeps a gone collection fixed until the choices are in, even where a change is allowed", () => {
    expect(
      collectionFieldView(
        savedAt("articles"),
        withState("offered", "pending"),
        "allowed"
      )
    ).toEqual({ kind: "fixed", label: null, slug: "articles", note: null });
    expect(
      collectionFieldView(
        savedAt("articles"),
        withState("offered", "failed"),
        "allowed"
      )
    ).toEqual({
      kind: "fixed",
      label: null,
      slug: "articles",
      note: LIST_FAILED_NOTE,
    });
  });

  it("keeps a saved template's slug read-only while the names load or fail", () => {
    expect(
      collectionFieldView(
        savedAt("posts"),
        withState("named", "pending"),
        "allowed"
      )
    ).toEqual({ kind: "fixed", label: null, slug: "posts", note: null });
    expect(
      collectionFieldView(
        savedAt("posts"),
        withState("named", "failed"),
        "allowed"
      )
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
      options: OFFERED,
      loading: false,
      note: null,
    });
    expect(
      collectionFieldView(NEW, withState("offered", "pending"), "pending")
    ).toEqual({
      kind: "choose",
      options: [],
      loading: true,
      note: null,
    });
    expect(
      collectionFieldView(NEW, withState("offered", "failed"), "pending")
    ).toEqual({
      kind: "type",
      note: TYPE_SLUG_NOTE,
    });
    // A new template draws no saved collection, so the names decide nothing.
    expect(
      collectionFieldView(NEW, withState("named", "failed"), "pending")
    ).toEqual({
      kind: "choose",
      options: OFFERED,
      loading: false,
      note: null,
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

describe("the collection reads", () => {
  it("asks the list and the choices again on every mount, since schema edits do not refresh them", () => {
    renderField("", undefined);
    const asked = read.mock.calls.map(([options]) => options);
    for (const path of [
      loopCollectionsPath(),
      TEMPLATE_COLLECTION_CHOICES_ROUTE_PATH,
    ]) {
      expect(
        asked.some(
          options =>
            options.path === path &&
            options.staleTime === 0 &&
            options.enabled !== false
        )
      ).toBe(true);
    }
  });

  it("asks the choices only where a choice may be drawn", () => {
    // A saved template the list names is fixed: no choice to draw.
    renderField("posts", "t1");
    expect(askedUnder(TEMPLATE_COLLECTION_CHOICES_ROUTE_PATH)).toEqual([]);
    cleanup();
    read.mockClear();
    // One the list leaves out may be offered a change, so they are asked.
    renderField("articles", "t1");
    expect(askedUnder(TEMPLATE_COLLECTION_CHOICES_ROUTE_PATH)).not.toEqual([]);
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
    // Exactly the server's choices, in its order: Pages and Authors, which
    // the list holds, are not offered, and nothing is reordered here.
    expect(screen.getAllByRole("option").map(o => o.textContent)).toEqual([
      "Posts posts",
      "Events events",
    ]);
    await act(async () => {
      fireEvent.click(screen.getByRole("option", { name: "Posts posts" }));
    });
    expect(values().collection).toBe("posts");
  });

  it("offers a collection the list cannot judge only as the server answers it", async () => {
    // The list holds a collection whose slug field the public cannot read,
    // which says nothing of its type: the server's answer leaves it out, and
    // so does the choice.
    listed = {
      data: {
        items: [...LISTED, item("issues", "Issues")],
        meta: {},
      },
      error: null,
    };
    renderField("");
    await act(async () => {
      fireEvent.keyDown(screen.getByRole("combobox", { name: "Collection" }), {
        key: "Enter",
      });
    });
    expect(screen.getAllByRole("option").map(o => o.textContent)).toEqual([
      "Posts posts",
      "Events events",
    ]);
  });

  it("falls back to typing the slug when the choices cannot be read", () => {
    // Refused, and answered without a list: neither says what may be chosen.
    for (const answer of [
      { data: undefined, error: new Error("refused") },
      { data: null, error: null },
      { data: { items: "posts" }, error: null },
    ]) {
      choices = answer;
      renderField("");
      const input = screen.getByRole("textbox", { name: "Collection" });
      fireEvent.change(input, { target: { value: "posts" } });
      expect(values().collection).toBe("posts");
      expect(screen.queryByRole("combobox")).toBeNull();
      expect(screen.getByText(TYPE_SLUG_NOTE)).toBeTruthy();
      cleanup();
    }
  });

  it("waits, rather than offering typing, while a read that failed before is asked again", async () => {
    // The query keeps its earlier error beside the retry in flight: the
    // fresh answer may yet list the collections.
    choices = {
      ...CHOICES_ANSWER,
      error: new Error("earlier failure"),
      fetching: true,
    };
    renderField("");
    const trigger = screen.getByRole("combobox", { name: "Collection" });
    expect(trigger.textContent).toBe("Loading collections…");
    expect(screen.queryByText(TYPE_SLUG_NOTE)).toBeNull();
    expect(screen.queryByRole("textbox", { name: "Collection" })).toBeNull();
  });

  it("offers nothing while a cached answer is refreshed, until the fresh one arrives", async () => {
    // The hook keeps the cached choices while it asks again on mount: they
    // may name a collection since removed or no longer eligible.
    choices = { ...CHOICES_ANSWER, fetching: true };
    const { rerender } = renderField("");
    const trigger = screen.getByRole("combobox", { name: "Collection" });
    expect(trigger.textContent).toBe("Loading collections…");
    expect(trigger.hasAttribute("disabled")).toBe(true);
    await act(async () => {
      fireEvent.keyDown(trigger, { key: "Enter" });
    });
    expect(screen.queryAllByRole("option")).toEqual([]);
    // The fresh answer, once in, is what is offered.
    choices = {
      data: { items: [{ slug: "events", label: "Events" }], meta: {} },
      error: null,
    };
    rerender(<Form defaults={{ collection: "", address: null }} />);
    await act(async () => {
      fireEvent.keyDown(screen.getByRole("combobox", { name: "Collection" }), {
        key: "Enter",
      });
    });
    expect(screen.getAllByRole("option").map(o => o.textContent)).toEqual([
      "Events events",
    ]);
  });

  it("keeps a saved collection pending while the list or the retarget answer is refreshed", () => {
    // A cached list naming the collection, being asked again: not yet shown
    // by its name.
    listed = { ...LISTED_ANSWER, fetching: true };
    renderField("posts", "t1");
    let shown = screen.getByRole("textbox", { name: "Collection" });
    expect(shown.textContent).toBe("posts");
    expect(shown.getAttribute("aria-busy")).toBe("true");
    cleanup();
    // A cached "allowed" being asked again: no choice until it is fresh.
    listed = LISTED_ANSWER;
    retarget = { data: { retarget: "allowed" }, error: null, fetching: true };
    renderField("articles", "t1");
    shown = screen.getByRole("textbox", { name: "Collection" });
    expect(shown.getAttribute("aria-busy")).toBe("true");
    expect(screen.queryByRole("combobox")).toBeNull();
    cleanup();
    // Allowed and fresh, but the choices being refreshed: still none.
    retarget = { data: { retarget: "allowed" }, error: null };
    choices = { ...CHOICES_ANSWER, fetching: true };
    renderField("articles", "t1");
    shown = screen.getByRole("textbox", { name: "Collection" });
    expect(shown.getAttribute("aria-busy")).toBe("true");
    expect(screen.queryByRole("combobox")).toBeNull();
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
    expect(screen.getAllByRole("option").map(o => o.textContent)).toEqual([
      "Posts posts",
      "Events events",
    ]);
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
