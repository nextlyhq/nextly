// @vitest-environment jsdom
/**
 * The palette is exported for embedding, and is routinely rendered OUTSIDE the admin shell.
 *
 * `apps/playground/src/app/layout.tsx` mounts it as a SIBLING of the routed children, so the
 * shell's provider is not an ancestor of it. React context does not reach siblings, so a shortcut
 * registered here would throw and the enclosing error boundary would replace the application.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { CommandPalette } from "./index";

afterEach(cleanup);

/**
 * Deliberately NOT the shared test render: that one supplies a `ShortcutProvider`, which is the
 * very thing this asserts the palette does not need from its host.
 */
function Bare({ children }: { children: ReactNode }): ReactElement {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("the command palette rendered outside the admin shell", () => {
  it("mounts without a shortcut provider around it", () => {
    expect(() => render(<CommandPalette />, { wrapper: Bare })).not.toThrow();
  });

  it("still registers its keys, so bringing its own provider is not the same as having none", () => {
    // The control. Mounting without throwing would also be satisfied by a palette that quietly
    // registered nothing, which is the failure this fix could plausibly have introduced.
    const view = render(<CommandPalette />, { wrapper: Bare });

    // Wrapped, because opening the palette is a state update: without it React has not flushed
    // by the time the assertion reads the DOM, and the test would fail for a reason unrelated to
    // whether the shortcut registered.
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

    // Asserted on rendered TEXT rather than the input's placeholder, which is an attribute and
    // never appears in `textContent`.
    expect(view.baseElement.textContent).toContain("Dashboard");
  });
});
