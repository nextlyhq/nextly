// @vitest-environment jsdom

/**
 * A page that shows two headers, or two footers: the notice above the
 * canvas, its three ways on, and the dismissal kept per person and page
 * until the page's set or its own header block changes.
 *
 * @module admin/editor/two-regions-notice.test
 */
import type { BlockNode } from "@nextlyhq/blocks-engine";
import { COMPONENT_INSTANCE_TYPE } from "@nextlyhq/blocks-engine";
import type { PreferenceStore } from "@nextlyhq/builder";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { LayoutArea } from "../../collections/areas";

import { TwoRegionsNotices } from "./two-regions-notice";

afterEach(cleanup);

const section = (id: string, as: string): BlockNode => ({
  id,
  type: "core/section",
  version: 1,
  props: { as },
});

const placed = (id: string, componentId: string): BlockNode => ({
  id,
  type: COMPONENT_INSTANCE_TYPE,
  version: 1,
  props: { componentId },
});

const cards = (setId = "set-1", setTitle = "Foursight") =>
  (["header", "footer"] as const).map(area => ({ area, setId, setTitle }));

function memoryStore(initial: string | null = null): PreferenceStore & {
  value: string | null;
} {
  const store = {
    value: initial,
    read: () => store.value,
    write: (next: string) => {
      store.value = next;
    },
  };
  return store;
}

const HEADER_WORDS =
  "This page shows two headers: the site header (Foursight) and a header block on the page.";
const FOOTER_WORDS =
  "This page shows two footers: the site footer (Foursight) and a footer block on the page.";

function draw({
  nodes,
  regionCards = cards(),
  store = memoryStore(),
  pageId = "page-1",
  componentArea = (): LayoutArea | undefined => undefined,
  onSelect = vi.fn(),
  onOpenSettings = vi.fn(),
}: {
  nodes: BlockNode[];
  regionCards?: ReturnType<typeof cards>;
  store?: PreferenceStore;
  pageId?: string | null;
  componentArea?: (id: string) => LayoutArea | undefined;
  onSelect?: (id: string) => void;
  onOpenSettings?: () => void;
}) {
  const props = {
    nodes,
    cards: regionCards,
    componentArea,
    pageId,
    store,
    onSelect,
    onOpenSettings,
  };
  const view = render(<TwoRegionsNotices {...props} />);
  return {
    ...view,
    redraw: (next: Partial<typeof props>) =>
      view.rerender(<TwoRegionsNotices {...props} {...next} />),
  };
}

describe("TwoRegionsNotices", () => {
  it("says the page shows two headers, naming the set, with its three ways on", () => {
    draw({ nodes: [section("own-header", "header")] });

    expect(screen.getByText(HEADER_WORDS)).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Select the page's header" })
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Change in Page settings" })
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Dismiss" })).toBeTruthy();
  });

  it("says the same for footers, and for a placed component used as the footer", () => {
    draw({
      nodes: [placed("p1", "c-foot")],
      componentArea: id => (id === "c-foot" ? "footer" : undefined),
    });

    expect(screen.getByText(FOOTER_WORDS)).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Select the page's footer" })
    ).toBeTruthy();
    expect(screen.queryByText(HEADER_WORDS)).toBeNull();
  });

  it("says nothing while the page shows one header", () => {
    draw({ nodes: [section("s", "section")] });
    expect(screen.queryByText(HEADER_WORDS)).toBeNull();
  });

  it("says nothing while the page's set shows no header", () => {
    draw({
      nodes: [section("own-header", "header")],
      regionCards: cards().filter(card => card.area === "footer"),
    });
    expect(screen.queryByText(HEADER_WORDS)).toBeNull();
  });

  it("selects the page's own header block", () => {
    const onSelect = vi.fn();
    draw({
      nodes: [section("own-header", "header"), section("second", "header")],
      onSelect,
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Select the page's header" })
    );
    expect(onSelect).toHaveBeenCalledWith("own-header");
  });

  it("opens Page settings for the header & footer choice", () => {
    const onOpenSettings = vi.fn();
    draw({ nodes: [section("own-header", "header")], onOpenSettings });

    fireEvent.click(
      screen.getByRole("button", { name: "Change in Page settings" })
    );
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it("stays dismissed for this page and person, after a reload too", () => {
    const store = memoryStore();
    const nodes = [section("own-header", "header")];
    draw({ nodes, store });

    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByText(HEADER_WORDS)).toBeNull();

    cleanup();
    draw({ nodes, store });
    expect(screen.queryByText(HEADER_WORDS)).toBeNull();
  });

  it("dismisses only that area: the footer notice stays", () => {
    draw({
      nodes: [section("own-header", "header"), section("own-footer", "footer")],
    });

    const [headerDismiss] = screen.getAllByRole("button", { name: "Dismiss" });
    fireEvent.click(headerDismiss as HTMLElement);
    expect(screen.queryByText(HEADER_WORDS)).toBeNull();
    expect(screen.getByText(FOOTER_WORDS)).toBeTruthy();
  });

  it("comes back when the page's own header block changes", () => {
    const view = draw({ nodes: [section("own-header", "header")] });
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));

    view.redraw({ nodes: [section("another-header", "header")] });
    expect(screen.getByText(HEADER_WORDS)).toBeTruthy();
  });

  it("comes back when the page's header & footer choice changes", () => {
    const view = draw({ nodes: [section("own-header", "header")] });
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));

    view.redraw({ cards: cards("set-2", "Foursight") });
    expect(screen.getByText(HEADER_WORDS)).toBeTruthy();
  });

  it("is another page's notice to dismiss: dismissing here leaves it there", () => {
    const store = memoryStore();
    const nodes = [section("own-header", "header")];
    draw({ nodes, store });
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));

    cleanup();
    draw({ nodes, store, pageId: "page-2" });
    expect(screen.getByText(HEADER_WORDS)).toBeTruthy();
  });

  it("reads a store that holds something else as nothing dismissed", () => {
    draw({
      nodes: [section("own-header", "header")],
      store: memoryStore("{not json"),
    });
    expect(screen.getByText(HEADER_WORDS)).toBeTruthy();
  });

  it("announces what it says to a screen reader", () => {
    draw({ nodes: [section("own-header", "header")] });
    expect(screen.getByRole("status").textContent).toBe(HEADER_WORDS);
  });
});
