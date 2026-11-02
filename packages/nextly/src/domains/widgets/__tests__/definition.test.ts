import { describe, expect, it } from "vitest";

import { validateWidgetDefinition, widgetValueProblem } from "../definition";

const valid = {
  id: "core/recent-entries",
  title: "Recently edited",
  archetype: "list" as const,
  size: { default: { w: 6, h: 4 } },
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

  it("requires a size", () => {
    // The resolved widget: a card with no size has nowhere on the grid to
    // start. A contribution may leave it out; a registration may not.
    const unsized = {
      id: valid.id,
      title: valid.title,
      archetype: valid.archetype,
    };
    expect(() => validateWidgetDefinition(unsized)).toThrow(
      /size is required, as \{ default: \{ w, h \}, min\?, max\? \}/
    );
  });

  it("refuses a named size where grid units are taken", () => {
    // 🔴 There is one size vocabulary. A named width or size is refused, not
    // translated, so no second vocabulary can reach the grid.
    expect(() => validateWidgetDefinition({ ...valid, size: "lg" })).toThrow(
      /size must be \{ default: \{ w, h \}, min\?, max\? \}/
    );
    expect(() =>
      validateWidgetDefinition({ ...valid, size: { default: "full" } })
    ).toThrow(/size\.default must be \{ w, h \}/);
  });

  it("refuses a width outside the twelve columns and a height below one row", () => {
    expect(() =>
      validateWidgetDefinition({ ...valid, size: { default: { w: 13, h: 4 } } })
    ).toThrow(/size\.default\.w must be a whole number from 1 to 12/);
    expect(() =>
      validateWidgetDefinition({ ...valid, size: { default: { w: 6, h: 0 } } })
    ).toThrow(/size\.default\.h must be a whole number from 2 to 12/);
    expect(() =>
      validateWidgetDefinition({
        ...valid,
        size: { default: { w: 6, h: 4 }, min: { w: 2.5, h: 4 } },
      })
    ).toThrow(/size\.min\.w must be a whole number/);
  });

  it("refuses a minimum above the default", () => {
    // The bounds are what a user may resize BETWEEN, and the default is what
    // they start at. A default under the floor means the widget renders at a
    // size no resize can return it to -- accepted at registration and
    // unreachable for the rest of its life.
    expect(() =>
      validateWidgetDefinition({
        ...valid,
        size: { default: { w: 4, h: 3 }, min: { w: 6, h: 3 } },
      })
    ).toThrow(/size\.min must not be larger than size\.default/);
  });

  it("refuses a default above the maximum, in either direction", () => {
    expect(() =>
      validateWidgetDefinition({
        ...valid,
        size: { default: { w: 8, h: 3 }, max: { w: 6, h: 3 } },
      })
    ).toThrow(/size\.default must not be larger than size\.max/);
    // Within the maximum's width but taller than it.
    expect(() =>
      validateWidgetDefinition({
        ...valid,
        size: { default: { w: 4, h: 4 }, max: { w: 12, h: 3 } },
      })
    ).toThrow(/size\.default must not be larger than size\.max/);
    // An unstated maximum is the full row at the default's height, so the
    // default always fits it.
    expect(() =>
      validateWidgetDefinition({ ...valid, size: { default: { w: 12, h: 6 } } })
    ).not.toThrow();
  });

  it("accepts a default sitting on either bound", () => {
    // The bounds are INCLUSIVE: the minimum is a size the user may resize to,
    // so a default equal to it is inside the range, not outside it.
    expect(() =>
      validateWidgetDefinition({
        ...valid,
        size: {
          default: { w: 3, h: 2 },
          min: { w: 3, h: 2 },
          max: { w: 6, h: 4 },
        },
      })
    ).not.toThrow();
    expect(() =>
      validateWidgetDefinition({
        ...valid,
        size: {
          default: { w: 6, h: 4 },
          min: { w: 3, h: 2 },
          max: { w: 6, h: 4 },
        },
      })
    ).not.toThrow();
  });

  it("judges a stated size the same way through the shared rule", () => {
    // `widgetValueProblem` is what the contributions channel asks, so a size
    // refused here is refused there with the same words.
    expect(
      widgetValueProblem({
        size: { default: { w: 8, h: 3 }, max: { w: 6, h: 3 } },
      })
    ).toBe("size.default must not be larger than size.max");
    expect(widgetValueProblem({})).toBeUndefined();
  });

  it("requires a component for the custom archetype and forbids one otherwise", () => {
    expect(() =>
      validateWidgetDefinition({ ...valid, archetype: "custom" })
    ).toThrow(/component/);
    expect(() =>
      validateWidgetDefinition({ ...valid, component: "pkg#Widget" })
    ).toThrow(/component/);
  });

  it("refuses an archetype outside the six it draws", () => {
    // Every widget is a declaration whose view maps onto one of core's
    // displays or onto its own component, so a name outside those, such as a
    // display core no longer draws, is refused naming the six it takes.
    for (const archetype of ["stats", "text", "actions", "pie"]) {
      expect(() =>
        validateWidgetDefinition({ ...valid, archetype } as never)
      ).toThrow(
        /archetype must be one of metric, table, list, bars, timeseries, custom/
      );
    }
    // The control: each of the six registers, `custom` with its component.
    for (const archetype of [
      "metric",
      "table",
      "list",
      "bars",
      "timeseries",
    ] as const) {
      expect(() =>
        validateWidgetDefinition({ ...valid, archetype })
      ).not.toThrow();
    }
    expect(() =>
      validateWidgetDefinition({
        ...valid,
        archetype: "custom",
        component: "pkg#Chart",
      })
    ).not.toThrow();
  });
});

