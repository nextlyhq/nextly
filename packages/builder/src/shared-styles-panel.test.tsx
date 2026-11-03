// @vitest-environment jsdom

/**
 * The Shared styles tab, driven as an author meets it: the list and its
 * counts, the search, each row's details (where it's used, rename, lock,
 * remove), "Remove unused…", and every state's words.
 *
 * `shared-style-library.test` asserts the rules this draws from.
 *
 * @module shared-styles-panel.test
 */
import { BASE_BREAKPOINT, type NamedClass } from "@nextlyhq/blocks-engine";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  SharedStyleReach,
  SharedStylesUsage,
  SharedStyleUsesPage,
} from "./shared-style-library";
import {
  SharedStylesPanel,
  type SharedStylesAccess,
  type SharedStylesPanelProps,
} from "./shared-styles-panel";

afterEach(cleanup);

const CARD: NamedClass = {
  id: "c-card",
  slug: "card",
  label: "Card",
  orderIndex: 0,
  styles: {
    base: { [BASE_BREAKPOINT]: { color: "#112233" } },
    hover: { [BASE_BREAKPOINT]: { padding: { blockStart: "24px" } } },
  },
};
const HERO: NamedClass = {
  id: "c-hero",
  slug: "hero",
  orderIndex: 1,
  styles: { base: { [BASE_BREAKPOINT]: { color: "#445566" } } },
};
const OLD: NamedClass = {
  id: "c-old",
  slug: "old-note",
  label: "Old note",
  orderIndex: 2,
  styles: {},
};

const NONE = { pages: 0, components: 0, patterns: 0, layouts: 0 };
function reach(
  byKind: Partial<SharedStyleReach["byKind"]>,
  complete = true
): SharedStyleReach {
  const kinds = { ...NONE, ...byKind };
  return {
    documents: Object.values(kinds).reduce((sum, n) => sum + n, 0),
    byKind: kinds,
    complete,
  };
}

/** Usage the access answers with, by id; unknown ids read as unused. */
function accessOf({
  whole = true,
  mayLock = false,
  styles = {},
  uses,
  remove = async () => undefined,
  lock = async () => undefined,
}: {
  whole?: boolean;
  mayLock?: boolean;
  styles?: Record<string, SharedStyleReach>;
  uses?: (id: string, page: number) => SharedStyleUsesPage;
  remove?: SharedStylesAccess["remove"];
  lock?: SharedStylesAccess["lock"];
} = {}) {
  const usageReads: (readonly string[])[] = [];
  const access: SharedStylesAccess = {
    usage: vi.fn(async (ids: readonly string[]): Promise<SharedStylesUsage> => {
      usageReads.push(ids);
      return {
        whole,
        mayLock,
        styles: new Map(
          ids.map(id => [
            id,
            Object.hasOwn(styles, id)
              ? (styles[id] ?? reach({}))
              : reach({}, whole),
          ])
        ),
      };
    }),
    uses: vi.fn(
      async (id: string, page: number) =>
        uses?.(id, page) ?? {
          items: [],
          total: 0,
          hidden: 0,
          hasNext: false,
          complete: true,
        }
    ),
    lock: vi.fn(lock),
    remove: vi.fn(remove),
  };
  return { access, usageReads };
}

const NO_BLOCKS = { counts: new Map<string, number>(), complete: true };

async function panel(props: Partial<SharedStylesPanelProps> = {}) {
  const view = render(
    <SharedStylesPanel
      library={[CARD, HERO, OLD]}
      pageBlocks={NO_BLOCKS}
      onRename={async () => ({ ok: true })}
      {...props}
    />
  );
  // Let the usage read answer.
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  return view;
}

const row = (name: RegExp) => screen.getByRole("button", { name });

async function open(name: RegExp, title: string) {
  fireEvent.click(row(name));
  const details = await screen.findByRole("dialog", { name: title });
  await act(async () => {
    await Promise.resolve();
  });
  return details;
}

