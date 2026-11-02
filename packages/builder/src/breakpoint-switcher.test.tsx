// @vitest-environment jsdom
/**
 * What the device buttons are responsible for: offering the site's devices,
 * emitting the breakpoint the author chose, showing which one is being styled
 * with the exact width it is previewed at, and being operable from a keyboard.
 *
 * Which width a device is previewed at, and which breakpoint an unknown choice
 * resolves to, are `canvas-width.ts`'s answers and have their own suite.
 *
 * @module breakpoint-switcher.test
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { BreakpointSet } from "./breakpoints";
import { BreakpointSwitcher } from "./breakpoint-switcher";

afterEach(cleanup);

const site = (): BreakpointSet => ({
  viewport: [
    { id: "tablet", label: "Tablet", maxWidth: 991 },
    { id: "mobile", label: "Mobile", maxWidth: 575 },
  ],
  container: [],
});

const options = (): HTMLElement[] => screen.getAllByRole("radio");
const checked = (): HTMLElement[] =>
  options().filter(option => option.getAttribute("aria-checked") === "true");

function mount(
  props: Partial<React.ComponentProps<typeof BreakpointSwitcher>> = {}
) {
  const onSelect = vi.fn();
  const view = render(
    <BreakpointSwitcher
      breakpoints={site()}
      selected="base"
      onSelect={onSelect}
      status="ready"
      {...props}
    />
  );
  return { onSelect, ...view };
}

describe("choosing a device", () => {
  it("emits the breakpoint's id", () => {
    const { onSelect } = mount();
    fireEvent.click(screen.getByRole("radio", { name: /^Tablet/ }));
    expect(onSelect).toHaveBeenCalledWith("tablet");
  });

  it("emits the base breakpoint for Desktop", () => {
    const { onSelect } = mount({ selected: "mobile" });
    fireEvent.click(screen.getByRole("radio", { name: /^Desktop/ }));
    expect(onSelect).toHaveBeenCalledWith("base");
  });

  it("names the base breakpoint Desktop, with where it applies", () => {
    mount();
    expect(
      screen.getByRole("radio", { name: "Desktop, from 992 pixels" })
    ).toBeDefined();
  });

  it("says each breakpoint's range in its accessible name and tooltip", () => {
    mount();
    const tablet = screen.getByRole("radio", {
      name: "Tablet, up to 991 pixels",
    });
    expect(tablet.getAttribute("title")).toBe("Tablet, up to 991 pixels");
  });
});

describe("which device is shown as being styled", () => {
  it("selects the device the author chose", () => {
    mount({ selected: "tablet" });
    expect(checked()).toEqual([screen.getByRole("radio", { name: /^Tablet/ })]);
  });

  it("shows the chosen device's exact preview width, unrounded", () => {
    // A breakpoint at 991 reads 991, not 990 or 1000: the width an author
    // styles at is the width the button says.
    mount({ selected: "tablet" });
    expect(checked()[0]?.textContent).toBe("Tablet · 991px");
  });

  it("shows Desktop at the width it is previewed at", () => {
    mount({ selected: "base" });
    expect(checked()[0]?.textContent).toBe("Desktop · 1280px");
  });

  it("shows the base as chosen for a breakpoint the site no longer defines", () => {
    // Where the host sends the edit, so the control and the edit agree.
    mount({ selected: "watch" });
    expect(checked()[0]?.textContent).toBe("Desktop · 1280px");
  });

  it("lets the chosen device's label give way first on a narrow top bar", () => {
    // A container query on the top bar hides it; the accessible name keeps
    // the device and its range.
    mount({ selected: "tablet" });
    const label = checked()[0]?.querySelector("span");
    expect(label?.className).toContain("@max-[1400px]/topbar:hidden");
    expect(checked()[0]?.getAttribute("aria-label")).toBe(
      "Tablet, up to 991 pixels"
    );
  });

  it("names only the chosen device in visible text", () => {
    mount({ selected: "tablet" });
    const unchosen = options().filter(
      option => option.getAttribute("aria-checked") !== "true"
    );
    for (const option of unchosen) expect(option.textContent).toBe("");
  });
});

describe("the gate on the saved read", () => {
  it("is inert until the saved breakpoints have been read", () => {
    const { onSelect } = mount({ status: "loading" });
    for (const option of options()) {
      expect((option as HTMLButtonElement).disabled).toBe(true);
    }
    fireEvent.keyDown(screen.getByRole("radiogroup"), { key: "ArrowRight" });
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("shows nothing as chosen while it cannot be trusted", () => {
    mount({ status: "unavailable", selected: "tablet" });
    expect(checked()).toEqual([]);
  });
});

describe("keyboard operation", () => {
  it("moves the choice with the arrow keys", () => {
    const { onSelect } = mount({ selected: "base" });
    fireEvent.keyDown(screen.getByRole("radiogroup"), { key: "ArrowRight" });
    expect(onSelect).toHaveBeenCalledWith("tablet");
  });

  it("wraps at the end rather than stopping", () => {
    const { onSelect } = mount({ selected: "mobile" });
    fireEvent.keyDown(screen.getByRole("radiogroup"), { key: "ArrowRight" });
    expect(onSelect).toHaveBeenCalledWith("base");
  });

  it("keeps exactly one option in the tab order", () => {
    mount({ selected: "tablet" });
    const stops = options().filter(option => option.tabIndex === 0);
    expect(stops).toEqual([screen.getByRole("radio", { name: /^Tablet/ })]);
  });

  it("moves focus to the option the arrow key chose", () => {
    mount({ selected: "base" });
    options()[0]?.focus();
    fireEvent.keyDown(screen.getByRole("radiogroup"), { key: "ArrowRight" });
    expect(document.activeElement).toBe(options()[1]);
  });

  it("leaves focus alone when the control is not ready", () => {
    mount({ status: "loading" });
    const before = document.activeElement;
    fireEvent.keyDown(screen.getByRole("radiogroup"), { key: "ArrowRight" });
    expect(document.activeElement).toBe(before);
  });
});

describe("a site with no viewport breakpoints", () => {
  it("renders nothing rather than a control offering Desktop alone", () => {
    const { container } = mount({
      breakpoints: { viewport: [], container: [] },
    });
    expect(container.firstChild).toBeNull();
  });

  it("drops a breakpoint the compiler emits no bound for", () => {
    // Offered anyway, choosing it would style a breakpoint no query reaches.
    const rejected = {
      viewport: [
        { id: "tablet", label: "Tablet", maxWidth: 991 },
        { id: "broken", label: "Broken", maxWidth: 0 },
      ],
      container: [],
    } as unknown as BreakpointSet;
    mount({ breakpoints: rejected });
    expect(screen.getByRole("radio", { name: /^Tablet/ })).toBeDefined();
    expect(screen.queryByRole("radio", { name: /Broken/ })).toBeNull();
  });

  it("does not offer a stored row using the reserved base id", () => {
    const withReserved = {
      viewport: [{ id: "base", label: "Base", maxWidth: undefined }],
      container: [],
    } as unknown as BreakpointSet;
    const { container } = mount({ breakpoints: withReserved });
    expect(container.firstChild).toBeNull();
  });
});

describe("a stored set the compiler has to reconcile", () => {
  it("offers one option per id when a set carries the id twice", () => {
    mount({
      breakpoints: {
        viewport: [
          { id: "tablet", label: "Tablet", maxWidth: 991 },
          { id: "tablet", label: "Tablet Copy", maxWidth: 700 },
        ],
        container: [],
      },
    });
    expect(options()).toHaveLength(2);
  });

  it("offers one option when two breakpoints share a bound", () => {
    mount({
      breakpoints: {
        viewport: [
          { id: "alpha", label: "Alpha", maxWidth: 991 },
          { id: "beta", label: "Beta", maxWidth: 991 },
        ],
        container: [],
      },
    });
    expect(options()).toHaveLength(2);
    expect(
      screen.getByRole("radio", { name: "Beta, up to 991 pixels" })
    ).toBeDefined();
  });

  it("labels the surviving breakpoint from the definition the compiler kept", () => {
    mount({
      breakpoints: {
        viewport: [
          { id: "tablet", label: "Draft", maxWidth: 700 },
          { id: "tablet", label: "Tablet", maxWidth: 991 },
        ],
        container: [],
      },
    });
    expect(
      screen.getByRole("radio", { name: "Tablet, up to 991 pixels" })
    ).toBeDefined();
    expect(screen.queryByRole("radio", { name: /Draft/ })).toBeNull();
  });
});