describe("a custom widget's component must be able to resolve", () => {
  const custom = {
    id: "acme/chart",
    title: "Chart",
    archetype: "custom" as const,
    size: { default: { w: 6, h: 4 } },
  };

  it("accepts a real component path", () => {
    expect(() =>
      validateWidgetDefinition({ ...custom, component: "pkg#Chart" })
    ).not.toThrow();
  });

  it("refuses an empty component", () => {
    // `typeof d.component !== "string"` passes for `""`, so the archetype that
    // REQUIRES a component registered without a usable one -- the same broken
    // card requiring the field exists to prevent, reached through the check
    // meant to prevent it.
    expect(() =>
      validateWidgetDefinition({ ...custom, component: "" })
    ).toThrow(/requires a component path/);
  });

  it("refuses a whitespace-only component", () => {
    expect(() =>
      validateWidgetDefinition({ ...custom, component: "   " })
    ).toThrow(/requires a component path/);
  });
});

describe("defaultOrder places a widget without depending on which channel it came through", () => {
  // A data widget as core publishes one, with no query riding with it.
  const base = valid;

  it("accepts a definition that omits it", () => {
    // The control, and the compatibility bound: every widget that exists today
    // declares none, so an absent value must stay valid.
    expect(() => validateWidgetDefinition(base)).not.toThrow();
  });

  it("accepts any finite number, negative and fractional included", () => {
    // Not an index. A caller inserting between two neighbours should not have
    // to renumber them, which is the whole reason this is a number and not a
    // position.
    for (const defaultOrder of [0, 3, -1, 1.5]) {
      expect(() =>
        validateWidgetDefinition({ ...base, defaultOrder })
      ).not.toThrow();
    }
  });

  it("refuses a non-finite number", () => {
    // `1e400` is valid JSON and parses to Infinity, so this is reachable from a
    // decoded manifest rather than only from a test double. An Infinity sort
    // key is not a diagnosable position -- it silently pins the card to one end
    // and compares equal to every other Infinity.
    for (const defaultOrder of [Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() =>
        validateWidgetDefinition({ ...base, defaultOrder })
      ).toThrow();
    }
  });

  it("refuses a value that is not a number at all", () => {
    expect(() =>
      validateWidgetDefinition({ ...base, defaultOrder: "1" })
    ).toThrow();
  });
});

describe("every widget is framed", () => {
  const custom = {
    id: "core/team",
    title: "Team",
    archetype: "custom" as const,
    size: { default: { w: 6, h: 4 } },
    component: "core#TeamSummary",
  };

  it("accepts a widget that says nothing about its frame", () => {
    expect(() => validateWidgetDefinition(custom)).not.toThrow();
  });
});

describe("hidesWhenEmpty", () => {
  const custom = {
    id: "core/team",
    title: "Team",
    archetype: "custom" as const,
    size: { default: { w: 6, h: 4 } },
    component: "core#TeamSummary",
  };

  it("accepts true and false", () => {
    expect(() =>
      validateWidgetDefinition({ ...custom, hidesWhenEmpty: true })
    ).not.toThrow();
    expect(() =>
      validateWidgetDefinition({ ...custom, hidesWhenEmpty: false })
    ).not.toThrow();
  });

  it("refuses anything that is not a boolean", () => {
    // A truthy "false" would take a card off every reader's dashboard that
    // its author meant to keep.
    expect(() =>
      validateWidgetDefinition({ ...custom, hidesWhenEmpty: "false" } as never)
    ).toThrow(/hidesWhenEmpty, when given, must be a boolean/);
  });
});

