// @vitest-environment jsdom
/**
 * What the shell DECIDES, not what it lays out.
 *
 * jsdom reports every element as zero-sized and applies no stylesheet, so an
 * assertion about a panel's width, its position, or whether the chrome tokens
 * resolved would pass whatever the CSS does. Those belong in the Playwright
 * spec, which measures a real browser.
 *
 * What is genuinely decidable here: which regions exist and how they are named
 * to assistive technology, which panel the rail opens, that the exit is a
 * labelled control rather than a glyph, and that preferences survive a remount
 * through the port rather than through `localStorage` reached for directly.
 */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import * as React from "react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SLOTS_ATTRIBUTE } from "@nextlyhq/blocks-react";
import { useShortcuts } from "@nextlyhq/ui";

import { useNoticeQueue, useNoticeSink } from "./builder-notices";
import { BuilderShell, type SettingsDialogState } from "./builder-shell";
import { CanvasFrameProvider } from "./canvas-frame-context";
import { CommandPalette } from "./command-palette";
import { EMPTY_CONTAINER_SELECTOR } from "./empty-slot";
import {
  DEFAULT_PREFERENCES,
  fitsFullShell,
  MIN_SHELL_WIDTH,
  readPreferences,
  type PreferenceStore,
} from "./shell-state";

afterEach(cleanup);

/**
 * The width every observed element reports, in CSS pixels.
 *
 * The shell decides whether it fits by measuring its CONTAINER, so this is the
 * input to that decision and a test that wants the narrow branch sets it.
 */
let observedWidth = MIN_SHELL_WIDTH + 160;

/**
 * Horizontal padding a `p-6` class contributes, in CSS pixels — Tailwind's
 * 1.5rem on both sides.
 *
 * The measured wrapper carries the CALLER's `className` and nothing else, so a
 * caller adding padding there reduces what its children get by this much. The
 * narrow notice also has `p-6`, inside the wrapper, where it is invisible to
 * the measurement — which is the whole point of measuring one element rather
 * than whichever branch is showing.
 */
const P6_PADDING = 48;

/**
 * `ResizeObserver`, which jsdom does not implement.
 *
 * Previously stubbed INERT, on the reasoning that a fake reporting invented
 * dimensions would let a layout assertion pass against numbers this file made
 * up. That reasoning still holds for LAYOUT and no longer covers everything:
 * the shell now derives fits-or-not from the observed width, so an inert
 * observer does not abstain from that question — it answers it, permanently
 * "fits", and the narrow branch becomes unreachable.
 *
 * So this reports ONE number the test sets, and nothing else. Panel sizes
 * remain Playwright's to check; what is decided here is a comparison against a
 * threshold, which is exactly the kind of thing a unit test can settle.
 */
class DrivenResizeObserver {
  private static live = new Set<DrivenResizeObserver>();
  private targets = new Set<Element>();

  constructor(private readonly callback: ResizeObserverCallback) {}

  observe(target: Element) {
    this.targets.add(target);
    DrivenResizeObserver.live.add(this);
    // A real observer delivers an initial observation on `observe`, which is
    // what lets a test set the width before rendering and have the first
    // measurement already carry it.
    this.deliver();
  }

  unobserve(target: Element) {
    this.targets.delete(target);
  }

  disconnect() {
    this.targets.clear();
    DrivenResizeObserver.live.delete(this);
  }

  private deliver() {
    const entries = [...this.targets].map(target => {
      // `contentRect` excludes padding and `borderBoxSize` includes it, and the
      // difference is the whole question here: what the regions get is the
      // CONTENT box of the element the caller styled. Modelling both is what
      // lets this file tell those two readings apart — a stub reporting one
      // number for both would pass on either, which is how a measurement that
      // over-reports the available space by the caller's padding would ship.
      const padding = (target as HTMLElement).className?.includes("p-6")
        ? P6_PADDING
        : 0;
      return {
        target,
        borderBoxSize: [{ inlineSize: observedWidth, blockSize: 900 }],
        contentRect: { width: observedWidth - padding, height: 900 },
      } as unknown as ResizeObserverEntry;
    });
    if (entries.length > 0) this.callback(entries, this as never);
  }

  /** Re-deliver to everything currently observing, as a resize would. */
  static redeliver() {
    for (const observer of DrivenResizeObserver.live) observer.deliver();
  }
}
vi.stubGlobal("ResizeObserver", DrivenResizeObserver);

function memoryStore(initial: string | null = null): PreferenceStore & {
  value: string | null;
} {
  return {
    value: initial,
    read() {
      return this.value;
    },
    write(next: string) {
      this.value = next;
    },
  };
}

/**
 * Set whether the shell's CONTAINER can carry the full layout.
 *
 * Named for the container rather than the viewport because that is now the
 * quantity: the shell sizes to its container (`h-full w-full`, no viewport
 * units), and a wide window around a narrow column used to report "fits" while
 * the layout was being compressed past its minimums.
 *
 * `matchMedia` is still stubbed because jsdom lacks it and other code reaches
 * for it, but the shell no longer asks it anything.
 */
function stubContainerFits(fits: boolean) {
  observedWidth = fits ? MIN_SHELL_WIDTH + 160 : MIN_SHELL_WIDTH - 100;
  DrivenResizeObserver.redeliver();
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: fits,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }))
  );
}

function renderShell(props: Partial<Parameters<typeof BuilderShell>[0]> = {}) {
  stubContainerFits(true);
  const onExit = vi.fn();
  const result = render(
    <BuilderShell onExit={onExit} store={memoryStore()} {...props} />
  );
  return { onExit, ...result };
}

