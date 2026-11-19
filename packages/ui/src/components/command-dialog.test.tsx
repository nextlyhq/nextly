// @vitest-environment jsdom
/**
 * The name and description of a command dialog.
 *
 * A dialog needs an accessible name, or a screen reader announces "dialog"
 * and nothing more, and axe-core's `aria-dialog-name` fails it. The search
 * field's placeholder is no substitute: it names the input, not the dialog
 * around it. So the dialog names itself, as the kit's `Dialog` is named, from
 * a visually hidden title: "Command palette" unless the caller says
 * otherwise. A description is the caller's to give; without one the dialog
 * points at none, rather than at an element that is not there.
 *
 * Run with the real axe-core in jsdom rather than a copy of the rule, so an
 * axe upgrade that reads the dialog differently fails here first.
 */
import { cleanup, render, screen } from "@testing-library/react";
import axe from "axe-core";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from "vitest";

import {
  CommandDialog,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  type CommandDialogProps,
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

let warned: MockInstance;
let errored: MockInstance;
beforeEach(() => {
  // Radix says a dialog lacks a title, or points at a missing description,
  // through the console.
  warned = vi.spyOn(console, "warn").mockImplementation(() => {});
  errored = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function Palette(props: Omit<CommandDialogProps, "open" | "children">) {
  return (
    <CommandDialog open commandProps={{ label: "Commands" }} {...props}>
      <CommandInput placeholder="Type a command or search..." />
      <CommandList label="Results">
        <CommandGroup heading="Pages">
          <CommandItem>Home</CommandItem>
          <CommandItem>About</CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
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

/** What Radix said through the console about the dialog's title or description. */
function radixComplaints(): string[] {
  return [...warned.mock.calls, ...errored.mock.calls]
    .map(call => call.map(String).join(" "))
    .filter(line => /DialogTitle|Description|aria-describedby/.test(line));
}

describe("a command dialog", () => {
  it("is named, with no name given, so axe finds it named", async () => {
    render(<Palette />);

    // The control: the dialog is open, so the rule has a dialog to read.
    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeTruthy();
    expect(await violations(["aria-dialog-name"])).toEqual([]);
    expect(screen.getByRole("dialog", { name: "Command palette" })).toBe(
      dialog
    );
  });

  it("passes the whole axe rule set, not only the dialog rule", async () => {
    render(<Palette />);

    // `region` asks for the page to sit in landmarks, which a lone component
    // rendered into an empty body never does.
    const found = (await violations()).filter(({ id }) => id !== "region");
    expect(found).toEqual([]);
  });

  it("takes the name its caller gives, and keeps it out of sight", () => {
    render(<Palette title="Search the site" />);

    const dialog = screen.getByRole("dialog", { name: "Search the site" });
    const title = document.getElementById(
      dialog.getAttribute("aria-labelledby") ?? ""
    );
    expect(title?.textContent).toBe("Search the site");
    // Named for a screen reader; the search field is what is drawn on top.
    expect(title?.className).toContain("sr-only");
    // One title: a second element answering to the same id would be invalid.
    expect(document.querySelectorAll(`[id="${title?.id}"]`)).toHaveLength(1);
  });

  it("is described by the description its caller gives", () => {
    render(<Palette description="Search for a command and press Enter." />);

    const dialog = screen.getByRole("dialog");
    const description = document.getElementById(
      dialog.getAttribute("aria-describedby") ?? ""
    );
    expect(description?.textContent).toBe(
      "Search for a command and press Enter."
    );
    expect(description?.className).toContain("sr-only");
  });

  it("points at no description when none is given, and Radix has nothing to say", () => {
    render(<Palette />);

    expect(screen.getByRole("dialog").hasAttribute("aria-describedby")).toBe(
      false
    );
    expect(radixComplaints()).toEqual([]);
  });
});
