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
import { TooltipProvider } from "@nextlyhq/ui";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { BreakpointSet } from "../breakpoints";
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
    <TooltipProvider delayDuration={0}>
      <BreakpointSwitcher
        breakpoints={site()}
        selected="base"
        onSelect={onSelect}
        status="ready"
        {...props}
      />
    </TooltipProvider>
  );
  return { onSelect, ...view };
}

/** The tooltip a device's control opens when it takes keyboard focus. */
async function tooltipOf(control: HTMLElement): Promise<string> {
  act(() => control.focus());
  const tip = await screen.findByRole("tooltip");
  return tip.textContent ?? "";
}

/** The width shown beside the buttons, as text. */
const activeWidth = (): HTMLElement | null =>
  document.querySelector<HTMLElement>("[data-nx-active-width]");

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

  it("names the base breakpoint Desktop, with its width and the widths it styles", () => {
    mount();
    expect(
      screen.getByRole("radio", {
        name: "Desktop · 1280px · styles for 992px and wider",
      })
    ).toBeDefined();
  });

  it("says each device's name, width and range in its accessible name and tooltip", async () => {
    // A breakpoint at 991 reads 991 in both: the width an author styles at is
    // the width the control says, not a rounded one.
    mount();
    const tablet = screen.getByRole("radio", {
      name: "Tablet · 991px · styles for 991px and narrower",
    });
    expect(await tooltipOf(tablet)).toBe(
      "Tablet · 991px · styles for 991px and narrower"
    );
    // A real tooltip, not the browser's slow one on top of it.
    expect(tablet.hasAttribute("title")).toBe(false);
  });
});

describe("focus", () => {
  it("draws the house ring on every device button, not the browser's outline", () => {
    // Off the button by a gap, so it shows on the chosen device's fill too.
    mount({ selected: "mobile" });
    for (const option of options()) {
      expect(option.className).toContain("focus-visible:ring-2");
      expect(option.className).toContain("focus-visible:ring-offset-1");
      expect(option.className).toContain("focus-visible:outline-none");
    }
  });
});

describe("which device is shown as being styled", () => {
  it("selects the device the author chose", () => {
    mount({ selected: "tablet" });
    expect(checked()).toEqual([screen.getByRole("radio", { name: /^Tablet/ })]);
  });

  it("shows the chosen device's exact preview width beside the buttons, unrounded", () => {
    mount({ selected: "tablet" });
    expect(activeWidth()?.textContent).toBe("991px");
  });

  it("shows Desktop's width as the width it is previewed at", () => {
    mount({ selected: "base" });
    expect(activeWidth()?.textContent).toBe("1280px");
  });

  it("shows the base as chosen for a breakpoint the site no longer defines", () => {
    // Where the host sends the edit, so the control and the edit agree.
    mount({ selected: "watch" });
    expect(checked()[0]?.getAttribute("aria-label")).toMatch(/^Desktop · /);
    expect(activeWidth()?.textContent).toBe("1280px");
  });

  it("keeps the active width shown at every top-bar width", () => {
    // The width being styled never gives way on a narrow bar: no container
    // query hides it.
    mount({ selected: "tablet" });
    const width = activeWidth();
    // The control: the width is drawn at all.
    expect(width).not.toBeNull();
    expect(width?.className).not.toMatch(/hidden/);
  });

  it("draws every device as an icon, with its words in the name and tooltip", () => {
    mount({ selected: "tablet" });
    for (const option of options()) {
      expect(option.textContent).toBe("");
      expect(option.querySelector("svg")).not.toBeNull();
    }
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
      screen.getByRole("radio", {
        name: "Beta · 991px · styles for 991px and narrower",
      })
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
      screen.getByRole("radio", {
        name: "Tablet · 991px · styles for 991px and narrower",
      })
    ).toBeDefined();
    expect(screen.queryByRole("radio", { name: /Draft/ })).toBeNull();
  });
});

/**
 * A site's breakpoints, `count` of them with the base counted as one: the
 * tiers from the widest down, so the first `count - 1` are taken.
 */