describe("the list", () => {
  it("names each style, with its class name under it", async () => {
    await panel();
    const card = row(/^Card, \.card/);
    expect(card.textContent).toContain("Card");
    expect(card.textContent).toContain(".card");
    // A style made before names shows its class name as its name.
    expect(row(/^hero, \.hero/)).toBeTruthy();
  });

  it("says how to make one when there are none, with no + to create an empty one", async () => {
    await panel({ library: [] });
    expect(
      screen.getByText(/you make from a block show here\.$/).textContent
    ).toBe("Shared styles you make from a block show here.");
    expect(screen.queryByRole("button", { name: /add/i })).toBeNull();
  });

  it("says a read in flight is loading, and a failed one failed", async () => {
    const view = await panel({ library: undefined });
    expect(screen.getByRole("status").textContent).toBe(
      "Reading this site’s shared styles…"
    );
    view.rerender(
      <SharedStylesPanel
        library={undefined}
        absence="failed"
        pageBlocks={NO_BLOCKS}
      />
    );
    expect(screen.getByRole("alert").textContent).toContain(
      "could not be read"
    );
  });

  it("marks a locked style and one set in the site's code", async () => {
    await panel({
      library: [{ ...CARD, locked: true }, HERO],
      suppliedClassIds: ["c-hero"],
    });
    expect(row(/^Card, \.card, locked/)).toBeTruthy();
    expect(row(/^hero, \.hero, set in your site/).textContent).toContain(
      "In code"
    );
  });
});

describe("counts", () => {
  it("reads only the rows on screen, fifty at a time", async () => {
    const many: NamedClass[] = Array.from({ length: 61 }, (_, n) => ({
      id: `c-${n}`,
      slug: `s-${n}`,
      orderIndex: n,
      styles: {},
    }));
    const { access, usageReads } = accessOf();
    await panel({ library: many, access });
    expect(usageReads.map(ids => ids.length)).toEqual([50]);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Show 11 more" }));
    });
    await act(async () => {
      await Promise.resolve();
    });
    // Only the rows newly on screen are asked about.
    expect(usageReads.map(ids => ids.length)).toEqual([50, 11]);
    expect(usageReads[1]?.[0]).toBe("c-50");
  });

  it("states the reach in words, with blocks on this page", async () => {
    const { access } = accessOf({
      styles: { "c-card": reach({ pages: 4, components: 1 }) },
    });
    await panel({
      access,
      pageBlocks: { counts: new Map([["c-card", 3]]), complete: true },
    });
    const card = row(/^Card, \.card/);
    expect(card.getAttribute("aria-label")).toBe(
      "Card, .card, 3 blocks on this page · on 4 pages and 1 component"
    );
    expect(card.textContent).toContain("5");
    expect(screen.queryByText(/numbers are minimums/)).toBeNull();
  });

  it("says at least, with a note, while some pages are still being counted", async () => {
    const { access } = accessOf({
      whole: false,
      styles: { "c-card": reach({ pages: 4 }, false) },
    });
    await panel({ access });
    const card = row(/^Card, \.card/);
    expect(card.getAttribute("aria-label")).toBe(
      "Card, .card, On at least 4 pages"
    );
    expect(card.textContent).toContain("4+");
    expect(
      screen.getByText(
        "Some pages are still being counted, so these numbers are minimums."
      )
    ).toBeTruthy();
  });
});

describe("the search", () => {
  const shownRows = () =>
    screen
      .queryAllByRole("button")
      .filter(button => button.hasAttribute("data-shared-style"))
      .map(button => button.getAttribute("data-shared-style"));
  const typeIn = (query: string) =>
    fireEvent.change(
      screen.getByRole("searchbox", { name: "Search shared styles" }),
      {
        target: { value: query },
      }
    );

  it("finds a style by name, by property and by value", async () => {
    await panel();
    typeIn("old");
    expect(shownRows()).toEqual(["c-old"]);
    typeIn("padding");
    expect(shownRows()).toEqual(["c-card"]);
    typeIn("#445566");
    expect(shownRows()).toEqual(["c-hero"]);
  });

  it("says when nothing matches", async () => {
    await panel();
    typeIn("margin");
    expect(screen.getByText("No shared styles match “margin”.")).toBeTruthy();
  });
});

