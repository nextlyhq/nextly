// @vitest-environment jsdom
/**
 * A right-click menu is only useful if it can be reached and read whole. These check the two
 * things that are easy to get wrong and invisible until someone hits them: a surface that clips
 * off-screen with no way to scroll, and a trigger no keyboard can reach.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "./context-menu";

// The submenu is opened declaratively rather than by simulating the pointer dance Radix listens
// for. Driving it with a click looked like it worked and did not: the surface assertions passed
// unchanged with the submenu's height bound removed, because the submenu had never rendered.
const Menu = ({ subOpen }: { subOpen?: boolean }) => (
  <ContextMenu>
    <ContextMenuTrigger asChild>
      <div tabIndex={0} role="group" aria-label="Canvas">
        Right-click here
      </div>
    </ContextMenuTrigger>
    <ContextMenuContent>
      <ContextMenuItem>Duplicate</ContextMenuItem>
      <ContextMenuSub open={subOpen}>
        <ContextMenuSubTrigger>More</ContextMenuSubTrigger>
        <ContextMenuSubContent>
          <ContextMenuItem>Nested</ContextMenuItem>
        </ContextMenuSubContent>
      </ContextMenuSub>
    </ContextMenuContent>
  </ContextMenu>
);

// Explicit, because this package does not run vitest with globals, so testing-library never
// registers its own teardown: without this each render stacks on the last and a query that
// should match one element matches every copy left behind.
afterEach(cleanup);

const openMenu = (subOpen?: boolean) => {
  render(<Menu subOpen={subOpen} />);
  fireEvent.contextMenu(screen.getByText("Right-click here"));
  return screen.getAllByRole("menu");
};

describe("the menu surface", () => {
  it("bounds itself to the space it has, so a long menu scrolls rather than clipping", () => {
    const [menu] = openMenu();

    // The variable is what carries the measurement; a fixed max-height would be wrong at every
    // size except the one it was written for.
    expect(menu.className).toContain(
      "max-h-[var(--radix-context-menu-content-available-height)]"
    );
    expect(menu.className).toContain("overflow-y-auto");
  });

  it("gives a submenu the same bound as the root menu", () => {
    // A submenu opens beside its parent item, so it has LESS room left than the menu that
    // spawned it. This drifted once, with the submenu left on `overflow-hidden` and no bound.
    const menus = openMenu(true);

    expect(menus).toHaveLength(2);
    for (const menu of menus) {
      expect(menu.className).toContain(
        "max-h-[var(--radix-context-menu-content-available-height)]"
      );
      expect(menu.className).toContain("overflow-y-auto");
    }
  });
});

describe("reaching the menu without a pointer", () => {
  it("keeps the documented trigger focusable, which Radix does not do on its own", () => {
    // `asChild` hands the event handlers to the child and nothing else. A plain `div` trigger
    // takes right-clicks and is unreachable by Shift+F10, so the example carries `tabIndex`.
    render(<Menu />);
    const trigger = screen.getByRole("group", { name: "Canvas" });

    trigger.focus();

    expect(document.activeElement).toBe(trigger);
  });
});
