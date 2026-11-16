import { beforeEach, describe, expect, it } from "vitest";

import type { WidgetDefinition } from "../definition";
import {
  clearWidgets,
  deregisterWidget,
  getWidget,
  listWidgets,
  registerWidget,
} from "../registry";

const def = (
  id: string,
  over: Partial<WidgetDefinition> = {}
): WidgetDefinition => ({
  id,
  title: id,
  archetype: "metric",
  size: { default: { w: 3, h: 2 } },
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
    // The whole message, anchored: there is no door to replace a widget by,
    // so the refusal points at none.
    expect(() =>
      registerWidget(def("metrics/totals"), { source: "@acme/stripe" })
    ).toThrow(
      /^Widget id "metrics\/totals" is already registered by "core"; "@acme\/stripe" cannot claim it\.$/
    );
  });

  it("validates at registration", () => {
    expect(() => registerWidget(def("nonamespace"))).toThrow(/namespace\/name/);
  });

  it("refuses an id in a retired namespace, saying what replaced it, and keeps none", () => {
    // 🔴 Core no longer makes a card per collection or per Single. One
    // registered there would be offered, then refused by every layout write
    // and dropped by every read, so the registry refuses it at startup.
    expect(() => registerWidget(def("collection/x-count"))).toThrow(
      'Widget "collection/x-count" cannot be registered: "collection/x-count" is a retired card: core no longer makes a card per collection. Add Count, Breakdown, Over time or Recent entries and set its Collection to the collection this card showed.'
    );
    expect(() => registerWidget(def("single/about-card"))).toThrow(
      `Widget "single/about-card" cannot be registered: "single/about-card" is a retired card: core no longer makes a card per Single. A Single's edits show in Continue where you left off (core/continue).`
    );
    expect(listWidgets()).toEqual([]);
    // The control: the same definition outside those namespaces registers.
    registerWidget(def("acme/x-count"));
    expect(listWidgets().map(w => w.id)).toEqual(["acme/x-count"]);
  });

  it("stores a snapshot, so mutating the registered object changes nothing", () => {
    // Registration is the gate: `validateWidgetDefinition` runs there. Keeping
    // the caller's object by reference would make it optional -- whoever holds
    // the object it handed over could edit the archetype or a nested size
    // afterwards with nothing revalidating anything.
    const original = def("core/totals", { title: "Totals" });
    registerWidget(original, { source: "core" });

    original.title = "Hijacked";
    original.archetype = "custom";
    original.size.default.w = 12;

    const stored = getWidget("core/totals");
    expect(stored?.title).toBe("Totals");
    expect(stored?.archetype).toBe("metric");
    expect(stored?.size.default.w).toBe(3);
  });

  it("hands out a definition the caller cannot mutate, at every depth", () => {
    // The other half: a snapshot taken at registration is undone if the
    // getter then hands the store's own object to anyone who asks.
    registerWidget(def("core/totals", { title: "Totals" }), { source: "core" });

    const stored = getWidget("core/totals") as WidgetDefinition;
    expect(() => {
      stored.title = "Hijacked";
    }).toThrow(TypeError);
    // A nested field, so a freeze of the top level alone would not pass.
    expect(() => {
      (stored.size.default as { w: number }).w = 12;
    }).toThrow(TypeError);

    expect(getWidget("core/totals")?.title).toBe("Totals");
    expect(listWidgets()[0].size.default.w).toBe(3);
  });

  it("reports whether a deregistration removed anything", () => {
    registerWidget(def("core/totals"), { source: "core" });
    expect(deregisterWidget("core/totals")).toBe(true);
    expect(deregisterWidget("core/totals")).toBe(false);
    expect(getWidget("core/totals")).toBeUndefined();
  });
});

describe("a setting's own editor", () => {
  it("is kept with the widget, since every registered widget is a declaration core published", () => {
    // Every widget reaching the registry was published from a `defineWidget`
    // declaration, whose editors join the generated component map, so its
    // settings are judged as core's own and an editor is kept rather than
    // refused.
    const settings: WidgetDefinition["settings"] = [
      {
        name: "goal",
        label: "Goal",
        type: "number",
        editor: { component: "@acme/goals/admin#GoalEditor" },
      },
    ];
    registerWidget(def("acme/goal", { settings }), {
      source: "plugin @acme/goals",
    });
    expect(getWidget("acme/goal")?.settings?.[0]?.editor).toEqual({
      component: "@acme/goals/admin#GoalEditor",
    });
  });
});
