/**
 * What the relationship picker says while a search is out and once it has
 * answered: a loading state, never "No results found", until the answer for
 * what is typed is in; the previous results kept on screen meanwhile; and,
 * when every match is already selected, which ones, by name.
 *
 * `useEntries` is replaced by a recorder that answers as TanStack Query does
 * with `keepPreviousData`: while a new search loads, the previous answer is
 * handed back marked as a placeholder. The debounce is replaced by one the
 * test moves on by hand.
 */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SearchResultItem } from "./RelationshipSearch";

interface Answer {
  items: SearchResultItem[];
  hasNext?: boolean;
}

/** What the server answers for each term, once the test lets it. */
let answers: Record<string, Answer> = {};
/** The terms whose answers have arrived. */
let arrived = new Set<string>();
/** The term the debounce has passed on so far. */
let debounced = "";
/** The last term asked of `useEntries`. */
const asked: string[] = [];

vi.mock("@admin/hooks/useDebouncedValue", () => ({
  useDebouncedValue: () => debounced,
}));

type Data = { items: SearchResultItem[]; meta: object };
/** The previous answer held while a new one loads, as keepPreviousData does. */
let held: Data | undefined;
/** Each answer's data, one object per answer as the query cache keeps it. */
let cached = new Map<string, Data>();

vi.mock("@admin/hooks/queries", () => ({
  useEntries: ({ params }: { params: { search: string; page: number } }) => {
    asked.push(params.search);
    const key = `${params.search}#${String(params.page)}`;
    const answer = answers[key];
    if (answer !== undefined && arrived.has(key)) {
      const data = cached.get(key) ?? {
        items: answer.items,
        meta: { hasNext: answer.hasNext ?? false, total: answer.items.length },
      };
      cached.set(key, data);
      held = data;
      return {
        data: held,
        isLoading: false,
        isFetching: false,
        isPlaceholderData: false,
      };
    }
    return {
      data: held,
      isLoading: held === undefined,
      isFetching: true,
      isPlaceholderData: held !== undefined,
    };
  },
}));

const { RelationshipSearch } = await import("./RelationshipSearch");

const OPEN_SOURCE = { id: "t1", name: "Open Source" };
const OPEN_DATA = { id: "t2", name: "Open Data" };
const COMMUNITY = { id: "t3", name: "Community" };

function picker(excludeIds: string[] = []) {
  return render(
    <RelationshipSearch
      collections={["tags"]}
      onSelect={() => {}}
      onClose={() => {}}
      excludeIds={excludeIds}
    />
  );
}

/** Type `term`, and let the debounce pass it on. */
function type(
  view: ReturnType<typeof picker>,
  term: string,
  excludeIds: string[] = []
) {
  fireEvent.change(screen.getByPlaceholderText("Search..."), {
    target: { value: term },
  });
  debounced = term;
  view.rerender(
    <RelationshipSearch
      collections={["tags"]}
      onSelect={() => {}}
      onClose={() => {}}
      excludeIds={excludeIds}
    />
  );
}

/** Let the answer for `term`'s first page arrive. */
function arrive(
  view: ReturnType<typeof picker>,
  term: string,
  excludeIds: string[] = []
) {
  arrived.add(`${term}#1`);
  act(() => {
    view.rerender(
      <RelationshipSearch
        collections={["tags"]}
        onSelect={() => {}}
        onClose={() => {}}
        excludeIds={excludeIds}
      />
    );
  });
}

beforeEach(() => {
  answers = {
    "#1": { items: [OPEN_SOURCE, OPEN_DATA, COMMUNITY] },
    "Open#1": { items: [OPEN_SOURCE, OPEN_DATA] },
    "Open S#1": { items: [OPEN_SOURCE] },
    "Nextly#1": { items: [] },
  };
  arrived = new Set();
  debounced = "";
  held = undefined;
  cached = new Map();
  asked.length = 0;
});

afterEach(() => {
  cleanup();
});

