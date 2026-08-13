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
import * as React from "react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BuilderShell } from "./builder-shell";
import { CommandPalette } from "./command-palette";
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
    stubViewport(true);
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
      screen.getByRole("main", { name: "Canvas" })
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
    stubViewport(false);
    render(
      <BuilderShell onExit={vi.fn()} store={memoryStore()}>
        <p data-testid="canvas-slot">the caller&apos;s canvas</p>
      </BuilderShell>
    );

    expect(screen.getByText(/needs a wider screen/i)).toBeTruthy();
    expect(screen.queryByTestId("canvas-slot")).not.toBeNull();
  });

  it("hides that subtree from pointer, keyboard and assistive technology", () => {
    // The positive control for the test above. Keeping the slots mounted is
    // only correct while they are also unreachable — a tab order that runs
    // through an editor nobody can see is worse than the unmount was.
    stubViewport(false);
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
    expect(screen.queryByRole("main", { name: "Canvas" })).toBeNull();
  });

  it("keeps a portalling slot child from opening over the notice", () => {
    // `hidden` and `inert` only reach what renders INSIDE the wrapper. A dialog in a slot portals
    // to the document body and escapes both, so it would float over the narrow-screen notice,
    // fully interactive. The shell publishes its own answer instead, and the palette takes it as
    // its default — note NO `enabled` prop here, because a caller forced to pass one would be
    // re-deriving MIN_SHELL_WIDTH for itself.
    stubViewport(false);
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

  it("does not cycle regions while the editor is hidden", () => {
    // The slots stay mounted behind the notice, which leaves the F6 binding
    // registered over regions that are all `inert`. Left enabled it consumed the
    // key, focused nothing a person could see, and — where the host shares the
    // shortcut manager — took the keystroke from whatever binding of its own
    // would otherwise have handled it.
    stubViewport(false);
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
    stubViewport(false);
    const { container } = render(
      <BuilderShell
        onExit={vi.fn()}
        store={memoryStore()}
        className="host-placed-me"
      />
    );

    const notice = container.querySelector(".host-placed-me");
    expect(notice).not.toBeNull();
    expect(notice?.textContent).toMatch(/needs a wider screen/i);
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
    stubViewport(true);
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
