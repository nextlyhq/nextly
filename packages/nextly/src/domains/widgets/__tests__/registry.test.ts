import { beforeEach, describe, expect, it } from "vitest";

import type { WidgetDefinition } from "../definition";
import {
  clearWidgets,
  deregisterWidget,
  extendWidget,
  getWidget,
  listWidgets,
  overrideWidget,
  registerDeclaredDefinition,
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

  it("refuses an override whose definition claims a different id", () => {
    // `overrideWidget("core/a", def)` stores `def` under key "core/a", so a
    // `def.id` of "core/b" makes `getWidget("core/a")` answer with an object
    // announcing itself as "core/b" -- and leaves "core/b" free for someone
    // else to register alongside it. Anything keying off the definition's own
    // id (a picker, a layout, a diagnostic) then disagrees with the registry.
    registerWidget(def("core/totals"), { source: "core" });
    expect(() => overrideWidget("core/totals", def("stripe/revenue"))).toThrow(
      /stripe\/revenue/
    );
    expect(getWidget("core/totals")?.id).toBe("core/totals");
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
    extendWidget("core/totals", {
      title: "Revenue totals",
      size: { default: { w: 6, h: 4 } },
    });

    const patched = getWidget("core/totals");
    expect(patched?.title).toBe("Revenue totals");
    expect(patched?.size).toEqual({ default: { w: 6, h: 4 } });
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
      extendWidget("core/totals", {
        size: { default: { w: 8, h: 2 }, max: { w: 6, h: 2 } },
      })
    ).toThrow(/size\.default must not be larger than size\.max/);

    // A rejected patch must not be written even partially: the stored widget
    // keeps its own size, not the invalid one the patch tried to set. This
    // would stay green if validation ran AFTER the write.
    const survivor = getWidget("core/totals");
    expect(survivor?.size).toEqual({ default: { w: 3, h: 2 } });
  });

  it("stores a snapshot, so mutating the registered object changes nothing", () => {
    // Registration is the gate: `validateWidgetDefinition` runs, `extendWidget`
    // restricts a patch to named fields, and `overrideWidget` is the only way
    // to replace one wholesale. Keeping the caller's object by reference makes
    // all three optional -- a plugin holds the object it handed over and edits
    // it afterwards, changing the archetype or the query the host will execute
    // with nothing revalidating anything.
    const original = def("core/totals", { title: "Totals" });
    registerWidget(original, { source: "core" });

    original.title = "Hijacked";
    original.archetype = "custom";
    if (original.query) original.query.op = "list";

    const stored = getWidget("core/totals");
    expect(stored?.title).toBe("Totals");
    expect(stored?.archetype).toBe("metric");
    expect(stored?.query?.op).toBe("count");
  });

  it("hands out a definition the caller cannot mutate, at every depth", () => {
    // The other half: a snapshot taken at registration is undone if the
    // getter then hands the store's own object to anyone who asks.
    registerWidget(def("core/totals", { title: "Totals" }), { source: "core" });

    const stored = getWidget("core/totals") as WidgetDefinition;
    expect(() => {
      stored.title = "Hijacked";
    }).toThrow(TypeError);
    expect(() => {
      (stored.query as { op: string }).op = "list";
    }).toThrow(TypeError);

    expect(getWidget("core/totals")?.title).toBe("Totals");
    expect(listWidgets()[0].query?.op).toBe("count");
  });

  it("snapshots a patched widget too", () => {
    registerWidget(def("core/totals", { title: "Totals" }), { source: "core" });
    extendWidget("core/totals", { title: "Revenue totals" });

    const patched = getWidget("core/totals") as WidgetDefinition;
    expect(() => {
      patched.title = "Hijacked";
    }).toThrow(TypeError);
  });

  it("reports whether a deregistration removed anything", () => {
    registerWidget(def("core/totals"), { source: "core" });
    expect(deregisterWidget("core/totals")).toBe(true);
    expect(deregisterWidget("core/totals")).toBe(false);
    expect(getWidget("core/totals")).toBeUndefined();
  });
});

describe("the doors a widget whose data core builds may come through", () => {
  // A declared widget as core publishes it: its data is built on the server, so it has no query.
  const declared = (id: string): WidgetDefinition => {
    const { query: _query, ...rest } = def(id);
    return { ...rest, serverData: true };
  };

  it("comes in through core's own door, and through no public one", () => {
    registerDeclaredDefinition(declared("acme/orders"), "plugin @acme/shop");
    expect(getWidget("acme/orders")?.serverData).toBe(true);

    expect(() => registerWidget(declared("acme/other"))).toThrow(
      /registerWidget\(\) with serverData/
    );
    expect(getWidget("acme/other")).toBeUndefined();
  });

  it("is refused through a public door even untyped, as a spread of a published one carries it", () => {
    const spread = {
      ...def("acme/spread"),
      serverData: "yes",
    } as unknown as WidgetDefinition;
    expect(() => registerWidget(spread)).toThrow(/with serverData/);
  });

  it("is the only door an owner comes in by: a public one refuses a definition naming one", () => {
    const owned = {
      ...def("acme/owned"),
      owner: 'plugin "@acme/shop"',
    } as unknown as WidgetDefinition;
    expect(() => registerWidget(owned)).toThrow(
      /registerWidget\(\) with owner/
    );
    expect(getWidget("acme/owned")).toBeUndefined();
    expect(() => overrideWidget("acme/owned", owned)).toThrow(
      /overrideWidget\(\) with owner/
    );
  });

  it("cannot be replaced, since its card is answered from its declaration", () => {
    registerDeclaredDefinition(declared("acme/orders"), "plugin @acme/shop");
    expect(() => overrideWidget("acme/orders", def("acme/orders"))).toThrow(
      /"plugin @acme\/shop" declares it/
    );
    expect(getWidget("acme/orders")?.serverData).toBe(true);
    // Nor replaced by one that claims to be server-built, through the public door.
    expect(() =>
      overrideWidget("acme/orders", declared("acme/orders"))
    ).toThrow(/overrideWidget\(\) with serverData/);
  });

  it("cannot be handed a query by a patch", () => {
    registerDeclaredDefinition(declared("acme/orders"), "plugin @acme/shop");
    expect(() =>
      extendWidget("acme/orders", {
        query: { source: "collection:posts", op: "count" },
      })
    ).toThrow(/built on the server takes no query/);
    expect(getWidget("acme/orders")?.query).toBeUndefined();
  });

  it("admits only what core built: a definition without the mark is refused at core's door too", () => {
    let refused: unknown;
    try {
      registerDeclaredDefinition(def("acme/plain"), "plugin @acme/shop");
    } catch (error) {
      refused = error;
    }
    // Core's own fault, so an internal error whose detail is for the log only.
    expect(refused).toMatchObject({
      code: "INTERNAL_ERROR",
      logContext: {
        widgetId: "acme/plain",
        reason: "a declared widget was published without serverData",
      },
    });
    expect(getWidget("acme/plain")).toBeUndefined();
  });
});