function devicesFor(count: number): BreakpointSet {
  const tiers = [
    { id: "laptop", label: "Laptop", maxWidth: 1199 },
    { id: "tablet", label: "Tablet", maxWidth: 991 },
    { id: "phone-l", label: "Phone L", maxWidth: 767 },
    { id: "phone", label: "Phone", maxWidth: 575 },
    { id: "phone-s", label: "Phone S", maxWidth: 375 },
    { id: "watch", label: "Watch", maxWidth: 280 },
  ];
  // Stored narrowest first, so the order on screen is the switcher's own.
  return { viewport: tiers.slice(0, count - 1).reverse(), container: [] };
}

const moreDevices = (): HTMLElement | null =>
  screen.queryByRole("button", { name: /^More devices/ });

function openMore(): HTMLElement[] {
  const trigger = moreDevices();
  if (trigger === null) throw new Error("no More devices button");
  fireEvent.pointerDown(trigger, { pointerType: "mouse" });
  return screen.getAllByRole("menuitemradio");
}

const names = (elements: HTMLElement[]): string[] =>
  elements.map(element => element.getAttribute("aria-label") ?? "");

describe("the open device menu and the rest of the editor", () => {
  it("leaves the editor around it in the accessibility tree", () => {
    // As the zoom menu: a modal menu hides the focusable editor around it,
    // which axe reports as aria-hidden-focus.
    mount({ breakpoints: devicesFor(5) });
    const trigger = moreDevices();
    if (trigger === null) throw new Error("no More devices button");

    expect(openMore().length).toBeGreaterThan(0);

    expect(trigger.closest('[aria-hidden="true"]')).toBeNull();
    expect(document.querySelector('[aria-hidden="true"] button')).toBeNull();
  });
});

describe("how many devices are buttons", () => {
  it("offers nothing on a site with the base breakpoint alone", () => {
    const { container } = mount({ breakpoints: devicesFor(1) });
    expect(container.firstChild).toBeNull();
  });

  it("shows two buttons and no menu for two breakpoints", () => {
    mount({ breakpoints: devicesFor(2) });
    expect(names(options())).toEqual([
      "Desktop · 1280px · styles for 1200px and wider",
      "Laptop · 1199px · styles for 1199px and narrower",
    ]);
    expect(moreDevices()).toBeNull();
  });

  it("shows three buttons and no menu for three breakpoints", () => {
    mount({ breakpoints: devicesFor(3) });
    expect(options()).toHaveLength(3);
    expect(moreDevices()).toBeNull();
  });

  it("puts the fourth breakpoint in a menu, the base and the two widest staying buttons", () => {
    mount({ breakpoints: devicesFor(4) });
    expect(names(options())).toEqual([
      "Desktop · 1280px · styles for 1200px and wider",
      "Laptop · 1199px · styles for 1199px and narrower",
      "Tablet · 991px · styles for 991px and narrower",
    ]);
    expect(openMore().map(item => item.textContent)).toEqual([
      "Phone L · 767px",
    ]);
  });

  it("lists every breakpoint past the third in the menu, widest first, for seven", () => {
    mount({ breakpoints: devicesFor(7) });
    expect(options()).toHaveLength(3);
    expect(openMore().map(item => item.textContent)).toEqual([
      "Phone L · 767px",
      "Phone · 575px",
      "Phone S · 375px",
      "Watch · 280px",
    ]);
  });

  it("names each device in the menu as its button would be named", () => {
    mount({ breakpoints: devicesFor(5) });
    expect(names(openMore())).toEqual([
      "Phone L · 767px · styles for 767px and narrower",
      "Phone · 575px · styles for 575px and narrower",
    ]);
  });

  it("keeps the menu outside the radio group, as its own button", () => {
    mount({ breakpoints: devicesFor(4) });
    const group = screen.getByRole("radiogroup", { name: "Device" });
    const more = moreDevices();
    expect(more).not.toBeNull();
    expect(group.contains(more)).toBe(false);
  });
});

