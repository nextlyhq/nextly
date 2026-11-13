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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PluginMetadata } from "@admin/types/branding";

import {
  ChromeSuppressionProvider,
  useSuppressedChrome,
} from "../ChromeSuppression";
import {
  PanelFoldProvider,
  useCollectionFoldedPanel,
  useFoldedPanel,
  usePanelFold,
} from "../PanelFold";

/** The plugins the admin metadata answered with, or none while it has not. */
let answered: PluginMetadata[] | undefined;

vi.mock("@admin/context/providers/BrandingProvider", () => ({
  useBranding: () => (answered === undefined ? {} : { plugins: answered }),
}));

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

beforeEach(() => {
  window.localStorage.clear();
  answered = undefined;
});
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

/** A collection's document screen, or the frame's outline of one. */
function CollectionScreen({ slug }: { slug?: string }): React.JSX.Element {
  useCollectionFoldedPanel(slug);
  return <p>screen</p>;
}

describe("a collection whose plugin declares its screens folded", () => {
  const forms: PluginMetadata = {
    name: "@acme/forms",
    collections: ["forms"],
    foldedPanels: ["forms"],
  };

  it("folds its screens, and only its own", () => {
    answered = [forms];
    const { rerender } = render(
      <Shell>
        <CollectionScreen slug="forms" />
      </Shell>
    );
    expect(released()).toBe("true");
    expect(screen.getByTestId("declared").textContent).toBe(
      "collections/forms"
    );

    rerender(
      <Shell>
        <CollectionScreen slug="posts" />
      </Shell>
    );
    expect(released()).toBe("false");
    rerender(
      <Shell>
        <CollectionScreen />
      </Shell>
    );
    expect(released()).toBe("false");
    expect(screen.getByTestId("declared").textContent).toBe("none");
  });

  it("stays folded as the screen replaces the frame's outline of it", () => {
    answered = [forms];
    // The outline and the screen each declare it; between them the panel
    // never opens, so the frame does not move.
    const { rerender } = render(
      <Shell>
        <CollectionScreen key="outline" slug="forms" />
      </Shell>
    );
    expect(released()).toBe("true");
    rerender(
      <Shell>
        <CollectionScreen key="screen" slug="forms" />
      </Shell>
    );
    expect(released()).toBe("true");
  });

  it("opens where the reader opened it on any entry of the collection", () => {
    answered = [forms];
    const { unmount } = render(
      <Shell>
        <CollectionScreen slug="forms" />
      </Shell>
    );
    act(() => screen.getByRole("button", { name: "toggle" }).click());
    unmount();

    render(
      <Shell>
        <CollectionScreen slug="forms" />
      </Shell>
    );
    expect(released()).toBe("false");
  });
});
