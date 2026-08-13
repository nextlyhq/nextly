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
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ShortcutProvider, ShortcutScope, useShortcuts } from "@nextlyhq/ui";

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

/** A `mod`-chorded host binding, sent both ways for the same reason as {@link pressPaletteKey}. */
function pressHostChord() {
  fireEvent.keyDown(document, { key: "b", metaKey: true });
  fireEvent.keyDown(document, { key: "b", ctrlKey: true });
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

  it("lists ungrouped commands first even when a group was supplied before them", () => {
    // The ordering the type documents. Supplying the GROUPED command first is the whole test:
    // first-appearance order alone would put the headingless item between two named groups, where
    // it reads as belonging to the heading above it.
    mount(
      <CommandPalette
        commands={[
          { id: "1", label: "Grouped thing", group: "Panels", run: noop },
          { id: "2", label: "Loose thing", run: noop },
          { id: "3", label: "Other grouped", group: "View", run: noop },
        ]}
      />
    );
    pressPaletteKey();

    const rows = screen
      .getAllByText(/^(Grouped thing|Loose thing|Other grouped)$/)
      .map(n => n.textContent);
    expect(rows).toEqual(["Loose thing", "Grouped thing", "Other grouped"]);
  });
});

describe("running a command", () => {
  it("leaves focus where the command put it, while the exit animation is still running", () => {
    // The property that matters in a browser, and the one jsdom hides by default.
    //
    // Radix holds the dialog MOUNTED for its 200ms `animate-out`, so `run()` always executes with
    // the palette still in the DOM. What must be true is narrower: the content has to be
    // focus-INERT by then, so a command that focuses something outside the palette keeps it.
    // That holds because the modal content is trapped only while the dialog is open, and the
    // synchronous close in `choose` flips that before `run()` is called. Queue the close instead
    // and the trap is still armed, so focus is pulled straight back inside the palette.
    //
    // jsdom reports no animation, so the content would otherwise unmount immediately and the test
    // would pass without ever reaching the case it is named for. Presence decides by reading
    // `animationName` off the computed style and waiting for `animationend`, so reporting one
    // here puts the dialog into exactly the state a real close is in.
    const realGetComputedStyle = window.getComputedStyle.bind(window);
    const stub = vi
      .spyOn(window, "getComputedStyle")
      .mockImplementation((element: Element, pseudo?: string | null) => {
        const styles = realGetComputedStyle(element, pseudo);
        // `getAttribute`, not the reflected `element.role`: jsdom does not implement that
        // property, so reading it returns undefined and the stub matches nothing.
        if (element.getAttribute?.("role") !== "dialog") return styles;
        // The name has to DIFFER between the open and closed states. Presence treats an
        // unchanged `animationName` as "not animating" and unmounts at once, so a stub
        // reporting one constant name suspends nothing — which is what the real stylesheet
        // avoids by keying `animate-in` and `animate-out` off `data-state`.
        const name =
          element.getAttribute("data-state") === "closed" ? "exit" : "enter";
        return new Proxy(styles, {
          get: (target, key) =>
            key === "animationName" ? name : Reflect.get(target, key),
        });
      });

    try {
      mount(
        <>
          <input data-testid="outside" />
          <CommandPalette
            commands={[
              {
                id: "act",
                label: "Do the thing",
                run: () => screen.getByTestId("outside").focus(),
              },
            ]}
          />
        </>
      );
      pressPaletteKey();
      fireEvent.click(screen.getByText("Do the thing"));

      // The positive control. Without it a stub that silently stopped applying would unmount the
      // dialog at once, and the focus assertion below would pass over the unanimated case — the
      // exact hole this test replaced.
      expect(screen.queryByRole("dialog")).not.toBeNull();
      expect(document.activeElement).toBe(screen.getByTestId("outside"));
    } finally {
      stub.mockRestore();
    }
  });

  it("reports the close to a controlling host before running", () => {
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

    expect(order).toEqual(["close:false", "run"]);
  });

  it("gives the dialog an accessible name and description", () => {
    mount(<CommandPalette commands={[]} placeholder="Search commands…" />);
    pressPaletteKey();

    // `CommandDialog` renders neither, and the input's placeholder names the INPUT rather than
    // the dialog — so without these a screen reader announces an unnamed dialog.
    const dialog = screen.getByRole("dialog", { name: "Command palette" });
    expect(dialog.getAttribute("aria-describedby")).toBeTruthy();
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

  it("opens on the hotkey and stays open when it is pressed again", () => {
    mount(
      <CommandPalette
        commands={[{ id: "a", label: "Still here", run: noop }]}
      />
    );

    pressPaletteKey();
    expect(screen.getByText("Still here")).toBeTruthy();

    // Open-only, deliberately. cmdk's vim bindings claim Ctrl+K inside the palette and
    // `preventDefault()` it, so a toggle would close on Apple platforms and refuse to on
    // Windows and Linux. Escape closes on all three.
    pressPaletteKey();
    expect(screen.getByText("Still here")).toBeTruthy();
  });

  it("hands focus back to whatever opened it", async () => {
    render(
      <ShortcutProvider>
        <button type="button">Origin control</button>
        <CommandPalette
          commands={[{ id: "a", label: "Anything", run: noop }]}
        />
      </ShortcutProvider>
    );

    const origin = screen.getByRole("button", { name: "Origin control" });
    origin.focus();
    expect(document.activeElement).toBe(origin);

    pressPaletteKey();
    // Radix restores focus to the dialog's TRIGGER, and a palette opened by a keystroke has none
    // — so without the restore, closing drops focus onto <body> and a keyboard user starts again
    // from the top of the document.
    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => expect(document.activeElement).toBe(origin));
  });

  it("hands focus back after an ordinary command that never touches it", async () => {
    render(
      <ShortcutProvider>
        <button type="button">Origin control</button>
        <CommandPalette
          commands={[{ id: "a", label: "Just a toggle", run: () => {} }]}
        />
      </ShortcutProvider>
    );

    const origin = screen.getByRole("button", { name: "Origin control" });
    origin.focus();
    pressPaletteKey();
    fireEvent.click(screen.getByText("Just a toggle"));

    // The common case, and the one a blanket "a command ran" claim broke: most commands never
    // touch focus, and suppressing the restore for them drops the user on `<body>`.
    await waitFor(() => expect(document.activeElement).toBe(origin));
  });

  it("leaves focus where a command put it", async () => {
    render(
      <ShortcutProvider>
        <button type="button">Origin control</button>
        <button type="button">Command target</button>
        <CommandPalette
          commands={[
            {
              id: "a",
              label: "Focus elsewhere",
              run: () =>
                screen.getByRole("button", { name: "Command target" }).focus(),
            },
          ]}
        />
      </ShortcutProvider>
    );

    screen.getByRole("button", { name: "Origin control" }).focus();
    pressPaletteKey();
    fireEvent.click(screen.getByText("Focus elsewhere"));

    // Suppressed only where the command ESTABLISHED focus, which is observed rather than assumed.
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Command target" })
    );
  });

  it("tells a controlling host to close when it becomes disabled", () => {
    const onOpenChange = vi.fn();
    const commands: BuilderCommand[] = [
      { id: "a", label: "Open already", run: noop },
    ];
    const { rerender } = mount(
      <CommandPalette commands={commands} open onOpenChange={onOpenChange} />
    );

    rerender(
      <ShortcutProvider>
        <CommandPalette
          commands={commands}
          open
          onOpenChange={onOpenChange}
          enabled={false}
        />
      </ShortcutProvider>
    );

    // Clearing only our own copy would leave the host's `open` true, and the palette would reopen
    // the moment the shell widened again.
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("gives an ungrouped bucket a key a group name cannot collide with", () => {
    // Group names are unrestricted, so a host may legitimately name one `__ungrouped`. Asserted
    // on React's duplicate-key WARNING rather than on the rendered rows: duplicate keys render
    // correctly on the first pass and only misbehave on a later update, so a render assertion
    // passes either way.
    const errors: unknown[][] = [];
    const spy = vi
      .spyOn(console, "error")
      .mockImplementation((...args: unknown[]) => {
        errors.push(args);
      });

    mount(
      <CommandPalette
        commands={[
          { id: "1", label: "Loose row", run: noop },
          { id: "2", label: "Named row", group: "__ungrouped", run: noop },
        ]}
      />
    );
    pressPaletteKey();
    spy.mockRestore();

    expect(screen.getByText("Loose row")).toBeTruthy();
    expect(screen.getByText("Named row")).toBeTruthy();
    expect(errors.filter(args => String(args[0]).includes("same key"))).toEqual(
      []
    );
  });

  it("cannot be opened while the host has it disabled", () => {
    mount(
      <CommandPalette
        commands={[{ id: "a", label: "Should not appear", run: noop }]}
        enabled={false}
      />
    );

    pressPaletteKey();

    // The dialog portals out of any `inert` wrapper the host put itself behind, so refusing the
    // hotkey is the host's only way to keep the palette off a screen it has disabled.
    expect(screen.queryByText("Should not appear")).toBeNull();
  });

  it("flattens groups while searching so ranking is global", () => {
    mount(
      <CommandPalette
        commands={[
          { id: "1", label: "Zulu zebra", group: "Zulu", run: noop },
          { id: "2", label: "Alpha zebra", group: "Alpha", run: noop },
          { id: "3", label: "Unrelated", group: "Alpha", run: noop },
        ]}
      />
    );
    pressPaletteKey();

    // Headings are gone: cmdk orders items WITHIN a group and leaves the groups in their own
    // order, so keeping them would pin a better match below a weaker one from an earlier group.
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "zebra" },
    });

    expect(screen.queryByText("Zulu")).toBeNull();
    expect(screen.queryByText("Alpha")).toBeNull();
    expect(screen.queryByText("Unrelated")).toBeNull();
    expect(screen.getByText("Zulu zebra")).toBeTruthy();
    expect(screen.getByText("Alpha zebra")).toBeTruthy();
  });

  it("keeps two commands separable when their fields concatenate alike", () => {
    // The labels must MATCH for the collision to exist: joining label, keywords and id gives both
    // of these "Open settings page settings advanced", differing only in where the split falls.
    // cmdk keys SELECTION on that value, so a collision marks both rows selected and activates
    // the first whichever the user chose.
    const chosen: string[] = [];
    mount(
      <CommandPalette
        commands={[
          {
            id: "settings advanced",
            label: "Open settings",
            keywords: ["page"],
            run: () => chosen.push("first"),
          },
          {
            id: "advanced",
            label: "Open settings",
            keywords: ["page", "settings"],
            run: () => chosen.push("second"),
          },
        ]}
      />
    );
    pressPaletteKey();

    expect(screen.getAllByText("Open settings")).toHaveLength(2);

    // Driven by the KEYBOARD, which is where the collision bites. A click dispatches that row's
    // own React handler and reaches the right command whatever cmdk thinks; selection is what
    // cmdk keys on the value, so only arrowing and activating can tell the two apart.
    const input = screen.getByRole("combobox");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(chosen).toEqual(["second"]);
  });

  it("keeps two commands separable when their ids differ only by whitespace", () => {
    // cmdk TRIMS the value before using it as the selection identity, so `"save"` and `"save "` —
    // distinct ids by this component's contract — collide through normalisation rather than
    // through concatenation. Driven by the keyboard, because selection is what the value keys.
    const chosen: string[] = [];
    mount(
      <CommandPalette
        commands={[
          { id: "save", label: "Save", run: () => chosen.push("first") },
          { id: "save ", label: "Save", run: () => chosen.push("second") },
        ]}
      />
    );
    pressPaletteKey();

    expect(screen.getAllByText("Save")).toHaveLength(2);
    const input = screen.getByRole("combobox");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(chosen).toEqual(["second"]);
  });

  it("hands focus back to a focusable element that is not an HTMLElement", async () => {
    render(
      <ShortcutProvider>
        {/* Focusable and NOT an HTMLElement — narrowing the origin to one discards it. */}
        <svg tabIndex={0} data-testid="svg-origin" />
        <CommandPalette
          commands={[{ id: "a", label: "Anything", run: noop }]}
        />
      </ShortcutProvider>
    );

    const origin = screen.getByTestId("svg-origin");
    (origin as unknown as { focus: () => void }).focus();
    expect(document.activeElement).toBe(origin);

    pressPaletteKey();
    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => expect(document.activeElement).toBe(origin));
  });

  it("renders an id that cannot be percent-encoded", () => {
    // `id: string` admits a lone UTF-16 surrogate, which survives a JSON round trip.
    // `encodeURIComponent` raises `URIError` on it, and a throw here takes the whole palette down
    // during render rather than degrading.
    expect(() =>
      mount(
        <CommandPalette
          commands={[{ id: "\ud800", label: "Lone surrogate", run: noop }]}
        />
      )
    ).not.toThrow();

    pressPaletteKey();
    expect(screen.getByText("Lone surrogate")).toBeTruthy();
  });

  it("asks each command whether it is available once, not once per path", () => {
    // The searched list is DERIVED from the grouped one rather than filtered again. Two paths
    // computing availability agree until someone edits one, and the divergence would show only
    // while the user is searching — the half nobody looks at. Asserted by call COUNT because the
    // two implementations return the same set today; what separates them is how many times the
    // predicate runs.
    const when = vi.fn(() => true);
    mount(
      <CommandPalette
        commands={[{ id: "a", label: "Conditional", when, run: noop }]}
      />
    );
    pressPaletteKey();

    when.mockClear();
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "cond" },
    });

    // One evaluation per render, however many views of the list that render produces.
    const searching = when.mock.calls.length;

    // Calibrated against the SAME component in the SAME test rather than against a number chosen
    // here: React's render count is not something this test should be asserting, and a tolerance
    // wide enough to survive it is wide enough to hide the second path. Typing must not cost more
    // availability checks per render than not typing does.
    when.mockClear();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "" } });
    const notSearching = when.mock.calls.length;

    expect(notSearching).toBeGreaterThan(0);
    expect(searching).toBeLessThanOrEqual(notSearching);
  });

  it("does not match every command on a character from the encoded id", () => {
    mount(
      <CommandPalette
        commands={[
          { id: "one", label: "Alpha", run: noop },
          { id: "two", label: "Beta", run: noop },
        ]}
        emptyMessage="Nothing to run."
      />
    );
    pressPaletteKey();

    // Every encoded id begins and ends with a quote, and cmdk's default filter scores the item
    // VALUE as well as its keywords — so a query of `"` matched all of them. The palette scores
    // the label and synonyms only.
    fireEvent.change(screen.getByRole("combobox"), { target: { value: '"' } });

    expect(screen.queryByText("Alpha")).toBeNull();
    expect(screen.queryByText("Beta")).toBeNull();
    expect(screen.getByText("Nothing to run.")).toBeTruthy();
  });

  it("lets a space be typed in the middle of a query", () => {
    mount(
      <CommandPalette
        commands={[
          { id: "1", label: "Open settings", run: noop },
          { id: "2", label: "Opensettings decoy", run: noop },
        ]}
      />
    );
    pressPaletteKey();

    // Typed one character at a time, which is the whole point: injecting the finished string in a
    // single change event never exercises the moment the value is `"open "` and a trimming
    // controlled value hands back `"open"`, so the next key produces `"opensettings"`.
    const input = screen.getByRole("combobox") as HTMLInputElement;
    for (const ch of "open settings") {
      fireEvent.change(input, { target: { value: input.value + ch } });
    }

    expect(input.value).toBe("open settings");
    expect(screen.getByText("Open settings")).toBeTruthy();
  });

  it("treats a whitespace-only query as no search at all", () => {
    mount(
      <CommandPalette
        commands={[
          { id: "1", label: "Only entry", group: "Panels", run: noop },
          { id: "2", label: "Other entry", group: "View", run: noop },
        ]}
      />
    );
    pressPaletteKey();

    const separators = () =>
      document.querySelectorAll("[cmdk-separator]").length;
    expect(separators()).toBeGreaterThan(0);

    // The mode decision and cmdk's own search state have to agree. cmdk's separator reads its RAW
    // search and unmounts while that is nonempty, so spaces stripped every divider out of a list
    // that was still grouped and still showing everything.
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "   " },
    });

    expect(screen.getByText("Only entry")).toBeTruthy();
    expect(screen.getByText("Panels")).toBeTruthy();
    expect(separators()).toBeGreaterThan(0);
  });

  it("lets a space be typed in the middle of a query", () => {
    mount(
      <CommandPalette
        commands={[
          { id: "1", label: "Open settings", run: noop },
          { id: "2", label: "Opensettings decoy", run: noop },
        ]}
      />
    );
    pressPaletteKey();

    // Typed one character at a time, which is the whole point: injecting the finished string in a
    // single change event never exercises the moment the value is `"open "` and a trimming
    // controlled value hands back `"open"`, so the next key produces `"opensettings"`.
    const input = screen.getByRole("combobox") as HTMLInputElement;
    for (const ch of "open settings") {
      fireEvent.change(input, { target: { value: input.value + ch } });
    }

    expect(input.value).toBe("open settings");
    expect(screen.getByText("Open settings")).toBeTruthy();
  });

  it("treats a whitespace-only query as no search at all", () => {
    mount(
      <CommandPalette
        commands={[
          { id: "1", label: "Only entry", group: "Panels", run: noop },
        ]}
      />
    );
    pressPaletteKey();

    // The mode decision and cmdk's filter input have to agree. Trimming for the mode while
    // handing cmdk the raw string left the palette rendering its grouped view while cmdk was
    // already filtering, which hid the entries.
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "   " },
    });

    expect(screen.getByText("Only entry")).toBeTruthy();
    expect(screen.getByText("Panels")).toBeTruthy();
  });

  it("refuses two available commands that share an id", () => {
    // A host concatenating registries is where this arises. cmdk keys selection on the id, so a
    // duplicate marks both rows selected and Enter runs the first whichever was chosen — the
    // wrong command, silently, and only through the keyboard.
    const quiet = vi.spyOn(console, "error").mockImplementation(noop);
    expect(() =>
      mount(
        <CommandPalette
          commands={[
            { id: "save", label: "Save draft", run: noop },
            { id: "save", label: "Save and publish", run: noop },
          ]}
        />
      )
    ).toThrow(/two available commands with the id "save"/);
    quiet.mockRestore();
  });

  it("allows a shared id when only one of the pair is available", () => {
    // Checked over the AVAILABLE list: a `when` that hides one of a colliding pair resolves the
    // collision, and refusing there would reject a registry that never renders a duplicate.
    mount(
      <CommandPalette
        commands={[
          { id: "save", label: "Save draft", when: () => false, run: noop },
          { id: "save", label: "Save and publish", run: noop },
        ]}
      />
    );
    pressPaletteKey();

    expect(screen.getByText("Save and publish")).toBeTruthy();
  });

  it("searches on a renamed label while the palette stays open", () => {
    const commands: BuilderCommand[] = [
      { id: "a", label: "Original name", run: noop },
    ];
    const { rerender } = mount(<CommandPalette commands={commands} />);
    pressPaletteKey();

    // Renamed with the id held stable, which is what the contract asks of a host.
    rerender(
      <ShortcutProvider>
        <CommandPalette
          commands={[{ id: "a", label: "Renamed thing", run: noop }]}
        />
      </ShortcutProvider>
    );
    expect(screen.getByText("Renamed thing")).toBeTruthy();

    // cmdk refreshes an item's keywords only when its VALUE changes, and the value is the id.
    // Without the metadata in the key, the row reads "Renamed thing" while cmdk still filters on
    // "Original name" — so searching for what is on screen hides it.
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "Renamed" },
    });

    expect(screen.getByText("Renamed thing")).toBeTruthy();
  });

  it("remounts on a rename that a delimited key could not tell apart", () => {
    // Joining free-form fields is not injective: with a delimiter, keywords `["open\u0000settings"]`
    // and `["open", "settings"]` produce the same key, so the rename would not remount and cmdk
    // would keep the old metadata — the exact defect the key exists to prevent.
    const separator = String.fromCharCode(0);
    const commands: BuilderCommand[] = [
      {
        id: "a",
        label: "Thing",
        keywords: [`open${separator}settings`],
        run: noop,
      },
    ];
    const { rerender } = mount(<CommandPalette commands={commands} />);
    pressPaletteKey();

    rerender(
      <ShortcutProvider>
        <CommandPalette
          commands={[
            {
              id: "a",
              label: "Thing",
              keywords: ["open", "settings"],
              run: noop,
            },
          ]}
        />
      </ShortcutProvider>
    );

    // The new synonyms have to be what cmdk matches on.
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "open settings" },
    });

    expect(screen.getByText("Thing")).toBeTruthy();
  });

  it("names the search field, not just the dialog", () => {
    mount(<CommandPalette commands={[]} />);
    pressPaletteKey();

    // cmdk points the input's `aria-labelledby` at a hidden label it renders for the command
    // root. Unset, that label is EMPTY — an explicit reference to nothing, which is worse than no
    // reference at all because it stops the placeholder naming the field.
    expect(
      screen.getByRole("combobox", { name: "Command palette" })
    ).toBeTruthy();
  });

  it("stays closed after being re-enabled, rather than reopening itself", () => {
    const commands: BuilderCommand[] = [
      { id: "a", label: "Was open", run: noop },
    ];
    const { rerender } = mount(<CommandPalette commands={commands} />);
    pressPaletteKey();
    expect(screen.getByText("Was open")).toBeTruthy();

    const render = (enabled: boolean) =>
      rerender(
        <ShortcutProvider>
          <CommandPalette commands={commands} enabled={enabled} />
        </ShortcutProvider>
      );

    render(false);
    expect(screen.queryByText("Was open")).toBeNull();

    // Masking `open` would leave the stored `true` intact, so widening the shell back would
    // reopen a palette nobody asked for.
    render(true);
    expect(screen.queryByText("Was open")).toBeNull();
  });

  it("closes an open palette when the host becomes disabled", () => {
    const commands: BuilderCommand[] = [
      { id: "a", label: "Open already", run: noop },
    ];
    const { rerender } = mount(<CommandPalette commands={commands} open />);
    expect(screen.getByText("Open already")).toBeTruthy();

    // A shell that narrows past its minimum width disables itself while the palette is already
    // up; `enabled` alone has to close it, without the host also driving `open`.
    rerender(
      <ShortcutProvider>
        <CommandPalette commands={commands} open enabled={false} />
      </ShortcutProvider>
    );

    expect(screen.queryByText("Open already")).toBeNull();
  });

  it("holds the keyboard while open, so host shortcuts do not fire underneath it", () => {
    const hostShortcut = vi.fn();
    /**
     * Stands in for the shell. Bound to `mod+b` rather than to the shell's own bare F6 on
     * purpose: a bare function key is skipped while the user is typing anyway, and the palette
     * autofocuses its search field — so an F6 probe would go quiet whether or not the layer
     * blocks, and pass against an unblocked palette. A non-shift modifier fires WHILE typing,
     * which leaves the blocking layer as the only thing that can suppress it.
     */
    function Host() {
      useShortcuts(
        [{ keys: "mod+b", description: "A host binding", run: hostShortcut }],
        { name: "host" }
      );
      return null;
    }
    // Rendered AFTER the palette, which is the UNFAVOURABLE order: layers at equal depth are
    // ordered by registration with the newest on top, so a host registering later would win the
    // key. The palette keeps it only because it registers in a scope of its own, one level
    // deeper. Putting `Host` first would pass with or without that scope.
    mount(
      <>
        <CommandPalette
          commands={[{ id: "a", label: "Anything", run: noop }]}
        />
        {/* SCOPED, and rendered last: the host's own binding is both deeper than ambient and
            registered after the palette, which is the arrangement depth alone cannot outrank. */}
        <ShortcutScope>
          <ShortcutScope>
            <Host />
          </ShortcutScope>
        </ShortcutScope>
      </>
    );

    // The positive control. Without it, a probe that never reached the manager would report the
    // suppression below whether or not the layer blocks anything.
    pressHostChord();
    expect(hostShortcut).toHaveBeenCalledTimes(1);

    pressPaletteKey();
    pressHostChord();

    // Still once. Acting on a shell the user cannot see behind the modal is exactly the
    // confusion a blocking layer exists to prevent.
    expect(hostShortcut).toHaveBeenCalledTimes(1);
  });

  it("does not open over a modal that owns the keyboard", () => {
    /**
     * Another modal, registered the way one should be: in a scope of its OWN, so its hold sits
     * deeper than ambient host shortcuts. That is the same arrangement the palette uses while it
     * is open.
     */
    function HostModal() {
      return (
        <ShortcutScope>
          <HostModalHold />
        </ShortcutScope>
      );
    }
    function HostModalHold() {
      useShortcuts([], { name: "host-modal", blocking: true });
      return null;
    }
    mount(
      <>
        <HostModal />
        <CommandPalette
          commands={[{ id: "a", label: "Should not appear", run: noop }]}
        />
      </>
    );

    pressPaletteKey();

    // The palette's OPENER is ambient, so a deeper modal outranks it. Elevating the opener along
    // with the palette's own hold would have resolved `mod+k` first and opened this over the
    // other modal.
    expect(screen.queryByText("Should not appear")).toBeNull();
  });

  it("leaves the keystroke to the browser when it is disabled", () => {
    mount(<CommandPalette commands={[]} enabled={false} />);

    const event = new KeyboardEvent("keydown", {
      key: "k",
      ctrlKey: true,
      cancelable: true,
      bubbles: true,
    });
    document.dispatchEvent(event);

    // A disabled layer must not consume the chord: swallowing `mod+k` while refusing to act on
    // it would take the browser's own shortcut away and give nothing back.
    expect(event.defaultPrevented).toBe(false);
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
