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
    // The id itself must not contain either source's name, or a message that
    // drops one claimant entirely can still satisfy a regex that only checks
    // for the substrings' presence somewhere in the failure.
    registerWidget(def("metrics/totals"), { source: "core" });
    expect(() =>
      registerWidget(def("metrics/totals"), { source: "@acme/stripe" })
    ).toThrow(/"core"/);
    expect(() =>
      registerWidget(def("metrics/totals"), { source: "@acme/stripe" })
    ).toThrow(/"@acme\/stripe"/);
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

  it("refuses to override a widget that was never registered", () => {
    // This guard is what stops a plugin bypassing registerWidget's duplicate-id
    // check by calling overrideWidget instead -- overrideWidget must never be
    // usable to create a widget, only to replace one that already exists.
    expect(() =>
      overrideWidget("metrics/missing", def("metrics/missing"))
    ).toThrow(/metrics\/missing/);
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

  it("re-validates the result of a patch, leaving the store unmutated", () => {
    registerWidget(def("core/totals"), { source: "core" });
    expect(() =>
      extendWidget("core/totals", { minSize: "xl", maxSize: "sm" })
    ).toThrow(/minSize/);

    // A rejected patch must not be written even partially: the stored widget
    // still has no minSize/maxSize bounds, not the invalid ones the patch
    // tried to set. This would stay green if validation ran AFTER the write.
    const survivor = getWidget("core/totals");
    expect(survivor?.minSize).toBeUndefined();
    expect(survivor?.maxSize).toBeUndefined();
  });

  it("reports whether a deregistration removed anything", () => {
    registerWidget(def("core/totals"), { source: "core" });
    expect(deregisterWidget("core/totals")).toBe(true);
    expect(deregisterWidget("core/totals")).toBe(false);
    expect(getWidget("core/totals")).toBeUndefined();
  });
});
