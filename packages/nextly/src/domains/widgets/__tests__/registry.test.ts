import { beforeEach, describe, expect, it } from "vitest";

import type { WidgetDefinition } from "../definition";
import {
  clearWidgets,
  deregisterWidget,
  extendWidget,
  getWidget,
  listWidgets,
  overrideWidget,
  registerWidget,
} from "../registry";

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

describe("widget registry", () => {
  it("holds core and plugin widgets in one store", () => {
    registerWidget(def("core/totals"), { source: "core" });
    registerWidget(def("stripe/revenue"), { source: "@acme/stripe" });

    expect(
      listWidgets()
        .map(w => w.id)
        .sort()
    ).toEqual(["core/totals", "stripe/revenue"]);
  });

  it("names both claimants when two sources register one id", () => {
    registerWidget(def("core/totals"), { source: "core" });
    expect(() =>
      registerWidget(def("core/totals"), { source: "@acme/stripe" })
    ).toThrow(/core.*@acme\/stripe|@acme\/stripe.*core/);
  });

  it("validates at registration", () => {
    expect(() => registerWidget(def("nonamespace"))).toThrow(/namespace\/name/);
  });

  it("lets a plugin replace a core widget wholesale", () => {
    registerWidget(def("core/totals", { title: "Totals" }), { source: "core" });
    overrideWidget("core/totals", def("core/totals", { title: "Our totals" }), {
      source: "@acme/stripe",
    });
    expect(getWidget("core/totals")?.title).toBe("Our totals");
  });

  it("lets a plugin patch named fields of a core widget", () => {
    registerWidget(def("core/totals", { title: "Totals" }), { source: "core" });
    extendWidget("core/totals", { title: "Revenue totals", defaultSize: "lg" });

    const patched = getWidget("core/totals");
    expect(patched?.title).toBe("Revenue totals");
    expect(patched?.defaultSize).toBe("lg");
    // Untouched fields survive.
    expect(patched?.archetype).toBe("metric");
  });

  it("refuses to patch a widget that was never registered", () => {
    expect(() => extendWidget("core/missing", { title: "x" })).toThrow(
      /core\/missing/
    );
  });

  it("re-validates the result of a patch", () => {
    registerWidget(def("core/totals"), { source: "core" });
    expect(() =>
      extendWidget("core/totals", { minSize: "xl", maxSize: "sm" })
    ).toThrow(/minSize/);
  });

  it("reports whether a deregistration removed anything", () => {
    registerWidget(def("core/totals"), { source: "core" });
    expect(deregisterWidget("core/totals")).toBe(true);
    expect(deregisterWidget("core/totals")).toBe(false);
    expect(getWidget("core/totals")).toBeUndefined();
  });
});
