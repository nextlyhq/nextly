// @vitest-environment jsdom
/**
 * The palette's dialog is named and described.
 *
 * Without a name a screen reader announces "dialog" and nothing more, and
 * axe-core's `aria-dialog-name` fails it; the search field's placeholder names
 * the field, not the dialog around it. The kit's `CommandDialog` draws the
 * name, hidden, and the palette says what it offers in a description.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen } from "@testing-library/react";
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

describe("the command palette's dialog", () => {
  it("is named and described for a screen reader", () => {
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

    const dialog = screen.getByRole("dialog", { name: "Command palette" });
    const described = document.getElementById(
      dialog.getAttribute("aria-describedby") ?? ""
    );
    expect(described?.textContent).toBe(
      "Go to a page, run an action or find a user, and press Enter to choose it."
    );
  });
});
