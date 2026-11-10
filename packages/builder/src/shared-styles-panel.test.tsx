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
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  SHARED_STYLE_UNCOUNTED_USES,
  type SharedStyleReach,
  type SharedStylesCount,
  type SharedStylesUsage,
  type SharedStyleUsesPage,
} from "./shared-style-library";
import {
  SharedStylesPanel,
  USAGE_RECOUNT_MS,
  USAGE_RECOUNT_IDLE_MAX,
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
  counting = !whole,
  mayLock = false,
  styles = {},
  uses,
  remove = async () => undefined,
  removeWithReason,
  lock = async () => undefined,
}: {
  whole?: boolean;
  /** Whether a count that is not whole may still become whole. */
  counting?: boolean;
  mayLock?: boolean;
  styles?: Record<string, SharedStyleReach>;
  uses?: (id: string, page: number) => SharedStyleUsesPage;
  remove?: SharedStylesAccess["remove"];
  removeWithReason?: SharedStylesAccess["removeWithReason"];
  lock?: SharedStylesAccess["lock"];
} = {}) {
  const usageReads: (readonly string[])[] = [];
  const access: SharedStylesAccess = {
    usage: vi.fn(async (ids: readonly string[]): Promise<SharedStylesUsage> => {
      usageReads.push(ids);
      return {
        whole,
        counting,
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
    ...(removeWithReason === undefined
      ? {}
      : { removeWithReason: vi.fn(removeWithReason) }),
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
    const card = row(/^Card, \.nx-c-card/);
    expect(card.textContent).toContain("Card");
    expect(card.textContent).toContain(".nx-c-card");
    // A style made before names shows its class name as its name.
    expect(row(/^hero, \.nx-c-hero/)).toBeTruthy();
  });

  it("lists no look among the shared styles, only among the block looks", async () => {
    const outline: NamedClass = {
      id: "look:core/button:outline",
      slug: "button-outline",
      label: "Outline",
      orderIndex: 0,
      blockType: "core/button",
      styles: {},
    };
    await panel({ library: [CARD, outline] });
    expect(row(/^Card, \.nx-c-card/)).toBeTruthy();
    const shared = screen.getByRole("region", { name: "Shared styles" });
    expect(within(shared).queryByText("Outline")).toBeNull();
    // It is listed with its block type's looks instead.
    const looks = screen.getByRole("region", { name: "Block looks" });
    expect(within(looks).getByText("Outline")).toBeTruthy();
  });

  it("lists each block type's own look first, with a Default chip and no count, and edits a look on a click", async () => {
    const primary: NamedClass = {
      id: "look:core/button:primary",
      slug: "button-primary",
      label: "Primary",
      orderIndex: 0,
      blockType: "core/button",
      isDefault: true,
      styles: {},
    };
    const outline: NamedClass = {
      id: "look:core/button:outline",
      slug: "button-outline",
      label: "Outline",
      orderIndex: 1,
      blockType: "core/button",
      styles: {},
    };
    const onEditLook = vi.fn();
    await panel({
      library: [CARD, primary, outline],
      looks: {
        onEdit: onEditLook,
        editing: { id: outline.id, blockType: "core/button" },
      },
    });
    const looks = screen.getByRole("region", { name: "Block looks" });
    const rows = within(looks).getAllByRole("button");
    expect(rows.map(each => each.textContent)).toEqual([
      expect.stringMatching(/^ButtonPrimaryown lookDefault$/),
      expect.stringMatching(/^ButtonOutline\.nx-l-button-outline/),
    ]);
    // The own look says what it covers, on hover and to a screen reader.
    expect(rows[0]?.getAttribute("aria-description")).toBe(
      "Default · every Button starts from this look; other looks are laid on top"
    );
    expect(rows.map(each => each.getAttribute("aria-pressed"))).toEqual([
      "false",
      "true",
    ]);
    fireEvent.click(rows[0] as HTMLElement);
    expect(onEditLook).toHaveBeenCalledWith({
      id: primary.id,
      blockType: "core/button",
    });
  });

  it("reads a worn look's count with the styles' and says it in the row's name", async () => {
    const outline: NamedClass = {
      id: "look:core/button:outline",
      slug: "button-outline",
      label: "Outline",
      orderIndex: 0,
      blockType: "core/button",
      styles: {},
    };
    const { access, usageReads } = accessOf({
      styles: { [outline.id]: reach({ pages: 3 }) },
    });
    await panel({
      library: [CARD, outline],
      access,
      looks: { onEdit: () => {}, editing: null },
    });
    // One read for the tab: the styles and the worn look together.
    expect(usageReads).toHaveLength(1);
    expect(usageReads[0]).toEqual([CARD.id, outline.id]);
    const looks = screen.getByRole("region", { name: "Block looks" });
    expect(
      within(looks)
        .getByRole("button", { name: /^Outline, \.nx-l-button-outline, / })
        .getAttribute("aria-label")
    ).toMatch(/3 pages/);
  });

  it("counts a worn look's blocks on the open page with its documents, as a shared style's", async () => {
    const outline: NamedClass = {
      id: "look:core/button:outline",
      slug: "button-outline",
      label: "Outline",
      orderIndex: 0,
      blockType: "core/button",
      styles: {},
    };
    const { access } = accessOf({
      styles: {
        [CARD.id]: reach({ pages: 4 }),
        [outline.id]: reach({ pages: 3 }),
      },
    });
    await panel({
      library: [CARD, outline],
      access,
      // The open page's unsaved blocks: two wear the look, one the style.
      pageBlocks: {
        counts: new Map([
          [outline.id, 2],
          [CARD.id, 1],
        ]),
        complete: true,
      },
      looks: { onEdit: () => {}, editing: null },
    });
    const looks = screen.getByRole("region", { name: "Block looks" });
    const look = within(looks).getByRole("button", { name: /^Outline, / });
    expect(look.getAttribute("aria-label")).toBe(
      "Outline, .nx-l-button-outline, 2 blocks on this page · on 3 pages"
    );
    expect(look.getAttribute("title")).toBe(
      "2 blocks on this page · on 3 pages"
    );
    // The control: the shared style beside it says its page blocks the same way.
    expect(row(/^Card, \.nx-c-card/).getAttribute("aria-label")).toBe(
      "Card, .nx-c-card, 1 block on this page · on 4 pages"
    );
  });

  it("finds each of two block types' own looks that share an id by its own text", async () => {
    const primary: NamedClass = {
      id: "look:shared",
      slug: "button-primary",
      label: "Primary",
      orderIndex: 0,
      blockType: "core/button",
      isDefault: true,
      styles: {},
    };
    const square: NamedClass = {
      id: "look:shared",
      slug: "image-square",
      label: "Square",
      orderIndex: 1,
      blockType: "core/image",
      isDefault: true,
      styles: {},
    };
    await panel({
      library: [CARD, primary, square],
      looks: { onEdit: () => {}, editing: null },
    });
    const search = screen.getByRole("searchbox", { name: /Search/ });
    const lookNames = () =>
      within(screen.getByRole("region", { name: "Block looks" }))
        .getAllByRole("button")
        .map(each => each.getAttribute("aria-label"));
    // The control: with no search, both are listed.
    expect(lookNames()).toEqual(["Primary, own look", "Square, own look"]);
    fireEvent.change(search, { target: { value: "Square" } });
    expect(lookNames()).toEqual(["Square, own look"]);
    fireEvent.change(search, { target: { value: "Primary" } });
    expect(lookNames()).toEqual(["Primary, own look"]);
  });

  it("finds a look by a value it sets, as it finds a shared style", async () => {
    const outline: NamedClass = {
      id: "look:core/button:outline",
      slug: "button-outline",
      label: "Outline",
      orderIndex: 0,
      blockType: "core/button",
      styles: { base: { base: { opacity: 0.25 } } },
    };
    const text: NamedClass = {
      ...outline,
      id: "look:core/button:text",
      slug: "button-text",
      label: "Text",
      orderIndex: 1,
      styles: {},
    };
    await panel({ library: [CARD, outline, text] });
    fireEvent.change(screen.getByRole("searchbox", { name: /Search/ }), {
      target: { value: "0.25" },
    });
    const looks = screen.getByRole("region", { name: "Block looks" });
    expect(within(looks).getByText("Outline")).toBeTruthy();
    expect(within(looks).queryByText("Text")).toBeNull();
  });

  it("says how to make one when there are none, with no + to create an empty one", async () => {
    await panel({ library: [] });
    expect(screen.getByText(/^No shared styles yet\./).textContent).toBe(
      "No shared styles yet. Select a block and choose Save as shared style…"
    );
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
    expect(row(/^Card, \.nx-c-card, locked/)).toBeTruthy();
    expect(row(/^hero, \.nx-c-hero, set in your site/).textContent).toContain(
      "In code"
    );
  });
});

describe("the row's preview", () => {
  it("draws a style's colours on a tile that stands for the site's page", async () => {
    await panel({ tokens: { tokens: [] } });
    const card = row(/^Card, \.nx-c-card/);
    const tile = card.querySelector<HTMLElement>(".nx-shared-styles__tile");
    // The engine's default page, in light mode: white, with near-black text.
    expect(tile?.style.backgroundColor).toBe("rgb(255, 255, 255)");
    expect(tile?.style.color).toBe("rgb(17, 24, 39)");
    const specimen = tile?.querySelector<HTMLElement>(".nx-vars__specimen");
    expect(specimen?.style.color).toBe("rgb(17, 34, 51)");
  });

  describe("in dark mode", () => {
    afterEach(() => vi.unstubAllGlobals());
    const prefersDark = () =>
      vi.stubGlobal("matchMedia", (query: string) => ({
        matches: query.includes("dark"),
        media: query,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      }));
    const LIGHT_TEXT: NamedClass = {
      id: "c-light",
      slug: "light-text",
      label: "Light text",
      orderIndex: 3,
      styles: { base: { [BASE_BREAKPOINT]: { color: "#e5e7eb" } } },
    };

    it("draws a style unreadable on the dark page on the light one, and says so", async () => {
      prefersDark();
      await panel({ tokens: { tokens: [] }, library: [CARD, LIGHT_TEXT] });
      const card = row(/^Card, \.nx-c-card/);
      expect(card.getAttribute("aria-label")).toContain(
        "Hard to read in dark mode"
      );
      const tile = card.querySelector<HTMLElement>(".nx-shared-styles__tile");
      expect(tile?.style.backgroundColor).toBe("rgb(255, 255, 255)");
      // Said where keyboard and touch users meet it too: the row's tooltip,
      // shown when the row takes focus, not a title on a hidden element.
      expect(tile?.hasAttribute("title")).toBe(false);
      await act(async () => {
        card.focus();
      });
      expect((await screen.findByRole("tooltip")).textContent).toContain(
        "Hard to read in dark mode"
      );
      // The tooltip leaves the row the one control it was: it still opens.
      fireEvent.click(card);
      const opened = await screen.findByRole("dialog", { name: "Card" });
      fireEvent.keyDown(opened, { key: "Escape" });
      // CONTROL: a style that reads on the dark page keeps it, unmarked.
      const light = row(/^Light text, \.nx-c-light-text/);
      expect(light.getAttribute("aria-label")).not.toContain("dark mode");
      expect(
        light.querySelector<HTMLElement>(".nx-shared-styles__tile")?.style
          .backgroundColor
      ).toBe("rgb(11, 15, 25)");
    });

    it("gives a white style with no text colour readable text", async () => {
      prefersDark();
      const field: NamedClass = {
        id: "c-field",
        slug: "form-field",
        label: "Form field",
        orderIndex: 0,
        styles: {
          base: { [BASE_BREAKPOINT]: { backgroundColor: "#ffffff" } },
        },
      };
      await panel({ tokens: { tokens: [] }, library: [field] });
      const specimen =
        row(/^Form field/).querySelector<HTMLElement>(".nx-vars__specimen");
      expect(specimen?.style.backgroundColor).toBe("rgb(255, 255, 255)");
      expect(specimen?.style.color).toBe("rgb(17, 24, 39)");
    });
  });

  it('outlines the "Aa" on a background it cannot measure', async () => {
    const navy: NamedClass = {
      id: "c-navy",
      slug: "navy-band",
      label: "Navy band",
      orderIndex: 0,
      styles: { base: { [BASE_BREAKPOINT]: { backgroundColor: "navy" } } },
    };
    await panel({ tokens: { tokens: [] }, library: [navy, CARD] });
    const specimen = (name: RegExp) =>
      row(name).querySelector<HTMLElement>(".nx-vars__specimen");
    expect(
      specimen(/^Navy band/)?.classList.contains(
        "nx-shared-styles__lead--outlined"
      )
    ).toBe(true);
    // CONTROL: a style shown to read draws with no outline.
    expect(
      specimen(/^Card, \.nx-c-card/)?.classList.contains(
        "nx-shared-styles__lead--outlined"
      )
    ).toBe(false);
  });

  it("keeps the neutral tile when the site's variables are not to hand", async () => {
    await panel();
    const tile = row(/^Card, \.nx-c-card/).querySelector<HTMLElement>(
      ".nx-shared-styles__tile"
    );
    expect(tile).not.toBeNull();
    expect(tile?.style.backgroundColor).toBe("");
  });
});

describe("counts", () => {
  it("reads the rows on screen first, then every other style, fifty at a time and each once", async () => {
    const many: NamedClass[] = Array.from({ length: 61 }, (_, n) => ({
      id: `c-${n}`,
      slug: `s-${n}`,
      orderIndex: n,
      styles: {},
    }));
    const { access, usageReads } = accessOf();
    await panel({ library: many, access });
    await act(async () => {
      await Promise.resolve();
    });
    // Every style is read, so each filter can be counted: the fifty on
    // screen first, then the rest.
    expect(usageReads.map(ids => ids.length)).toEqual([50, 11]);
    expect(usageReads[0]?.[0]).toBe("c-0");
    expect(usageReads[1]?.[0]).toBe("c-50");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Show 11 more" }));
    });
    await act(async () => {
      await Promise.resolve();
    });
    // Showing them asks nothing again.
    expect(usageReads).toHaveLength(2);
  });

  it("states the reach in words, with blocks on this page", async () => {
    const { access } = accessOf({
      styles: { "c-card": reach({ pages: 4, components: 1 }) },
    });
    await panel({
      access,
      pageBlocks: { counts: new Map([["c-card", 3]]), complete: true },
    });
    const card = row(/^Card, \.nx-c-card/);
    expect(card.getAttribute("aria-label")).toBe(
      "Card, .nx-c-card, 3 blocks on this page · on 4 pages and 1 component"
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
    const card = row(/^Card, \.nx-c-card/);
    expect(card.getAttribute("aria-label")).toBe(
      "Card, .nx-c-card, On at least 4 pages"
    );
    expect(card.textContent).toContain("4+ pages");
    const note = screen.getByText(
      "Some pages haven't been counted yet, so the numbers are minimums and no style can be called unused or removed."
    );
    // At the top of the list, where the counts first read as minimums, not
    // after every row.
    expect(
      note.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    // Who counts them, so a site whose counts never finish knows why: the
    // site's background jobs, which nothing runs without a scheduler.
    expect(
      screen.getByText(/Pages are counted by the site's background jobs/)
    ).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: "How background jobs run" })
        .getAttribute("href")
    ).toBe("https://nextlyhq.com/docs/jobs#running-the-queue");
  });

  it("says a zero not counted yet in words, muted, rather than 0+", async () => {
    const { access } = accessOf({
      whole: false,
      styles: { "c-card": reach({}, false) },
    });
    await panel({ access });
    const chip = row(/^Card, \.nx-c-card/).querySelector(".nx-vars__chip");
    expect(chip?.textContent).toBe("Not counted yet");
    expect(chip?.classList.contains("nx-shared-styles__count--uncounted")).toBe(
      true
    );
  });

  it("keeps the counts floors when an earlier batch was read before every page was counted", async () => {
    const many: NamedClass[] = Array.from({ length: 61 }, (_, n) => ({
      id: `c-${n}`,
      slug: `s-${n}`,
      orderIndex: n,
      styles: {},
    }));
    let reads = 0;
    const base = accessOf().access;
    // The index finishes counting between the two batches of one scan.
    const access: SharedStylesAccess = {
      ...base,
      usage: vi.fn(async (ids: readonly string[]) => {
        reads += 1;
        const whole = reads > 1;
        return {
          whole,
          counting: !whole,
          mayLock: false,
          styles: new Map(ids.map(id => [id, reach({}, whole)])),
        };
      }),
    };
    await panel({ library: many, access });
    await act(async () => {
      await Promise.resolve();
    });
    expect(reads).toBe(2);
    expect(
      screen.getByText(
        "Some pages haven't been counted yet, so the numbers are minimums and no style can be called unused or removed."
      )
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Unused" })).toBeTruthy();
  });

  it("asks about an id holding a newline as that one id", async () => {
    const odd: NamedClass = {
      id: "a\nb",
      slug: "odd",
      label: "Odd",
      orderIndex: 0,
      styles: {},
    };
    const { access, usageReads } = accessOf({
      styles: { "a\nb": reach({ pages: 3 }) },
    });
    await panel({ library: [odd], access, suppliedClassIds: ["a\nb"] });
    expect(usageReads).toEqual([["a\nb"]]);
    expect(row(/^Odd, \.nx-c-odd/).getAttribute("aria-label")).toBe(
      "Odd, .nx-c-odd, set in your site’s code, On 3 pages"
    );
  });

  it("keeps asking while an earlier batch was read before the count finished", async () => {
    // Sixty styles in two batches: the first read while still counting, the
    // second once counting is done and nothing pending.
    const many: NamedClass[] = Array.from({ length: 60 }, (_, n) => ({
      id: `c-${n}`,
      slug: `s-${n}`,
      orderIndex: n,
      styles: {},
    }));
    let reads = 0;
    const asked: (readonly string[])[] = [];
    const base = accessOf().access;
    const access: SharedStylesAccess = {
      ...base,
      usage: vi.fn(async (ids: readonly string[]) => {
        reads += 1;
        asked.push(ids);
        const whole = reads > 1;
        return {
          whole,
          counting: !whole,
          mayLock: false,
          styles: new Map(ids.map(id => [id, reach({}, whole)])),
        };
      }),
    };
    vi.useFakeTimers({
      shouldAdvanceTime: true,
      toFake: ["setTimeout", "clearTimeout"],
    });
    try {
      await panel({ library: many, access });
      await act(async () => {
        await Promise.resolve();
      });
      expect(reads).toBe(2);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(USAGE_RECOUNT_MS);
      });
    } finally {
      vi.useRealTimers();
    }
    // The first batch's floors were asked about again: a read after the
    // timer names a style from it, not only the already-whole second batch.
    expect(asked.slice(2).some(ids => ids.includes("c-0"))).toBe(true);
  });

  it("re-reads a host that does not say whether it is counting, a bounded number of times", async () => {
    // A host built before `counting` existed: absent means unknown.
    const base = accessOf().access;
    let reads = 0;
    const access: SharedStylesAccess = {
      ...base,
      usage: vi.fn(async (ids: readonly string[]) => {
        reads += 1;
        return {
          whole: false,
          mayLock: false,
          styles: new Map(ids.map(id => [id, reach({}, false)])),
        };
      }),
    };
    vi.useFakeTimers({
      shouldAdvanceTime: true,
      toFake: ["setTimeout", "clearTimeout"],
    });
    try {
      await panel({ access });
      const first = reads;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(USAGE_RECOUNT_MS);
      });
      // Still asked again while it may be counting...
      expect(reads).toBe(first + 1);
      for (let tick = 0; tick < USAGE_RECOUNT_IDLE_MAX + 5; tick += 1) {
        await act(async () => {
          await vi.advanceTimersByTimeAsync(USAGE_RECOUNT_MS);
        });
      }
    } finally {
      vi.useRealTimers();
    }
    // ...but not for ever.
    expect(reads).toBe(1 + USAGE_RECOUNT_IDLE_MAX);
  });

  it("stops asking a site that says it is counting once five minutes pass with no change", async () => {
    // A site no scheduler runs jobs for: counting, and never moving. Asked
    // for ever, every open tab would poll it for as long as it stays open.
    const base = accessOf().access;
    let reads = 0;
    const access: SharedStylesAccess = {
      ...base,
      usage: vi.fn(async (ids: readonly string[]) => {
        reads += 1;
        return {
          whole: false,
          counting: true,
          mayLock: false,
          styles: new Map(ids.map(id => [id, reach({ pages: 2 }, false)])),
        };
      }),
    };
    vi.useFakeTimers({
      shouldAdvanceTime: true,
      toFake: ["setTimeout", "clearTimeout"],
    });
    try {
      await panel({ access });
      for (let tick = 0; tick < USAGE_RECOUNT_IDLE_MAX + 5; tick += 1) {
        await act(async () => {
          await vi.advanceTimersByTimeAsync(USAGE_RECOUNT_MS);
        });
      }
    } finally {
      vi.useRealTimers();
    }
    expect(reads).toBe(1 + USAGE_RECOUNT_IDLE_MAX);
  });

  it("keeps asking a counting site while its counts still move", async () => {
    const base = accessOf().access;
    let reads = 0;
    const access: SharedStylesAccess = {
      ...base,
      usage: vi.fn(async (ids: readonly string[]) => {
        reads += 1;
        // One more page counted on every read: the backfill is getting on.
        return {
          whole: false,
          counting: true,
          mayLock: false,
          styles: new Map(ids.map(id => [id, reach({ pages: reads }, false)])),
        };
      }),
    };
    vi.useFakeTimers({
      shouldAdvanceTime: true,
      toFake: ["setTimeout", "clearTimeout"],
    });
    try {
      await panel({ access });
      for (let tick = 0; tick < USAGE_RECOUNT_IDLE_MAX + 5; tick += 1) {
        await act(async () => {
          await vi.advanceTimersByTimeAsync(USAGE_RECOUNT_MS);
        });
      }
    } finally {
      vi.useRealTimers();
    }
    expect(reads).toBe(1 + USAGE_RECOUNT_IDLE_MAX + 5);
  });

  it("keeps asking while the kinds move, even when the total does not", async () => {
    // A page use added while a component use goes: two documents throughout,
    // but the row's words change ("on 2 pages" from "on 1 page and 1
    // component"), so the counting is still getting somewhere.
    const base = accessOf().access;
    let reads = 0;
    const access: SharedStylesAccess = {
      ...base,
      usage: vi.fn(async (ids: readonly string[]) => {
        reads += 1;
        const pages = reads % 2 === 0 ? 2 : 1;
        return {
          whole: false,
          counting: true,
          mayLock: false,
          styles: new Map(
            ids.map(id => [id, reach({ pages, components: 2 - pages }, false)])
          ),
        };
      }),
    };
    vi.useFakeTimers({
      shouldAdvanceTime: true,
      toFake: ["setTimeout", "clearTimeout"],
    });
    try {
      await panel({ access });
      for (let tick = 0; tick < USAGE_RECOUNT_IDLE_MAX + 5; tick += 1) {
        await act(async () => {
          await vi.advanceTimersByTimeAsync(USAGE_RECOUNT_MS);
        });
      }
    } finally {
      vi.useRealTimers();
    }
    expect(reads).toBe(1 + USAGE_RECOUNT_IDLE_MAX + 5);
  });

  it("renews the unknown host's recounts when a style it has not read arrives", async () => {
    const base = accessOf().access;
    const asked: (readonly string[])[] = [];
    const access: SharedStylesAccess = {
      ...base,
      usage: vi.fn(async (ids: readonly string[]) => {
        asked.push(ids);
        return {
          whole: false,
          mayLock: false,
          styles: new Map(ids.map(id => [id, reach({}, false)])),
        };
      }),
    };
    const tick = async () =>
      act(async () => {
        await vi.advanceTimersByTimeAsync(USAGE_RECOUNT_MS);
      });
    vi.useFakeTimers({
      shouldAdvanceTime: true,
      toFake: ["setTimeout", "clearTimeout"],
    });
    try {
      const view = await panel({ library: [CARD], access });
      // Spend the budget on Card.
      for (let n = 0; n < USAGE_RECOUNT_IDLE_MAX + 2; n += 1) await tick();
      const spent = asked.length;
      // A style made since arrives, and is read not whole.
      view.rerender(
        <SharedStylesPanel
          library={[CARD, HERO]}
          pageBlocks={NO_BLOCKS}
          onRename={async () => ({ ok: true })}
          access={access}
        />
      );
      await act(async () => {
        await Promise.resolve();
      });
      expect(asked.length).toBe(spent + 1);
      await tick();
      // Its floors are asked about again, on the timer, not only read once.
      expect(asked.length).toBe(spent + 2);
      expect(asked.at(-1)).toContain("c-hero");
    } finally {
      vi.useRealTimers();
    }
  });

  it("asks nothing more when the count cannot become whole", async () => {
    // A blocks-backed Single, say: floors for good, so no timer.
    const { access, usageReads } = accessOf({ whole: false, counting: false });
    vi.useFakeTimers({
      shouldAdvanceTime: true,
      toFake: ["setTimeout", "clearTimeout"],
    });
    try {
      await panel({ access });
      const reads = usageReads.length;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(USAGE_RECOUNT_MS * 3);
      });
      expect(usageReads).toHaveLength(reads);
    } finally {
      vi.useRealTimers();
    }
    // The floor note says the numbers are minimums, promising no wait.
    expect(
      screen.getByText(
        "Some pages can't be counted, so these numbers are minimums."
      )
    ).toBeTruthy();
    expect(screen.queryByText(/haven't been counted/)).toBeNull();
    // No job will finish them, so none is pointed at.
    expect(
      screen.queryByRole("link", { name: "How background jobs run" })
    ).toBeNull();
  });

  it("says once, without a wait, why Unused holds rows back when the count cannot finish", async () => {
    const { access } = accessOf({ whole: false, counting: false });
    await panel({ library: [CARD, HERO, OLD], access });
    fireEvent.click(
      within(screen.getByRole("group", { name: "Show" })).getByRole("button", {
        name: /^Unused/,
      })
    );
    expect(
      screen.getAllByText(/^Some pages/).map(note => note.textContent)
    ).toEqual(["Some pages can't be counted, so these numbers are minimums."]);
  });

  it("asks again while counting, and shows the whole count once it is done", async () => {
    let counted = false;
    const base = accessOf().access;
    const access: SharedStylesAccess = {
      ...base,
      usage: vi.fn(async (ids: readonly string[]) => ({
        whole: counted,
        counting: !counted,
        mayLock: false,
        styles: new Map(ids.map(id => [id, reach({ pages: 4 }, counted)])),
      })),
    };
    // The recount waits on a timer started at the first read, so the clock is
    // faked from the start; it still runs, for the render helpers.
    vi.useFakeTimers({
      shouldAdvanceTime: true,
      toFake: ["setTimeout", "clearTimeout"],
    });
    try {
      await panel({ access });
      expect(row(/^Card, \.nx-c-card/).getAttribute("aria-label")).toBe(
        "Card, .nx-c-card, On at least 4 pages"
      );
      counted = true;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(USAGE_RECOUNT_MS);
      });
    } finally {
      vi.useRealTimers();
    }
    expect(row(/^Card, \.nx-c-card/).getAttribute("aria-label")).toBe(
      "Card, .nx-c-card, On 4 pages"
    );
    expect(
      screen.queryByText(
        "Some pages haven't been counted yet, so these numbers are minimums."
      )
    ).toBeNull();
  });
});

