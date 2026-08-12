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
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BuilderShell } from "./builder-shell";
import { DEFAULT_PREFERENCES, type PreferenceStore } from "./shell-state";

afterEach(cleanup);

/**
 * `react-resizable-panels` measures its group with a `ResizeObserver`, which
 * jsdom does not implement. Stubbed as an inert observer rather than one that
 * reports sizes: a fake that invented dimensions would let a layout assertion
 * pass against numbers this file made up, which is the failure these tests are
 * written to avoid. The panels mount; their SIZES are Playwright's to check.
 */
class InertResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", InertResizeObserver);

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
 * jsdom has no `matchMedia`, and the shell asks it whether the viewport can
 * carry the full layout. Stubbed to the supported case so the tests exercise
 * the shell rather than the narrow-viewport message; the one test that wants
 * the other answer stubs it itself.
 */
function stubViewport(matches: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }))
  );
}

function renderShell(props: Partial<Parameters<typeof BuilderShell>[0]> = {}) {
  stubViewport(true);
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
    expect(screen.getByRole("main", { name: "Canvas" })).toBeTruthy();
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

describe("preferences", () => {
  it("writes the open panel through the store, not to localStorage", () => {
    // The port is what lets these become durable server-side prefs later. A
    // component reaching for `localStorage` makes that a rewrite.
    const store = memoryStore();
    stubViewport(true);
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
    stubViewport(true);
    render(
      <BuilderShell
        onExit={vi.fn()}
        store={store}
        renderPanel={panel => <p>{panel} panel</p>}
      />
    );

    expect(screen.getByText("fonts panel")).toBeTruthy();
  });

  it("opens no panel when a stored one no longer exists", () => {
    // A preference outlives the release that wrote it. Restoring a removed
    // panel leaves a region rendering nothing, with no obvious way back.
    const store = memoryStore(JSON.stringify({ leftPanel: "history" }));
    stubViewport(true);
    render(
      <BuilderShell
        onExit={vi.fn()}
        store={store}
        renderPanel={panel => <p>{panel} panel</p>}
      />
    );

    expect(screen.queryByText(/panel$/)).toBeNull();
  });
});

describe("a viewport too narrow for the shell", () => {
  it("says where to edit instead of compressing", () => {
    // An editor that merely gets cramped is worse than one that says it needs a
    // wider screen: the author otherwise discovers the limit by failing a task.
    stubViewport(false);
    render(<BuilderShell onExit={vi.fn()} store={memoryStore()} />);

    expect(screen.getByText(/needs a wider screen/i)).toBeTruthy();
    expect(screen.queryByRole("main", { name: "Canvas" })).toBeNull();
  });

  it("still offers a way out", () => {
    // The one control that must survive every degraded state: an author who
    // opened the editor on a narrow screen has to be able to leave it.
    stubViewport(false);
    const onExit = vi.fn();
    render(<BuilderShell onExit={onExit} store={memoryStore()} />);

    fireEvent.click(screen.getByRole("button", { name: "Exit editor" }));
    expect(onExit).toHaveBeenCalledTimes(1);
  });
});
