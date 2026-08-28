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
} from "@testing-library/react";
import * as React from "react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BuilderShell } from "./builder-shell";
import { CommandPalette } from "./command-palette";
import {
  DEFAULT_PREFERENCES,
  EMPTY_ELEMENTS_ATTRIBUTE,
  fitsFullShell,
  MIN_SHELL_WIDTH,
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
  it("shows them, disabled, rather than opening an empty region", () => {
    // Hiding them would make the rail change shape under an author as features
    // land. Opening one is worse: it reserves a panel and shrinks the canvas to
    // display nothing, which reads as a broken control rather than a missing one.
    renderShell({ availablePanels: ["insert"] });

    const layers = screen.getByRole("button", { name: /^Layers/ });
    expect((layers as HTMLButtonElement).disabled).toBe(true);
  });

  it("says why, rather than presenting a dead control", () => {
    renderShell({ availablePanels: ["insert"] });

    expect(
      screen.getByRole("button", { name: "Layers — coming soon" })
    ).toBeTruthy();
  });

  it("leaves a panel the host CAN fill fully operable", () => {
    // The positive control. Without it, a shell that disabled every rail button
    // would satisfy both assertions above perfectly.
    renderShell({
      availablePanels: ["insert"],
      renderPanel: panel => <p>{panel} panel</p>,
    });

    const insert = screen.getByRole("button", { name: "Insert" });
    expect((insert as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(insert);
    expect(screen.getByText("insert panel")).toBeTruthy();
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
        availablePanels={["insert"]}
        renderPanel={panel => <p>{panel} panel</p>}
      />
    );

    expect(screen.queryByText("layers panel")).toBeNull();
  });

  it("treats every panel as available when the host says nothing", () => {
    // Omitting the prop must not silently disable the whole rail for hosts that
    // fill all of them.
    renderShell();

    expect(
      (screen.getByRole("button", { name: "Layers" }) as HTMLButtonElement)
        .disabled
    ).toBe(false);
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
    fireEvent.click(screen.getByRole("button", { name: "Tokens" }));

    expect(screen.getByText("tokens panel")).toBeTruthy();
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

describe("opening the insert panel from outside the shell", () => {
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
    expect(screen.queryByText("insert panel")).toBeNull();

    rerender(
      <BuilderShell
        onExit={vi.fn()}
        store={store}
        renderPanel={panel => <p>{panel} panel</p>}
        openInsertPanelToken={1}
      />
    );

    expect(screen.getByText("insert panel")).toBeTruthy();
  });

  it("does not close an already-open insert panel when the effect first applies its token", () => {
    // The rail's own click handler TOGGLES: a second press on the same item
    // closes the panel. Forcing the panel open must not inherit that —
    // pressing the canvas control again for the same container must never
    // read as "hide it".
    //
    // The panel is opened by a RAIL CLICK here, deliberately not by an
    // earlier token — from `leftPanel: null`, a correct force-set and a
    // buggy `panelAfterRailClick(current, "insert")` both land on
    // `"insert"`, so a fixture starting closed cannot tell them apart. Only
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
    fireEvent.click(screen.getByRole("button", { name: "Insert" }));
    expect(screen.getByText("insert panel")).toBeTruthy();

    // The token's FIRST value, applied against a panel already open by the
    // rail rather than by a previous token — so the once-per-token guard is
    // not what is standing between this render and the effect running.
    rerender(
      <BuilderShell
        onExit={vi.fn()}
        store={store}
        renderPanel={panel => <p>{panel} panel</p>}
        openInsertPanelToken={1}
      />
    );

    expect(screen.getByText("insert panel")).toBeTruthy();
  });

  it("reopens on a NEW token after the author closed the panel by hand", () => {
    stubContainerFits(true);
    const store = memoryStore();
    const { rerender } = render(
      <BuilderShell
        onExit={vi.fn()}
        store={store}
        renderPanel={panel => <p>{panel} panel</p>}
        openInsertPanelToken={1}
      />
    );
    expect(screen.getByText("insert panel")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Insert" }));
    expect(screen.queryByText("insert panel")).toBeNull();

    rerender(
      <BuilderShell
        onExit={vi.fn()}
        store={store}
        renderPanel={panel => <p>{panel} panel</p>}
        openInsertPanelToken={2}
      />
    );

    expect(screen.getByText("insert panel")).toBeTruthy();
  });

  it("keeps every stored preference when a token is already set at mount", () => {
    /*
     * The store is READ in an effect, so on the mount pass the restored record
     * has only been scheduled: the newest preferences this shell has seen are
     * still the defaults. A token applied there computes its write from those
     * defaults and persists them, so the author's panel widths and their
     * `showEmptyElements` are gone — from the store and from the state — while
     * the panel they asked for opens and everything on screen looks right.
     *
     * Every stored field is asserted, plus the panel: a test asserting only
     * that the panel opened passes against exactly that loss, and one
     * asserting only the record passes against a token that never applies at
     * all. `showEmptyElements` is additionally read off the chrome attribute,
     * because the store and the state are two separate casualties and the
     * record alone cannot tell them apart.
     */
    stubContainerFits(true);
    const layouts = { "canvas,panel": { canvas: 3, panel: 1 } };
    const store = memoryStore(
      JSON.stringify({
        ...DEFAULT_PREFERENCES,
        leftPinned: false,
        showEmptyElements: false,
        layouts,
      })
    );

    render(
      <BuilderShell
        onExit={vi.fn()}
        store={store}
        renderPanel={panel => <p>{panel} panel</p>}
        openInsertPanelToken={1}
      />
    );

    expect(screen.getByText("insert panel")).toBeTruthy();
    // Queried rather than assumed present: a selector that matched nothing
    // would make the attribute assertion pass on `undefined`.
    const chrome = document.querySelector(".nx-builder-chrome");
    expect(chrome).not.toBeNull();
    expect(chrome?.getAttribute(EMPTY_ELEMENTS_ATTRIBUTE)).toBe("hidden");
    expect(JSON.parse(store.value as string)).toMatchObject({
      leftPanel: "insert",
      leftPinned: false,
      showEmptyElements: false,
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
        openInsertPanelToken={1}
      />
    );

    expect(screen.getByText("insert panel")).toBeTruthy();
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
     * `showEmptyElements` replace another's. A count of reads cannot see this:
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
        leftPinned: false,
        showEmptyElements: false,
        layouts: firstLayouts,
      })
    );
    const second = memoryStore(
      JSON.stringify({
        ...DEFAULT_PREFERENCES,
        leftPinned: true,
        showEmptyElements: true,
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
    expect(document.querySelector(".nx-builder-chrome")).not.toBeNull();
    expect(
      document
        .querySelector(".nx-builder-chrome")
        ?.getAttribute(EMPTY_ELEMENTS_ATTRIBUTE)
    ).toBe("hidden");

    rerender(
      <BuilderShell
        onExit={vi.fn()}
        store={second}
        renderPanel={panel => <p>{panel} panel</p>}
        openInsertPanelToken={1}
      />
    );

    expect(screen.getByText("insert panel")).toBeTruthy();
    expect(JSON.parse(second.value as string)).toMatchObject({
      leftPanel: "insert",
      leftPinned: true,
      showEmptyElements: true,
      layouts: secondLayouts,
    });
    // The state the author sees, not only the bytes: the attribute is absent
    // when empty containers are shown, so the outgoing store's `false` reaching
    // this render would put it back.
    expect(
      document
        .querySelector(".nx-builder-chrome")
        ?.getAttribute(EMPTY_ELEMENTS_ATTRIBUTE)
    ).toBeNull();
  });

  it("does not reopen a manually closed panel when the SAME token survives an unrelated effect re-run", () => {
    // `update`'s identity follows the `store` prop (documented on `store`
    // above: a host swapping stores is expected to hand over a new object),
    // so a re-render that swaps stores re-runs this effect even though the
    // TOKEN did not change. The regression this guards: without the
    // once-per-token guard, that re-run would reapply "insert" over a manual
    // close it had nothing to do with.
    //
    // A `className` change was tried here first and did not exercise this at
    // all — neither `openInsertPanelToken` nor `update` depends on it, so the
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
        openInsertPanelToken={1}
      />
    );
    expect(screen.getByText("insert panel")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Insert" }));
    expect(screen.queryByText("insert panel")).toBeNull();

    // A DIFFERENT store object reading the same backing value — `update`
    // changes identity, `openInsertPanelToken` does not.
    rerender(
      <BuilderShell
        onExit={vi.fn()}
        store={storeOverBacking()}
        renderPanel={panel => <p>{panel} panel</p>}
        openInsertPanelToken={1}
      />
    );

    expect(screen.queryByText("insert panel")).toBeNull();
  });
});

describe("preferences", () => {
  it("writes the open panel through the store, not to localStorage", () => {
    // The port is what lets these become durable server-side prefs later. A
    // component reaching for `localStorage` makes that a rewrite.
    const store = memoryStore();
    stubContainerFits(true);
    render(<BuilderShell onExit={vi.fn()} store={store} />);

    fireEvent.click(screen.getByRole("button", { name: "Tokens" }));

    expect(store.value).not.toBeNull();
    expect(JSON.parse(store.value as string)).toMatchObject({
      leftPanel: "tokens",
    });
  });

  it("restores the panel that was open when the editor was last left", () => {
    const store = memoryStore(
      JSON.stringify({ ...DEFAULT_PREFERENCES, leftPanel: "fonts" })
    );
    stubContainerFits(true);
    render(
      <BuilderShell
        onExit={vi.fn()}
        store={store}
        renderPanel={panel => <p>{panel} panel</p>}
      />
    );

    expect(screen.getByText("fonts panel")).toBeTruthy();
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

    fireEvent.click(screen.getByRole("button", { name: "Tokens" }));
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

  it("restores a stored showEmptyElements even when every other field matches the default", () => {
    // The restore-on-load effect gates on `shallowEqualPreferences`, which
    // compares fields one at a time. A field that comparator does not name
    // reads as "unchanged" for any two records differing only in it — so a
    // fresh session, with no panel ever opened and no layout ever dragged,
    // matches the default on every field THIS store record sets except this
    // one, and is exactly the case where a missing clause drops it silently.
    const store = memoryStore(
      JSON.stringify({ ...DEFAULT_PREFERENCES, showEmptyElements: false })
    );
    stubContainerFits(true);
    render(<BuilderShell onExit={vi.fn()} store={store} />);

    // Queried rather than assumed present: a selector that matched nothing
    // would make the attribute assertion below pass on `undefined`, which is
    // not the property under test.
    const chrome = document.querySelector(".nx-builder-chrome");
    expect(chrome).not.toBeNull();
    expect(chrome?.getAttribute(EMPTY_ELEMENTS_ATTRIBUTE)).toBe("hidden");
  });

  it("offers a labelled control for showEmptyElements, reflecting its state", () => {
    // By NAME and by role, the same way the exit button above is asserted —
    // an unlabelled control for a visibility affordance would repeat the exact
    // failure this feature exists to fix.
    renderShell();

    const toggle = screen.getByRole("switch", {
      name: "Show empty containers",
    });
    expect(toggle.getAttribute("aria-checked")).toBe("true");
  });

  it("writes showEmptyElements through the store when the control is toggled", () => {
    const store = memoryStore();
    stubContainerFits(true);
    render(<BuilderShell onExit={vi.fn()} store={store} />);

    fireEvent.click(
      screen.getByRole("switch", { name: "Show empty containers" })
    );

    expect(store.value).not.toBeNull();
    expect(JSON.parse(store.value as string)).toMatchObject({
      showEmptyElements: false,
    });
  });

  it("does not re-invoke onShowEmptyElementsChange when only the host's callback identity changes", () => {
    // A host wires this the conventional way — an inline callback recreated
    // on every one of ITS OWN renders — and if the effect reporting this
    // preference depended on that identity, a rerender with nothing else
    // changed would call the new callback anyway. Chained with a host whose
    // own state update is itself a fresh render (`setState(c => ({ ...c }))`
    // always produces a new object), that is a render loop; this asserts the
    // narrower, safely-testable half of it: identity churn alone must not
    // re-invoke the callback.
    const store = memoryStore();
    stubContainerFits(true);
    const first = vi.fn();
    const { rerender } = render(
      <BuilderShell
        onExit={vi.fn()}
        store={store}
        onShowEmptyElementsChange={first}
      />
    );
    expect(first).toHaveBeenCalledTimes(1);
    expect(first).toHaveBeenCalledWith(true);

    const second = vi.fn();
    rerender(
      <BuilderShell
        onExit={vi.fn()}
        store={store}
        onShowEmptyElementsChange={second}
      />
    );
    expect(second).not.toHaveBeenCalled();

    // Toggling the preference must still reach the LATEST callback, proving
    // the ref is read fresh rather than pinned to the first render's closure.
    fireEvent.click(
      screen.getByRole("switch", { name: "Show empty containers" })
    );
    expect(second).toHaveBeenCalledWith(false);
    expect(first).toHaveBeenCalledTimes(1);
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
    fireEvent.click(screen.getByRole("button", { name: "Insert" }));

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
      JSON.stringify({ ...DEFAULT_PREFERENCES, leftPanel: "fonts" })
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
    expect(markup).toContain('aria-pressed="false"');
    expect(markup).not.toContain('aria-pressed="true"');
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

    expect(document.activeElement).toBe(
      screen.getByRole("navigation", { name: "Editor panels" })
    );
  });

  it("answers from the chrome header, which is in no region", () => {
    // The header holds the exit button and whatever the host puts in the top
    // bar — the breakpoint switcher, here — and it is a SIBLING of the region
    // container rather than inside one. Asking the regions who owns the key
    // therefore rejected the shell from its own chrome, so F6 did nothing
    // while focus sat on a control that is plainly inside the editor.
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

    expect(document.activeElement).toBe(
      screen.getByRole("navigation", { name: "Editor panels" })
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

    expect(document.activeElement).toBe(rails[0]);
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
    // into Tokens, which is a different tool entirely.
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

    fireEvent.click(screen.getByRole("button", { name: "Tokens" }));
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