describe("the rail's panel keys", () => {
  const railItem = (name: string) =>
    within(screen.getByRole("navigation", { name: "Editor panels" })).getByRole(
      "button",
      { name }
    );

  it("opens a panel on its key, and closes it on the same key, as clicking does", () => {
    renderShell({ renderPanel: panel => <p>{panel} panel</p> });
    fireEvent.keyDown(document.body, { key: "l" });
    expect(railItem("Layers").getAttribute("aria-pressed")).toBe("true");
    fireEvent.keyDown(document.body, { key: "l" });
    expect(railItem("Layers").getAttribute("aria-pressed")).toBe("false");
  });

  it("does nothing while text is being typed, or with a modifier held", () => {
    renderShell({ renderPanel: panel => <p>{panel} panel</p> });
    const before = railItem("Design").getAttribute("aria-pressed");
    const field = document.createElement("input");
    document.body.append(field);
    field.focus();
    fireEvent.keyDown(field, { key: "d" });
    field.remove();
    fireEvent.keyDown(document.body, { key: "d", ctrlKey: true });
    fireEvent.keyDown(document.body, { key: "D", shiftKey: true });
    expect(railItem("Design").getAttribute("aria-pressed")).toBe(before);
  });

  it("answers for the editor the author is in, with two on the page", () => {
    // The shortcut manager hands a key to the binding registered last, which
    // is the second editor's: without the shell's own check, a key pressed in
    // the first switched panels in the second.
    stubContainerFits(true);
    const shell = (label: string) => (
      <BuilderShell
        onExit={vi.fn()}
        store={memoryStore()}
        renderPanel={panel => <p>{panel} panel</p>}
        inspector={<button type="button">{label} inspector control</button>}
      />
    );
    render(shell("first"));
    render(shell("second"));
    const [first, second] = screen
      .getAllByRole("navigation", { name: "Editor panels" })
      .map(rail => within(rail).getByRole("button", { name: "Layers" }));
    screen.getByRole("button", { name: "first inspector control" }).focus();

    fireEvent.keyDown(document.activeElement ?? document, { key: "l" });

    expect(first?.getAttribute("aria-pressed")).toBe("true");
    expect(second?.getAttribute("aria-pressed")).toBe("false");
  });

  it("passes the key on from an editor behind its narrow-window notice", () => {
    // That editor stays mounted to keep its slots, so its keys stay
    // registered; registered last, it took the key from the editor the author
    // can see.
    observedWidth = MIN_SHELL_WIDTH + 160;
    render(
      <BuilderShell
        store={memoryStore()}
        renderPanel={panel => <p>{panel} panel</p>}
      >
        <p>wide canvas</p>
      </BuilderShell>
    );
    act(() => {
      observedWidth = MIN_SHELL_WIDTH - 100;
    });
    render(
      <BuilderShell
        store={memoryStore()}
        renderPanel={panel => <p>{panel} panel</p>}
      >
        <p>narrow canvas</p>
      </BuilderShell>
    );
    expect(screen.queryAllByText(/needs more width/i)).toHaveLength(1);
    (document.activeElement as HTMLElement | null)?.blur();

    fireEvent.keyDown(document.body, { key: "l" });

    expect(railItem("Layers").getAttribute("aria-pressed")).toBe("true");
  });

  it("keeps focus in the editor when a key closes the panel holding it", () => {
    // The panel unmounts the control holding focus; left there, focus fell to
    // the page body, where a second editor on the page would claim no key.
    renderShell({
      renderPanel: panel => <button type="button">{panel} control</button>,
    });
    fireEvent.keyDown(document.body, { key: "l" });
    screen.getByRole("button", { name: "layers control" }).focus();

    fireEvent.keyDown(document.activeElement ?? document, { key: "l" });

    expect(railItem("Layers").getAttribute("aria-pressed")).toBe("false");
    expect(document.activeElement).not.toBe(document.body);
    expect(
      document.activeElement?.closest(".nx-builder-chrome")
    ).not.toBeNull();
  });

  it("can be turned off in Help, and then none answers or is offered", async () => {
    // A key with no modifier can be set off by speech input; WCAG 2.1.4 asks
    // for a way to turn it off.
    const store = memoryStore();
    renderShell({ store, renderPanel: panel => <p>{panel} panel</p> });
    fireEvent.click(railItem("Help"));
    const keys = await screen.findByRole("switch", {
      name: "Single-letter shortcuts",
    });
    expect(keys.getAttribute("aria-checked")).toBe("true");

    fireEvent.click(keys);
    fireEvent.keyDown(document.activeElement ?? document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    fireEvent.keyDown(document.body, { key: "l" });
    expect(railItem("Layers").getAttribute("aria-pressed")).toBe("false");
    expect(railItem("Layers").hasAttribute("aria-keyshortcuts")).toBe(false);
    expect(readPreferences(store).panelKeys).toBe(false);
  });

  it("names each panel's key on its item, for assistive technology", () => {
    renderShell();
    expect(railItem("Add").getAttribute("aria-keyshortcuts")).toBe("A");
    expect(railItem("Pages").getAttribute("aria-keyshortcuts")).toBe("P");
    expect(railItem("Components").getAttribute("aria-keyshortcuts")).toBe("C");
  });

  it("names an item and its key in the tooltip its focus shows", async () => {
    // The rail draws icons only: the tooltip is how a sighted author learns
    // both what an item is and its key.
    renderShell();
    act(() => railItem("Layers").focus());

    // The whole text, since "Layers" alone already holds an "L".
    const tip = await screen.findByRole("tooltip");
    expect(tip.textContent?.replace(/\s+/g, "")).toBe("LayersL");
  });

  it("keeps a keyboard-focused item's tooltip open when the pointer enters the frame", async () => {
    // The tooltip is the focused item's only visible name. Reached by Tab, so
    // the focus is a keyboard user's and shows as such.
    renderShell();
    fireEvent.keyDown(document.body, { key: "Tab" });
    act(() => railItem("Layers").focus());
    expect(railItem("Layers").matches(":focus-visible")).toBe(true);
    await screen.findByRole("tooltip");
    const frame = document.createElement("iframe");
    document.body.append(frame);

    fireEvent.pointerOver(frame);

    expect(screen.getByRole("tooltip")).toBeTruthy();
    frame.remove();
  });

  it("closes a pointer-opened tooltip when the pointer moves into the canvas frame", () => {
    // A frame is another document: once the pointer is in it, this one sees
    // no move that could tell the tooltip it was left, and it stayed open over
    // the canvas.
    vi.useFakeTimers();
    try {
      renderShell();
      fireEvent.pointerMove(railItem("Layers"), { pointerType: "mouse" });
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(screen.getByRole("tooltip")).toBeTruthy();
      const frame = document.createElement("iframe");
      document.body.append(frame);

      fireEvent.pointerOver(frame);

      expect(screen.queryByRole("tooltip")).toBeNull();
      frame.remove();
    } finally {
      vi.useRealTimers();
    }
  });

  it("lists in Help only its own editor's panel keys, with two on the page", async () => {
    // The shortcut manager is shared, and lists every editor's bindings: Help
    // in an editor whose keys are off listed the other editor's as if they
    // were its own.
    stubContainerFits(true);
    render(
      <BuilderShell
        onExit={vi.fn()}
        store={memoryStore(
          JSON.stringify({ ...DEFAULT_PREFERENCES, panelKeys: false })
        )}
      />
    );
    render(<BuilderShell onExit={vi.fn()} store={memoryStore()} />);
    const [first] = screen.getAllByRole("navigation", {
      name: "Editor panels",
    });
    fireEvent.click(
      within(first as HTMLElement).getByRole("button", { name: "Help" })
    );

    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain("Hide or show the side panels");
    expect(dialog.textContent).not.toContain("Open or close Layers");
  });
});

describe("whose notices the shell reports", () => {
  it("renders and provides the HOST's queue when one is handed in, so a sentence raised above the shell lands in its region", () => {
    // A host builds its editor above the shell, and that editor is where an
    // edit is refused for room. The sink the shell provides cannot be reached
    // from there, so the host owns the queue instead: what it raises and what
    // a control inside the shell raises land in the same region.
    function Host(): React.JSX.Element {
      const notices = useNoticeQueue();
      hostRaise = notices.raise;
      return (
        <BuilderShell
          onExit={() => {}}
          store={memoryStore()}
          notices={notices}
          inspector={<InsideRaiser />}
        />
      );
    }
    function InsideRaiser(): React.JSX.Element {
      insideRaise = useNoticeSink();
      return <span />;
    }
    let hostRaise: ((message: string) => void) | undefined;
    let insideRaise: ((message: string) => void) | undefined;
    stubContainerFits(true);
    render(<Host />);

    act(() => {
      hostRaise?.("This page has no room left for that component.");
    });
    act(() => {
      insideRaise?.("This class could not be saved.");
    });

    const region = screen.getByRole("status");
    expect(region.textContent).toMatch(/no room left/);
    expect(region.textContent).toMatch(/could not be saved/);
  });
});

describe("the regions the shell exposes", () => {
  it("names every region for assistive technology", () => {
    // The names are the only way a screen-reader user tells these apart: four
    // scroll containers with no accessible name are four identical regions.
    renderShell();

    // `banner`, not `toolbar`. A `toolbar` role promises APG arrow-key
    // navigation between its items, which this bar does not implement — and a
    // role claiming a keyboard contract that is not there is worse for a screen
    // reader user than the plain landmark, because it sets an expectation the
    // component then fails.
    expect(screen.getByRole("banner", { name: "Editor actions" })).toBeTruthy();
    expect(
      screen.getByRole("navigation", { name: "Editor panels" })
    ).toBeTruthy();
    expect(screen.getByRole("region", { name: "Canvas" })).toBeTruthy();
    expect(
      screen.getByRole("complementary", { name: "Inspector" })
    ).toBeTruthy();
  });

  it("renders each slot's content without inspecting it", () => {
    // The slot contract: the shell knows the SHAPE of the editor and never what
    // fills it, so the panels can be built independently of this file.
    renderShell({
      children: <p>canvas content</p>,
      inspector: <p>inspector content</p>,
      topBar: <p>top bar content</p>,
      breadcrumb: <p>breadcrumb content</p>,
    });

    expect(screen.getByText("canvas content")).toBeTruthy();
    expect(screen.getByText("inspector content")).toBeTruthy();
    expect(screen.getByText("top bar content")).toBeTruthy();
    expect(screen.getByText("breadcrumb content")).toBeTruthy();
  });
});

describe("the strip pinned above the canvas", () => {
  it("draws it outside the region that scrolls the page, so it stays while the page scrolls", () => {
    renderShell({
      children: <p>canvas content</p>,
      canvasStrip: <p>strip content</p>,
    });
    const strip = screen.getByText("strip content");
    const region = screen.getByRole("region", { name: "Canvas" });
    // The region is what scrolls: a strip inside it would scroll away.
    expect(region.contains(strip)).toBe(false);
    expect(region.contains(screen.getByText("canvas content"))).toBe(true);
    // Above the page, beside it in the canvas's panel.
    expect(
      strip.compareDocumentPosition(region) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    // The page meets the strip with no gap of its own, as one surface.
    expect(parseFloat(region.style.paddingTop)).toBe(0);
    expect(parseFloat(region.style.paddingLeft)).toBeGreaterThan(0);
  });

  it("draws none, and keeps the canvas's whole gutter, where the host gives none (the control)", () => {
    renderShell({ children: <p>canvas content</p> });
    const region = screen.getByRole("region", { name: "Canvas" });
    expect(document.querySelector(".nx-canvas-strip-slot")).toBeNull();
    expect(parseFloat(region.style.paddingTop)).toBeGreaterThan(0);
  });
});

describe("leaving the editor", () => {
  it("offers an exit with words on it", () => {
    // Deliberately asserted by NAME rather than by role alone. The author is one
    // click from leaving a canvas full of work, and an unlabelled X is how that
    // happens by accident.
    const { onExit } = renderShell();

    const exit = screen.getByRole("button", { name: "Exit editor" });
    fireEvent.click(exit);
    expect(onExit).toHaveBeenCalledTimes(1);
  });
});

describe("panels the host cannot fill", () => {
  it("leaves them off the rail rather than offering a dead control", () => {
    // An item that does nothing teaches an author the rail is unreliable, and
    // opening one reserves a panel and shrinks the canvas to display nothing.
    renderShell({ availablePanels: ["add"] });

    const rail = screen.getByRole("navigation", { name: "Editor panels" });
    expect(within(rail).queryByRole("button", { name: /^Layers/ })).toBeNull();
    expect(rail.textContent).not.toMatch(/coming soon/i);
  });

  it("leaves a panel the host CAN fill fully operable", () => {
    // The positive control. Without it, a shell that disabled every rail button
    // would satisfy both assertions above perfectly.
    renderShell({
      availablePanels: ["add"],
      renderPanel: panel => <p>{panel} panel</p>,
    });

    const insert = screen.getByRole("button", { name: "Add" });
    expect((insert as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(insert);
    expect(screen.getByText("add panel")).toBeTruthy();
  });

  it("does not reserve a panel a RESTORED selection names but the host cannot fill", () => {
    // Disabling the rail button does not cover this: nobody clicked it, the
    // selection came out of storage. Left alone the layout reserves a left panel
    // whose content renders nothing — the blank panel the prop exists to prevent.
    const store = memoryStore(
      JSON.stringify({ ...DEFAULT_PREFERENCES, leftPanel: "layers" })
    );
    stubContainerFits(true);
    render(
      <BuilderShell
        store={store}
        availablePanels={["add"]}
        renderPanel={panel => <p>{panel} panel</p>}
      />
    );

    expect(screen.queryByText("layers panel")).toBeNull();
  });

  it("treats every panel as available when the host says nothing", () => {
    // Omitting the prop must not silently disable the whole rail for hosts that
    // fill all of them.
    renderShell();

    const rail = screen.getByRole("navigation", { name: "Editor panels" });
    const names = within(rail)
      .getAllByRole("button")
      .map(button => button.getAttribute("aria-label"));
    expect(names).toEqual([
      "Add",
      "Layers",
      "Pages",
      "Components",
      "Design",
      "Settings",
      "Help",
    ]);
  });
});

describe("the rail", () => {
  const railButton = (name: string) =>
    screen.getByRole("button", { name, pressed: undefined }) ??
    screen.getByRole("button", { name });

  it("opens the panel whose rail item was clicked", () => {
    renderShell({ renderPanel: panel => <p>{panel} panel</p> });

    expect(screen.queryByText("layers panel")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Layers" }));
    expect(screen.getByText("layers panel")).toBeTruthy();
  });

  it("switches between panels rather than opening a second", () => {
    // PB-D17 D10-1: one at a time, fixed sides. Two panels open at once is the
    // layout this decision exists to prevent.
    renderShell({ renderPanel: panel => <p>{panel} panel</p> });

    fireEvent.click(screen.getByRole("button", { name: "Layers" }));
    fireEvent.click(screen.getByRole("button", { name: "Design" }));

    expect(screen.getByText("design panel")).toBeTruthy();
    expect(screen.queryByText("layers panel")).toBeNull();
  });

  it("closes the open panel when its own item is clicked again", () => {
    // The only route to a full-width canvas. Without it the author can switch
    // panels forever and never dismiss one.
    renderShell({ renderPanel: panel => <p>{panel} panel</p> });

    fireEvent.click(screen.getByRole("button", { name: "Layers" }));
    fireEvent.click(screen.getByRole("button", { name: "Layers" }));
    expect(screen.queryByText("layers panel")).toBeNull();
  });

  it("reports which item is active, not just paints it", () => {
    // `aria-pressed` rather than a class: the selected rail item is state, and
    // a colour change alone tells a screen-reader user nothing.
    renderShell();

    const layers = railButton("Layers");
    expect(layers.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(layers);
    expect(railButton("Layers").getAttribute("aria-pressed")).toBe("true");
  });
});

describe("the rail's groups", () => {
  it("keeps Settings and Help apart from the daily tools, at the bottom", () => {
    renderShell();

    const rail = screen.getByRole("navigation", { name: "Editor panels" });
    const [top, bottom] = within(rail).getAllByRole("list");
    expect(top).toBeDefined();
    expect(bottom).toBeDefined();
    if (top === undefined || bottom === undefined) return;
    expect(
      within(bottom)
        .getAllByRole("button")
        .map(button => button.getAttribute("aria-label"))
    ).toEqual(["Settings", "Help"]);
    expect(within(top).queryByRole("button", { name: "Help" })).toBeNull();
  });
});

describe("Help", () => {
  it("lists the shortcuts in effect, and hands focus back when Escape closes it", async () => {
    renderShell();
    const help = screen.getByRole("button", { name: "Help" });
    help.focus();
    fireEvent.click(help);

    const dialog = await screen.findByRole("dialog", { name: "Help" });
    // The shell's own region binding, read from the live registry rather than
    // from a list written for Help.
    expect(dialog.textContent).toContain("Move to the next area of the editor");

    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: "Escape",
    });

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(help);
  });

  it("closes when the editor gives way to its narrow-window notice", async () => {
    // The editor stays mounted, hidden and inert, behind the notice. A Help
    // left open there would still trap focus and hold the keyboard, with the
    // notice's Exit button outside its reach.
    renderShell();
    fireEvent.click(screen.getByRole("button", { name: "Help" }));
    await screen.findByRole("dialog", { name: "Help" });

    act(() => stubContainerFits(false));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    act(() => stubContainerFits(true));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("Settings, as the host's dialog", () => {
  /** A host's Settings: a dialog while open, recording what it was handed. */
  function settingsHost() {
    const handed: SettingsDialogState[] = [];
    const renderSettings = (dialog: SettingsDialogState) => {
      handed.push(dialog);
      return dialog.open ? (
        <div role="dialog" aria-label="Settings">
          <button type="button" onClick={() => dialog.onOpenChange(false)}>
            Done
          </button>
        </div>
      ) : null;
    };
    return { handed, renderSettings };
  }

  it("opens the host's dialog from the rail, shown pressed, and never as a panel", () => {
    const { renderSettings } = settingsHost();
    renderShell({ renderSettings });
    const rail = screen.getByRole("navigation", { name: "Editor panels" });
    const item = within(rail).getByRole("button", { name: "Settings" });
    expect(item.getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(item);

    expect(screen.getByRole("dialog", { name: "Settings" })).toBeTruthy();
    expect(item.getAttribute("aria-pressed")).toBe("true");
    // No left panel opened for it: the dialog is the whole of Settings.
    expect(item.getAttribute("data-rail-action")).toBe("settings");
    expect(
      within(rail).getAllByRole("button", { name: "Settings" })
    ).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("dialog", { name: "Settings" })).toBeNull();
    expect(item.getAttribute("aria-pressed")).toBe("false");
  });

  it("hands the dialog the rail's item to return focus to", () => {
    const { handed, renderSettings } = settingsHost();
    renderShell({ renderSettings });
    const item = screen.getByRole("button", { name: "Settings" });
    fireEvent.click(item);
    expect(handed.at(-1)?.returnFocus()).toBe(item);
  });

  it("opens from a host's request once per count, and not again on a re-render", () => {
    const { renderSettings } = settingsHost();
    const { rerender } = renderShell({
      renderSettings,
      openSettingsRequest: { count: 1 },
    });
    expect(screen.getByRole("dialog", { name: "Settings" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    // The same request again is not a new one: closed stays closed.
    rerender(
      <BuilderShell
        onExit={() => undefined}
        store={memoryStore()}
        renderSettings={renderSettings}
        openSettingsRequest={{ count: 1 }}
      />
    );
    expect(screen.queryByRole("dialog", { name: "Settings" })).toBeNull();

    rerender(
      <BuilderShell
        onExit={() => undefined}
        store={memoryStore()}
        renderSettings={renderSettings}
        openSettingsRequest={{ count: 2 }}
      />
    );
    expect(screen.getByRole("dialog", { name: "Settings" })).toBeTruthy();
  });

  it("holds a request that arrives while the window is too narrow, and opens once it fits", async () => {
    // A dialog there would trap focus over the notice and its way out. Read
    // from what the shell hands the host: a real dialog portals out of the
    // hidden regions, so "open" is the trap whatever this stand-in shows.
    const { handed, renderSettings } = settingsHost();
    const shell = (request?: { count: number }) => (
      <BuilderShell
        onExit={() => undefined}
        store={memoryStore()}
        renderSettings={renderSettings}
        {...(request === undefined ? {} : { openSettingsRequest: request })}
      />
    );
    const request = { count: 1 };
    const { rerender } = render(shell());
    act(() => stubContainerFits(false));
    await waitFor(() =>
      expect(
        screen.queryByRole("navigation", { name: "Editor panels" })
      ).toBeNull()
    );

    const before = handed.length;
    rerender(shell(request));
    await new Promise(settle => setTimeout(settle, 20));
    expect(handed.slice(before).some(dialog => dialog.open)).toBe(false);

    act(() => stubContainerFits(true));
    rerender(shell(request));
    await waitFor(() =>
      expect(screen.getByRole("dialog", { name: "Settings" })).toBeTruthy()
    );
  });

  it("closes when the editor gives way to its narrow-window notice", async () => {
    const { renderSettings } = settingsHost();
    renderShell({ renderSettings });
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect(screen.getByRole("dialog", { name: "Settings" })).toBeTruthy();

    act(() => stubContainerFits(false));

    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Settings" })).toBeNull()
    );
  });
});

describe("a panel's view", () => {
  function renderWithView(store = memoryStore()) {
    const seen: Array<string | null> = [];
    let choose: (view: string) => void = () => {};
    stubContainerFits(true);
    const result = render(
      <BuilderShell
        onExit={vi.fn()}
        store={store}
        renderPanel={(panel, view) => {
          seen.push(view.current);
          choose = view.choose;
          return <p>{panel} panel</p>;
        }}
      />
    );
    return { seen, choose: (view: string) => choose(view), store, ...result };
  }

  it("restores a remembered part when nothing else differs from the defaults", () => {
    // Choosing Classes and then closing Design leaves a record that differs
    // from the defaults only in the part. Read back as "unchanged", it was
    // dropped, and Design reopened on its first tab.
    const shell = renderWithView(
      memoryStore(
        JSON.stringify({ ...DEFAULT_PREFERENCES, leftPanelView: "classes" })
      )
    );
    fireEvent.click(screen.getByRole("button", { name: "Design" }));
    expect(shell.seen.at(-1)).toBe("classes");
  });

  it("keeps the part an author chose, and stores it with the panel", () => {
    const shell = renderWithView();
    fireEvent.click(screen.getByRole("button", { name: "Design" }));
    expect(shell.seen.at(-1)).toBeNull();

    act(() => shell.choose("classes"));

    expect(shell.seen.at(-1)).toBe("classes");
    expect(JSON.parse(shell.store.value as string)).toMatchObject({
      leftPanel: "design",
      leftPanelView: "classes",
    });
  });

  it("opens a panel stored under its old name on the part it became", () => {
    // Fonts was a panel of its own, and is now Design's Fonts tab. An author
    // who left it open comes back to it rather than to a closed rail.
    const shell = renderWithView(
      memoryStore(
        JSON.stringify({ ...DEFAULT_PREFERENCES, leftPanel: "fonts" })
      )
    );

    expect(screen.getByText("design panel")).toBeTruthy();
    expect(shell.seen.at(-1)).toBe("fonts");
  });

  it("opens the part a request names", () => {
    const store = memoryStore();
    const seen: Array<string | null> = [];
    stubContainerFits(true);
    render(
      <BuilderShell
        onExit={vi.fn()}
        store={store}
        renderPanel={(panel, view) => {
          seen.push(view.current);
          return <p>{panel} panel</p>;
        }}
        openPanelRequest={{ panel: "design", view: "variables", count: 1 }}
      />
    );

    expect(screen.getByText("design panel")).toBeTruthy();
    expect(seen.at(-1)).toBe("variables");
  });
});

describe("opening the Add panel from outside the shell", () => {
  // `rerender` rather than `renderShell` throughout: these assert what
  // happens BETWEEN two renders holding the same store, and `renderShell`
  // builds a fresh store each call, which would additionally exercise the
  // reload-on-swapped-store behaviour covered elsewhere and confuse which
  // effect produced the result.

  it("opens it once the token changes from undefined", () => {
    stubContainerFits(true);
    const store = memoryStore();
    const { rerender } = render(
      <BuilderShell
        onExit={vi.fn()}
        store={store}
        renderPanel={panel => <p>{panel} panel</p>}
      />
    );
    expect(screen.queryByText("add panel")).toBeNull();

    rerender(
      <BuilderShell
        onExit={vi.fn()}
        store={store}
        renderPanel={panel => <p>{panel} panel</p>}
        openPanelRequest={{ panel: "add", count: 1 }}
      />
    );

    expect(screen.getByText("add panel")).toBeTruthy();
  });

  it("does not close an already-open Add panel when the effect first applies its token", () => {
    // The rail's own click handler TOGGLES: a second press on the same item
    // closes the panel. Forcing the panel open must not inherit that —
    // pressing the canvas control again for the same container must never
    // read as "hide it".
    //
    // The panel is opened by a RAIL CLICK here, deliberately not by an
    // earlier token — from `leftPanel: null`, a correct force-set and a
    // buggy `panelAfterRailClick(current, "add")` both land on
    // `"add"`, so a fixture starting closed cannot tell them apart. Only
    // starting from ALREADY OPEN separates them: the toggle would close it,
    // the force-set leaves it exactly as it was.
    stubContainerFits(true);
    const store = memoryStore();
    const { rerender } = render(
      <BuilderShell
        onExit={vi.fn()}
        store={store}
        renderPanel={panel => <p>{panel} panel</p>}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(screen.getByText("add panel")).toBeTruthy();

    // The token's FIRST value, applied against a panel already open by the
    // rail rather than by a previous token — so the once-per-token guard is
    // not what is standing between this render and the effect running.
    rerender(
      <BuilderShell
        onExit={vi.fn()}
        store={store}
        renderPanel={panel => <p>{panel} panel</p>}
        openPanelRequest={{ panel: "add", count: 1 }}
      />
    );

    expect(screen.getByText("add panel")).toBeTruthy();
  });

  it("reopens on a NEW token after the author closed the panel by hand", () => {
    stubContainerFits(true);
    const store = memoryStore();
    const { rerender } = render(
      <BuilderShell
        onExit={vi.fn()}
        store={store}
        renderPanel={panel => <p>{panel} panel</p>}
        openPanelRequest={{ panel: "add", count: 1 }}
      />
    );
    expect(screen.getByText("add panel")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(screen.queryByText("add panel")).toBeNull();

    rerender(
      <BuilderShell
        onExit={vi.fn()}
        store={store}
        renderPanel={panel => <p>{panel} panel</p>}
        openPanelRequest={{ panel: "add", count: 2 }}
      />
    );

    expect(screen.getByText("add panel")).toBeTruthy();
  });

  it("keeps every stored preference when a token is already set at mount", () => {
    /*
     * The store is READ in an effect, so on the mount pass the restored record
     * has only been scheduled: the newest preferences this shell has seen are
     * still the defaults. A token applied there computes its write from those
     * defaults and persists them, so the author's panel widths and their
     * zoom are gone — from the store and from the state — while
     * the panel they asked for opens and everything on screen looks right.
     *
     * Every stored field is asserted, plus the panel: a test asserting only
     * that the panel opened passes against exactly that loss, and one
     * asserting only the record passes against a token that never applies at
     * all.
     */
    stubContainerFits(true);
    const layouts = { "canvas,panel": { canvas: 3, panel: 1 } };
    const store = memoryStore(
      JSON.stringify({
        ...DEFAULT_PREFERENCES,
        leftPinned: false,
        zoom: 1.5,
        layouts,
      })
    );

    render(
      <BuilderShell
        onExit={vi.fn()}
        store={store}
        renderPanel={panel => <p>{panel} panel</p>}
        openPanelRequest={{ panel: "add", count: 1 }}
      />
    );

    expect(screen.getByText("add panel")).toBeTruthy();
    expect(JSON.parse(store.value as string)).toMatchObject({
      leftPanel: "add",
      leftPinned: false,
      zoom: 1.5,
      layouts,
    });
  });

  it("still applies a mount-time token when the shell falls back to its own store", () => {
    /*
     * Waiting for a store read raises one question: can a token WAIT FOREVER?
     * It cannot, and the case with no `store` prop at all is where that would
     * show — the shell builds its own fallback, and the read that releases the
     * token runs for it exactly as for a supplied one. Reading cannot fail
     * either: unreadable or malformed storage answers with the defaults rather
     * than throwing, so there is no path where the count stays where it was.
     *
     * `localStorage` is cleared on both sides because this is the only case in
     * the file that reaches the fallback store: before, so the mount starts
     * from a known-empty one, and after, so nothing it wrote is still there
     * for another mount to restore.
     */
    stubContainerFits(true);
    window.localStorage.clear();

    render(
      <BuilderShell
        onExit={vi.fn()}
        renderPanel={panel => <p>{panel} panel</p>}
        openPanelRequest={{ panel: "add", count: 1 }}
      />
    );

    expect(screen.getByText("add panel")).toBeTruthy();
    window.localStorage.clear();
  });

  it("keeps the INCOMING store's record when a swap and a new token arrive together", () => {
    /*
     * The store swap a host makes when the backing user or workspace changes —
     * signing into a second workspace, promoting a memory store to a persisted
     * one — with a press of the canvas appender landing in the same render.
     *
     * Reading a store is an effect, so in the commit the new store first
     * arrives in, the newest preferences this shell has seen are still the
     * OUTGOING store's. A token applied there computes its write from those and
     * persists them through the new store, so one workspace's saved layout and
     * zoom replace another's. A count of reads cannot see this:
     * it is already nonzero from the first store and a swap only takes it
     * higher, so the window is exactly where the count looks safest.
     *
     * The two records differ in every field, so a write of EITHER wrong record
     * is visible: `first` is non-default throughout, and `second` differs from
     * `first` on all three and from the defaults on `layouts`. Asserting the
     * panel opened as well, because a guard that simply never releases the
     * token would leave the record intact and the feature dead.
     */
    stubContainerFits(true);
    const firstLayouts = { "canvas,panel": { canvas: 3, panel: 1 } };
    const secondLayouts = { "canvas,panel": { canvas: 1, panel: 4 } };
    const first = memoryStore(
      JSON.stringify({
        ...DEFAULT_PREFERENCES,
        leftPanel: "layers",
        leftPinned: false,
        zoom: 1.5,
        layouts: firstLayouts,
      })
    );
    const second = memoryStore(
      JSON.stringify({
        ...DEFAULT_PREFERENCES,
        leftPinned: true,
        layouts: secondLayouts,
      })
    );

    const { rerender } = render(
      <BuilderShell
        onExit={vi.fn()}
        store={first}
        renderPanel={panel => <p>{panel} panel</p>}
      />
    );
    // The first store's read has landed before the swap, which is what makes
    // this a test about the SECOND store rather than about a cold mount.
    expect(screen.getByText("layers panel")).toBeTruthy();

    rerender(
      <BuilderShell
        onExit={vi.fn()}
        store={second}
        renderPanel={panel => <p>{panel} panel</p>}
        openPanelRequest={{ panel: "add", count: 1 }}
      />
    );

    expect(screen.getByText("add panel")).toBeTruthy();
    expect(JSON.parse(second.value as string)).toMatchObject({
      leftPanel: "add",
      leftPinned: true,
      // The incoming store's own zoom, not the outgoing store's 1.5.
      zoom: "fit",
      layouts: secondLayouts,
    });
  });

  it("does not reopen a manually closed panel when the SAME token survives an unrelated effect re-run", () => {
    // `update`'s identity follows the `store` prop (documented on `store`
    // above: a host swapping stores is expected to hand over a new object),
    // so a re-render that swaps stores re-runs this effect even though the
    // TOKEN did not change. The regression this guards: without the
    // once-per-token guard, that re-run would reapply "add" over a manual
    // close it had nothing to do with.
    //
    // A `className` change was tried here first and did not exercise this at
    // all — neither `openPanelRequest` nor `update` depends on it, so the
    // effect never re-runs and the guard is never reached. Only a dependency
    // the effect actually reads can demonstrate the guard is doing anything.
    stubContainerFits(true);
    const backing: { value: string | null } = { value: null };
    const storeOverBacking = (): PreferenceStore => ({
      read: () => backing.value,
      write: value => {
        backing.value = value;
      },
    });

    const { rerender } = render(
      <BuilderShell
        onExit={vi.fn()}
        store={storeOverBacking()}
        renderPanel={panel => <p>{panel} panel</p>}
        openPanelRequest={{ panel: "add", count: 1 }}
      />
    );
    expect(screen.getByText("add panel")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(screen.queryByText("add panel")).toBeNull();

    // A DIFFERENT store object reading the same backing value — `update`
    // changes identity, `openPanelRequest` does not.
    rerender(
      <BuilderShell
        onExit={vi.fn()}
        store={storeOverBacking()}
        renderPanel={panel => <p>{panel} panel</p>}
        openPanelRequest={{ panel: "add", count: 1 }}
      />
    );

    expect(screen.queryByText("add panel")).toBeNull();
  });
});

describe("preferences", () => {
  it("writes the open panel through the store, not to localStorage", () => {
    // The port is what lets these become durable server-side prefs later. A
    // component reaching for `localStorage` makes that a rewrite.
    const store = memoryStore();
    stubContainerFits(true);
    render(<BuilderShell onExit={vi.fn()} store={store} />);

    fireEvent.click(screen.getByRole("button", { name: "Design" }));

    expect(store.value).not.toBeNull();
    expect(JSON.parse(store.value as string)).toMatchObject({
      leftPanel: "design",
    });
  });

  it("restores the panel that was open when the editor was last left", () => {
    const store = memoryStore(
      JSON.stringify({ ...DEFAULT_PREFERENCES, leftPanel: "design" })
    );
    stubContainerFits(true);
    render(
      <BuilderShell
        onExit={vi.fn()}
        store={store}
        renderPanel={panel => <p>{panel} panel</p>}
      />
    );

    expect(screen.getByText("design panel")).toBeTruthy();
  });

  it("a later write does not clobber an earlier one", () => {
    // The stale-closure defect a browser found and jsdom cannot: a callback
    // React captured at render time, handed a whole record built by spreading
    // that render's preferences, writes the OLD record back with one field
    // replaced. Two writes in a row from separate handlers is the shape.
    //
    // Driven through the rail because it is the only writer reachable here —
    // `onLayoutChanged` never fires under an inert ResizeObserver, which is
    // exactly why the Playwright spec is the one that caught it.
    const store = memoryStore();
    stubContainerFits(true);
    render(<BuilderShell onExit={vi.fn()} store={store} />);

    fireEvent.click(screen.getByRole("button", { name: "Design" }));
    fireEvent.click(screen.getByRole("button", { name: "Layers" }));

    // The second write must have been computed from the FIRST write's result,
    // not from the render both handlers were created in.
    expect(JSON.parse(store.value as string)).toMatchObject({
      leftPanel: "layers",
    });
  });

  it("opens no panel when a stored one no longer exists", () => {
    // A preference outlives the release that wrote it. Restoring a removed
    // panel leaves a region rendering nothing, with no obvious way back.
    const store = memoryStore(JSON.stringify({ leftPanel: "history" }));
    stubContainerFits(true);
    render(
      <BuilderShell
        onExit={vi.fn()}
        store={store}
        renderPanel={panel => <p>{panel} panel</p>}
      />
    );

    expect(screen.queryByText(/panel$/)).toBeNull();
  });

  it("shows empty containers, and the rest of the record, when a stored preference hid them", () => {
    // Records written while the editor could hide empty containers still carry
    // `showEmptyElements: false`. The field no longer exists: the record must
    // load whole (the stored panel opens) and empty containers still draw.
    const store = memoryStore(
      JSON.stringify({
        ...DEFAULT_PREFERENCES,
        leftPanel: "design",
        showEmptyElements: false,
      })
    );
    stubContainerFits(true);
    render(
      <BuilderShell
        onExit={vi.fn()}
        store={store}
        renderPanel={panel => <p>{panel} panel</p>}
      />
    );

    expect(screen.getByText("design panel")).toBeTruthy();
    // Queried rather than assumed present: a selector that matched nothing
    // would make the match below fail for the wrong reason.
    const chrome = document.querySelector(".nx-builder-chrome");
    if (chrome === null) throw new Error("the shell rendered no chrome root");
    // An empty container on a canvas inside this chrome, asked the same
    // selector the canvas's sheet draws the placeholder box for.
    const canvas = document.createElement("div");
    canvas.className = "nx-canvas";
    const container = document.createElement("div");
    container.setAttribute(SLOTS_ATTRIBUTE, "children");
    canvas.append(container);
    chrome.append(canvas);
    expect(container.matches(EMPTY_CONTAINER_SELECTOR)).toBe(true);
  });

  it("offers no control to hide empty containers", () => {
    renderShell();
    expect(
      screen.queryByRole("switch", { name: "Show empty containers" })
    ).toBeNull();
    expect(screen.queryByText("Show empty containers")).toBeNull();
  });
});

describe("where overlays inside the shell portal to", () => {
  /** The host the shell publishes for portalled overlay content. */
  function overlayHost(): HTMLElement {
    const host = document.querySelector<HTMLElement>(
      '[data-slot="builder-overlay-host"]'
    );
    if (host === null) throw new Error("the shell rendered no overlay host");
    return host;
  }

  it("puts the host inside the subtree that goes inert", () => {
    // The whole point. `hidden` and `inert` are attributes on an element and
    // reach descendants only, so an overlay portalled to `document.body` could
    // never be covered by them — it stayed visible and clickable on top of the
    // notice saying the editor was unavailable. Containment is what makes that
    // impossible rather than something each control has to remember.
    stubContainerFits(false);
    render(
      <BuilderShell onExit={vi.fn()} store={memoryStore()}>
        <p>canvas</p>
      </BuilderShell>
    );

    const inert = overlayHost().closest("[inert]");
    expect(inert).not.toBeNull();
    // And the same element is the one taken out of layout, so portalled
    // content inherits `display: none` rather than merely losing pointers.
    expect(inert?.hasAttribute("hidden")).toBe(true);
  });

  it("keeps the host out of every scrollable region", () => {
    // The failure a naive placement produces, and it is worse than the one
    // being fixed because it is silent: the panel, the canvas and the
    // inspector are each `overflow-auto`, so an overlay opened near a panel
    // edge would be CLIPPED rather than merely misplaced. Asserted
    // structurally because jsdom computes no styles — what it can decide is
    // that the host is not a descendant of any of them.
    renderShell({ renderPanel: panel => <p>{panel} panel</p> });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    const host = overlayHost();
    for (const region of [
      screen.getByRole("region", { name: "Canvas" }),
      screen.getByRole("complementary", { name: "Inspector" }),
      screen.getByRole("navigation", { name: "Editor panels" }),
    ]) {
      expect(region.contains(host)).toBe(false);
    }
  });

  it("keeps the host out of any ancestor that would trap fixed positioning", () => {
    // A guard rather than a comment, because the invariant is fragile by
    // construction and its violation is silent.
    //
    // Every overlay positions itself `fixed`. A `transform`, `filter`,
    // `backdrop-filter`, `perspective`, `contain` or `will-change` on an
    // ancestor makes that ancestor the containing block instead of the
    // viewport, so a centred dialog would centre on the canvas and a dropdown
    // would land somewhere unrelated. The same properties create a stacking
    // context, which additionally makes every z-index inside the host local
    // and unable to compete with admin-level overlays.
    //
    // A page builder acquires canvas zoom eventually, and the day a `scale-`
    // lands on an ancestor of this host is the day overlays quietly
    // mispositioned. This fails then rather than in a bug report.
    const TRAPS =
      /(^|[\s:])(scale|rotate|translate|skew|transform|filter|blur|backdrop|perspective|isolate|contain|will-change|opacity)-/;

    renderShell({ renderPanel: panel => <p>{panel} panel</p> });

    const offenders: string[] = [];
    for (
      let node: HTMLElement | null = overlayHost().parentElement;
      node !== null;
      node = node.parentElement
    ) {
      const classes = node.className;
      if (typeof classes === "string" && TRAPS.test(classes)) {
        offenders.push(`${node.tagName.toLowerCase()}: ${classes}`);
      }
    }

    expect(offenders).toEqual([]);
  });

  it("walked real ancestors, so the guard above is not vacuous", () => {
    // The positive control. A host with no parents, or a selector that found
    // nothing, would satisfy the empty-offenders check perfectly.
    renderShell();

    let depth = 0;
    for (
      let node: HTMLElement | null = overlayHost().parentElement;
      node !== null;
      node = node.parentElement
    ) {
      depth += 1;
    }

    expect(depth).toBeGreaterThan(2);
  });
});

describe("the server render and the first client render agree", () => {
  it("emits the defaults even when the store has preferences", () => {
    // The hydration property, and it needs a real server render to state.
    // Reading storage in the state initializer is the obvious shape: the server
    // store answers null and emits no panel, the client store answers a stored
    // panel and emits one, and React 19 answers that divergence by discarding
    // and rebuilding the subtree. A returning author's layout then arrives as a
    // flash rather than a layout.
    const store = memoryStore(
      JSON.stringify({ ...DEFAULT_PREFERENCES, leftPanel: "design" })
    );

    const markup = renderToString(
      <BuilderShell
        onExit={vi.fn()}
        store={store}
        renderPanel={panel => <p>{panel} panel</p>}
      />
    );

    // Asserted on the RAIL's pressed state, not on the panel's content. The
    // panel body is inside `react-resizable-panels`, which renders nothing
    // measurable on the server — so "the panel content is absent" is true
    // whatever the preferences say, and a test asserting it passes with this
    // fix reverted. That was the first version of this test.
    //
    // The rail is plain markup the library never touches, so its `aria-pressed`
    // reflects the preferences the server actually rendered with.
    // Read off the rail alone: the top bar's side-panel buttons are pressed
    // whenever a side is shown, which says nothing about the stored panel.
    const rail =
      /<nav[^>]*aria-label="Editor panels"[^>]*>[\s\S]*?<\/nav>/.exec(
        markup
      )?.[0] ?? "";
    expect(rail).toContain('aria-pressed="false"');
    expect(rail).not.toContain('aria-pressed="true"');
    // The control: this render really did produce a shell, so the assertions
    // above are not passing on empty output.
    expect(markup).toContain("Exit editor");
  });
});

describe("F6 region cycling", () => {
  it("skips a region that is not rendered", () => {
    // With no panel open the left region does not exist. Cycling the static
    // list would land on it, focus nothing, and leave the key looking broken
    // for every press after the first.
    renderShell({ renderPanel: panel => <p>{panel} panel</p> });

    const rail = screen.getByRole("navigation", { name: "Editor panels" });
    rail.focus();
    expect(document.activeElement).toBe(rail);

    fireEvent.keyDown(document, { key: "F6" });

    // The next PRESENT region is the canvas, because the panel is closed.
    expect(document.activeElement).toBe(
      screen.getByRole("region", { name: "Canvas" })
    );
  });

  it("includes the panel once it is open", () => {
    // The positive control: a cycle that always skipped the panel would satisfy
    // the assertion above.
    renderShell({ renderPanel: panel => <p>{panel} panel</p> });

    fireEvent.click(screen.getByRole("button", { name: "Layers" }));
    const rail = screen.getByRole("navigation", { name: "Editor panels" });
    rail.focus();

    fireEvent.keyDown(document, { key: "F6" });

    expect(document.activeElement).toBe(
      screen.getByRole("region", { name: "Layers" })
    );
  });
});

describe("F6 and the top bar", () => {
  it("reaches the top bar, as the first area after the inspector", () => {
    // The top bar holds the editor's own controls (exit, undo, devices,
    // zoom, the side toggles): a keyboard author must be able to land there
    // without tabbing through the whole canvas.
    renderShell({ inspector: <p>inspector body</p> });
    const inspector = screen.getByRole("complementary", { name: "Inspector" });
    inspector.focus();

    fireEvent.keyDown(document, { key: "F6" });

    const header = document.querySelector(
      'header[aria-label="Editor actions"]'
    );
    expect(header).not.toBeNull();
    expect(document.activeElement).toBe(header);

    fireEvent.keyDown(document, { key: "F6" });
    expect(document.activeElement).toBe(
      screen.getByRole("navigation", { name: "Editor panels" })
    );
  });
});

describe("which shell F6 belongs to", () => {
  /**
   * The binding is registered on the document, so every mounted shell sees
   * every press. What decides the answer has to be where focus IS — a shell
   * the author is not in should let the key reach whatever they are in.
   */
  it("leaves the key alone when focus is in a control outside the shell", () => {
    // The field mount's real situation: an editor embedded in an entry form,
    // beside ordinary inputs. Enabling from viewport state alone made this
    // press move focus into the editor from a field the author was typing in.
    render(
      <div>
        <input aria-label="Page title" />
        <BuilderShell store={memoryStore()}>
          <p>canvas</p>
        </BuilderShell>
      </div>
    );

    const outside = screen.getByRole("textbox", { name: "Page title" });
    outside.focus();
    expect(document.activeElement).toBe(outside);

    fireEvent.keyDown(outside, { key: "F6" });

    expect(document.activeElement).toBe(outside);
  });

  it("still enters from a page where nothing has focus yet", () => {
    // The positive control, and the behaviour the rule above must not cost:
    // the full Edit view owns its page and nothing inside it has focus on
    // load, so refusing there would make the key look broken until focus
    // happened to land somewhere it recognised.
    renderShell({ renderPanel: panel => <p>{panel} panel</p> });
    (document.activeElement as HTMLElement | null)?.blur();

    fireEvent.keyDown(document, { key: "F6" });

    // Entering from nowhere lands on the first area, the top bar.
    expect(document.activeElement).toBe(
      document.querySelector('header[aria-label="Editor actions"]')
    );
  });

  it("answers from a control in the top bar, and moves on to the rail", () => {
    // The top bar holds the exit button and whatever the host puts there
    // (the device buttons, here). It is the first area F6 cycles through, so
    // from a control inside it the next press reaches the rail. It once sat
    // outside every area, and F6 then did nothing from a control plainly
    // inside the editor.
    renderShell({
      renderPanel: panel => <p>{panel} panel</p>,
      topBar: <button type="button">Desktop</button>,
    });

    const inTopBar = screen.getByRole("button", { name: "Desktop" });
    inTopBar.focus();
    expect(document.activeElement).toBe(inTopBar);

    fireEvent.keyDown(inTopBar, { key: "F6" });

    expect(document.activeElement).toBe(
      screen.getByRole("navigation", { name: "Editor panels" })
    );
  });

  it("answers from the exit button as well", () => {
    renderShell({ renderPanel: panel => <p>{panel} panel</p> });

    const exit = screen.getByRole("button", { name: "Exit editor" });
    exit.focus();

    fireEvent.keyDown(exit, { key: "F6" });

    expect(document.activeElement).toBe(
      screen.getByRole("navigation", { name: "Editor panels" })
    );
  });

  it("still enters after a shell has been mounted and torn down", () => {
    // The counter deciding "is this the only shell" must come back DOWN. A
    // leak drifts it upward and never returns, which declines the entry above
    // permanently — the same defect as the one this rule fixes, arriving from
    // the other side and first in dev, where a hot reload remounts.
    //
    // Asserting the count is 1 after one mount would not catch that: it passes
    // on a leaky counter the first time. The cycle is what separates them.
    const first = render(
      <BuilderShell store={memoryStore()}>
        <p>canvas</p>
      </BuilderShell>
    );
    first.unmount();

    renderShell({ renderPanel: panel => <p>{panel} panel</p> });
    (document.activeElement as HTMLElement | null)?.blur();

    fireEvent.keyDown(document, { key: "F6" });

    // Entering from nowhere lands on the first area, the top bar.
    expect(document.activeElement).toBe(
      document.querySelector('header[aria-label="Editor actions"]')
    );
  });

  it("stays reachable when the other shells are behind their notices", () => {
    // Only became possible once each shell measured its OWN container. Two
    // page-builder fields in columns of different widths can disagree about
    // whether they fit, so a form can hold one usable editor beside several
    // showing the narrow notice.
    //
    // Counting every MOUNTED shell there leaves the one editor that can answer
    // seeing more than one and declining, while the others decline because
    // their binding is disabled — and F6 reaches nothing at all. A shell behind
    // its notice is not a candidate for the key, so it is not part of the
    // ambiguity either.
    //
    // jsdom cannot give the two shells different real widths, so the narrow one
    // is rendered while the observer reports a narrow number and the wide one
    // after it changes — which is the same end state: one active, one not.
    observedWidth = MIN_SHELL_WIDTH - 100;
    render(
      <BuilderShell store={memoryStore()}>
        <p>narrow canvas</p>
      </BuilderShell>
    );

    act(() => {
      observedWidth = MIN_SHELL_WIDTH + 160;
    });
    render(
      <BuilderShell store={memoryStore()}>
        <p>wide canvas</p>
      </BuilderShell>
    );

    // Exactly one shell is usable.
    expect(screen.queryAllByText(/needs more width/i)).toHaveLength(1);
    const rails = screen.getAllByRole("navigation", { name: "Editor panels" });
    expect(rails).toHaveLength(1);

    (document.activeElement as HTMLElement | null)?.blur();
    fireEvent.keyDown(document, { key: "F6" });

    // Entering from nowhere lands on the first area, the top bar, of the one
    // usable shell (the other's header is behind its notice).
    const usableHeader = rails[0]
      ?.closest(".nx-builder-chrome")
      ?.querySelector('header[aria-label="Editor actions"]');
    expect(usableHeader).toBeTruthy();
    expect(document.activeElement).toBe(usableHeader);
  });

  it("declines that entry when a second shell makes it ambiguous", () => {
    // With two mounted, a press from nowhere names neither — and answering it
    // anyway is decided by whichever registered last, which is how a form with
    // several page-builder fields moved focus into an arbitrary one.
    render(
      <div>
        <BuilderShell store={memoryStore()}>
          <p>first canvas</p>
        </BuilderShell>
        <BuilderShell store={memoryStore()}>
          <p>second canvas</p>
        </BuilderShell>
      </div>
    );
    (document.activeElement as HTMLElement | null)?.blur();

    fireEvent.keyDown(document, { key: "F6" });

    expect(document.activeElement).toBe(document.body);
  });
});

describe("an embedded host with nowhere to exit to", () => {
  it("renders no exit affordance at all", () => {
    // The editor also mounts as a FIELD inside an entry form, where the author is
    // already on the page they would be sent back to. An inert button there
    // teaches them that leaving does nothing.
    stubContainerFits(true);
    render(<BuilderShell store={memoryStore()} />);

    expect(screen.queryByRole("button", { name: "Exit editor" })).toBeNull();
  });

  it("still renders the editor itself", () => {
    // The positive control for the assertion above: without it, a shell that
    // failed to render anything would satisfy "no exit button" perfectly.
    stubContainerFits(true);
    render(
      <BuilderShell store={memoryStore()}>
        <div data-testid="canvas-slot" />
      </BuilderShell>
    );

    expect(screen.getByTestId("canvas-slot")).toBeTruthy();
  });
});

describe("a viewport too narrow for the shell", () => {
  it("says where to edit instead of compressing", () => {
    // An editor that merely gets cramped is worse than one that says it needs
    // more width: the author otherwise discovers the limit by failing a task.
    stubContainerFits(false);
    render(<BuilderShell onExit={vi.fn()} store={memoryStore()} />);

    expect(screen.getByText(/needs more width/i)).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Canvas" })).toBeNull();
  });

  it("still offers a way out", () => {
    // The one control that must survive every degraded state: an author who
    // opened the editor on a narrow screen has to be able to leave it.
    stubContainerFits(false);
    const onExit = vi.fn();
    render(<BuilderShell onExit={onExit} store={memoryStore()} />);

    fireEvent.click(screen.getByRole("button", { name: "Exit editor" }));
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it("drops the escape sentence WITH the button when no host can be exited to", () => {
    // The copy and the control are one unit. Keeping the sentence while dropping
    // the button instructs the author to go somewhere and offers nothing to get
    // there; keeping the button with no handler is worse, because it looks
    // operable. Asserting only the button's absence would pass on the version
    // that still promises an escape, so the sentence is asserted too.
    stubContainerFits(false);
    render(<BuilderShell store={memoryStore()} />);

    expect(screen.getByText(/needs more width/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Exit editor" })).toBeNull();
    expect(screen.queryByText(/from the admin/i)).toBeNull();
  });

  it("keeps the caller's slots mounted behind the notice", () => {
    // Swapping the editor out for the notice unmounted every slot the host had
    // given us, and React discards the state inside them. Narrowing a window is
    // transient; widening it again must not hand back empty components while
    // whatever the host was holding locally is gone, with nothing having told
    // it the subtree was going away.
    //
    // Queried by test id rather than by role: the subtree is `hidden`, so a
    // role query correctly refuses to see it and would report the unmounted
    // case and the hidden case identically.
    stubContainerFits(false);
    render(
      <BuilderShell onExit={vi.fn()} store={memoryStore()}>
        <p data-testid="canvas-slot">the caller&apos;s canvas</p>
      </BuilderShell>
    );

    expect(screen.getByText(/needs more width/i)).toBeTruthy();
    expect(screen.queryByTestId("canvas-slot")).not.toBeNull();
  });

  it("hides that subtree from pointer, keyboard and assistive technology", () => {
    // The positive control for the test above. Keeping the slots mounted is
    // only correct while they are also unreachable — a tab order that runs
    // through an editor nobody can see is worse than the unmount was.
    stubContainerFits(false);
    render(
      <BuilderShell onExit={vi.fn()} store={memoryStore()}>
        <p data-testid="canvas-slot">the caller&apos;s canvas</p>
      </BuilderShell>
    );

    const slot = screen.getByTestId("canvas-slot");
    const hiddenWrapper = slot.closest("[hidden]");
    expect(hiddenWrapper).not.toBeNull();
    expect(hiddenWrapper?.hasAttribute("inert")).toBe(true);
    // And the canvas is genuinely out of the accessibility tree.
    expect(screen.queryByRole("region", { name: "Canvas" })).toBeNull();
  });

  it("decides at the boundary the exported predicate defines", () => {
    // ONE implementation of "does this fit". The hook used to repeat
    // `width >= MIN_SHELL_WIDTH` inline, which is a second answer to a question
    // `shell-state` already exports and tests — and the two would first diverge
    // at exactly the boundary those tests pin.
    //
    // Asserted AT the boundary rather than well inside it: the shell must agree
    // with `fitsFullShell(MIN_SHELL_WIDTH) === true`, so a hook that had drifted
    // to a strict `>` shows the notice here while the helper's own tests stay
    // green.
    observedWidth = MIN_SHELL_WIDTH;
    expect(fitsFullShell(observedWidth)).toBe(true);
    render(
      <BuilderShell onExit={vi.fn()} store={memoryStore()}>
        <p>canvas</p>
      </BuilderShell>
    );

    expect(screen.queryByRole("region", { name: "Canvas" })).not.toBeNull();
    expect(screen.queryByText(/needs more width/i)).toBeNull();
  });

  it("refuses one pixel below that boundary", () => {
    // The other side, so the test above cannot be satisfied by a shell that
    // renders fully at every width.
    observedWidth = MIN_SHELL_WIDTH - 1;
    expect(fitsFullShell(observedWidth)).toBe(false);
    render(
      <BuilderShell onExit={vi.fn()} store={memoryStore()}>
        <p>canvas</p>
      </BuilderShell>
    );

    expect(screen.queryByText(/needs more width/i)).not.toBeNull();
    expect(screen.queryByRole("region", { name: "Canvas" })).toBeNull();
  });

  it("subtracts padding the CALLER put on the shell", () => {
    // The regions are laid out inside the caller's decoration, not across it.
    // A root at exactly the threshold with `p-6` leaves 48px less than the
    // layout needs, so reporting that it fits recreates the compression this
    // whole change exists to prevent — measuring the border box says "1280"
    // while the regions are handed 1232.
    observedWidth = MIN_SHELL_WIDTH;
    render(
      <BuilderShell onExit={vi.fn()} store={memoryStore()} className="p-6">
        <p>canvas</p>
      </BuilderShell>
    );

    expect(screen.queryByText(/needs more width/i)).not.toBeNull();
    expect(screen.queryByRole("region", { name: "Canvas" })).toBeNull();
  });

  it("does not subtract padding that belongs to the notice", () => {
    // The other side, and the reason the measured element is a wrapper rather
    // than whichever branch is showing. The notice's own `p-6` sits INSIDE the
    // measured box, so it must not move the threshold — an earlier version
    // measured the notice itself and could not recover into a 48px band.
    observedWidth = MIN_SHELL_WIDTH;
    render(
      <BuilderShell onExit={vi.fn()} store={memoryStore()}>
        <p>canvas</p>
      </BuilderShell>
    );

    expect(screen.queryByRole("region", { name: "Canvas" })).not.toBeNull();
    expect(screen.queryByText(/needs more width/i)).toBeNull();
  });

  it("recovers into the band where the notice's own padding would hide it", () => {
    // The narrow band, and the only widths that separate a border-box
    // measurement from a content-box one.
    //
    // The notice is `p-6` and the shell root is not, so `contentRect` reports
    // this container 48px narrower while the notice is up. A container growing
    // back to anywhere in [MIN_SHELL_WIDTH, MIN_SHELL_WIDTH + 48) therefore
    // measures below the threshold and the notice never leaves — while a fresh
    // render at that same width shows the editor, because the shell root is
    // what gets observed first. Behaviour that depends on how a width was
    // ARRIVED AT rather than on the width.
    //
    // Growing to a comfortably wide value cannot see this: it clears the
    // threshold with or without the padding subtracted, which is why the first
    // version of the recovery test above passed on the broken implementation.
    const inBand = MIN_SHELL_WIDTH + 20;
    expect(inBand).toBeLessThan(MIN_SHELL_WIDTH + P6_PADDING);

    stubContainerFits(false);
    render(
      <BuilderShell onExit={vi.fn()} store={memoryStore()}>
        <p>canvas</p>
      </BuilderShell>
    );
    expect(screen.queryByText(/needs more width/i)).not.toBeNull();

    act(() => {
      observedWidth = inBand;
      DrivenResizeObserver.redeliver();
    });

    expect(screen.queryByRole("region", { name: "Canvas" })).not.toBeNull();
    expect(screen.queryByText(/needs more width/i)).toBeNull();
  });

  it("re-renders the editor when the measured width comes back up", () => {
    // Asserts the hook is WIRED — that a later measurement reaches the render
    // — and deliberately does NOT claim to cover the deadlock this fix exists
    // for. Saying so here because the two are easy to confuse and the stronger
    // reading is the tempting one.
    //
    // The deadlock is that observing the editor's own wrapper reports width 0
    // whenever the notice is up, because that wrapper is `display: contents`
    // when visible and `hidden` when narrow, so the shell could never measure
    // its way back above the threshold. That is REAL BROWSER GEOMETRY. The
    // observer here is a fake that reports whatever width the test sets,
    // regardless of which element is being observed, so it reports the same
    // number for the wrapper and for the visible root — measured by writing
    // the deadlock deliberately, and this file stayed green.
    //
    // Which element carries the observer is therefore Playwright's to check,
    // where elements have boxes. See `e2e/tests/shell/shell.spec.ts`.
    stubContainerFits(false);
    render(
      <BuilderShell onExit={vi.fn()} store={memoryStore()}>
        <p data-testid="canvas-slot">the caller&apos;s canvas</p>
      </BuilderShell>
    );
    expect(screen.queryByText(/needs more width/i)).not.toBeNull();
    expect(screen.queryByRole("region", { name: "Canvas" })).toBeNull();

    act(() => {
      stubContainerFits(true);
    });

    expect(screen.queryByRole("region", { name: "Canvas" })).not.toBeNull();
    expect(screen.queryByText(/needs more width/i)).toBeNull();
  });

  it("keeps a portalling slot child from opening over the notice", () => {
    // `hidden` and `inert` only reach what renders INSIDE the wrapper. A dialog in a slot portals
    // to the document body and escapes both, so it would float over the narrow-screen notice,
    // fully interactive. The shell publishes its own answer instead, and the palette takes it as
    // its default — note NO `enabled` prop here, because a caller forced to pass one would be
    // re-deriving MIN_SHELL_WIDTH for itself.
    stubContainerFits(false);
    render(
      <BuilderShell onExit={vi.fn()} store={memoryStore()}>
        <CommandPalette
          commands={[{ id: "a", label: "Should stay hidden", run: () => {} }]}
        />
      </BuilderShell>
    );

    fireEvent.keyDown(document, { key: "k", metaKey: true });
    fireEvent.keyDown(document, { key: "k", ctrlKey: true });

    expect(screen.queryByText("Should stay hidden")).toBeNull();
  });

  it("keeps its own answer authoritative over an enabling prop", () => {
    // `enabled` NARROWS the shell's state rather than replacing it. A host passing a condition of
    // its own — `enabled={!readOnly}` — would otherwise re-enable the portalling palette on a
    // viewport where the shell has hidden everything else, which is the case it exists to cover.
    stubContainerFits(false);
    render(
      <BuilderShell onExit={vi.fn()} store={memoryStore()}>
        <CommandPalette
          commands={[{ id: "a", label: "Should stay hidden", run: () => {} }]}
          enabled
        />
      </BuilderShell>
    );

    fireEvent.keyDown(document, { key: "k", metaKey: true });
    fireEvent.keyDown(document, { key: "k", ctrlKey: true });

    expect(screen.queryByText("Should stay hidden")).toBeNull();
  });

  it("does not cycle regions while the editor is hidden", () => {
    // The slots stay mounted behind the notice, which leaves the F6 binding
    // registered over regions that are all `inert`. Left enabled it consumed the
    // key, focused nothing a person could see, and — where the host shares the
    // shortcut manager — took the keystroke from whatever binding of its own
    // would otherwise have handled it.
    stubContainerFits(false);
    render(
      <BuilderShell onExit={vi.fn()} store={memoryStore()}>
        <p data-testid="canvas-slot">the caller&apos;s canvas</p>
      </BuilderShell>
    );

    const exit = screen.getByRole("button", { name: "Exit editor" });
    exit.focus();
    expect(document.activeElement).toBe(exit);

    fireEvent.keyDown(document, { key: "F6" });

    // Focus has not been pulled into the hidden subtree. jsdom does not
    // implement `inert`, so nothing but the disabled binding stops it here —
    // which is exactly the property under test.
    expect(document.activeElement).toBe(exit);
  });

  it("keeps the class the caller positioned the shell with", () => {
    // The className is how the host places the shell in its own layout — a grid
    // area, a height, a border. Dropping it on this path let the notice escape
    // the box the shell had been given.
    stubContainerFits(false);
    const { container } = render(
      <BuilderShell
        onExit={vi.fn()}
        store={memoryStore()}
        className="host-placed-me"
      />
    );

    const notice = container.querySelector(".host-placed-me");
    expect(notice).not.toBeNull();
    expect(notice?.textContent).toMatch(/needs more width/i);
  });
});

describe("F6 while an editing control has focus", () => {
  it("moves between regions from inside a text field", () => {
    // The shortcut manager's default asks whether the first chord carries a
    // modifier or is Escape, and answers no for a bare function key — so F6 was
    // held back by any focused field. Moving between areas is exactly what an
    // author needs while a field has focus, because it is how they get back out
    // without reaching for the mouse.
    renderShell({
      children: <input data-testid="caption" aria-label="Caption" />,
    });

    const field = screen.getByTestId("caption") as HTMLInputElement;
    field.focus();
    expect(document.activeElement).toBe(field);

    fireEvent.keyDown(field, { key: "F6" });

    // Out of the field and onto a region. Which one depends on where the field
    // sits in the cycle; that it LEFT the field is the property under test.
    expect(document.activeElement).not.toBe(field);
    expect(
      (document.activeElement as HTMLElement | null)?.getAttribute("aria-label")
    ).toBeTruthy();
  });
});

describe("the preference store the caller supplies", () => {
  it("follows a store that is swapped for another", () => {
    // Capturing the caller's store in state pinned whichever one arrived first,
    // so a host that swaps stores — signing into a second workspace, promoting
    // a memory store to a persisted one — went on writing to the one it had
    // replaced.
    stubContainerFits(true);
    const first = memoryStore();
    const second = memoryStore();

    const { rerender } = render(
      <BuilderShell onExit={vi.fn()} store={first} />
    );
    rerender(<BuilderShell onExit={vi.fn()} store={second} />);

    fireEvent.click(screen.getByRole("button", { name: "Layers" }));

    expect(second.value).toContain("layers");
    expect(first.value).toBeNull();
  });
});

describe("switching between panels", () => {
  it("mounts the new panel rather than updating the old one", () => {
    // `renderPanel` is documented as keyed by the panel that is open, and
    // React's default reconciliation does not honour that: a caller rendering
    // one component for several panels puts the same element type at the same
    // position, so switching tools UPDATES that instance. Its state, its
    // effects and any uncontrolled input values follow the author from Layers
    // into Design, which is a different tool entirely.
    let mounts = 0;
    function Probe({ panel }: { panel: string }) {
      React.useEffect(() => {
        mounts += 1;
      }, []);
      return <p>{panel} panel</p>;
    }

    renderShell({ renderPanel: panel => <Probe panel={panel} /> });

    fireEvent.click(screen.getByRole("button", { name: "Layers" }));
    expect(mounts).toBe(1);

    fireEvent.click(screen.getByRole("button", { name: "Design" }));
    // A fresh mount, not the same instance handed a new prop. Asserted through
    // a mount-effect rather than through rendered text: the text changes either
    // way, so it cannot tell the two apart.
    expect(mounts).toBe(2);
  });
});

describe("F6 from a focused drag handle", () => {
  it("leaves the separator for the next region", () => {
    // The separators run their own key listener, and it claims F6: it cycles
    // between separators and calls `preventDefault()`. The shortcut manager
    // deliberately skips an already-prevented event, so the shell's region
    // binding never ran — and with one separator in the default topology, F6
    // re-focused the same handle for ever. That is the state an author is in
    // immediately after resizing anything.
    renderShell({ renderPanel: panel => <p>{panel} panel</p> });

    const separator = screen.getAllByRole("separator")[0];
    expect(separator).toBeDefined();
    if (separator === undefined) return;
    separator.focus();
    expect(document.activeElement).toBe(separator);

    fireEvent.keyDown(separator, { key: "F6" });

    // Off the handle and onto a region. Which region depends on where the
    // separator sits; that focus LEFT the separator is the property here.
    expect(document.activeElement).not.toBe(separator);
    expect(
      (document.activeElement as HTMLElement | null)?.getAttribute("aria-label")
    ).toBeTruthy();
  });

  it("recognises a separator built by another realm", () => {
    // The same press, with the shell rendered into an iframe's document. Its
    // separator carries that window's constructors, so a check made with this
    // realm's `HTMLElement` declines it and the handle keeps F6 for itself.
    stubContainerFits(true);
    const frame = document.createElement("iframe");
    document.body.appendChild(frame);
    // Removed however the test ends: a frame left holding focus would be the
    // active element for every case after this one.
    try {
      const inner = frame.contentDocument;
      if (inner === null) throw new Error("the iframe has no document");
      // The panel library builds its observer from the element's own window,
      // which jsdom gives none; the same driven stub as this realm's.
      Reflect.set(
        frame.contentWindow ?? {},
        "ResizeObserver",
        DrivenResizeObserver
      );
      const container = inner.createElement("div");
      inner.body.appendChild(container);
      render(<BuilderShell onExit={vi.fn()} store={memoryStore()} />, {
        container,
      });

      const separator = within(container).getAllByRole("separator")[0];
      expect(separator).toBeDefined();
      if (separator === undefined) return;
      // The control: the handle really is foreign to this realm.
      expect(separator instanceof HTMLElement).toBe(false);
      separator.focus();
      // Identity as a boolean: a failing `toBe` cannot print another realm's node.
      expect(inner.activeElement === separator).toBe(true);

      fireEvent.keyDown(separator, { key: "F6" });

      expect(inner.activeElement === separator).toBe(false);
      expect(inner.activeElement?.getAttribute("aria-label")).toBeTruthy();
    } finally {
      frame.remove();
    }
  });
});

describe("telling the host which zoom the shell is holding", () => {
  /**
   * A stored preference set carrying a NON-DEFAULT zoom.
   *
   * The value has to differ from the default for any assertion here to mean
   * something: a host told `fit` cannot tell the shell from a host that
   * assumed, so a case built on the default passes against a shell that
   * reports nothing at all. Stored in its PERSISTED form — a number, which is
   * what `writeZoom` emits — because a record carrying the runtime object is
   * rejected on read and restores the default, which is the value the case is
   * built to exclude.
   */
  const STORED = JSON.stringify({ ...DEFAULT_PREFERENCES, zoom: 1.5 });

  it("reports the stored zoom to a host that wires its handler LATE", () => {
    /*
     * A host can resolve `onZoomChange` from its own state, so the prop moves
     * from `undefined` to a function after the shell has already loaded its
     * preferences. Keyed on the value alone the effect does not re-run at that
     * moment, and the host draws its canvas at the default while the shell's
     * control reads 150%.
     */
    stubContainerFits(true);
    const store = memoryStore(STORED);
    const onZoomChange = vi.fn();
    const view = render(<BuilderShell onExit={vi.fn()} store={store} />);

    view.rerender(
      <BuilderShell
        onExit={vi.fn()}
        store={store}
        onZoomChange={onZoomChange}
      />
    );

    expect(onZoomChange).toHaveBeenCalledWith({ kind: "fixed", scale: 1.5 });
  });

  it("does not report again when only the handler's IDENTITY changed", () => {
    // The control. Reporting on identity would satisfy the case above while
    // closing a render loop around any host that writes its handler inline.
    stubContainerFits(true);
    const store = memoryStore(STORED);
    const reports: unknown[] = [];
    const view = render(
      <BuilderShell
        onExit={vi.fn()}
        store={store}
        onZoomChange={zoom => reports.push(zoom)}
      />
    );

    // The stored value, not the default: the shell reads its store in an
    // effect, so the mount report carries the default and the restore that
    // follows carries this. Asserting the LAST one keeps the case about the
    // value the shell settled on rather than about how many passes it took.
    const settled = reports.length;
    expect(reports.at(-1)).toEqual({ kind: "fixed", scale: 1.5 });

    view.rerender(
      <BuilderShell
        onExit={vi.fn()}
        store={store}
        onZoomChange={zoom => reports.push(zoom)}
      />
    );

    expect(reports).toHaveLength(settled);
  });
});

describe("where the notice region sits", () => {
  it("renders it inside a token scope, so its tokens resolve", () => {
    /*
     * Every `--nx-builder-*` token is declared on `.nx-builder-chrome` or on
     * `.nx-builder-tokens`, and custom properties inherit down but never
     * across. A region rendered outside both resolved its border, background
     * and text to nothing — a transparent box with host-default text, which in
     * dark mode is a failure message the author cannot read.
     *
     * Asserted as "has a token-declaring ancestor" rather than as a fixed
     * parent, because WHICH scope supplies them is a placement decision and the
     * placement is what the case below constrains. Pinning the parent here
     * would make the two cases contradict each other.
     *
     * The region is always mounted so a polite live region exists before its
     * content changes, which is what makes this assertable without provoking a
     * failure first.
     */
    render(<BuilderShell onExit={vi.fn()} store={memoryStore()} />);
    const region = document.querySelector(".nx-notices");
    expect(region).not.toBeNull();
    expect(
      region?.closest(".nx-builder-tokens, .nx-builder-chrome") ?? null
    ).not.toBeNull();
  });

  it("keeps it out of the subtree the shell makes inert when narrow", () => {
    /*
     * The failure this exists for. `hidden` and `inert` do not unmount, so a
     * notice region inside that wrapper stays mounted and goes on accepting
     * messages while being excluded from paint AND from the accessibility
     * tree. A refusal arriving as an author narrows the window then lands
     * somewhere no one can reach, and they leave believing the write happened.
     *
     * Asserted as REACHABILITY rather than as presence. A case checking only
     * that the region rendered passes on the broken placement, because the
     * broken placement renders it too.
     */
    stubContainerFits(false);
    render(<BuilderShell onExit={vi.fn()} store={memoryStore()} />);

    const suppressed = (node: Element | null): Element | null => {
      for (let at = node?.parentElement ?? null; at; at = at.parentElement) {
        if (at.hasAttribute("inert") || at.hasAttribute("hidden")) return at;
      }
      return null;
    };

    const region = document.querySelector(".nx-notices");
    expect(region).not.toBeNull();
    expect(suppressed(region)).toBeNull();

    /*
     * The control, and it has to be able to come out non-null or the assertion
     * above is satisfied by a render where nothing is suppressed at all — which
     * is exactly what a harness that failed to go narrow produces.
     *
     * The overlay host rather than `.nx-builder-chrome`: while narrow, the
     * narrow-width notice renders a chrome root of its own OUTSIDE the wrapper,
     * so the first match is a visible element and the control would fail while
     * the shell is behaving correctly. The overlay host has exactly one
     * instance and is deliberately inside the wrapper.
     */
    expect(
      suppressed(document.querySelector('[data-slot="builder-overlay-host"]'))
    ).not.toBeNull();
  });
});

describe("the device being edited", () => {
  /** A shell whose host asks for devices and records what the shell reports. */
  function deviceShell(store = memoryStore()) {
    stubContainerFits(true);
    const devices: Array<string | null> = [];
    const zooms: unknown[] = [];
    const shell = (
      request?: { breakpoint: string | null; count: number },
      extra: Partial<Parameters<typeof BuilderShell>[0]> = {}
    ) => (
      <BuilderShell
        onExit={vi.fn()}
        store={store}
        renderPanel={panel => <p>{panel} panel</p>}
        onZoomChange={zoom => zooms.push(zoom)}
        onEditingBreakpointChange={device => devices.push(device)}
        {...(request === undefined
          ? {}
          : { editingBreakpointRequest: request })}
        {...extra}
      />
    );
    const view = render(shell());
    return { store, devices, zooms, view, shell };
  }

  it("starts on the base breakpoint, and reports it", () => {
    const { devices } = deviceShell();
    expect(devices.at(-1)).toBeNull();
  });

  it("holds the device a host asks for, and reports it", () => {
    const { devices, view, shell, store } = deviceShell();
    view.rerender(shell({ breakpoint: "tablet", count: 1 }));
    expect(devices.at(-1)).toBe("tablet");
    expect(JSON.parse(store.value ?? "{}").editingBreakpoint).toBe("tablet");
  });

  it("restores the device the author left, before any request", () => {
    const { devices } = deviceShell(
      memoryStore(
        JSON.stringify({ ...DEFAULT_PREFERENCES, editingBreakpoint: "mobile" })
      )
    );
    expect(devices.at(-1)).toBe("mobile");
  });

  it("keeps the device when a panel opens or closes", () => {
    // The defect this guards: the device was read off the canvas's measured
    // width, so opening a panel narrowed the canvas and moved every edit to a
    // narrower breakpoint without the author choosing one.
    const { devices, view, shell } = deviceShell();
    view.rerender(shell({ breakpoint: "tablet", count: 1 }));
    const rail = screen.getByRole("navigation", { name: "Editor panels" });
    const layers = rail.querySelector<HTMLButtonElement>(
      '[data-panel="layers"]'
    );
    if (layers === null) throw new Error("no Layers item on the rail");
    fireEvent.click(layers);
    fireEvent.click(layers);
    expect(new Set(devices.slice(devices.indexOf("tablet")))).toEqual(
      new Set(["tablet"])
    );
  });

  it("goes back to fitting the canvas when the device changes", () => {
    const { zooms, view, shell } = deviceShell(
      memoryStore(JSON.stringify({ ...DEFAULT_PREFERENCES, zoom: 1.5 }))
    );
    view.rerender(shell({ breakpoint: "tablet", count: 1 }));
    expect(zooms.at(-1)).toEqual({ kind: "fit" });
  });

  it("keeps a chosen zoom when the same device is asked for again", () => {
    // Choosing the device already being edited is not a change of device, and
    // throwing away the author's zoom for it would be a surprise.
    const { zooms, view, shell } = deviceShell(
      memoryStore(
        JSON.stringify({
          ...DEFAULT_PREFERENCES,
          zoom: 1.5,
          editingBreakpoint: "tablet",
        })
      )
    );
    view.rerender(shell({ breakpoint: "tablet", count: 1 }));
    expect(zooms.at(-1)).toEqual({ kind: "fixed", scale: 1.5 });
  });
});

describe("zooming from the keyboard", () => {
  function zoomShell(stored: Record<string, unknown> = {}) {
    stubContainerFits(true);
    const zooms: unknown[] = [];
    render(
      <BuilderShell
        onExit={vi.fn()}
        store={memoryStore(
          JSON.stringify({ ...DEFAULT_PREFERENCES, ...stored })
        )}
        onZoomChange={zoom => zooms.push(zoom)}
      />
    );
    return zooms;
  }

  it("shows the page at actual size on mod+0", () => {
    const zooms = zoomShell();
    fireEvent.keyDown(document, { key: "0", ctrlKey: true, metaKey: false });
    fireEvent.keyDown(document, { key: "0", metaKey: true, ctrlKey: false });
    expect(zooms.at(-1)).toEqual({ kind: "fixed", scale: 1 });
  });

  it("lists fitting in Help under Shift+1 alone, not a second key cap for the same press", async () => {
    zoomShell({ zoom: 1.5 });
    fireEvent.click(
      within(
        screen.getByRole("navigation", { name: "Editor panels" })
      ).getByRole("button", { name: "Help" })
    );
    const dialog = await screen.findByRole("dialog");
    const row = within(dialog).getByText("Fit the page to the canvas");
    const caps = row.parentElement?.querySelectorAll("kbd") ?? [];
    expect([...caps].map(cap => cap.textContent)).toEqual(["Shift+1"]);
  });

  it("fits the canvas on Shift+1, whichever character the layout gives", () => {
    // On a US layout Shift+1 arrives as "!"; on layouts where the digit needs
    // Shift, it arrives as "1" with Shift held. Both mean the same press.
    const us = zoomShell({ zoom: 1.5 });
    fireEvent.keyDown(document, { key: "!", shiftKey: true });
    expect(us.at(-1)).toEqual({ kind: "fit" });
    cleanup();
    const azerty = zoomShell({ zoom: 1.5 });
    fireEvent.keyDown(document, { key: "1", shiftKey: true });
    expect(azerty.at(-1)).toEqual({ kind: "fit" });
  });

  it("zooms only the shell that holds focus when two are mounted", () => {
    // Two shells share one shortcut manager. The zoom keys must answer for
    // the shell the author is in, as F6 does, not for whichever registered
    // last.
    stubContainerFits(true);
    const first: unknown[] = [];
    const second: unknown[] = [];
    render(
      <BuilderShell
        onExit={vi.fn()}
        store={memoryStore()}
        onZoomChange={zoom => first.push(zoom)}
      />
    );
    render(
      <BuilderShell
        onExit={vi.fn()}
        store={memoryStore()}
        onZoomChange={zoom => second.push(zoom)}
      />
    );
    const [firstRail] = screen.getAllByRole("navigation", {
      name: "Editor panels",
    });
    firstRail?.focus();
    fireEvent.keyDown(document.activeElement ?? document, {
      key: "0",
      ctrlKey: true,
    });
    expect(first.at(-1)).toEqual({ kind: "fixed", scale: 1 });
    expect(second.at(-1)).toEqual({ kind: "fit" });
  });

  it("leaves Shift+1 to a text field, where it types a character", () => {
    // On a layout where the digit needs Shift, Shift+1 is how "1" is typed.
    // The field is inside the shell, so the focus check passes and only the
    // typing rule can keep the key; a field outside would pass by absence.
    stubContainerFits(true);
    const zooms: unknown[] = [];
    render(
      <BuilderShell
        onExit={vi.fn()}
        store={memoryStore(
          JSON.stringify({ ...DEFAULT_PREFERENCES, zoom: 1.5 })
        )}
        onZoomChange={zoom => zooms.push(zoom)}
        inspector={<input aria-label="A field in the inspector" />}
      />
    );
    const field = screen.getByRole("textbox", {
      name: "A field in the inspector",
    });
    field.focus();
    fireEvent.keyDown(field, { key: "1", shiftKey: true });
    fireEvent.keyDown(field, { key: "!", shiftKey: true });
    expect(zooms.at(-1)).toEqual({ kind: "fixed", scale: 1.5 });
  });
});

describe("hiding the side panels", () => {
  function sidesShell(stored: Record<string, unknown> = {}) {
    stubContainerFits(true);
    const store = memoryStore(
      JSON.stringify({ ...DEFAULT_PREFERENCES, ...stored })
    );
    const view = render(
      <BuilderShell
        onExit={vi.fn()}
        store={store}
        availablePanels={["add", "layers"]}
        renderPanel={panel => <p>{panel} panel</p>}
        inspector={<p>inspector body</p>}
      />
    );
    return { store, ...view };
  }
  const toggle = (name: RegExp) => screen.getByRole("button", { name });
  const stored = (store: { value: string | null }) =>
    JSON.parse(store.value ?? "{}") as Record<string, unknown>;

  it("hides and shows the inspector, and remembers it", () => {
    const { store } = sidesShell();
    expect(screen.getByText("inspector body")).toBeTruthy();
    expect(toggle(/^Inspector$/).getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(toggle(/^Inspector$/));

    expect(screen.queryByText("inspector body")).toBeNull();
    expect(
      screen.queryByRole("complementary", { name: "Inspector" })
    ).toBeNull();
    expect(toggle(/^Inspector$/).getAttribute("aria-pressed")).toBe("false");
    expect(stored(store).inspectorHidden).toBe(true);
  });

  it("restores a hidden inspector when nothing else differs from the defaults", () => {
    sidesShell({ inspectorHidden: true });
    expect(screen.queryByText("inspector body")).toBeNull();
    expect(toggle(/^Inspector$/).getAttribute("aria-pressed")).toBe("false");
  });

  it("hides the left panel without forgetting which one was open", () => {
    const { store } = sidesShell({ leftPanel: "layers" });
    expect(screen.getByText("layers panel")).toBeTruthy();

    fireEvent.click(toggle(/^Left panel$/));
    expect(screen.queryByText("layers panel")).toBeNull();
    expect(stored(store)).toMatchObject({
      leftPanel: "layers",
      leftPanelHidden: true,
    });

    fireEvent.click(toggle(/^Left panel$/));
    expect(screen.getByText("layers panel")).toBeTruthy();
  });

  it("opens Add when the left panel is shown with none chosen", () => {
    sidesShell({ leftPanel: null, leftPanelHidden: true });
    fireEvent.click(toggle(/^Left panel$/));
    expect(screen.getByText("add panel")).toBeTruthy();
  });

  it("shows the left side again when the rail is used while it is hidden", () => {
    sidesShell({ leftPanel: "layers", leftPanelHidden: true });
    const rail = screen.getByRole("navigation", { name: "Editor panels" });
    const add = rail.querySelector<HTMLButtonElement>('[data-panel="add"]');
    if (add === null) throw new Error("no Add item on the rail");
    fireEvent.click(add);
    expect(screen.getByText("add panel")).toBeTruthy();
  });

  it("hides both sides on mod+\\, and shows both again", () => {
    const { store } = sidesShell({ leftPanel: "layers" });
    fireEvent.keyDown(document, { key: "\\", ctrlKey: true });
    expect(screen.queryByText("layers panel")).toBeNull();
    expect(screen.queryByText("inspector body")).toBeNull();
    expect(stored(store)).toMatchObject({
      leftPanelHidden: true,
      inspectorHidden: true,
    });

    fireEvent.keyDown(document, { key: "\\", ctrlKey: true });
    expect(screen.getByText("layers panel")).toBeTruthy();
    expect(screen.getByText("inspector body")).toBeTruthy();
  });

  it("hides both when only one is showing", () => {
    sidesShell({ leftPanel: "layers", leftPanelHidden: true });
    fireEvent.keyDown(document, { key: "\\", ctrlKey: true });
    expect(screen.queryByText("inspector body")).toBeNull();
  });

  it("draws no left panel button when the host offers no left panel", () => {
    // With nothing to show there, the button could only do nothing.
    stubContainerFits(true);
    render(
      <BuilderShell
        onExit={vi.fn()}
        store={memoryStore()}
        availablePanels={[]}
        inspector={<p>inspector body</p>}
      />
    );
    expect(screen.queryByRole("button", { name: /^Left panel$/ })).toBeNull();
    expect(toggle(/^Inspector$/)).toBeTruthy();
  });

  it("opens the first panel the host offers when it offers no Add", () => {
    // Shown with none chosen, the left side has to open something the rail
    // offers, or the button would stay unpressed and nothing would open.
    stubContainerFits(true);
    render(
      <BuilderShell
        onExit={vi.fn()}
        store={memoryStore(
          JSON.stringify({ ...DEFAULT_PREFERENCES, leftPanel: null })
        )}
        availablePanels={["layers"]}
        renderPanel={panel => <p>{panel} panel</p>}
      />
    );
    fireEvent.click(toggle(/^Left panel$/));
    expect(screen.getByText("layers panel")).toBeTruthy();
    expect(toggle(/^Left panel$/).getAttribute("aria-pressed")).toBe("true");

    // mod+\ brings both sides back to the same panel.
    fireEvent.keyDown(document, { key: "\\", ctrlKey: true });
    expect(screen.queryByText("layers panel")).toBeNull();
    fireEvent.keyDown(document, { key: "\\", ctrlKey: true });
    expect(screen.getByText("layers panel")).toBeTruthy();
  });

  it("keeps mod+\\ working from inside a side it hides, with two editors on the page", () => {
    // Hiding the side that holds focus would drop focus to the page body,
    // where neither of two editors claims the key, so the second press
    // could not bring the sides back.
    stubContainerFits(true);
    const shell = (label: string) => (
      <BuilderShell
        onExit={vi.fn()}
        store={memoryStore(
          JSON.stringify({ ...DEFAULT_PREFERENCES, leftPanel: "add" })
        )}
        availablePanels={["add"]}
        renderPanel={() => <p>{label} add panel</p>}
        inspector={<button type="button">{label} inspector control</button>}
      />
    );
    render(shell("first"));
    render(shell("second"));
    screen.getByRole("button", { name: "first inspector control" }).focus();

    fireEvent.keyDown(document.activeElement ?? document, {
      key: "\\",
      ctrlKey: true,
    });
    expect(screen.queryByText("first inspector control")).toBeNull();
    expect(screen.getByText("second inspector control")).toBeTruthy();

    fireEvent.keyDown(document.activeElement ?? document, {
      key: "\\",
      ctrlKey: true,
    });
    expect(screen.getByText("first inspector control")).toBeTruthy();
    expect(screen.getByText("first add panel")).toBeTruthy();
  });

  it("leaves mod+\\ to a text field inside the editor", () => {
    // Inside the shell, so the focus check passes and only the typing rule
    // can keep the key: a backslash typed into a field is text.
    stubContainerFits(true);
    render(
      <BuilderShell
        onExit={vi.fn()}
        store={memoryStore()}
        inspector={<input aria-label="A field in the inspector" />}
      />
    );
    const field = screen.getByRole("textbox", {
      name: "A field in the inspector",
    });
    field.focus();
    fireEvent.keyDown(field, { key: "\\", ctrlKey: true });
    expect(
      screen.getByRole("textbox", { name: "A field in the inspector" })
    ).toBeTruthy();
  });
});

describe("the top bar's three columns", () => {
  it("places the host's start, centre and end content, and its own controls, in their columns", () => {
    stubContainerFits(true);
    render(
      <BuilderShell
        onExit={vi.fn()}
        store={memoryStore()}
        title="About us"
        topBar={<span>start content</span>}
        topBarCenter={<span>centre content</span>}
        topBarEnd={<span>end content</span>}
        onZoomChange={vi.fn()}
      />
    );
    const column = (name: string) =>
      document.querySelector<HTMLElement>(`[data-topbar="${name}"]`);
    const start = column("start");
    const centre = column("centre");
    const end = column("end");
    expect(start?.textContent).toContain("About us");
    expect(start?.textContent).toContain("start content");
    expect(start?.querySelector('[aria-label="Exit editor"]')).not.toBeNull();
    expect(centre?.textContent).toContain("centre content");
    expect(centre?.querySelector(".nx-zoom-control")).not.toBeNull();
    expect(end?.textContent).toContain("end content");
    expect(end?.querySelector('[aria-label="Inspector"]')).not.toBeNull();
  });

  it("ends on the host's actions: the panel buttons come first, then a rule", () => {
    // The accepted layout ends the bar on the action that leads, so the panel
    // buttons sit before the document's controls rather than after them.
    stubContainerFits(true);
    render(
      <BuilderShell
        onExit={vi.fn()}
        store={memoryStore()}
        title="About us"
        topBarEnd={<button type="button">Publish</button>}
        onZoomChange={vi.fn()}
      />
    );
    const end = document.querySelector<HTMLElement>('[data-topbar="end"]');
    const names = Array.from(end?.querySelectorAll("button") ?? []).map(
      button => button.getAttribute("aria-label") ?? button.textContent
    );
    expect(names).toEqual(["Left panel", "Inspector", "Publish"]);
    const publish = screen.getByRole("button", { name: "Publish" });
    expect(publish.previousElementSibling?.getAttribute("aria-hidden")).toBe(
      "true"
    );
  });

  it.each([
    ["no end content", undefined],
    ["an empty conditional slot", null],
    ["a false condition", false],
  ])("draws no rule for %s", (_name, topBarEnd) => {
    stubContainerFits(true);
    render(
      <BuilderShell
        onExit={vi.fn()}
        store={memoryStore()}
        title="About us"
        topBarEnd={topBarEnd}
        onZoomChange={vi.fn()}
      />
    );
    const end = document.querySelector<HTMLElement>('[data-topbar="end"]');
    expect(end?.querySelector('[aria-hidden="true"].w-px')).toBeNull();
  });

  it("truncates a long title rather than pushing the centre column", () => {
    stubContainerFits(true);
    render(
      <BuilderShell
        onExit={vi.fn()}
        store={memoryStore()}
        title="A page title long enough to run into the device buttons"
      />
    );
    const title = screen.getByText(
      "A page title long enough to run into the device buttons"
    );
    expect(title.className).toContain("truncate");
    expect(title.getAttribute("title")).toBe(
      "A page title long enough to run into the device buttons"
    );
  });
});

describe("the shell's keys inside the canvas's frame", () => {
  /** A binding registered from inside the shell, on the shell's own manager. */
  function Binding({ onPress }: { onPress: () => void }): null {
    useShortcuts(
      [
        {
          keys: "mod+s",
          description: "Save",
          // Not prevented, so a listener installed twice would run it twice.
          preventDefault: false,
          run: () => onPress(),
        },
      ],
      { name: "Test binding" }
    );
    return null;
  }

  it("hears a key pressed in the frame's document, through the one manager", () => {
    // A key pressed with focus inside the frame is dispatched in the frame's
    // document. The binding sits in a slot, so it is registered on whatever
    // manager the shell provides: firing proves the SHELL's manager listens in
    // the frame, rather than a second one built there.
    const frame = document.createElement("iframe");
    document.body.append(frame);
    const inner = frame.contentDocument;
    if (inner === null) throw new Error("no frame document");
    expect(inner).not.toBe(document);
    stubContainerFits(true);
    const onPress = vi.fn();
    render(
      <CanvasFrameProvider frame={frame}>
        <BuilderShell onExit={vi.fn()} store={memoryStore()}>
          <Binding onPress={onPress} />
        </BuilderShell>
      </CanvasFrameProvider>
    );
    fireEvent.keyDown(inner, { key: "s", ctrlKey: true, metaKey: false });
    fireEvent.keyDown(inner, { key: "s", metaKey: true, ctrlKey: false });
    expect(onPress).toHaveBeenCalledTimes(1);
    frame.remove();
  });
});

describe("the canvas region around a canvas in a frame", () => {
  it("hands focus on into the frame, and is no tab stop of its own", () => {
    /*
     * F6 focuses the canvas region; the page is in the frame, so focus has to
     * go on into it. A region that stayed a tab stop as well would trap Tab:
     * Shift+Tab out of the frame would land on it and be sent straight back.
     */
    const frame = document.createElement("iframe");
    stubContainerFits(true);
    const { getByRole } = render(
      <CanvasFrameProvider frame={frame}>
        <BuilderShell onExit={vi.fn()} store={memoryStore()}>
          <span />
        </BuilderShell>
      </CanvasFrameProvider>
    );
    const region = getByRole("region", { name: "Canvas" });
    // The frame inside the region, as `CanvasFrame` draws it there.
    region.append(frame);
    expect(region.tabIndex).toBe(-1);
    act(() => region.focus());
    expect(document.activeElement).toBe(frame);
  });

  it("is a tab stop of its own while the painted frame overflows it, so the keyboard can scroll it", () => {
    /*
     * At a zoom past the region, the region itself scrolls the painted frame,
     * and arrow keys inside the frame scroll only the frame's own page. So
     * while it overflows, the region keeps focus when it gets it, and Tab goes
     * on into the frame from there.
     */
    vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockReturnValue(2000);
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(800);
    const frame = document.createElement("iframe");
    stubContainerFits(true);
    const { getByRole } = render(
      <CanvasFrameProvider frame={frame}>
        <BuilderShell onExit={vi.fn()} store={memoryStore()}>
          <span />
        </BuilderShell>
      </CanvasFrameProvider>
    );
    const region = getByRole("region", { name: "Canvas" });
    region.append(frame);
    expect(region.tabIndex).toBe(0);
    act(() => region.focus());
    expect(document.activeElement).toBe(region);
    vi.restoreAllMocks();
  });

  it("stays a tab stop over a canvas in the editor's own document", () => {
    stubContainerFits(true);
    const { getByRole } = render(
      <BuilderShell onExit={vi.fn()} store={memoryStore()}>
        <span />
      </BuilderShell>
    );
    const region = getByRole("region", { name: "Canvas" });
    expect(region.tabIndex).toBe(0);
    act(() => region.focus());
    expect(document.activeElement).toBe(region);
  });
});
