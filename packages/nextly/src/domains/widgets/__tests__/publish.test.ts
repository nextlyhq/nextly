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

// Generated cards are NOT published here. They are caller-dependent -- their id
// and title name a collection -- so the workspace route resolves them per
// reader and passes them in; `readableGeneratedWidgets` in
// `collection-widgets.test.ts` covers that filtering.