describe("where a style is used", () => {
  const page = (n: number, from: number, count: number, hasNext: boolean) => ({
    items: Array.from({ length: count }, (_, i) => ({
      id: `p${from + i}`,
      title: `Page ${from + i}`,
      kind: "pages" as const,
    })),
    total: 25,
    hidden: 2,
    hasNext,
    complete: true,
  });

  it("names the documents, a page at a time, and counts the ones it can't open", async () => {
    const { access } = accessOf({
      uses: (_id, n) =>
        n === 1 ? page(1, 0, 20, true) : page(2, 20, 5, false),
    });
    await panel({ access });
    const details = await open(/^Card, \.card/, "Card");
    expect(within(details).getByText("Page 0")).toBeTruthy();
    expect(within(details).getByText("and 2 you can’t open")).toBeTruthy();
    expect(access.uses).toHaveBeenLastCalledWith(
      "c-card",
      1,
      expect.anything()
    );
    await act(async () => {
      fireEvent.click(
        within(details).getByRole("button", { name: "Show 5 more" })
      );
    });
    expect(access.uses).toHaveBeenLastCalledWith(
      "c-card",
      2,
      expect.anything()
    );
    expect(within(details).getByText("Page 24")).toBeTruthy();
    expect(within(details).queryByRole("button", { name: /Show/ })).toBeNull();
  });
});

describe("renaming", () => {
  it("renames to the name typed, with the class name derived from it", async () => {
    const onRename = vi.fn(async () => ({ ok: true as const }));
    await panel({ onRename });
    const details = await open(/^Card, \.card/, "Card");
    const name = within(details).getByLabelText("Name");
    fireEvent.change(name, { target: { value: "Promo card" } });
    expect(within(details).getByText(".promo-card")).toBeTruthy();
    fireEvent.keyDown(name, { key: "Enter" });
    expect(onRename).toHaveBeenCalledWith("c-card", {
      label: "Promo card",
      slug: "promo-card",
    });
  });

  it("refuses a class name another style has, without writing", async () => {
    const onRename = vi.fn(async () => ({ ok: true as const }));
    await panel({ onRename });
    const details = await open(/^Card, \.card/, "Card");
    const name = within(details).getByLabelText("Name");
    fireEvent.change(name, { target: { value: "Hero" } });
    fireEvent.keyDown(name, { key: "Enter" });
    expect(onRename).not.toHaveBeenCalled();
    expect(within(details).getByRole("alert").textContent).toBe(
      "“hero” is already a shared style. Choose another name."
    );
  });

  it("shows the host's refusal in the details", async () => {
    await panel({
      onRename: async () => ({ ok: false, reason: "The site refused it." }),
    });
    const details = await open(/^Card, \.card/, "Card");
    const name = within(details).getByLabelText("Name");
    fireEvent.change(name, { target: { value: "Promo" } });
    await act(async () => {
      fireEvent.keyDown(name, { key: "Enter" });
    });
    expect(within(details).getByRole("alert").textContent).toBe(
      "The site refused it."
    );
  });

  it("keeps a locked style's name, and says why", async () => {
    const onRename = vi.fn(async () => ({ ok: true as const }));
    await panel({ library: [{ ...CARD, locked: true }, HERO], onRename });
    const details = await open(/^Card, \.card/, "Card");
    const name = within(details).getByLabelText("Name");
    expect(name.hasAttribute("readonly")).toBe(true);
    fireEvent.change(name, { target: { value: "Promo" } });
    fireEvent.keyDown(name, { key: "Enter" });
    expect(onRename).not.toHaveBeenCalled();
    expect(
      within(details).getByText(
        "Locked by your site’s designers. Ask someone who can unlock shared styles."
      )
    ).toBeTruthy();
  });
});

describe("locking", () => {
  it("offers no lock to an author the server says may not lock", async () => {
    const { access } = accessOf({ mayLock: false });
    await panel({ access });
    const details = await open(/^Card, \.card/, "Card");
    expect(within(details).queryByRole("button", { name: /Lock/ })).toBeNull();
  });

  it("locks and unlocks for an author who may", async () => {
    const { access } = accessOf({ mayLock: true });
    await panel({ access });
    let details = await open(/^Card, \.card/, "Card");
    await act(async () => {
      fireEvent.click(
        within(details).getByRole("button", { name: "Lock Card" })
      );
    });
    expect(access.lock).toHaveBeenCalledWith("c-card", true);
    cleanup();
    await panel({ library: [{ ...CARD, locked: true }], access });
    details = await open(/^Card, \.card/, "Card");
    expect(within(details).getByText(/^Card is locked/)).toBeTruthy();
    await act(async () => {
      fireEvent.click(
        within(details).getByRole("button", { name: "Unlock Card" })
      );
    });
    expect(access.lock).toHaveBeenLastCalledWith("c-card", false);
  });
});

