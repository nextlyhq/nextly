// @vitest-environment jsdom
/**
 * The divider between command groups, inside the list.
 *
 * The list is a `listbox`, and a listbox may own only options and the groups
 * that hold them. The library's separator carries `role="separator"`, set after
 * the props it is given, so a caller cannot replace it, and axe-core's
 * `aria-required-children` fails the list on it. The divider is hidden from
 * screen readers instead: the rule passes over an element a screen reader
 * skips, and the line is still drawn.
 *
 * Run with the real axe-core in jsdom rather than a copy of the rule, so an
 * axe upgrade that reads the list differently fails here first.
 */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import axe from "axe-core";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "./command";

// jsdom draws no layout: the list observes its size and scrolls its
// highlighted item into view, and neither exists there. Nor does it draw on a
// canvas, which axe measures icon fonts with; without one it leaves those
// checks incomplete, so say so quietly rather than through jsdom's warning.
beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = () => null;
  Element.prototype.scrollIntoView ??= () => {};
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

afterEach(cleanup);

function Palette({ alwaysRender }: { alwaysRender?: boolean }) {
  return (
    <Command label="Commands">
      <CommandInput placeholder="Search" />
      <CommandList label="Results">
        <CommandGroup heading="Pages">
          <CommandItem>Home</CommandItem>
          <CommandItem>About</CommandItem>
        </CommandGroup>
        <CommandSeparator alwaysRender={alwaysRender} />
        <CommandGroup heading="Actions">
          <CommandItem>Publish</CommandItem>
        </CommandGroup>
      </CommandList>
    </Command>
  );
}

async function violations(rules?: string[]) {
  const results = await axe.run(
    document.body,
    rules === undefined ? {} : { runOnly: { type: "rule", values: rules } }
  );
  return results.violations.map(violation => ({
    id: violation.id,
    nodes: violation.nodes.map(node => node.failureSummary),
  }));
}

function separator(): HTMLElement {
  const found = document.querySelector<HTMLElement>("[cmdk-separator]");
  if (found === null) throw new Error("no separator rendered");
  return found;
}

describe("a separator between groups in the list", () => {
  it("leaves the listbox owning only its groups and options", async () => {
    render(<Palette />);

    expect(await violations(["aria-required-children"])).toEqual([]);
  });

  it("passes the whole axe rule set, not only the listbox rule", async () => {
    render(<Palette />);

    // `region` asks for the page to sit in landmarks, which a lone component
    // rendered into an empty body never does.
    const found = (await violations()).filter(({ id }) => id !== "region");
    expect(found).toEqual([]);
  });

  it("is still drawn: a 1px rule in the border colour", () => {
    render(<Palette />);

    const rule = separator();
    const classes = (rule.getAttribute("class") ?? "").split(/\s+/);
    expect(classes).toEqual(
      expect.arrayContaining(["h-px", "bg-border", "my-2"])
    );
    // A screen reader skips it; it is a line, not a row.
    expect(rule.getAttribute("aria-hidden")).toBe("true");
    expect(screen.getByRole("listbox").contains(rule)).toBe(true);
  });

  it("keeps a caller's class next to its own", () => {
    render(
      <Command label="Commands">
        <CommandList label="Results">
          <CommandSeparator className="my-1" />
        </CommandList>
      </Command>
    );

    const classes = (separator().getAttribute("class") ?? "").split(/\s+/);
    expect(classes).toEqual(
      expect.arrayContaining(["h-px", "bg-border", "my-1"])
    );
    expect(classes).not.toContain("my-2");
  });

  it("lets a caller that places it outside a list announce it", () => {
    render(
      <Command label="Commands">
        <CommandSeparator aria-hidden={false} />
      </Command>
    );

    expect(separator().getAttribute("aria-hidden")).toBe("false");
    expect(screen.getByRole("separator")).toBe(separator());
  });

  it("is passed over by the arrow keys, from one group's last row to the next group's first", () => {
    render(<Palette />);

    const input = screen.getByRole("combobox");
    const highlighted = () =>
      document.querySelector('[cmdk-item][data-selected="true"]')?.textContent;

    expect(highlighted()).toBe("Home");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(highlighted()).toBe("About");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(highlighted()).toBe("Publish");
    // The announced row agrees with the drawn one.
    const active = input.getAttribute("aria-activedescendant");
    expect(active).not.toBeNull();
    expect(document.getElementById(active ?? "")?.textContent).toBe("Publish");
  });

  it("still leaves while a search is typed, unless it is asked to stay", async () => {
    const { unmount } = render(<Palette />);
    await act(async () => {
      fireEvent.change(screen.getByRole("combobox"), {
        target: { value: "o" },
      });
    });
    expect(document.querySelector("[cmdk-separator]")).toBeNull();
    unmount();

    render(<Palette alwaysRender />);
    await act(async () => {
      fireEvent.change(screen.getByRole("combobox"), {
        target: { value: "o" },
      });
    });
    expect(separator().getAttribute("aria-hidden")).toBe("true");
    expect(await violations(["aria-required-children"])).toEqual([]);
  });
});