describe("counting the pages now", () => {
  /**
   * A site not counted in full until it is asked to count: each count moves
   * it on by `step` pages of Card's, and the last one makes it whole.
   */
  function countingSite({
    mayCount = true,
    counts = [true],
    refused,
  }: {
    mayCount?: boolean;
    /** Whether each count in turn leaves the site whole. */
    counts?: boolean[];
    refused?: string;
  } = {}) {
    let whole = false;
    let pages = 1;
    const count = vi.fn(async (): Promise<SharedStylesCount> => {
      if (refused !== undefined) return { kind: "refused", reason: refused };
      whole = counts.shift() ?? true;
      pages += 1;
      return { kind: "counted", whole, counting: !whole };
    });
    const base = accessOf().access;
    const access: SharedStylesAccess = {
      ...base,
      count,
      usage: vi.fn(async (ids: readonly string[]) => ({
        whole,
        counting: !whole,
        mayLock: false,
        mayCount,
        styles: new Map(ids.map(id => [id, reach({ pages }, whole)])),
      })),
    };
    return { access, count };
  }
  const countNow = () => screen.queryByRole("button", { name: "Count now" });

  it("offers Count now beside who counts the pages, and counts them", async () => {
    const { access, count } = countingSite();
    await panel({ access });
    // A button, since it does work, beside the docs on how the jobs that
    // would have counted run.
    const button = countNow();
    expect(button).not.toBeNull();
    expect(
      screen.getByRole("link", { name: "How background jobs run" })
    ).toBeTruthy();

    await act(async () => {
      fireEvent.click(button as HTMLElement);
    });
    expect(count).toHaveBeenCalledTimes(1);
    // The rows are read again, now whole: the note and the button go.
    await screen.findByRole("button", { name: "Card, .nx-c-card, On 2 pages" });
    expect(screen.queryByText(/haven't been counted yet/)).toBeNull();
    expect(countNow()).toBeNull();
  });

  it("says when pages are still left, and offers to count again", async () => {
    const { access, count } = countingSite({ counts: [false, true] });
    await panel({ access });
    await act(async () => {
      fireEvent.click(countNow() as HTMLElement);
    });
    expect((await screen.findByRole("status")).textContent).toBe(
      "Some pages are still to count."
    );
    const again = screen.getByRole("button", { name: "Count again" });
    await act(async () => {
      fireEvent.click(again);
    });
    expect(count).toHaveBeenCalledTimes(2);
    await screen.findByRole("button", { name: "Card, .nx-c-card, On 3 pages" });
  });

  it("offers a count again once a later read says counting can get further", async () => {
    // The count said nothing more could be counted; then the site gained
    // something to count (a new scope, a failed write marked), and a later
    // read says so. The final word gives way to it.
    const base = accessOf().access;
    let counting = true;
    const count = vi.fn(async (): Promise<SharedStylesCount> => {
      counting = false;
      return { kind: "counted", whole: false, counting: false };
    });
    const access: SharedStylesAccess = {
      ...base,
      count,
      usage: vi.fn(async (ids: readonly string[]) => ({
        whole: false,
        counting,
        mayLock: false,
        mayCount: true,
        styles: new Map(ids.map(id => [id, reach({ pages: 1 }, false)])),
      })),
    };
    const view = await panel({ library: [CARD], access });
    await act(async () => {
      fireEvent.click(countNow() as HTMLElement);
    });
    expect(countNow()).toBeNull();
    // Something new to count; a style made meanwhile is read, and that read
    // says so.
    counting = true;
    await act(async () => {
      view.rerender(
        <SharedStylesPanel
          library={[CARD, HERO]}
          pageBlocks={NO_BLOCKS}
          onRename={async () => ({ ok: true })}
          access={access}
        />
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() => expect(countNow()).not.toBeNull());
    expect(screen.queryByText("The pages left can't be counted.")).toBeNull();
  });

  it("offers a count again on the first later read, when the count's own read never answered", async () => {
    // The read the count sets off fails, so it says nothing; the next read
    // that answers is the first word after the count, and says counting.
    const base = accessOf().access;
    let failNext = false;
    const count = vi.fn(async (): Promise<SharedStylesCount> => {
      failNext = true;
      return { kind: "counted", whole: false, counting: false };
    });
    const usage = vi.fn(async (ids: readonly string[]) => {
      if (failNext) {
        failNext = false;
        throw new Error("offline");
      }
      return {
        whole: false,
        counting: true,
        mayLock: false,
        mayCount: true,
        styles: new Map(ids.map(id => [id, reach({ pages: 1 }, false)])),
      };
    });
    const access: SharedStylesAccess = { ...base, count, usage };
    const view = await panel({ library: [CARD], access });
    await act(async () => {
      fireEvent.click(countNow() as HTMLElement);
    });
    await waitFor(() => expect(usage).toHaveBeenCalledTimes(2));
    expect(countNow()).toBeNull();
    // A style comes on screen, and its read is the first to answer.
    await act(async () => {
      view.rerender(
        <SharedStylesPanel
          library={[CARD, HERO]}
          pageBlocks={NO_BLOCKS}
          onRename={async () => ({ ok: true })}
          access={access}
        />
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() => expect(usage).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(countNow()).not.toBeNull());
  });

  it("offers no further count when the answer says counting cannot get further", async () => {
    // Whole no, counting no: what is left cannot be counted, so another
    // press would do nothing, and none is offered.
    const base = accessOf().access;
    const count = vi.fn(
      async (): Promise<SharedStylesCount> => ({
        kind: "counted",
        whole: false,
        counting: false,
      })
    );
    const access: SharedStylesAccess = {
      ...base,
      count,
      usage: vi.fn(async (ids: readonly string[]) => {
        // The read after the press fails, so the panel still holds the
        // first read's "counting": only the count's own answer can say no
        // further count will help.
        if (count.mock.calls.length > 0) throw new Error("offline");
        return {
          whole: false,
          counting: true,
          mayLock: false,
          mayCount: true,
          styles: new Map(ids.map(id => [id, reach({ pages: 1 }, false)])),
        };
      }),
    };
    await panel({ access });
    await act(async () => {
      fireEvent.click(countNow() as HTMLElement);
    });
    expect(screen.queryByRole("button", { name: "Count again" })).toBeNull();
    expect(screen.queryByText("Some pages are still to count.")).toBeNull();
    // Nor a fresh Count now: the answer said another count cannot get
    // further, so the row says that instead of offering one.
    expect(countNow()).toBeNull();
    expect((await screen.findByRole("status")).textContent).toBe(
      "The pages left can't be counted."
    );
  });

  it("says why a count was refused, in its own words", async () => {
    const { access } = countingSite({ refused: "You can't count pages here." });
    await panel({ access });
    await act(async () => {
      fireEvent.click(countNow() as HTMLElement);
    });
    expect((await screen.findByRole("status")).textContent).toBe(
      "You can't count pages here."
    );
  });

  it("offers no Count now to an author who may not count, or a host that cannot", async () => {
    await panel({ access: countingSite({ mayCount: false }).access });
    expect(
      screen.getByText(/Pages are counted by the site's background jobs/)
    ).toBeTruthy();
    expect(countNow()).toBeNull();
    cleanup();

    const { count: _count, ...noCount } = countingSite().access;
    await panel({ access: noCount });
    expect(countNow()).toBeNull();
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

describe("the filters", () => {
  const shownRows = () =>
    screen
      .queryAllByRole("button")
      .filter(button => button.hasAttribute("data-shared-style"))
      .map(button => button.getAttribute("data-shared-style"));
  const filters = () => screen.getByRole("group", { name: "Show" });
  const pick = (name: RegExp) =>
    fireEvent.click(within(filters()).getByRole("button", { name }));
  const LOCKED_OLD: NamedClass = { ...OLD, locked: true };

  it("shows used, unused or locked styles, each counted once every count is exact", async () => {
    const { access } = accessOf({
      styles: { "c-card": reach({ pages: 4 }) },
    });
    await panel({ library: [CARD, HERO, LOCKED_OLD], access });
    const segment = (name: RegExp) =>
      within(filters()).getByRole("button", { name });
    expect(segment(/^All 3$/).getAttribute("aria-pressed")).toBe("true");
    expect(segment(/^Used 1$/)).toBeTruthy();
    expect(segment(/^Unused 2$/)).toBeTruthy();
    expect(segment(/^Locked 1$/)).toBeTruthy();
    pick(/^Unused/);
    expect(shownRows()).toEqual(["c-hero", "c-old"]);
    expect(segment(/^Unused 2$/).getAttribute("aria-pressed")).toBe("true");
    pick(/^Locked/);
    expect(shownRows()).toEqual(["c-old"]);
    pick(/^Used/);
    expect(shownRows()).toEqual(["c-card"]);
    pick(/^All/);
    expect(shownRows()).toEqual(["c-card", "c-hero", "c-old"]);
  });

  it("counts every style, not only the ones on screen", async () => {
    const many = Array.from({ length: 60 }, (_, i) => ({
      id: `c-${i}`,
      slug: `style-${i}`,
      orderIndex: i,
      styles: {},
    }));
    const { access } = accessOf({ styles: { "c-59": reach({ pages: 1 }) } });
    await panel({ library: many, access });
    await act(async () => {
      await Promise.resolve();
    });
    expect(
      within(filters()).getByRole("button", { name: /^Used 1$/ })
    ).toBeTruthy();
    expect(
      within(filters()).getByRole("button", { name: /^Unused 59$/ })
    ).toBeTruthy();
  });

  it("gives no used or unused count while some pages are still being counted", async () => {
    const { access } = accessOf({
      whole: false,
      styles: { "c-card": reach({ pages: 4 }, false) },
    });
    await panel({ library: [CARD, HERO, LOCKED_OLD], access });
    const names = within(filters())
      .getAllByRole("button")
      .map(button => button.getAttribute("aria-label"));
    expect(names).toEqual(["All 3", "Used", "Unused", "Locked 1"]);
  });

  it("lists under Unused only styles certainly unused, saying why while counting", async () => {
    const { access } = accessOf({
      whole: false,
      styles: { "c-card": reach({ pages: 4 }, false) },
    });
    await panel({ library: [CARD, HERO, OLD], access });
    pick(/^Unused/);
    // HERO and OLD count zero so far, which is not unused yet.
    expect(shownRows()).toEqual([]);
    // One note for the whole state, not one per thing it holds back.
    const notes = screen
      .getAllByText(/^Some pages haven't been counted/)
      .map(note => note.textContent);
    expect(notes).toEqual([
      "Some pages haven't been counted yet, so the numbers are minimums and no style can be called unused or removed.",
    ]);
    // Remove unused still says why it waits, by pointing at that note.
    const removeUnused = screen.getByRole("button", { name: "Remove unused…" });
    const describedBy = removeUnused.getAttribute("aria-describedby") ?? "";
    expect(document.getElementById(describedBy)?.textContent).toBe(notes[0]);
    // Who counts them, once, beside that one note.
    expect(
      screen.getAllByRole("link", { name: "How background jobs run" })
    ).toHaveLength(1);
    // A counted use is a use, counted in full or not.
    pick(/^Used/);
    expect(shownRows()).toEqual(["c-card"]);
  });

  it("lists proven-unused styles while an unrelated count is cut short", async () => {
    // Every page counted, but Card's count stopped at its cap and Hero's
    // zero is not complete: only Old note is certainly unused.
    const { access } = accessOf({
      styles: {
        "c-card": reach({ pages: 9 }, false),
        "c-hero": reach({}, false),
        "c-old": reach({}),
      },
    });
    await panel({ library: [CARD, HERO, OLD], access });
    pick(/^Unused/);
    expect(shownRows()).toEqual(["c-old"]);
    // Hero is held back, and the list says some are, beside the proven row;
    // every page is counted, so it promises no wait.
    expect(
      screen.getByText(
        "Some uses could not all be counted, so some styles can't be called unused yet."
      )
    ).toBeTruthy();
    expect(screen.queryByText(/^Some pages/)).toBeNull();
  });

  it("says nothing about counting when no row under Unused is held back", async () => {
    const { access } = accessOf({
      styles: { "c-card": reach({ pages: 9 }, false) },
    });
    await panel({ library: [CARD, HERO, OLD], access });
    pick(/^Unused/);
    expect(shownRows()).toEqual(["c-hero", "c-old"]);
    expect(screen.queryByText(/no style can be called unused yet/)).toBeNull();
  });

  it("keeps a zero on a page not read in full out of Unused", async () => {
    const { access } = accessOf();
    await panel({
      library: [HERO],
      access,
      pageBlocks: { counts: new Map(), complete: false },
    });
    pick(/^Unused/);
    expect(shownRows()).toEqual([]);
  });

  it("says when a filter holds nothing, and when the search finds nothing in it", async () => {
    const { access } = accessOf({
      styles: { "c-card": reach({ pages: 4 }) },
    });
    await panel({ library: [CARD], access });
    pick(/^Unused/);
    expect(screen.getByText("No unused shared styles.")).toBeTruthy();
    pick(/^Locked/);
    expect(screen.getByText("No locked shared styles.")).toBeTruthy();
    pick(/^Used/);
    fireEvent.change(
      screen.getByRole("searchbox", { name: "Search shared styles" }),
      { target: { value: "margin" } }
    );
    expect(
      screen.getByText("No used shared styles match “margin”.")
    ).toBeTruthy();
  });
});

describe("where a style is used", () => {
  const page = (n: number, from: number, count: number, hasNext: boolean) => ({
    items: Array.from({ length: count }, (_, i) => ({
      id: `p${from + i}`,
      title: `Page ${from + i}`,
      collection: "pages",
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
    const details = await open(/^Card, \.nx-c-card/, "Card");
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

  it("lists one id in two collections as two documents", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { access } = accessOf({
        uses: () => ({
          items: [
            { id: "x", title: "Home", collection: "pages", kind: "pages" },
            { id: "x", title: "News", collection: "posts", kind: "pages" },
          ],
          total: 2,
          hidden: 0,
          hasNext: false,
          complete: true,
        }),
      });
      await panel({ access });
      const details = await open(/^Card, \.nx-c-card/, "Card");
      expect(within(details).getByText("Home")).toBeTruthy();
      expect(within(details).getByText("News")).toBeTruthy();
      // Two rows keyed alike are one row to React, which says so.
      expect(
        errors.mock.calls.some(call => String(call[0]).includes("same key"))
      ).toBe(false);
    } finally {
      errors.mockRestore();
    }
  });

  it("asks for one page at a time, so a second press while one is coming skips nothing", async () => {
    const pages = {
      ...page(1, 0, 20, true),
      total: 45,
    };
    let answerSecond: (answer: SharedStyleUsesPage) => void = () => undefined;
    const base = accessOf().access;
    const access: SharedStylesAccess = {
      ...base,
      uses: vi.fn(async (_id: string, n: number) =>
        n === 1
          ? pages
          : n === 2
            ? new Promise<SharedStyleUsesPage>(resolve => {
                answerSecond = resolve;
              })
            : { ...page(3, 40, 5, false), total: 45 }
      ),
    };
    await panel({ access });
    const details = await open(/^Card, \.nx-c-card/, "Card");
    const more = within(details).getByRole("button", {
      name: /^Show \d+ more$/,
    });
    await act(async () => {
      fireEvent.click(more);
      fireEvent.click(more);
    });
    // The second press waits for the page in flight rather than asking past it.
    expect(access.uses).not.toHaveBeenCalledWith(
      "c-card",
      3,
      expect.anything()
    );
    await act(async () => {
      answerSecond({ ...page(2, 20, 20, true), total: 45 });
    });
    expect(within(details).getByText("Page 20")).toBeTruthy();
    expect(within(details).getByText("Page 39")).toBeTruthy();
  });
});

describe("renaming", () => {
  it("renames to the name typed, with the class name derived from it", async () => {
    const onRename = vi.fn(async () => ({ ok: true as const }));
    await panel({ onRename });
    const details = await open(/^Card, \.nx-c-card/, "Card");
    const name = within(details).getByLabelText("Name");
    fireEvent.change(name, { target: { value: "Promo card" } });
    expect(within(details).getByText(".nx-c-promo-card")).toBeTruthy();
    fireEvent.keyDown(name, { key: "Enter" });
    expect(onRename).toHaveBeenCalledWith("c-card", {
      label: "Promo card",
      slug: "promo-card",
    });
  });

  it("refuses a class name another style has, without writing", async () => {
    const onRename = vi.fn(async () => ({ ok: true as const }));
    await panel({ onRename });
    const details = await open(/^Card, \.nx-c-card/, "Card");
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
    const details = await open(/^Card, \.nx-c-card/, "Card");
    const name = within(details).getByLabelText("Name");
    fireEvent.change(name, { target: { value: "Promo" } });
    await act(async () => {
      fireEvent.keyDown(name, { key: "Enter" });
    });
    expect(within(details).getByRole("alert").textContent).toBe(
      "The site refused it."
    );
  });

  it("does not select a name that can't be changed when its details open", async () => {
    await panel({ library: [{ ...CARD, locked: true }, HERO] });
    const locked = await open(/^Card, \.nx-c-card/, "Card");
    expect(document.activeElement).not.toBe(
      within(locked).getByLabelText("Name")
    );
    cleanup();
    // CONTROL: a name that can be changed is focused, ready to type over.
    await panel({ library: [CARD, HERO] });
    const open_ = await open(/^Card, \.nx-c-card/, "Card");
    expect(document.activeElement).toBe(within(open_).getByLabelText("Name"));
  });

  it("keeps a locked style's name, and says why", async () => {
    const onRename = vi.fn(async () => ({ ok: true as const }));
    await panel({ library: [{ ...CARD, locked: true }, HERO], onRename });
    const details = await open(/^Card, \.nx-c-card/, "Card");
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
    const details = await open(/^Card, \.nx-c-card/, "Card");
    expect(within(details).queryByRole("button", { name: /Lock/ })).toBeNull();
  });

  it("locks and unlocks for an author who may", async () => {
    const { access } = accessOf({ mayLock: true });
    await panel({ access });
    let details = await open(/^Card, \.nx-c-card/, "Card");
    await act(async () => {
      fireEvent.click(
        within(details).getByRole("button", { name: "Lock Card" })
      );
    });
    expect(access.lock).toHaveBeenCalledWith("c-card", true);
    cleanup();
    await panel({ library: [{ ...CARD, locked: true }], access });
    details = await open(/^Card, \.nx-c-card/, "Card");
    expect(within(details).getByText(/^Card is locked/)).toBeTruthy();
    await act(async () => {
      fireEvent.click(
        within(details).getByRole("button", { name: "Unlock Card" })
      );
    });
    expect(access.lock).toHaveBeenLastCalledWith("c-card", false);
  });

  it("holds Lock while the style's rename is still being stored", async () => {
    // Both writes replace the whole list of styles, so a lock written over a
    // rename in flight would put the old name back.
    const { access } = accessOf({ mayLock: true });
    await panel({ access, pendingNames: { "c-card": "Promo card" } });
    const details = await open(/^Promo card/, "Promo card");
    const lock = within(details).getByRole("button", {
      name: "Lock Promo card",
    });
    expect((lock as HTMLButtonElement).disabled).toBe(true);
    expect(
      within(details).getByText("Wait until the name change is saved.")
    ).toBeTruthy();
    fireEvent.click(lock);
    expect(access.lock).not.toHaveBeenCalled();
  });

  it("holds Lock while another style's rename is still being stored", async () => {
    // Every rename writes the whole list, so it is not only the same row's.
    const { access } = accessOf({ mayLock: true });
    await panel({ access, pendingNames: { "c-hero": "Big hero" } });
    const details = await open(/^Card, \.nx-c-card/, "Card");
    const lock = within(details).getByRole("button", { name: "Lock Card" });
    expect((lock as HTMLButtonElement).disabled).toBe(true);
    expect(
      within(details).getByText("Wait until the name change is saved.")
    ).toBeTruthy();
  });
});

describe("removing one style", () => {
  it("removes an unused style once the author confirms", async () => {
    const { access } = accessOf();
    await panel({ access });
    const details = await open(/^Old note/, "Old note");
    fireEvent.click(within(details).getByRole("button", { name: "Remove" }));
    // At a count of zero it still asks, saying what the count cannot see.
    const confirm = within(details).getByRole("group", {
      name: "Remove Old note",
    });
    expect(confirm.textContent).toContain("No page uses it in the editor.");
    expect(confirm.textContent).toContain(SHARED_STYLE_UNCOUNTED_USES);
    await act(async () => {
      fireEvent.click(
        within(details).getByRole("button", { name: "Remove Old note" })
      );
    });
    expect(access.remove).toHaveBeenCalledWith(["c-old"]);
  });

  it("drops the confirmation on a refusal, says why, and reads the style's usage again", async () => {
    const refusal =
      "Still used on Home and 2 more. Remove it from those pages first.";
    const styles: Record<string, SharedStyleReach> = {};
    const { access, usageReads } = accessOf({
      styles,
      removeWithReason: async () => ({ reason: refusal, inUse: true }),
    });
    await panel({ access });
    const details = await open(/^Old note/, "Old note");
    // By the time it is read again, the index has caught up with the page.
    styles["c-old"] = reach({ pages: 1 });
    fireEvent.click(within(details).getByRole("button", { name: "Remove" }));
    usageReads.length = 0;
    await act(async () => {
      fireEvent.click(
        within(details).getByRole("button", { name: "Remove Old note" })
      );
    });
    expect(within(details).getByRole("alert").textContent).toBe(refusal);
    // No confirmation left saying nothing uses it, and nothing to press.
    expect(within(details).queryByText(/No page uses it/)).toBeNull();
    expect(
      within(details).queryByRole("button", { name: /^Remove/ })
    ).toBeNull();
    expect(usageReads).toEqual([["c-old"]]);
    // The read again, not the refusal, says the row is used now.
    fireEvent.keyDown(details, { key: "Escape" });
    fireEvent.click(
      within(screen.getByRole("group", { name: "Show" })).getByRole("button", {
        name: /^Unused/,
      })
    );
    expect(screen.queryByRole("button", { name: /^Old note/ })).toBeNull();
  });

  it('does not say the index\'s "Not used anywhere" over a refusal that says it is used', async () => {
    const refusal =
      "Still used on Home and 2 more. Remove it from those pages first.";
    // The route's explicit in-use refusal, as the host reports it.
    const { access } = accessOf({
      removeWithReason: async () => ({ reason: refusal, inUse: true }),
    });
    await panel({ access });
    const details = await open(/^Old note/, "Old note");
    // CONTROL: before the refusal the index's sentence is there.
    expect(within(details).getByText("Not used anywhere")).toBeTruthy();
    fireEvent.click(within(details).getByRole("button", { name: "Remove" }));
    await act(async () => {
      fireEvent.click(
        within(details).getByRole("button", { name: "Remove Old note" })
      );
    });
    expect(within(details).getByRole("alert").textContent).toBe(refusal);
    expect(within(details).queryByText("Not used anywhere")).toBeNull();
  });

  it("lets the read again decide a style refused for another reason, such as a lock", async () => {
    const refusal = "Nothing was removed. Old note is locked.";
    const { access, usageReads } = accessOf({ remove: async () => refusal });
    await panel({ access });
    const details = await open(/^Old note/, "Old note");
    fireEvent.click(within(details).getByRole("button", { name: "Remove" }));
    usageReads.length = 0;
    await act(async () => {
      fireEvent.click(
        within(details).getByRole("button", { name: "Remove Old note" })
      );
    });
    expect(within(details).getByRole("alert").textContent).toBe(refusal);
    expect(usageReads).toEqual([["c-old"]]);
    // A lock says nothing of use, so the index's sentence stays.
    expect(within(details).getByText("Not used anywhere")).toBeTruthy();
    // Read again, it is still used by nothing, so it stays under Unused.
    fireEvent.keyDown(details, { key: "Escape" });
    fireEvent.click(
      within(screen.getByRole("group", { name: "Show" })).getByRole("button", {
        name: /^Unused/,
      })
    );
    expect(screen.getByRole("button", { name: /^Old note/ })).toBeTruthy();
  });

  it("offers no Remove for a style in use, and says why", async () => {
    const { access } = accessOf({ styles: { "c-card": reach({ pages: 1 }) } });
    await panel({ access });
    const details = await open(/^Card, \.nx-c-card/, "Card");
    expect(
      within(details).queryByRole("button", { name: "Remove" })
    ).toBeNull();
    expect(
      within(details).getByText(/^In use, so it can’t be removed/)
    ).toBeTruthy();
  });

  it("holds Remove while any rename is still being stored, and says why", async () => {
    const { access } = accessOf();
    await panel({ access, pendingNames: { "c-hero": "Big hero" } });
    const details = await open(/^Old note/, "Old note");
    const remove = within(details).getByRole("button", { name: "Remove" });
    expect((remove as HTMLButtonElement).disabled).toBe(true);
    expect(
      within(details).getByText("Wait until the name change is saved.")
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
      "Remove 2 unused shared styles? No page uses them in the editor."
    );
    // At a count of zero it still says what the count cannot see.
    expect(confirm.textContent).toContain(SHARED_STYLE_UNCOUNTED_USES);
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
    // Why, in the one note at the top of the list, which it points at
    // rather than saying it twice.
    const why = document.getElementById(
      button.getAttribute("aria-describedby") ?? ""
    );
    expect(why?.textContent).toBe(
      "Some pages haven't been counted yet, so the numbers are minimums and no style can be called unused or removed."
    );
  });

  it("is held while any rename is still being stored, and says why", async () => {
    const { access } = accessOf();
    await panel({ access, pendingNames: { "c-hero": "Big hero" } });
    const button = screen.getByRole("button", { name: "Remove unused…" });
    expect(button.hasAttribute("disabled")).toBe(true);
    expect(
      screen.getByText("Wait until the name change is saved.")
    ).toBeTruthy();
  });

  it("keeps the styles a later batch could not remove, and resends only those", async () => {
    const many: NamedClass[] = Array.from({ length: 55 }, (_, n) => ({
      id: `c-${n}`,
      slug: `s-${n}`,
      orderIndex: n,
      styles: {},
    }));
    let calls = 0;
    const { access } = accessOf({
      remove: async () => {
        calls += 1;
        return calls === 2 ? "Nothing was removed. s-50 is locked." : undefined;
      },
    });
    await panel({ access, library: many });
    fireEvent.click(screen.getByRole("button", { name: "Remove unused…" }));
    let confirm = await screen.findByRole("group", {
      name: "Remove 55 unused shared styles",
    });
    await act(async () => {
      fireEvent.click(
        within(confirm).getByRole("button", { name: "Remove 55" })
      );
    });
    confirm = screen.getByRole("group", {
      name: "Remove 5 unused shared styles",
    });
    expect(confirm.textContent).toContain(
      "50 were removed before the rest were refused."
    );
    expect(within(confirm).getByRole("alert").textContent).toBe(
      "Nothing was removed. s-50 is locked."
    );
    await act(async () => {
      fireEvent.click(
        within(confirm).getByRole("button", { name: "Remove 5" })
      );
    });
    expect(access.remove).toHaveBeenLastCalledWith(
      many.slice(50).map(style => style.id)
    );
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
