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

/** A fresh fake source per test, with its calls recorded. */
function fakeSource(): {
  load: () => Promise<IconSource>;
  search: ReturnType<typeof vi.fn>;
} {
  const search = vi.fn(async (query: string) =>
    NAMES.filter(name => name.includes(query.trim().toLowerCase())).map(icon)
  );
  const source: IconSource = {
    prefix: "fake",
    label: "Fake set",
    search,
    resolve: async id => {
      const name = id.replace(/^fake:/, "");
      return id.startsWith("fake:") && NAMES.includes(name) ? icon(name) : null;
    },
  };
  return { load: async () => source, search };
}

function renderField(
  props: Partial<React.ComponentProps<typeof IconField>> = {}
): {
  onChange: ReturnType<typeof vi.fn>;
  load: () => Promise<IconSource>;
  search: ReturnType<typeof vi.fn>;
} {
  const onChange = vi.fn();
  const { load, search } = fakeSource();
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
