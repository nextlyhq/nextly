/**
 * What the registry publishes to the admin.
 *
 * The assertions are about the PAYLOAD a browser would receive, not about the
 * round-trip helper having been called: a widget that cannot survive
 * `JSON.stringify` must cost itself its card and nothing else, because the
 * alternative -- the workspace response failing for every admin -- is the
 * failure this projection exists to avoid.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setNextlyLogger } from "../../../observability/logger";
import type { WidgetDefinition } from "../definition";
import { publishableWidgets } from "../publish";
import { setGeneratedWidgets } from "../collection-widgets";
import { clearWidgets, registerWidget } from "../registry";

const def = (
  id: string,
  over: Partial<WidgetDefinition> = {}
): WidgetDefinition => ({
  id,
  title: id,
  archetype: "metric",
  defaultSize: "sm",
  query: { source: "collection:posts", op: "count" },
  ...over,
});

beforeEach(() => clearWidgets());
afterEach(() => setNextlyLogger(undefined));

describe("publishableWidgets", () => {
  it("publishes a widget the app registered through the public API", () => {
    registerWidget(def("acme/revenue", { title: "Revenue" }), {
      source: "@acme/stripe",
    });

    expect(publishableWidgets()).toEqual([
      {
        id: "acme/revenue",
        title: "Revenue",
        archetype: "metric",
        defaultSize: "sm",
        query: { source: "collection:posts", op: "count" },
      },
    ]);
  });

  it("publishes nothing when nothing is registered", () => {
    expect(publishableWidgets()).toEqual([]);
  });

  it("drops only the widget JSON cannot carry, and keeps its neighbours", () => {
    const error = vi.fn();
    setNextlyLogger({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error,
    });

    registerWidget(def("acme/before"), { source: "@acme/a" });
    registerWidget(
      // A `BigInt` under `where` is type-legal (`Record<string, unknown>`) and
      // `structuredClone` stores it, so the registry's own gate lets it in.
      def("acme/bigint", {
        query: {
          source: "collection:posts",
          op: "count",
          where: { views: { greater_than: 10n } },
        },
      } as Partial<WidgetDefinition>),
      { source: "@acme/b" }
    );
    registerWidget(def("acme/after"), { source: "@acme/c" });

    expect(publishableWidgets().map(w => w.id)).toEqual([
      "acme/before",
      "acme/after",
    ]);
    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "widget-not-serializable",
        widget: "acme/bigint",
      })
    );
  });
});

describe("the generated cards reach the admin", () => {
  const generated = def("collection/posts-count", {
    archetype: "metric",
    query: { source: "collection:posts", op: "count" },
  });

  afterEach(() => setGeneratedWidgets([]));

  it("publishes a card nobody registered", () => {
    // 🔴 This is the seam that makes a generated card real. The admin renders
    // from this payload and from plugin contributions, and a generated widget
    // is in neither unless it is put here -- so without this the layout
    // endpoint would offer an id the grid has no declaration to draw.
    setGeneratedWidgets([generated]);
    expect(publishableWidgets().map(w => w.id)).toEqual([
      "collection/posts-count",
    ]);
  });

  it("lets an explicit registration REPLACE the generated card of that id", () => {
    // A generated card is core's guess at something useful; a registration of
    // the same id is an author saying what that card should be. The reader gets
    // one card, and it is the author's.
    setGeneratedWidgets([generated]);
    registerWidget(def("collection/posts-count", { title: "Mine" }));

    const published = publishableWidgets();
    expect(published).toHaveLength(1);
    expect(published[0].title).toBe("Mine");
  });
});
