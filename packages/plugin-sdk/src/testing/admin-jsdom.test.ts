// @vitest-environment jsdom
/**
 * `renderWidgetCard` where a plugin author's card test runs it: under jsdom,
 * with nothing mocked. The module loads with `window` defined, its `nextly`
 * and admin imports included, and the card it builds renders into the
 * document through the admin's own renderer.
 *
 * `admin.test.ts` captures the card builder instead, so only this file loads
 * the real graph. Loading it is the property: `nextly/testing`'s harness
 * refuses to load where `window` is defined, and an import of it anywhere in
 * that graph fails this file before a test runs.
 */
import type { defineWidget as DefineWidget } from "nextly";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renderWidgetCard } from "./admin";

// `defineWidget` hands its declaration back as it came, so this declares
// through its signature without loading `nextly`'s root entry: that entry
// carries the server, and refuses to load where `window` is defined.
const declareWidget = ((declaration: object) =>
  declaration) as typeof DefineWidget;

/**
 * jsdom has no `ResizeObserver`, which the card's frame measures itself with;
 * the admin's own test setup supplies the same stand-in. Nothing here resizes,
 * so an observer that never reports is the whole of what the card needs.
 */
class SilentResizeObserver {
  observe(): void {
    // Never reports a size: nothing in these tests resizes.
  }
  unobserve(): void {
    // Nothing is held, so nothing to release.
  }
  disconnect(): void {
    // Nothing is held, so nothing to release.
  }
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", SilentResizeObserver);
});

const openOrders = declareWidget({
  id: "acme/open-orders",
  title: "Open orders",
  description: "Orders waiting to be sent",
  size: { default: { w: 6, h: 3 } },
  load: async () => ({ total: 0 }),
  view: "figure",
});

let root: Root | undefined;

afterEach(() => {
  root?.unmount();
  root = undefined;
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

/** Renders `element` into the document now, and answers its container. */
function draw(element: Parameters<Root["render"]>[0]): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  const mounted = createRoot(container);
  root = mounted;
  flushSync(() => mounted.render(element));
  return container;
}

/** The card region, and the title its label points at. */
function card(container: HTMLElement): { region: Element; title: string } {
  const region = container.querySelector('[role="region"]');
  if (region === null) throw new Error("no card region was rendered");
  const titleId = region.getAttribute("aria-labelledby") ?? "";
  return {
    region,
    title: document.getElementById(titleId)?.textContent ?? "",
  };
}

describe("a widget's card under jsdom", () => {
  it("renders what a load answered, titled as the dashboard titles it", () => {
    const drawn = card(
      draw(
        renderWidgetCard(openOrders, {
          result: { state: "ready", data: { total: 41 } },
        })
      )
    );
    expect(drawn.title).toBe("Open orders");
    expect(drawn.region.getAttribute("data-state")).toBe("ready");
    expect(drawn.region.textContent).toContain("41");
  });

  it("renders a hand-made state in the scheme asked for", () => {
    const container = draw(
      renderWidgetCard(openOrders, { state: "unavailable", theme: "dark" })
    );
    expect(card(container).region.getAttribute("data-state")).toBe(
      "unavailable"
    );
    expect(container.querySelector('[data-theme="dark"]')).not.toBeNull();
  });
});
