// @vitest-environment jsdom
/**
 * The icon field and its picker, driven through a fake icon source.
 *
 * The fake searches by substring and resolves by id, which is all the
 * components ask of a source: what is under test is the field's wiring (the
 * names it gives, what it reports, where focus goes), not a set's ranking.
 *
 * @module components/icon-picker.test
 */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import * as React from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { IconGlyph, type IconSource, type IconSourceIcon } from "./icon-glyph";
import { IconField } from "./icon-picker";

beforeAll(() => {
  // The grid renders only the rows in view, sized from a ResizeObserver and
  // the scroll box's offset size, neither of which jsdom provides. Without
  // them the window is empty and every assertion on a cell passes against
  // nothing, so the observer reports once on observe, as a real one does.
  globalThis.ResizeObserver = class {
    constructor(private readonly callback: ResizeObserverCallback) {}
    observe(target: Element) {
      this.callback(
        [
          {
            target,
            contentRect: target.getBoundingClientRect(),
          } as ResizeObserverEntry,
        ],
        this as unknown as ResizeObserver
      );
    }
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    get() {
      return 320;
    },
  });
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
    configurable: true,
    get() {
      return 360;
    },
  });
  Element.prototype.scrollTo ??= () => {};
});

afterEach(cleanup);

const BODY = '<circle cx="12" cy="12" r="4"/><path d="M4 4h16"/>';

const NAMES = [
  "truck",
  "star",
  "star-half",
  "package",
  "package-check",
  "heart",
  "mail",
  "phone",
  "map-pin",
  "clock",
  "circle-arrow-out-up-right",
];

const icon = (name: string): IconSourceIcon => ({
  id: `fake:${name}`,
  name,
  body: BODY,
  viewBox: "0 0 24 24",
  tags: name === "truck" ? ["delivery", "van"] : [],
});

/** The icons a query matches, by substring. */
const matching = (query: string): IconSourceIcon[] =>
  NAMES.filter(name => name.includes(query.trim().toLowerCase())).map(icon);

/** What the fake set answers for an id: the icon, or `null` for one it does not draw. */
const resolveFake = async (
  id: string,
  aliases: Readonly<Record<string, string>> = {}
): Promise<IconSourceIcon | null> => {
  const stored = id.replace(/^fake:/, "");
  const name = aliases[stored] ?? stored;
  return id.startsWith("fake:") && NAMES.includes(name) ? icon(name) : null;
};

/**
 * A fresh fake source per test, with its calls recorded. `aliases` maps a
 * former name to the name the set draws it by now, as a set that renamed an
 * icon resolves it; `search` replaces the substring search, `resolve` the
 * lookup by id, and `load` the loader, which is handed the source.
 */
function fakeSource(
  options: {
    aliases?: Readonly<Record<string, string>>;
    search?: (query: string) => Promise<readonly IconSourceIcon[]>;
    resolve?: (id: string) => Promise<IconSourceIcon | null>;
    load?: (source: IconSource) => Promise<IconSource>;
  } = {}
): {
  load: () => Promise<IconSource>;
  search: ReturnType<typeof vi.fn>;
} {
  const search = vi.fn(
    options.search ?? (async (query: string) => matching(query))
  );
  const source: IconSource = {
    prefix: "fake",
    label: "Fake set",
    search,
    resolve: options.resolve ?? (id => resolveFake(id, options.aliases)),
  };
  const load = options.load;
  return {
    load: load === undefined ? async () => source : () => load(source),
    search,
  };
}

/**
 * A search that answers the whole set at once and holds every other query
 * until the test answers it, so a test decides the order answers land in.
 */
function heldSearch(): {
  search: (query: string) => Promise<readonly IconSourceIcon[]>;
  answer: (query: string) => Promise<void>;
} {
  const held = new Map<string, (results: readonly IconSourceIcon[]) => void>();
  return {
    search: query =>
      query === ""
        ? Promise.resolve(matching(query))
        : new Promise(resolve => held.set(query, resolve)),
    answer: async query => {
      const resolve = held.get(query);
      if (resolve === undefined) throw new Error(`No search for “${query}”.`);
      await act(async () => resolve(matching(query)));
    },
  };
}