describe("a device chosen from the menu", () => {
  it("emits the breakpoint's id", () => {
    const { onSelect } = mount({ breakpoints: devicesFor(7) });
    const phone = openMore().find(item => item.textContent === "Phone · 575px");
    if (phone === undefined) throw new Error("no Phone item");
    fireEvent.click(phone);
    expect(onSelect).toHaveBeenCalledWith("phone");
  });

  it("shows on the menu's button, with its exact width beside the buttons, while it is the one styled", () => {
    mount({ breakpoints: devicesFor(7), selected: "phone" });
    const trigger = moreDevices();
    expect(trigger?.getAttribute("aria-label")).toBe(
      "More devices, styling Phone · 575px · styles for 575px and narrower"
    );
    expect(trigger?.getAttribute("data-styling")).toBe("");
    expect(activeWidth()?.textContent).toBe("575px");
  });

  it("leaves no button checked, and the buttons where they were", () => {
    mount({ breakpoints: devicesFor(7), selected: "phone" });
    expect(checked()).toEqual([]);
    expect(names(options())).toEqual([
      "Desktop · 1280px · styles for 1200px and wider",
      "Laptop · 1199px · styles for 1199px and narrower",
      "Tablet · 991px · styles for 991px and narrower",
    ]);
  });

  it("keeps the first button in the tab order when the choice is in the menu", () => {
    mount({ breakpoints: devicesFor(7), selected: "phone" });
    expect(options().filter(option => option.tabIndex === 0)).toEqual([
      options()[0],
    ]);
  });

  it("is marked as chosen in the open menu", () => {
    mount({ breakpoints: devicesFor(7), selected: "phone-s" });
    const marked = openMore().filter(
      item => item.getAttribute("aria-checked") === "true"
    );
    expect(marked.map(item => item.textContent)).toEqual(["Phone S · 375px"]);
  });

  it("names the menu's button plainly while a button is the one styled", () => {
    mount({ breakpoints: devicesFor(7), selected: "tablet" });
    expect(moreDevices()?.getAttribute("aria-label")).toBe("More devices");
    expect(moreDevices()?.textContent).toBe("");
  });

  it("is inert until the saved breakpoints have been read", () => {
    mount({ breakpoints: devicesFor(7), status: "loading" });
    expect((moreDevices() as HTMLButtonElement | null)?.disabled).toBe(true);
  });
});

describe("arrow keys with a menu of devices", () => {
  it("move among the buttons only, wrapping past the last", () => {
    const { onSelect } = mount({
      breakpoints: devicesFor(7),
      selected: "tablet",
    });
    fireEvent.keyDown(screen.getByRole("radiogroup"), { key: "ArrowRight" });
    expect(onSelect).toHaveBeenCalledWith("base");
  });

  it("start from the first button when the choice is in the menu", () => {
    const { onSelect } = mount({
      breakpoints: devicesFor(7),
      selected: "phone",
    });
    fireEvent.keyDown(screen.getByRole("radiogroup"), { key: "ArrowRight" });
    expect(onSelect).toHaveBeenCalledWith("laptop");
  });
});

describe("the menu's button while a device in it is styled", () => {
  it("says the device, its width and its range in its tooltip", async () => {
    mount({ breakpoints: devicesFor(7), selected: "phone" });
    const trigger = moreDevices();
    if (trigger === null) throw new Error("no More devices button");
    expect(await tooltipOf(trigger)).toBe(
      "Phone · 575px · styles for 575px and narrower"
    );
  });
});

describe("an open menu when the saved breakpoints stop being trusted", () => {
  it("closes, so nothing in it can be chosen against an untrusted list", () => {
    const onSelect = vi.fn();
    const props = {
      breakpoints: devicesFor(7),
      selected: "base",
      onSelect,
    } as const;
    // Inside the shell's tooltip provider, as the top bar draws it.
    const { rerender } = render(
      <TooltipProvider delayDuration={0}>
        <BreakpointSwitcher {...props} status="ready" />
      </TooltipProvider>
    );
    openMore();
    expect(screen.getAllByRole("menuitemradio")).toHaveLength(4);

    rerender(
      <TooltipProvider delayDuration={0}>
        <BreakpointSwitcher {...props} status="loading" />
      </TooltipProvider>
    );
    expect(screen.queryAllByRole("menuitemradio")).toEqual([]);
    expect(onSelect).not.toHaveBeenCalled();
  });
});
