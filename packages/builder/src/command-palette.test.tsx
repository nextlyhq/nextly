// @vitest-environment jsdom
/**
 * What the palette DECIDES, not how it looks.
 *
 * jsdom applies no stylesheet and reports every element as zero-sized, so an assertion about the
 * dialog's width or its overlay would pass whatever the CSS does. What is genuinely decidable
 * here: which commands are offered, in what order, what running one does to the dialog, and that
 * the hotkey reaches the palette at all.
 *
 * Every case below is reachable only because commands are DATA. Mounting an editor to test that a
 * disabled command is hidden would make the test about the editor.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ShortcutProvider } from "@nextlyhq/ui";

import { CommandPalette, type BuilderCommand } from "./command-palette";

afterEach(cleanup);

/**
 * cmdk measures its list with a `ResizeObserver`, which jsdom does not implement. Stubbed as an
 * INERT observer rather than one reporting sizes: a fake that invented dimensions would let a
 * layout assertion pass against numbers this file made up. Nothing here asserts a size — which
 * commands are offered does not depend on how tall the list is.
 */
class InertResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", InertResizeObserver);

/**
 * cmdk scrolls the highlighted row into view; jsdom has no layout, so the method does not exist.
 * Inert for the same reason as the observer — there is nothing to scroll, and a stub that recorded
 * calls would tempt an assertion about scrolling that jsdom cannot honestly answer.
 */
Element.prototype.scrollIntoView = function scrollIntoView() {};

/** The palette needs an owner for its binding; the shell supplies one in real use. */
function mount(ui: React.ReactElement) {
  return render(<ShortcutProvider>{ui}</ShortcutProvider>);
}

/** `mod` is Meta on Apple platforms and Control elsewhere; jsdom reports neither, so send both. */
function pressPaletteKey() {
  fireEvent.keyDown(document, { key: "k", metaKey: true });
  fireEvent.keyDown(document, { key: "k", ctrlKey: true });
}

const noop = () => {};

describe("the palette offers what the host gives it", () => {
  it("opens on the hotkey and lists the commands", () => {
    mount(
      <CommandPalette
        commands={[
          { id: "a", label: "Toggle the outline", run: noop },
          { id: "b", label: "Exit the editor", run: noop },
        ]}
      />
    );

    // Closed to begin with: a palette that mounted open would steal focus on every page load.
    expect(screen.queryByText("Toggle the outline")).toBeNull();

    pressPaletteKey();

    expect(screen.getByText("Toggle the outline")).toBeTruthy();
    expect(screen.getByText("Exit the editor")).toBeTruthy();
  });

  it("hides a command whose condition is false, and offers it once true", () => {
    let available = false;
    const commands: BuilderCommand[] = [
      { id: "always", label: "Always here", run: noop },
      {
        id: "sometimes",
        label: "Only sometimes",
        when: () => available,
        run: noop,
      },
    ];

    const { rerender } = mount(<CommandPalette commands={commands} />);
    pressPaletteKey();

    expect(screen.getByText("Always here")).toBeTruthy();
    expect(screen.queryByText("Only sometimes")).toBeNull();

    // Evaluated per render rather than at mount, so a command that becomes available while the
    // palette is OPEN appears without closing and reopening it.
    available = true;
    rerender(
      <ShortcutProvider>
        <CommandPalette commands={commands} />
      </ShortcutProvider>
    );

    expect(screen.getByText("Only sometimes")).toBeTruthy();
  });

  it("keeps groups in the order they first appear, not alphabetical", () => {
    mount(
      <CommandPalette
        commands={[
          { id: "1", label: "Zulu thing", group: "Zulu", run: noop },
          { id: "2", label: "Alpha thing", group: "Alpha", run: noop },
        ]}
      />
    );
    pressPaletteKey();

    const headings = screen
      .getAllByText(/^(Zulu|Alpha)$/)
      .map(n => n.textContent);
    // A palette that reorders itself between openings makes muscle memory impossible.
    expect(headings).toEqual(["Zulu", "Alpha"]);
  });
});

describe("running a command", () => {
  it("asks to close BEFORE it runs the command", () => {
    // Asserted as CALL ORDER rather than as a closed dialog. `setOpen` is a React state update,
    // so the DOM cannot have re-rendered by the time a synchronous `run` executes — a test
    // checking for a vanished element would fail against correct code and tempt someone to
    // "fix" it by running the command first, which is the ordering this exists to prevent.
    const order: string[] = [];
    mount(
      <CommandPalette
        commands={[
          { id: "act", label: "Do the thing", run: () => order.push("run") },
        ]}
        open
        onOpenChange={next => order.push(`close:${next}`)}
      />
    );

    fireEvent.click(screen.getByText("Do the thing"));

    // A command that opens a dialog of its own, or moves focus, competes with a palette still
    // unmounting; asking to close first is what settles that race.
    expect(order).toEqual(["close:false", "run"]);
  });

  it("reports the empty state rather than an empty list", () => {
    mount(<CommandPalette commands={[]} emptyMessage="Nothing to run." />);
    pressPaletteKey();

    // An empty registry and a mis-typed search look the same to a user; both deserve words.
    expect(screen.getByText("Nothing to run.")).toBeTruthy();
  });
});

describe("the host can drive it", () => {
  it("honours a controlled open state and reports its own changes", () => {
    const onOpenChange = vi.fn();
    mount(
      <CommandPalette
        commands={[{ id: "a", label: "Visible now", run: noop }]}
        open
        onOpenChange={onOpenChange}
      />
    );

    // Open because the host says so, without the hotkey having been pressed.
    expect(screen.getByText("Visible now")).toBeTruthy();

    fireEvent.click(screen.getByText("Visible now"));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("refuses to mount outside a shortcut owner", () => {
    // A palette that silently registered nothing would look mounted and never open, which is the
    // failure this throw exists to prevent being silent.
    const quiet = vi.spyOn(console, "error").mockImplementation(noop);
    expect(() => render(<CommandPalette commands={[]} />)).toThrow(
      /ShortcutProvider/
    );
    quiet.mockRestore();
  });
});
