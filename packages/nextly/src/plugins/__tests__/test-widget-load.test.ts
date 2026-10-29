/**
 * The card a test draws for each state a load can answer: the slot the
 * dashboard's route would carry, built through the server's own answer.
 */
import { describe, expect, it } from "vitest";

import { defineWidget } from "../../domains/widgets/declaration/define-widget";
import { publishedWidgetDefinition, widgetCardSlot } from "../test-widget-load";

const figure = defineWidget({
  id: "acme/open-orders",
  title: "Open orders",
  description: "Orders waiting to be sent",
  size: { default: { w: 6, h: 3 } },
  load: async () => ({ total: 0 }),
  view: "figure",
});

const own = defineWidget({
  id: "acme/notes",
  title: "Notes",
  description: "The team's notes",
  size: { default: { w: 6, h: 3 } },
  load: async () => ({ notes: ["Ship it"] }),
  view: { component: "@acme/notes/admin#NotesCard" },
  isEmpty: data => data.notes.length === 0,
});

describe("a card's slot for a load result", () => {
  it("carries a core view's data as core answers it, op added", () => {
    expect(
      widgetCardSlot(figure, { state: "ready", data: { total: 3 } })
    ).toEqual({
      ok: true,
      result: { op: "count", total: 3 },
    });
  });

  it("carries a view of the widget's own as its data", () => {
    expect(
      widgetCardSlot(own, { state: "empty", data: { notes: [] } })
    ).toEqual({
      ok: true,
      result: { op: "data", data: { notes: [] } },
      empty: true,
    });
  });

  it("is each failure the route answers with, by its code", () => {
    expect(widgetCardSlot(figure, { state: "unavailable" })).toMatchObject({
      ok: false,
      code: "unavailable",
    });
    expect(widgetCardSlot(figure, { state: "not-shown" })).toMatchObject({
      ok: false,
      code: "not-shown",
    });
    expect(
      widgetCardSlot(figure, { state: "needs-setting", setting: "Collection" })
    ).toEqual({
      ok: false,
      error: "No Collection chosen yet",
      code: "needs-setting",
      setting: "Collection",
    });
    expect(widgetCardSlot(figure, { state: "error", error: "Boom" })).toEqual({
      ok: false,
      error: "Boom",
    });
  });

  it("is none while the card loads", () => {
    expect(widgetCardSlot(figure, { state: "loading" })).toBeUndefined();
  });
});

describe("a widget's published definition", () => {
  it("is the registry's: data only, its view's archetype, its size filled in", () => {
    const definition = publishedWidgetDefinition(own);
    expect(definition).toMatchObject({
      id: "acme/notes",
      archetype: "custom",
      component: "@acme/notes/admin#NotesCard",
      serverData: true,
    });
    expect(definition).not.toHaveProperty("load");
    expect(definition).not.toHaveProperty("isEmpty");
  });
});
