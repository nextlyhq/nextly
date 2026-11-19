// @vitest-environment jsdom
/**
 * The palette's list holds only what a listbox may: options, and the groups
 * that hold them. axe's `aria-required-children` reads a listbox's children
 * through any element without a role, and into each group, and fails on
 * anything else it finds there that a screen reader would meet. The divider
 * between groups was a `separator`, and a group's "Searching pages…" a
 * `status`, both inside the list.
 *
 * The walk below follows the rule as axe-core 4.14 writes it: an element a
 * screen reader skips (`aria-hidden`) is passed over, one with no role and no
 * ARIA attribute of its own is looked through, a group is looked into, and
 * anything else is a child the listbox owns.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ShortcutProvider } from "@nextlyhq/ui";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { CommandPalette, type BuilderCommand } from "./command-palette";

// The command primitives observe their list to size it and scroll the active
// row into view; jsdom has neither.
beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  Element.prototype.scrollIntoView ??= () => {};
});

afterEach(cleanup);

const command = (label: string, group: string): BuilderCommand => ({
  id: label,
  label,
  group,
  run: () => {},
});

/** Types into the palette's search, as the host's own results answer it. */
function search(text: string): void {
  fireEvent.change(screen.getByRole("combobox"), { target: { value: text } });
}

/** The roles of what the listbox owns, as axe walks them. */
function ownedRoles(listbox: Element): string[] {
  const roles: string[] = [];
  const queue = [...listbox.children];
  for (let element = queue.shift(); element; element = queue.shift()) {
    if (element.getAttribute("aria-hidden") === "true") continue;
    const role = element.getAttribute("role");
    const presentational = role === "none" || role === "presentation";
    const ownAria = [...element.attributes].some(
      attribute =>
        attribute.name.startsWith("aria-") && attribute.name !== "aria-hidden"
    );
    if ((role === null || presentational) && !ownAria) {
      queue.push(...element.children);
    } else if (role === "group") {
      roles.push(role);
      queue.push(...element.children);
    } else {
      roles.push(role ?? `<${element.tagName.toLowerCase()}>`);
    }
  }
  return roles;
}

describe("the palette's list", () => {
  it("owns only groups and options, between groups and while a group's search runs", () => {
    render(
      <ShortcutProvider>
        <CommandPalette
          open
          commands={[
            command("Heading", "Add"),
            command("Hero", "On this page"),
          ]}
          groups={[
            { name: "Add" },
            { name: "On this page" },
            { name: "Pages", matched: true, status: "Searching pages…" },
          ]}
        />
      </ShortcutProvider>
    );
    search("h");
    const listbox = screen.getByRole("listbox");
    const roles = ownedRoles(listbox);
    expect(roles).toContain("option");
    expect(roles.filter(role => role !== "group" && role !== "option")).toEqual(
      []
    );
  });

  it("still says a search is running, from outside the list", () => {
    render(
      <ShortcutProvider>
        <CommandPalette
          open
          commands={[command("Heading", "Add")]}
          groups={[
            { name: "Add" },
            { name: "Pages", matched: true, status: "Searching pages…" },
          ]}
        />
      </ShortcutProvider>
    );
    search("h");
    const status = screen.getByRole("status");
    expect(status.textContent).toBe("Searching pages…");
    expect(screen.getByRole("listbox").contains(status)).toBe(false);
  });
});
