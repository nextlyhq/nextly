// @vitest-environment jsdom
/**
 * The highlighted command's label colour.
 *
 * jsdom applies no stylesheet, so this pins the CLASSES the item carries, and
 * the light and dark axe scans in the e2e suite check what they draw. The
 * label is the foreground colour: the primary is a fill colour, and on a site
 * whose brand primary is a mid-tone it falls short of AA as small text. The
 * primary's light tint stays as the highlight.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Command, CommandItem, CommandList } from "./command";

describe("the highlighted command's label", () => {
  it("is drawn in the foreground colour on the primary's tint", () => {
    // jsdom draws no layout: the list observes its size and scrolls its
    // highlighted item into view, and neither exists there.
    Element.prototype.scrollIntoView ??= () => {};
    globalThis.ResizeObserver ??= class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
    render(
      <Command>
        <CommandList>
          <CommandItem>Close the editor</CommandItem>
        </CommandList>
      </Command>
    );

    const classes = (
      screen.getByRole("option").getAttribute("class") ?? ""
    ).split(/\s+/);
    expect(classes).toContain("data-[selected=true]:text-foreground");
    expect(classes).toContain("aria-selected:text-foreground");
    expect(classes).not.toContain("data-[selected=true]:text-primary");
    expect(classes).not.toContain("aria-selected:text-primary");
    expect(classes).toContain("data-[selected=true]:bg-primary/5");
  });
});