describe("removing one style", () => {
  it("removes an unused style once the author confirms", async () => {
    const { access } = accessOf();
    await panel({ access });
    const details = await open(/^Old note/, "Old note");
    fireEvent.click(within(details).getByRole("button", { name: "Remove" }));
    await act(async () => {
      fireEvent.click(
        within(details).getByRole("button", { name: "Remove Old note" })
      );
    });
    expect(access.remove).toHaveBeenCalledWith(["c-old"]);
  });

  it("offers no Remove for a style in use, and says why", async () => {
    const { access } = accessOf({ styles: { "c-card": reach({ pages: 1 }) } });
    await panel({ access });
    const details = await open(/^Card, \.card/, "Card");
    expect(
      within(details).queryByRole("button", { name: "Remove" })
    ).toBeNull();
    expect(
      within(details).getByText(/^In use, so it can’t be removed/)
    ).toBeTruthy();
  });

  it("counts a block on this page as a use", async () => {
    const { access } = accessOf();
    await panel({
      access,
      pageBlocks: { counts: new Map([["c-old", 1]]), complete: true },
    });
    const details = await open(/^Old note/, "Old note");
    expect(
      within(details).queryByRole("button", { name: "Remove" })
    ).toBeNull();
  });
});

describe("Remove unused…", () => {
  it("lists the unused styles by name, then removes them through the route", async () => {
    const { access } = accessOf({
      styles: { "c-card": reach({ pages: 2 }) },
    });
    await panel({ access });
    fireEvent.click(screen.getByRole("button", { name: "Remove unused…" }));
    const confirm = await screen.findByRole("group", {
      name: "Remove 2 unused shared styles",
    });
    expect(confirm.textContent).toContain(
      "Remove 2 unused shared styles? No page uses them."
    );
    expect(confirm.textContent).toContain("hero");
    expect(confirm.textContent).toContain("Old note");
    expect(confirm.textContent).not.toContain("Card");
    await act(async () => {
      fireEvent.click(
        within(confirm).getByRole("button", { name: "Remove 2" })
      );
    });
    expect(access.remove).toHaveBeenCalledWith(["c-hero", "c-old"]);
  });

  it("shows the route's refusal in its own words", async () => {
    const { access } = accessOf({
      remove: async () => "Nothing was removed. Old note is locked.",
    });
    await panel({ access, library: [OLD] });
    fireEvent.click(screen.getByRole("button", { name: "Remove unused…" }));
    const confirm = await screen.findByRole("group", {
      name: "Remove 1 unused shared style",
    });
    await act(async () => {
      fireEvent.click(
        within(confirm).getByRole("button", { name: "Remove 1" })
      );
    });
    expect(within(confirm).getByRole("alert").textContent).toBe(
      "Nothing was removed. Old note is locked."
    );
  });

  it("is withheld while some pages are still being counted, saying so in the route's words", async () => {
    const { access } = accessOf({ whole: false });
    await panel({ access });
    const button = screen.getByRole("button", { name: "Remove unused…" });
    expect(button.hasAttribute("disabled")).toBe(true);
    expect(
      screen.getByText(
        "Some pages are still being counted, so no shared style can be removed yet."
      )
    ).toBeTruthy();
  });

  it("leaves out locked styles and styles set in code", async () => {
    const { access, usageReads } = accessOf();
    await panel({
      access,
      library: [{ ...CARD, locked: true }, HERO, OLD],
      suppliedClassIds: ["c-hero"],
    });
    usageReads.length = 0;
    fireEvent.click(screen.getByRole("button", { name: "Remove unused…" }));
    await screen.findByRole("group", { name: "Remove 1 unused shared style" });
    expect(usageReads).toEqual([["c-old"]]);
  });
});

describe("a role that may not change the site's design", () => {
  it("shows the styles read-only: no rename, no Remove, no Remove unused", async () => {
    const onRename = vi.fn(async () => ({ ok: true as const }));
    const { access } = accessOf();
    await panel({ readOnly: true, access, onRename });
    expect(
      screen.getByText(
        "You can view the site’s shared styles but not change them."
      )
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Remove unused…" })).toBeNull();
    const details = await open(/^Old note/, "Old note");
    const name = within(details).getByLabelText("Name");
    expect(name.hasAttribute("readonly")).toBe(true);
    fireEvent.change(name, { target: { value: "New" } });
    fireEvent.keyDown(name, { key: "Enter" });
    expect(onRename).not.toHaveBeenCalled();
    expect(
      within(details).queryByRole("button", { name: "Remove" })
    ).toBeNull();
  });
});