/** The accessible name of the option the search box has highlighted. */
const highlightedIn = (box: HTMLElement): string | null =>
  document
    .getElementById(box.getAttribute("aria-activedescendant") ?? "")
    ?.getAttribute("aria-label") ?? null;

function renderField(
  props: Partial<React.ComponentProps<typeof IconField>> = {},
  source: ReturnType<typeof fakeSource> = fakeSource()
): {
  onChange: ReturnType<typeof vi.fn>;
  load: () => Promise<IconSource>;
  search: ReturnType<typeof vi.fn>;
} {
  const onChange = vi.fn();
  const { load, search } = source;
  render(
    <IconField
      value={null}
      onChange={onChange}
      loadIcons={load}
      label="Badge"
      {...props}
    />
  );
  return { onChange, load, search };
}

/** Opens the picker and waits for its first results. */
async function openPicker(name: RegExp): Promise<HTMLElement> {
  fireEvent.click(screen.getByRole("button", { name }));
  const search = await screen.findByRole("combobox", { name: "Search icons" });
  await waitFor(() =>
    expect(screen.getAllByRole("option").length).toBeGreaterThan(0)
  );
  return search;
}

describe("IconGlyph", () => {
  it("draws a body's shapes as SVG elements", () => {
    const { container } = render(
      <IconGlyph icon={{ body: BODY, viewBox: "0 0 24 24" }} />
    );
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("viewBox")).toBe("0 0 24 24");
    expect(svg?.getAttribute("aria-hidden")).toBe("true");
    expect([...(svg?.children ?? [])].map(child => child.tagName)).toEqual([
      "circle",
      "path",
    ]);
    expect(svg?.querySelector("path")?.getAttribute("d")).toBe("M4 4h16");
  });

  it.each([
    ["<script>alert(1)</script>", "an element that is not a shape"],
    ['<path d="M0 0" onload="alert(1)"/>', "an event attribute"],
    ['<g><path d="M0 0"/></g>', "a nested element"],
    ['<path d="M0 0" fill="url(#x)"/>', "a fill that is not a colour keyword"],
    ['text<path d="M0 0"/>', "text between the shapes"],
  ])("draws nothing for %s (%s)", body => {
    const { container } = render(
      <IconGlyph icon={{ body, viewBox: "0 0 24 24" }} />
    );
    // The control: the box is drawn, and it is empty.
    expect(container.querySelector("svg")).not.toBeNull();
    expect(container.querySelector("svg")?.children).toHaveLength(0);
    expect(container.innerHTML).not.toContain("alert");
  });
});

