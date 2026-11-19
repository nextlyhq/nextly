// @vitest-environment jsdom
/**
 * The "nothing found" message of a command list.
 *
 * The list is a `listbox`, and a listbox may own only options and the groups
 * that hold them. The library draws its empty message inside the list, as a
 * `presentation` row whose words the list then owns, so when a search matches
 * nothing axe-core's `aria-required-children` fails the list: "Required ARIA
 * children role not present: group, option". The message is still drawn in
 * the list, hidden from screen readers, and the list says it from a status
 * line of its own, outside the listbox, where a status may be.
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
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
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

function Palette() {
  return (
    <Command label="Commands">
      <CommandInput placeholder="Search" />
      <CommandList label="Results">
        <CommandEmpty>No results found.</CommandEmpty>
        <CommandGroup heading="Pages">
          <CommandItem>Home</CommandItem>
          <CommandItem>About</CommandItem>
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

async function search(text: string) {
  await act(async () => {
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: text },
    });
  });
}

function drawnEmpty(): HTMLElement | null {
  return document.querySelector<HTMLElement>("[cmdk-empty]");
}

describe("a command list a search finds nothing in", () => {
  it("leaves the listbox owning no stray words", async () => {
    render(<Palette />);
    await search("zzz");

    // The control: the message is drawn, so the list is in the state the
    // rule failed on.
    expect(drawnEmpty()?.textContent).toBe("No results found.");
    expect(await violations(["aria-required-children"])).toEqual([]);
  });

  it("passes the whole axe rule set, not only the listbox rule", async () => {
    render(<Palette />);
    await search("zzz");

    // `region` asks for the page to sit in landmarks, which a lone component
    // rendered into an empty body never does.
    const found = (await violations()).filter(({ id }) => id !== "region");
    expect(found).toEqual([]);
  });

  it("is drawn in the list and said from a status line outside it", async () => {
    render(<Palette />);
    const list = screen.getByRole("listbox");
    // Mounted before it has anything to say, so the first words are
    // announced, and empty while the search finds something.
    const status = screen.getByRole("status");
    expect(list.contains(status)).toBe(false);
    expect(status.textContent).toBe("");

    await search("zzz");
    const drawn = drawnEmpty();
    expect(drawn).not.toBeNull();
    expect(list.contains(drawn)).toBe(true);
    expect(drawn?.getAttribute("aria-hidden")).toBe("true");
    expect(status.textContent).toBe("No results found.");

    // Found again: the message leaves the list and the status line.
    await search("ho");
    expect(drawnEmpty()).toBeNull();
    expect(status.textContent).toBe("");
  });

  it("adds no status line to a list without one", () => {
    render(
      <Command label="Commands">
        <CommandList label="Results">
          <CommandItem>Home</CommandItem>
        </CommandList>
      </Command>
    );

    expect(screen.queryByRole("status")).toBeNull();
  });

  it("leaves a message holding a control where it is, so the control can be reached", async () => {
    render(
      <Command label="Commands">
        <CommandInput placeholder="Search" />
        <CommandList label="Results">
          <CommandEmpty>
            <span>
              Couldn&apos;t search <button type="button">Try again</button>
            </span>
          </CommandEmpty>
          <CommandItem>Home</CommandItem>
        </CommandList>
      </Command>
    );
    await search("zzz");

    expect(drawnEmpty()?.hasAttribute("aria-hidden")).toBe(false);
    // Once, where it is drawn: no copy in a status line.
    expect(screen.getAllByRole("button", { name: "Try again" })).toHaveLength(
      1
    );
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("is read where it is placed outside a list, which is no listbox", async () => {
    render(
      <Command label="Commands">
        <CommandInput placeholder="Search" />
        <CommandEmpty>No results found.</CommandEmpty>
        <CommandList label="Results">
          <CommandItem>Home</CommandItem>
        </CommandList>
      </Command>
    );
    await search("zzz");

    expect(drawnEmpty()?.hasAttribute("aria-hidden")).toBe(false);
  });
});
