// @vitest-environment jsdom

/**
 * A Single's "Shown on (from the builder)" section: what it says in each
 * state the read answers, the line it always says under the list, the cap
 * at ten rows and the full list behind "and N more", the places the reader
 * can't open said only as a number, and each row opening the builder at its
 * block.
 *
 * The read is replaced by a recorder; what the route answers on a real site
 * is the integration suite's.
 */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ShownOnAnswer, ShownOnPlace } from "../../shown-on-contract";

/** What the read answers, by whether it asked for every place. */
let answers: { first?: ShownOnAnswer; all?: ShownOnAnswer } = {};
let failed: Error | null = null;
const asked: { path: string; enabled: boolean }[] = [];
const navigated: string[] = [];
/** Whether a disabled read still hands back its last answer, as a cache does. */
let keptWhenDisabled = false;
/** How often each read was asked again, by whether it is the full list's. */
const refetched = { first: 0, all: 0 };

vi.mock("@nextlyhq/plugin-sdk/admin", () => ({
  usePluginRoute: ({ path, enabled }: { path: string; enabled?: boolean }) => {
    asked.push({ path, enabled: enabled !== false });
    const all = path.endsWith("?all=1");
    const data =
      enabled === false && !keptWhenDisabled
        ? undefined
        : all
          ? answers.all
          : answers.first;
    return {
      data,
      error: failed,
      pending: data === undefined,
      fetching: false,
      refetch: () => {
        refetched[all ? "all" : "first"] += 1;
      },
    };
  },
  navigateTo: (to: string) => {
    navigated.push(to);
  },
}));

const { ShownOnSection } = await import("./ShownOnSection");
const { SHOWN_ON_WORDS: WORDS } = await import("./words");

/** A place on page `id`, at block `nodeId`. */
const place = (id: string, title: string, block: string): ShownOnPlace => ({
  key: `collection:pages:${id}\u0000hero`,
  kind: "collection",
  slug: "pages",
  documentId: id,
  place: "pages",
  title,
  block,
  nodeId: "hero",
  blocksField: "content",
});

const answer = (patch: Partial<ShownOnAnswer>): ShownOnAnswer => ({
  checking: false,
  places: [],
  more: 0,
  hidden: 0,
  unchecked: 0,
  floor: false,
  ...patch,
});

const onSingle = () =>
  render(
    <ShownOnSection
      {...({
        context: { userId: "u1", single: "homepage" },
        entry: null,
      } as never)}
    />
  );

beforeEach(() => {
  answers = {};
  failed = null;
  keptWhenDisabled = false;
  refetched.first = 0;
  refetched.all = 0;
  asked.length = 0;
  navigated.length = 0;
});

afterEach(() => {
  cleanup();
});