describe("the relationship picker's search", () => {
  it("says it is searching, never that nothing was found, until the first answer is in", () => {
    const view = picker();
    expect(screen.getByRole("status").textContent).toContain("Searching");
    expect(screen.queryByText("No results found")).toBeNull();
    expect(screen.queryByText("Type to search...")).toBeNull();

    arrive(view, "");
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByRole("button", { name: "Community" })).toBeTruthy();
  });

  it("keeps the previous results on screen, with a loading state, while a new search is out", () => {
    const view = picker();
    arrive(view, "");

    type(view, "Open");
    expect(screen.getByRole("status").textContent).toContain("Searching");
    expect(screen.queryByText("No results found")).toBeNull();
    // The previous answer stays until the new one replaces it.
    expect(screen.getByRole("button", { name: "Community" })).toBeTruthy();

    arrive(view, "Open");
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByRole("button", { name: "Community" })).toBeNull();
    expect(screen.getByRole("button", { name: "Open Source" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open Data" })).toBeTruthy();
  });

  it("says nothing was found only once the search has answered with nothing", () => {
    const view = picker();
    arrive(view, "");
    type(view, "Nextly");
    expect(screen.queryByText("No results found")).toBeNull();

    arrive(view, "Nextly");
    expect(screen.getByText("No results found")).toBeTruthy();
  });

  it("says no empty result while a typed term waits out the debounce", () => {
    const view = picker();
    arrive(view, "");
    arrive(view, "Nextly");
    type(view, "Nextly");
    expect(screen.getByText("No results found")).toBeTruthy();

    // Typed, not yet sent: the old term's empty answer is not this one's.
    fireEvent.change(screen.getByPlaceholderText("Search..."), {
      target: { value: "Nextly CMS" },
    });
    expect(screen.queryByText("No results found")).toBeNull();
    expect(screen.getByRole("status").textContent).toContain("Searching");
  });

  it("shows the results again when a term comes back inside the debounce", () => {
    const view = picker();
    arrive(view, "");
    arrive(view, "Open");
    type(view, "Open");
    expect(screen.getByRole("button", { name: "Open Data" })).toBeTruthy();

    // Changed and changed back before the debounce passed it on.
    fireEvent.change(screen.getByPlaceholderText("Search..."), {
      target: { value: "Ope" },
    });
    fireEvent.change(screen.getByPlaceholderText("Search..."), {
      target: { value: "Open" },
    });
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByRole("button", { name: "Open Data" })).toBeTruthy();
  });

  it("reads a search's first page again when it comes back to it after another", () => {
    answers["Open#1"] = { items: [OPEN_SOURCE], hasNext: true };
    answers["Open#2"] = { items: [OPEN_DATA] };
    arrived.add("Open#2");
    const view = picker();
    arrive(view, "");
    type(view, "Open");
    arrive(view, "Open");
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /Load More/ }));
    });
    expect(screen.getByRole("button", { name: "Open Data" })).toBeTruthy();

    type(view, "Community");
    answers["Community#1"] = { items: [COMMUNITY] };
    arrive(view, "Community");
    expect(screen.getByRole("button", { name: "Community" })).toBeTruthy();

    // Back to the first term: its first page, not only the page loaded last.
    type(view, "Open");
    arrive(view, "Open");
    expect(screen.getByRole("button", { name: "Open Source" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Open Data" })).toBeNull();
    expect(screen.getByRole("button", { name: /Load More/ })).toBeTruthy();
  });

  it("names the matches already added when they are all it found", () => {
    const view = picker([OPEN_SOURCE.id]);
    arrive(view, "", [OPEN_SOURCE.id]);
    type(view, "Open S", [OPEN_SOURCE.id]);
    arrive(view, "Open S", [OPEN_SOURCE.id]);

    expect(screen.getByText("Already added: Open Source")).toBeTruthy();
    expect(screen.queryByText("No results found")).toBeNull();
    expect(screen.queryByRole("button", { name: "Open Source" })).toBeNull();
  });

  it("names the first few already added, and counts the rest", () => {
    const many = Array.from({ length: 5 }, (_, index) => ({
      id: `m${String(index)}`,
      name: `Tag ${String(index)}`,
    }));
    answers["Tag#1"] = { items: many };
    const ids = many.map(item => item.id);
    const view = picker(ids);
    arrive(view, "", ids);
    type(view, "Tag", ids);
    arrive(view, "Tag", ids);

    expect(
      screen.getByText("Already added: Tag 0, Tag 1, Tag 2 and 2 more")
    ).toBeTruthy();
  });
});
