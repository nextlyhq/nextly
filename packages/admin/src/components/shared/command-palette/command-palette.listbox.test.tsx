// @vitest-environment jsdom
/**
 * The palette's list holds only its groups and rows.
 *
 * The list is a `listbox`, which may own only options and their groups, and
 * the palette draws a divider between its groups inside it. The divider comes
 * from the kit's `CommandSeparator`, which hides itself from screen readers so
 * the list stays valid; this pins that the palette gets that default rather
 * than a separator a screen reader meets as a stray child of the list.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { CommandPalette } from "./index";

afterEach(cleanup);

function Bare({ children }: { children: ReactNode }): ReactElement {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("the command palette's list", () => {
  it("draws the divider between groups without giving the list a separator child", () => {
    render(<CommandPalette />, { wrapper: Bare });
    act(() => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "k",
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        })
      );
    });

    const list = screen.getByRole("listbox");
    const dividers = list.querySelectorAll("[cmdk-separator]");
    // Drawn: the line between Navigation and the actions is still there.
    expect(dividers.length).toBeGreaterThan(0);
    // Not met by a screen reader as a child of the list.
    for (const divider of dividers) {
      expect(divider.getAttribute("aria-hidden")).toBe("true");
    }
    expect(within(list).queryAllByRole("separator")).toEqual([]);
  });
});