describe("ShownOnSection", () => {
  it("lists each place by its document and block, and opens the builder at that block", () => {
    answers.first = answer({ places: [place("home", "Home", "Hero section")] });
    onSingle();
    const row = screen.getByRole("link", { name: "Home, Hero section" });
    const href = row.getAttribute("href") ?? "";
    expect(href).toContain("/admin/collections/pages/home/");
    expect(href).toContain("field=content");
    expect(new URL(href, "http://site").searchParams.get("block")).toBe("hero");
    fireEvent.click(row);
    expect(navigated).toEqual([href]);
    expect(asked[0]?.path).toBe("/singles/homepage/shown-on");
  });

  it("always says only builder pages are listed", () => {
    answers.first = answer({ places: [place("home", "Home", "Hero section")] });
    onSingle();
    expect(screen.getByText(WORDS.onlyBuilder)).toBeTruthy();
    cleanup();
    answers.first = answer({});
    onSingle();
    expect(
      screen.getByText(
        "Only pages made with the builder are listed. Code that reads this Single directly isn't."
      )
    ).toBeTruthy();
  });

  it("says it is still checking pages before the first complete check, and nothing found after it", () => {
    answers.first = answer({ checking: true });
    onSingle();
    expect(screen.getByText("Still checking pages…")).toBeTruthy();
    expect(screen.queryByText("Not shown on any builder page yet")).toBeNull();
    cleanup();
    answers.first = answer({ checking: false });
    onSingle();
    expect(screen.getByText("Not shown on any builder page yet")).toBeTruthy();
    expect(screen.queryByText("Still checking pages…")).toBeNull();
  });

  it('shows ten rows of twelve places, and the full list behind "and 2 more"', () => {
    const twelve = Array.from({ length: 12 }, (_, index) =>
      place(`p${String(index)}`, `Page ${String(index)}`, "Heading")
    );
    answers.first = answer({ places: twelve.slice(0, 10), more: 2 });
    answers.all = answer({ places: twelve });
    onSingle();
    const section = screen.getByTestId("shown-on");
    expect(within(section).getAllByRole("link")).toHaveLength(10);
    // The full list is not read until it is opened.
    expect(
      asked.some(read => read.path.endsWith("?all=1") && read.enabled)
    ).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "and 2 more" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getAllByRole("link")).toHaveLength(12);
  });

  it("counts the places the reader can't open, naming none of them", () => {
    answers.first = answer({
      places: [place("home", "Home", "Hero section")],
      hidden: 1,
    });
    onSingle();
    expect(screen.getByText("and 1 you can't open")).toBeTruthy();
    expect(screen.getAllByRole("link")).toHaveLength(1);
  });

  it("doesn't say nothing shows the Single when every place is one the reader can't open", () => {
    answers.first = answer({ hidden: 2 });
    onSingle();
    expect(screen.queryByText(WORDS.none)).toBeNull();
    expect(screen.getByText("and 2 you can't open")).toBeTruthy();
  });

  it("says how many places are in drafts it didn't check, apart from those hidden", () => {
    answers.first = answer({ unchecked: 5 });
    onSingle();
    expect(screen.getByText("and 5 in unpublished drafts")).toBeTruthy();
    expect(screen.queryByText(/you can't open/)).toBeNull();
    expect(screen.queryByText(WORDS.none)).toBeNull();
  });

  it("says its counts are at least those where the read reached its bound", () => {
    const ten = Array.from({ length: 10 }, (_, index) =>
      place(`p${String(index)}`, `Page ${String(index)}`, "Heading")
    );
    answers.first = answer({ places: ten, more: 4, hidden: 2, floor: true });
    onSingle();
    expect(
      screen.getByRole("button", { name: "and at least 4 more" })
    ).toBeTruthy();
    expect(screen.getByText("and at least 2 you can't open")).toBeTruthy();
    cleanup();
    answers.first = answer({
      places: ten.slice(0, 3),
      floor: true,
    });
    onSingle();
    expect(screen.getByText("and maybe more")).toBeTruthy();
  });

  it("says a place only in another language without a link", () => {
    answers.first = answer({
      places: [
        { ...place("home", "Home", "Hero section"), inAnotherLanguage: true },
      ],
    });
    onSingle();
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText(/Home, Hero section/)).toBeTruthy();
  });

  it("asks again while pages are being checked, but not for a closed full list", () => {
    vi.useFakeTimers();
    try {
      keptWhenDisabled = true;
      answers.first = answer({ checking: true });
      answers.all = answer({ checking: true });
      onSingle();
      vi.advanceTimersByTime(25_000);
      expect(refetched.first).toBe(2);
      expect(refetched.all).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("says a read that failed, with a way to ask again", () => {
    failed = new Error("down");
    onSingle();
    expect(screen.getByRole("alert").textContent).toContain(WORDS.loadFailed);
    expect(screen.getByRole("button", { name: WORDS.retry })).toBeTruthy();
  });

  it("draws nothing on a collection entry's panel", () => {
    const { container } = render(
      <ShownOnSection
        {...({
          context: { userId: "u1", collection: "posts", entryId: "1" },
          entry: null,
        } as never)}
      />
    );
    expect(container.textContent).toBe("");
  });
});