describe("a declared permission", () => {
  it("is refused when it is not a slug or a list of them", () => {
    // The field was declared and never checked, and the gap failed OPEN: the
    // dashboard's server filter reads "not a string" as "no permission
    // declared", so a widget whose author wrote `requiredPermission: { read:
    // true }` was gated for nobody and returned to every authenticated caller.
    // Refusing the declaration is the only place the mistake is still visible
    // to the person who made it.
    expect(widgetValueProblem({ requiredPermission: { read: true } })).toMatch(
      /requiredPermission, when given, must be a permission slug/
    );
    expect(widgetValueProblem({ requiredPermission: 42 })).toMatch(
      /requiredPermission/
    );
  });

  it("accepts a slug this core has never minted", () => {
    // Shape, not vocabulary. A newer core may mint new slugs; it cannot make a
    // slug stop being a string, and refusing an unknown one here would abort a
    // whole plugin install over a permission this core has not learned yet.
    expect(
      widgetValueProblem({ requiredPermission: "invent-something" })
    ).toBeUndefined();
    expect(widgetValueProblem({})).toBeUndefined();
  });

  it("accepts an anyOf gate", () => {
    expect(
      widgetValueProblem({
        requiredPermission: {
          anyOf: ["read-content-releases", "create-content-releases"],
        },
      })
    ).toBeUndefined();
  });

  /*
   * 🔴 The forms an any-of group allows to go wrong, each refused for the same
   * reason the object above is: they are PRESENT and unusable, and the gate
   * reads an unusable declaration as a refusal. Admitting them here while the
   * gate refuses them would hide a card with no error anywhere -- and admitting
   * an empty `anyOf` is worse than that, because "any of nothing" is satisfied
   * by nobody, so it would silently mean the opposite of what its author
   * plainly wrote. A bare list is no gate at all: it reads as "any" to one
   * author and "all" to the next.
   */
  it.each([
    ["an empty anyOf", { anyOf: [] }],
    ["an anyOf with an empty member", { anyOf: ["read-posts", ""] }],
    ["an anyOf with a non-slug member", { anyOf: ["read-posts", 7] }],
    ["a bare list", ["read-posts", "create-posts"]],
    ["an empty string", ""],
  ])("refuses %s", (_label, requiredPermission) => {
    expect(widgetValueProblem({ requiredPermission })).toMatch(
      /requiredPermission/
    );
  });
});

describe("a widget's empty state and settings", () => {
  it("may carry an empty state's words and action, which core publishes from its declaration", () => {
    const empty = {
      message: "No orders yet",
      action: { label: "Add", link: "collections/orders" },
    };
    expect(() => validateWidgetDefinition({ ...valid, empty })).not.toThrow();
    // Its shape is still judged: a message that is only spaces is not text.
    expect(() =>
      validateWidgetDefinition({ ...valid, empty: { message: "  " } })
    ).toThrow(/empty has a message or an action that is not text/);
  });

  it("may hold content settings, which reach its declaration's load", () => {
    // Every published widget is answered by its declaration's `load`, which
    // reads its settings as it chooses, so a Collection setting and a filter
    // on it are judged as core's own query reads them and admitted.
    const collection = {
      name: "collection",
      label: "Collection",
      type: "collection",
    };
    const filter = {
      name: "filter",
      label: "Filter",
      type: "filter",
      of: "collection",
    };
    expect(() =>
      validateWidgetDefinition({ ...valid, settings: [collection, filter] })
    ).not.toThrow();
  });
});

describe("a widget's add panel terms", () => {
  it("accepts a widget that allows several cards", () => {
    expect(() =>
      validateWidgetDefinition({ ...valid, allowsSeveral: true })
    ).not.toThrow();
  });

  it("sketches its row with one of core's displays, or not at all", () => {
    expect(() =>
      validateWidgetDefinition({ ...valid, sketch: "bars" })
    ).not.toThrow();
    expect(() => validateWidgetDefinition({ ...valid, sketch: "pie" })).toThrow(
      /sketch must be one of/
    );
  });

  it("says whether a dashboard may hold several only as true or false", () => {
    expect(() =>
      validateWidgetDefinition({ ...valid, allowsSeveral: "yes" })
    ).toThrow(/allowsSeveral must be true or false/);
  });
});

describe("an offered mode", () => {
  const collection = { name: "collection", type: "collection" as const };

  it("registers a widget offered per collection beside its Collection setting", () => {
    expect(() =>
      validateWidgetDefinition({
        ...valid,
        offered: "per-collection",
        settings: [collection],
      })
    ).not.toThrow();
  });

  it("refuses a widget offered per collection that declares no Collection setting", () => {
    // Its add-panel rows each start a card set to a collection; with no such
    // setting it could be added nowhere.
    expect(() =>
      validateWidgetDefinition({ ...valid, offered: "per-collection" })
    ).toThrow(/offered per collection needs a Collection setting/);
  });

  it("refuses an offered mode it does not know", () => {
    // 🔴 Read as an ordinary widget, a misspelt mode is placed by default with
    // no collection to read.
    expect(() =>
      validateWidgetDefinition({
        ...valid,
        offered: "per-colletion" as "per-collection",
      })
    ).toThrow(
      /has offered "per-colletion", which is not one of per-collection, on-request/
    );
  });
});
