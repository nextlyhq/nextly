// @vitest-environment jsdom
/**
 * A page may ask for its panel to start folded away (a builder that needs the
 * width). Folded, the panel is released through chrome suppression, so it
 * takes no width; the bar shows a toggle at its left end; and the reader's
 * choice is remembered for that page, so the next visit starts the same way.
 * A page that asks nothing keeps its panel and gets no toggle.
 */
import { act, cleanup, render, screen } from "@testing-library/react";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  ChromeSuppressionProvider,
  useSuppressedChrome,
} from "../ChromeSuppression";
import { PanelFoldProvider, useFoldedPanel, usePanelFold } from "../PanelFold";

function FoldingPage({ id }: { id: string }): React.JSX.Element {
  useFoldedPanel(id);
  return <p>page</p>;
}

/** Reads what the shell would: whether the panel is released, and the fold. */
function Probe(): React.JSX.Element {
  const released = useSuppressedChrome().has("subSidebar");
  const { declared, open, toggle } = usePanelFold();
  return (
    <div>
      <span data-testid="released">{String(released)}</span>
      <span data-testid="declared">{declared ?? "none"}</span>
      <button type="button" onClick={toggle} aria-pressed={open}>
        toggle
      </button>
    </div>
  );
}

function Shell({ children }: { children?: React.ReactNode }) {
  return (
    <ChromeSuppressionProvider>
      <PanelFoldProvider>
        <Probe />
        {children}
      </PanelFoldProvider>
    </ChromeSuppressionProvider>
  );
}

const released = () => screen.getByTestId("released").textContent;

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

describe("a folding panel", () => {
  it("starts folded on a page that asks for it", () => {
    render(
      <Shell>
        <FoldingPage id="forms.builder" />
      </Shell>
    );
    expect(released()).toBe("true");
    expect(screen.getByTestId("declared").textContent).toBe("forms.builder");
  });

  it("opens from the toggle and remembers the choice for that page", () => {
    const { unmount } = render(
      <Shell>
        <FoldingPage id="forms.builder" />
      </Shell>
    );
    act(() => screen.getByRole("button", { name: "toggle" }).click());
    expect(released()).toBe("false");
    unmount();

    // The next visit to the same page starts open.
    render(
      <Shell>
        <FoldingPage id="forms.builder" />
      </Shell>
    );
    expect(released()).toBe("false");
  });

  it("remembers each page apart", () => {
    const { unmount } = render(
      <Shell>
        <FoldingPage id="forms.builder" />
      </Shell>
    );
    act(() => screen.getByRole("button", { name: "toggle" }).click());
    unmount();

    render(
      <Shell>
        <FoldingPage id="schema.builder" />
      </Shell>
    );
    expect(released()).toBe("true");
  });

  it("leaves a page that asks nothing with its panel, and offers no fold", () => {
    render(<Shell />);
    expect(released()).toBe("false");
    expect(screen.getByTestId("declared").textContent).toBe("none");
  });

  it("returns the panel when the folding page goes", () => {
    const { rerender } = render(
      <Shell>
        <FoldingPage id="forms.builder" />
      </Shell>
    );
    expect(released()).toBe("true");
    rerender(<Shell />);
    expect(released()).toBe("false");
    expect(screen.getByTestId("declared").textContent).toBe("none");
  });
});
