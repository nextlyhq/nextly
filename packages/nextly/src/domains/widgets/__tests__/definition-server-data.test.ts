/**
 * A definition may say its card's data is built on the server, from the
 * widget's declaration, and then carries no query of its own.
 *
 * The controls matter as much as the acceptance: a data archetype without a
 * query and without the marker is still refused, so the marker is what lets it
 * through, and a definition carrying both is refused, so no card has two
 * answers to what it shows.
 */
import { describe, expect, it } from "vitest";

import { validateWidgetDefinition, type WidgetDefinition } from "../definition";

const BASE = {
  id: "acme/orders",
  title: "Orders",
  archetype: "metric",
  defaultSize: "md",
} as const satisfies Partial<WidgetDefinition>;

describe("a definition whose data is built on the server", () => {
  it("needs no query for a data archetype", () => {
    expect(() =>
      validateWidgetDefinition({ ...BASE, serverData: true })
    ).not.toThrow();
  });

  it("is still refused for a data archetype with neither", () => {
    expect(() => validateWidgetDefinition({ ...BASE })).toThrow(
      /requires a query/
    );
  });

  it("is refused when it also carries a query", () => {
    expect(() =>
      validateWidgetDefinition({
        ...BASE,
        serverData: true,
        query: { source: "collection:orders", op: "count" },
      })
    ).toThrow(/takes no query/);
  });

  it("is refused for any marker but true", () => {
    expect(() =>
      validateWidgetDefinition({
        ...BASE,
        serverData: "yes" as unknown as true,
      })
    ).toThrow(/serverData may only be true/);
  });
});
