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
 * anything else is a child the listbox owns. Words reached on the way are
 * owned too: a listbox holding words and no option fails the rule ("Required
 * ARIA children role not present"), which is what a search that found nothing
 * drew.
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

/**
 * What one node reached by the walk is: a role the listbox owns, words it
 * owns ("#text"), a node to look through ("through"), or nothing a screen
 * reader meets (`null`).
 */
function ownedAs(node: Node): string | null {
  if (!(node instanceof Element)) {
    return node.nodeType === Node.TEXT_NODE && node.textContent?.trim()
      ? "#text"
      : null;
  }
  if (node.getAttribute("aria-hidden") === "true") return null;
  const role = node.getAttribute("role");
  const presentational = role === "none" || role === "presentation";
  const ownAria = [...node.attributes].some(
    attribute =>
      attribute.name.startsWith("aria-") && attribute.name !== "aria-hidden"
  );
  if ((role === null || presentational) && !ownAria) return "through";
  return role ?? `<${node.tagName.toLowerCase()}>`;
}

/** The roles of what the listbox owns, as axe walks them. */
function ownedRoles(listbox: Element): string[] {
  const roles: string[] = [];
  const queue = [...listbox.childNodes];
  for (let node = queue.shift(); node; node = queue.shift()) {
    const owned = ownedAs(node);
    if (owned === null) continue;
    if (owned !== "through") roles.push(owned);
    // A group is looked into, as an element without a role is looked through.
    if (owned === "through" || owned === "group") {
      queue.push(...node.childNodes);
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

  it("owns no words when a search finds nothing, and says so from outside the list", () => {
    render(
      <ShortcutProvider>
        <CommandPalette open commands={[command("Heading", "Add")]} />
      </ShortcutProvider>
    );
    search("zzz");
    const listbox = screen.getByRole("listbox");
    // The control: the message is still drawn in the list.
    expect(listbox.textContent).toContain("No matching commands.");
    expect(ownedRoles(listbox)).toEqual([]);
    const status = screen.getByRole("status");
    expect(status.textContent).toBe("No matching commands.");
    expect(listbox.contains(status)).toBe(false);
  });
});