describe("IconField", () => {
  it("names its button by the field's label and the chosen icon", async () => {
    renderField({ value: "fake:circle-arrow-out-up-right" });
    expect(
      await screen.findByRole("button", {
        name: "Badge: Circle arrow out up right",
      })
    ).not.toBeNull();
    expect(screen.getByText("Fake set")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Clear icon" })).not.toBeNull();
  });

  it("says when nothing is chosen, and offers no clear", () => {
    renderField();
    expect(
      screen.getByRole("button", { name: "Badge: none chosen" })
    ).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Clear icon" })).toBeNull();
  });

  it("opens a dialog with the search box focused and the count announced", async () => {
    renderField();
    const search = await openPicker(/^Badge/);
    expect(
      screen.getByRole("dialog", { name: "Choose an icon" })
    ).not.toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(search));
    expect(screen.getByRole("status").textContent).toBe(
      `${NAMES.length} icons.`
    );
    expect(search.getAttribute("aria-controls")).toBe(
      screen.getByRole("listbox", { name: "Icons" }).id
    );
  });

  it("is never taller than the room on the side it opens", async () => {
    // A field low on the screen opens the picker upwards, where a panel of its
    // full height ran past the window's top edge, search box first. The
    // variable carries Radix's measurement of the room on the chosen side.
    renderField();
    const search = await openPicker(/^Badge/);
    const panel = search.closest(".flex-col");
    expect(panel?.className).toContain(
      "var(--radix-popover-content-available-height,452px)"
    );
  });

  it("searches as it is typed into, and announces the matches", async () => {
    const { search } = renderField();
    const box = await openPicker(/^Badge/);
    fireEvent.change(box, { target: { value: "pack" } });
    await waitFor(() =>
      expect(
        screen.getAllByRole("option").map(o => o.getAttribute("aria-label"))
      ).toEqual(["Package", "Package check"])
    );
    expect(search).toHaveBeenLastCalledWith("pack");
    expect(screen.getByRole("status").textContent).toBe(
      "2 icons match “pack”."
    );
    fireEvent.change(box, { target: { value: "nothing-like-it" } });
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toBe(
        "No icons match “nothing-like-it”."
      )
    );
  });

  it("chooses the best match with Enter, and stores its id", async () => {
    const { onChange } = renderField();
    const box = await openPicker(/^Badge/);
    fireEvent.change(box, { target: { value: "star" } });
    await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(2));
    fireEvent.keyDown(box, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith("fake:star");
  });

  it("moves through the grid by icon and by row from the keyboard", async () => {
    const { onChange } = renderField();
    const box = await openPicker(/^Badge/);
    const highlighted = (): string | null =>
      document
        .getElementById(box.getAttribute("aria-activedescendant") ?? "")
        ?.getAttribute("aria-label") ?? null;
    expect(highlighted()).toBe("Truck");
    fireEvent.keyDown(box, { key: "ArrowRight" });
    expect(highlighted()).toBe("Star");
    // Down moves a whole row of eight.
    fireEvent.keyDown(box, { key: "ArrowDown" });
    expect(highlighted()).toBe("Clock");
    fireEvent.keyDown(box, { key: "ArrowUp" });
    fireEvent.keyDown(box, { key: "ArrowLeft" });
    expect(highlighted()).toBe("Truck");
    fireEvent.keyDown(box, { key: "ArrowRight" });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith("fake:star");
  });

  it("chooses an icon by click", async () => {
    const { onChange } = renderField();
    await openPicker(/^Badge/);
    fireEvent.click(screen.getByRole("option", { name: "Heart" }));
    expect(onChange).toHaveBeenCalledWith("fake:heart");
  });

  it("marks the chosen icon in the grid", async () => {
    renderField({ value: "fake:mail" });
    await openPicker(/^Badge: Mail/);
    expect(
      screen.getByRole("option", { name: "Mail, current" }).dataset.current
    ).toBe("true");
  });

  it("marks and opens at a chosen icon stored by a name the set has since changed", async () => {
    // `envelope` is the fake set's former name for `mail`: resolving
    // `fake:envelope` answers the icon by its current id, `fake:mail`, and
    // that is the id the grid lists it by.
    renderField(
      { value: "fake:envelope" },
      fakeSource({ aliases: { envelope: "mail" } })
    );
    await screen.findByRole("button", { name: "Badge: Mail" });
    const box = await openPicker(/^Badge: Mail/);
    await waitFor(() =>
      expect(
        screen.getByRole("option", { name: "Mail, current" }).dataset.current
      ).toBe("true")
    );
    expect(highlightedIn(box)).toBe("Mail, current");
  });

  it("chooses nothing with Enter until the query typed is answered", async () => {
    const held = heldSearch();
    const { onChange } = renderField({}, fakeSource({ search: held.search }));
    const box = await openPicker(/^Badge/);
    fireEvent.change(box, { target: { value: "pack" } });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(onChange).not.toHaveBeenCalled();
    // The browse results are still drawn, but are not the answer to "pack".
    expect(screen.getAllByRole("option")).toHaveLength(NAMES.length);
    expect(
      screen.getByRole("listbox", { name: "Icons" }).getAttribute("aria-busy")
    ).toBe("true");
    expect(box.getAttribute("aria-activedescendant")).toBeNull();

    await held.answer("pack");
    expect(highlightedIn(box)).toBe("Package");
    fireEvent.keyDown(box, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith("fake:package");
  });

  it("keeps the latest query's answer when an earlier one lands after it", async () => {
    const held = heldSearch();
    const { onChange } = renderField({}, fakeSource({ search: held.search }));
    const box = await openPicker(/^Badge/);
    fireEvent.change(box, { target: { value: "p" } });
    fireEvent.change(box, { target: { value: "pa" } });
    await held.answer("pa");
    await held.answer("p");
    expect(
      screen.getAllByRole("option").map(o => o.getAttribute("aria-label"))
    ).toEqual(["Package", "Package check"]);
    fireEvent.keyDown(box, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith("fake:package");
  });

  it("says a failed search failed, and searches again on Try again", async () => {
    // As a set's data does when the chunk holding it fails to download.
    const search = vi
      .fn<(query: string) => Promise<readonly IconSourceIcon[]>>()
      .mockRejectedValueOnce(new Error("The data could not be fetched."))
      .mockImplementation(async query => matching(query));
    renderField({}, fakeSource({ search }));
    fireEvent.click(screen.getByRole("button", { name: /^Badge/ }));
    const retry = await screen.findByRole("button", { name: "Try again" });
    expect(
      screen.getByText("The icons could not be loaded.", {
        selector: "p:not([role=status])",
      })
    ).not.toBeNull();
    expect(screen.getByRole("status").textContent).toBe(
      "The icons could not be loaded."
    );
    expect(screen.queryByText(/No icons match/)).toBeNull();

    fireEvent.click(retry);
    await waitFor(() =>
      expect(screen.getAllByRole("option")).toHaveLength(NAMES.length)
    );
    expect(search).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("status").textContent).toBe(
      `${NAMES.length} icons.`
    );
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    expect(document.activeElement).toBe(
      screen.getByRole("combobox", { name: "Search icons" })
    );
  });

  it("closes on Escape and returns focus to its button", async () => {
    renderField();
    const box = await openPicker(/^Badge/);
    fireEvent.keyDown(box, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Badge: none chosen" })
    );
  });

  it("clears the value from its own button", async () => {
    const { onChange } = renderField({ value: "fake:star" });
    fireEvent.click(screen.getByRole("button", { name: "Clear icon" }));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("keeps an id the set no longer draws, by name, with a warning", async () => {
    renderField({ value: "fake:rocket-2" });
    const button = await screen.findByRole("button", {
      name: "Badge: rocket-2, not found",
    });
    expect(screen.getByText("Fake set · not found")).not.toBeNull();
    const warning = screen.getByText(
      "This icon is no longer available. Choose another."
    );
    expect(button.getAttribute("aria-describedby")).toBe(
      warning.closest("p")?.id
    );
  });

  it("says an icon whose lookup failed could not be loaded, not that it is gone", async () => {
    // As a set's data does when the chunk holding it fails to download: no
    // answer at all, which says nothing about whether the set draws the icon.
    const resolve = vi
      .fn<(id: string) => Promise<IconSourceIcon | null>>()
      .mockRejectedValue(new Error("The data could not be fetched."));
    renderField({ value: "fake:star" }, fakeSource({ resolve }));
    const button = await screen.findByRole("button", {
      name: "Badge: Star, could not be loaded",
    });
    expect(screen.getByText("Fake set · could not load")).not.toBeNull();
    expect(screen.queryByText(/no longer available/)).toBeNull();
    expect(button.getAttribute("aria-describedby")).toBeNull();
  });

  it("looks a failed icon up again when the picker opens", async () => {
    const resolve = vi
      .fn<(id: string) => Promise<IconSourceIcon | null>>()
      .mockRejectedValueOnce(new Error("The data could not be fetched."))
      .mockImplementation(id => resolveFake(id));
    renderField({ value: "fake:star" }, fakeSource({ resolve }));
    await screen.findByRole("button", {
      name: "Badge: Star, could not be loaded",
    });
    fireEvent.click(screen.getByRole("button", { name: /^Badge/ }));
    expect(
      await screen.findByRole("button", { name: "Badge: Star" })
    ).not.toBeNull();
    expect(screen.queryByText("Fake set · could not load")).toBeNull();
  });

  it("loads a set that failed to load again when the picker opens", async () => {
    let loads = 0;
    const source = fakeSource({
      load: async loadedSource => {
        loads += 1;
        if (loads === 1) throw new Error("The set could not be fetched.");
        return loadedSource;
      },
    });
    renderField({ value: "fake:star" }, source);
    await screen.findByRole("button", {
      name: "Badge: Star, could not be loaded",
    });
    expect(screen.queryByText(/no longer available/)).toBeNull();
    await openPicker(/^Badge/);
    expect(
      await screen.findByRole("button", { name: "Badge: Star" })
    ).not.toBeNull();
  });

  it("chooses nothing by click until the query typed is answered", async () => {
    const held = heldSearch();
    const { onChange } = renderField({}, fakeSource({ search: held.search }));
    const box = await openPicker(/^Badge/);
    fireEvent.change(box, { target: { value: "pack" } });
    // Heart is drawn, from the browse results, but is not an answer to "pack".
    fireEvent.click(screen.getByRole("option", { name: "Heart" }));
    expect(onChange).not.toHaveBeenCalled();

    await held.answer("pack");
    fireEvent.click(screen.getByRole("option", { name: "Package check" }));
    expect(onChange).toHaveBeenCalledWith("fake:package-check");
  });

  it("hands its button to a ref, and still takes focus back after a clear", async () => {
    const ref = React.createRef<HTMLButtonElement>();
    renderField({ value: "fake:star", ref });
    const button = await screen.findByRole("button", { name: "Badge: Star" });
    expect(ref.current).toBe(button);
    fireEvent.click(screen.getByRole("button", { name: "Clear icon" }));
    expect(document.activeElement).toBe(button);
  });

  describe("reports the field left", () => {
    /** The field between two other buttons, so focus has somewhere to go. */
    function renderBetween(
      props: Partial<React.ComponentProps<typeof IconField>> = {}
    ): ReturnType<typeof vi.fn> {
      const onBlur = vi.fn();
      const { load } = fakeSource();
      render(
        <>
          <button type="button">Before</button>
          <IconField
            value={null}
            onChange={() => {}}
            onBlur={onBlur}
            loadIcons={load}
            label="Badge"
            {...props}
          />
          <button type="button">After</button>
        </>
      );
      return onBlur;
    }

    it("when focus leaves its closed button for outside the field", () => {
      const onBlur = renderBetween();
      screen.getByRole("button", { name: "Badge: none chosen" }).focus();
      expect(onBlur).not.toHaveBeenCalled();
      screen.getByRole("button", { name: "After" }).focus();
      expect(onBlur).toHaveBeenCalledTimes(1);
    });

    it("not when focus moves from its button to its clear", async () => {
      const onBlur = renderBetween({ value: "fake:star" });
      (await screen.findByRole("button", { name: "Badge: Star" })).focus();
      screen.getByRole("button", { name: "Clear icon" }).focus();
      expect(onBlur).not.toHaveBeenCalled();
      // The control: leaving from the clear is reported.
      screen.getByRole("button", { name: "After" }).focus();
      expect(onBlur).toHaveBeenCalledTimes(1);
    });

    it("once when the picker closes on Escape, not for focus going into it or back", async () => {
      const onBlur = renderBetween();
      const button = screen.getByRole("button", { name: "Badge: none chosen" });
      button.focus();
      const box = await openPicker(/^Badge/);
      await waitFor(() => expect(document.activeElement).toBe(box));
      expect(onBlur).not.toHaveBeenCalled();
      fireEvent.keyDown(box, { key: "Escape" });
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      expect(document.activeElement).toBe(button);
      expect(onBlur).toHaveBeenCalledTimes(1);
    });

    it("once when focus leaves the open picker for outside the field", async () => {
      const onBlur = renderBetween();
      const box = await openPicker(/^Badge/);
      await waitFor(() => expect(document.activeElement).toBe(box));
      act(() => screen.getByRole("button", { name: "After" }).focus());
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      expect(onBlur).toHaveBeenCalledTimes(1);
    });
  });

  it("opens no picker and offers no clear when read-only", async () => {
    renderField({ value: "fake:star", readOnly: true });
    const button = await screen.findByRole("button", { name: "Badge: Star" });
    await act(async () => {
      fireEvent.click(button);
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("button", { name: "Clear icon" })).toBeNull();
  });
});
