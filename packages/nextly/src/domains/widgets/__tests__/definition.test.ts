import { describe, expect, it } from "vitest";

import { validateWidgetDefinition } from "../definition";

const valid = {
  id: "core/recent-entries",
  title: "Recently edited",
  archetype: "list" as const,
  defaultSize: "lg" as const,
  query: { source: "collection:posts", op: "list" as const, limit: 5 },
};

describe("validateWidgetDefinition", () => {
  it("accepts a well-formed definition", () => {
    expect(() => validateWidgetDefinition(valid)).not.toThrow();
  });

  it("refuses an id that is not namespace/name", () => {
    // Namespacing is what lets two plugins ship a widget with the same short
    // name, and what makes a collision message able to say who owns which.
    expect(() => validateWidgetDefinition({ ...valid, id: "recent" })).toThrow(
      /namespace\/name/
    );
  });

  it("refuses a size outside the enum", () => {
    expect(() =>
      validateWidgetDefinition({ ...valid, defaultSize: "gigantic" })
    ).toThrow(/defaultSize/);
  });

  it("refuses a minSize larger than maxSize", () => {
    expect(() =>
      validateWidgetDefinition({ ...valid, minSize: "xl", maxSize: "sm" })
    ).toThrow(/minSize/);
  });

  it("requires a component for the custom archetype and forbids one otherwise", () => {
    expect(() =>
      validateWidgetDefinition({ ...valid, archetype: "custom" })
    ).toThrow(/component/);
    expect(() =>
      validateWidgetDefinition({ ...valid, component: "pkg#Widget" })
    ).toThrow(/component/);
  });

  it("requires a query for every archetype that reads data", () => {
    const { query: _omitted, ...noQuery } = valid;
    expect(() => validateWidgetDefinition(noQuery)).toThrow(/query/);
  });

  it("allows text and actions archetypes to carry no query", () => {
    expect(() =>
      validateWidgetDefinition({
        id: "core/notes",
        title: "Notes",
        archetype: "text",
        defaultSize: "md",
      })
    ).not.toThrow();
  });

  it("FORBIDS a query on text and actions, both directions like component", () => {
    // The interface says "Required for every data archetype; forbidden for
    // `text` and `actions`", and only the first half was enforced. A `text`
    // widget carrying a query is a declaration whose author expected data and
    // whose renderer will never ask for any -- accepted at registration,
    // silently inert afterwards. `validateComponent` beside it already checks
    // both directions; this now matches.
    expect(() =>
      validateWidgetDefinition({
        id: "core/notes",
        title: "Notes",
        archetype: "text",
        defaultSize: "md",
        query: { source: "collection:posts", op: "list", limit: 5 },
      })
    ).toThrow(/query is only valid for/);

    expect(() =>
      validateWidgetDefinition({
        id: "core/shortcuts",
        title: "Shortcuts",
        archetype: "actions",
        defaultSize: "md",
        query: { source: "collection:posts", op: "count", limit: 5 },
      })
    ).toThrow(/query is only valid for/);
  });

  it("still allows a query on the custom archetype", () => {
    // The negative control, and the reason the forbidden set is named rather
    // than inferred as "everything that is not a data archetype": `custom`
    // draws itself and may legitimately want core to run its query.
    expect(() =>
      validateWidgetDefinition({
        id: "core/chart",
        title: "Chart",
        archetype: "custom",
        defaultSize: "md",
        component: "pkg#Chart",
        query: { source: "collection:posts", op: "count", limit: 5 },
      })
    ).not.toThrow();
  });
});
