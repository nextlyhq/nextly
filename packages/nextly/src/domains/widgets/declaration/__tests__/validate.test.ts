/**
 * A widget declaration is checked as startup receives it, so a plugin written
 * in plain JavaScript, with no types to catch a mistake, is refused the same
 * way, and every fault is reported at once.
 *
 * Every declaration here is written as plain JavaScript would hand it over:
 * typed `unknown`, never through `defineWidget`, so nothing below leans on the
 * compiler. Each case changes ONE thing in an otherwise valid declaration, and
 * the valid one is asserted to pass, so a fault reported is the change's doing
 * and not some other part of the fixture.
 */
import { describe, expect, it } from "vitest";

import { NextlyError } from "../../../../errors/nextly-error";
import { MAX_WIDGET_SETTINGS } from "../../settings";
import { settings } from "../setting-builders";
import {
  assertWidgetDeclarations,
  collectWidgetDeclarationFaults,
  widgetDeclarationFaults,
} from "../validate";

/** A valid declaration drawn by a core view, as plain JavaScript. */
function valid(overrides: Record<string, unknown> = {}): unknown {
  return {
    id: "acme/orders-by-state",
    title: "Orders by state",
    description: "How many orders sit in each state",
    category: "Shop",
    size: {
      default: { w: 4, h: 4 },
      min: { w: 3, h: 3 },
      max: { w: 6, h: 6 },
    },
    settings: {
      collection: { type: "collection" },
      by: { type: "groupBy", of: "collection", defaultValue: "state" },
      top: { type: "number", defaultValue: 5, min: 1, max: 25 },
    },
    load: async () => ({ buckets: [] }),
    view: "bars",
    ...overrides,
  };
}

/** A valid declaration drawn by a component of its own. */
function validComponent(overrides: Record<string, unknown> = {}): unknown {
  return {
    id: "acme/revenue",
    title: "Revenue",
    description: "Takings per day",
    category: "Shop",
    size: { default: { w: 12, h: 4 } },
    load: async () => ({ total: 3 }),
    view: { component: "@acme/shop/admin#RevenueCard" },
    isEmpty: (data: { total: number }) => data.total === 0,
    ...overrides,
  };
}

/**
 * A valid declaration carrying every field startup accepts today, each
 * written correctly: `summary` is the one it does not, as it is refused until
 * the dashboard's header reads it.
 */
function everyField(): Record<string, unknown> {
  return {
    ...(valid() as Record<string, unknown>),
    icon: "chart-bar",
    access: "read-orders",
    shows: () => true,
    several: true,
    hidesWhenEmpty: true,
    isEmpty: (data: { buckets: unknown[] }) => data.buckets.length === 0,
    empty: {
      message: "No orders yet",
      action: { label: "Add an order", link: "collections/orders/create" },
    },
    preview: [
      { name: "Some paid", data: { buckets: [{ value: "paid", count: 3 }] } },
    ],
  };
}

/** The same declaration with one field taken out. */
function without(
  field: string,
  from: Record<string, unknown> = valid() as Record<string, unknown>
): unknown {
  const declaration = { ...from };
  delete declaration[field];
  return declaration;
}

/** The problems found, without the owner and widget every fault carries. */
const problemsOf = (declaration: unknown) =>
  widgetDeclarationFaults(declaration, 'plugin "@acme/shop"').map(
    fault => fault.problem
  );

describe("a widget declaration as startup receives it", () => {
  it("passes a valid declaration of each kind", () => {
    // The control every refusal below depends on: without it, a validator that
    // refused everything would pass them all.
    expect(problemsOf(valid())).toEqual([]);
    expect(problemsOf(validComponent())).toEqual([]);
  });

  describe("refuses each required field left out, and only those", () => {
    const required = ["id", "title", "description", "size", "load", "view"];
    // Every field in turn, from a declaration that has them all: the control
    // is the whole one passing, so each refusal is the missing field's doing.
    it("passes with every field", () => {
      expect(problemsOf(everyField())).toEqual([]);
    });
    it.each(Object.keys(everyField()))("%s", field => {
      const problems = problemsOf(without(field, everyField()));
      if (required.includes(field)) {
        expect(problems).toEqual([`${field} is required`]);
      } else {
        expect(problems).toEqual([]);
      }
    });
    it("names isEmpty as required for a view with its own component", () => {
      expect(
        problemsOf(
          without("isEmpty", validComponent() as Record<string, unknown>)
        )
      ).toEqual([
        "isEmpty is required for a view with its own component: core cannot tell when its data is empty",
      ]);
    });
  });

  it("refuses a size left out, or one the grid cannot draw", () => {
    expect(problemsOf(without("size"))).toEqual(["size is required"]);
    // A named width is not a size: grid units are the only ones there are.
    expect(problemsOf(valid({ size: "half" }))).toEqual([
      "size must be { default: { w, h }, min?, max? }",
    ]);
    const sized = (size: unknown) => problemsOf(valid({ size }));
    expect(sized({ default: { w: 13, h: 4 } })).toEqual([
      "size.default.w must be a whole number from 1 to 12, got 13",
    ]);
    expect(sized({ default: { w: 4, h: 1.5 } })).toEqual([
      "size.default.h must be a whole number from 2 to 12, got 1.5",
    ]);
    expect(
      problemsOf(valid({ size: { default: { w: 4, h: 4 }, max: "full" } }))
    ).toEqual(["size.max must be { w, h }"]);
  });

  it("refuses a minimum above the default, or a default above the maximum", () => {
    const sized = (min: unknown, max: unknown) =>
      problemsOf(valid({ size: { default: { w: 4, h: 4 }, min, max } }));
    // Larger in one direction is enough: the other is smaller in each case.
    expect(sized({ w: 6, h: 2 }, undefined)).toEqual([
      "size.min must not be larger than size.default",
    ]);
    expect(sized(undefined, { w: 6, h: 3 })).toEqual([
      "size.default must not be larger than size.max",
    ]);
  });

  it("names the removed width fields as fields a declaration does not have", () => {
    // 🔴 No second vocabulary: a declaration still written with named widths
    // is refused by name, beside the size it is missing, not read as one.
    const named = {
      ...(without("size") as Record<string, unknown>),
      widths: ["half", "full"],
      width: "half",
    };
    expect(problemsOf(named)).toEqual([
      '"widths" is not a field of a widget declaration',
      '"width" is not a field of a widget declaration',
      "size is required",
    ]);
  });

  it.each([
    ["not namespace/name", "orders-by-state"],
    ["upper case", "Acme/Orders"],
    ["a number", 7],
  ])("refuses an id that is %s", (_label, id) => {
    expect(problemsOf(valid({ id }))[0]).toContain("id");
  });

  it.each(["core", "collection", "single"])(
    "refuses an id in the reserved %s/ namespace",
    namespace => {
      expect(problemsOf(valid({ id: `${namespace}/orders` }))).toEqual([
        `id "${namespace}/orders" is in the reserved "${namespace}/" namespace; use your own, such as your package's name`,
      ]);
    }
  );

  it.each([
    ["a sentence", "Read orders"],
    ["a number", 3],
    ["the rule-facing spelling", "orders:read"],
  ])("refuses access that is %s", (_label, access) => {
    expect(problemsOf(valid({ access }))[0]).toContain(
      "access must be a permission name"
    );
  });

  it("accepts access as a permission name, and refuses `several` that is not a boolean", () => {
    expect(problemsOf(valid({ access: "read-orders" }))).toEqual([]);
    expect(problemsOf(valid({ several: "yes" }))[0]).toContain("several");
  });

  it("accepts access as the collections it reads or a predicate of the person, and shows as a function", () => {
    // Judged per card, with the person, before its load runs.
    expect(problemsOf(valid({ access: () => true }))).toEqual([]);
    expect(problemsOf(valid({ access: { collections: ["orders"] } }))).toEqual(
      []
    );
    expect(problemsOf(valid({ shows: () => true }))).toEqual([]);
    // And refuses each malformed one, by what is wrong with it.
    for (const collections of [[], ["orders", " "], "orders"]) {
      expect(
        problemsOf(valid({ access: { collections } })),
        String(collections)
      ).toEqual([
        "access.collections must be a list of the collections the widget reads, each named by its slug",
      ]);
    }
    expect(problemsOf(valid({ access: 3 }))).toEqual([
      'access must be a permission name such as "read-orders", { collections }, or a function of the person, got 3',
    ]);
    expect(problemsOf(valid({ shows: "always" }))).toEqual([
      "shows must be a function of the person asking",
    ]);
  });

  it("refuses an icon or a category that is given but blank", () => {
    expect(problemsOf(valid({ icon: " " }))).toEqual([
      "icon must be a non-empty string when given",
    ]);
    expect(problemsOf(valid({ category: "" }))).toEqual([
      "category must be a non-empty string when given",
    ]);
  });

  it("refuses a summary until the dashboard's header reads it, and names a malformed one's faults", () => {
    // 🔴 Typed already, but read by nothing yet: accepted, a summary would be
    // started and never shown, so it is refused like `shows`.
    expect(
      problemsOf(valid({ summary: { label: "Orders", count: async () => 1 } }))
    ).toEqual([
      "summary is available in a later release: until then a widget that declares it is not started, so a summary it states is never accepted and left unshown",
    ]);
    expect(problemsOf(valid({ summary: "Orders" }))).toEqual([
      "summary must be { label, count }",
    ]);
    expect(problemsOf(valid({ summary: { label: "", count: 3 } }))).toEqual([
      "summary.label must be a non-empty string",
      "summary.count must be a function that counts, as the person asking",
    ]);
  });

  it("accepts hidesWhenEmpty as a boolean, and refuses anything else", () => {
    expect(problemsOf(valid({ hidesWhenEmpty: true }))).toEqual([]);
    expect(problemsOf(valid({ hidesWhenEmpty: false }))).toEqual([]);
    expect(problemsOf(valid({ hidesWhenEmpty: "yes" }))).toEqual([
      "hidesWhenEmpty must be true or false",
    ]);
  });

  it.each([
    ["data", "load"],
    ["display", "view"],
    ["example", "preview"],
    ["permission", "access"],
  ])("names the old field %s by the one that took its place", (old, now) => {
    expect(problemsOf(valid({ [old]: "x" }))).toEqual([
      `"${old}" is not a field of a widget declaration; it is now "${now}"${old === "example" ? ", a list of named cases" : ""}`,
    ]);
  });

  it("names sketch as removed, the view drawing its own skeleton", () => {
    expect(problemsOf(valid({ sketch: "bars" }))).toEqual([
      '"sketch" is not a field of a widget declaration; it is removed: the add panel draws the view\'s own skeleton until it draws the preview cases',
    ]);
  });

  it("accepts each core view by its name, and refuses one that is neither a core view nor a component", () => {
    for (const view of ["figure", "list", "table", "bars", "series"]) {
      expect(problemsOf(valid({ view })), view).toEqual([]);
    }
    // Today's display names are not view names.
    expect(problemsOf(valid({ view: "metric" }))).toEqual([
      'view must be one of core\'s views (figure, list, table, bars, series) or { component: "<module>#<Export>" }, got "metric"',
    ]);
    expect(problemsOf(validComponent({ view: { component: " " } }))).toEqual([
      'view.component must name where the admin loads the component from, as "<module>#<Export>"',
    ]);
  });

  it("refuses a load that is not a function, naming the removed { query } form", () => {
    expect(problemsOf(valid({ load: "orders" }))).toEqual([
      "load must be a function of the card's settings and the person asking",
    ]);
    // 🔴 The query form is removed: a declaration still written with it is told
    // what to write instead, whether its query is a function or not.
    for (const query of [
      () => ({ collection: "orders", op: "count" }),
      "orders",
    ]) {
      expect(problemsOf(valid({ load: { query } }))).toEqual([
        "load must be a function: the { query } form is removed. Read with the services a load function is handed (count, find), which read as the person asking",
      ]);
    }
  });

  it("refuses preview data without the shape a core view draws, naming the view as declared", () => {
    expect(
      problemsOf(valid({ preview: [{ name: "One", data: { total: 3 } }] }))[0]
    ).toContain(
      'preview[0].data does not have the shape the "bars" view draws'
    );
    expect(
      problemsOf(
        valid({
          view: "figure",
          preview: [{ name: "One", data: { buckets: [] } }],
        })
      )[0]
    ).toContain('the "figure" view draws');
    expect(
      problemsOf(
        valid({
          preview: [
            { name: "One", data: { buckets: [{ value: "paid", count: 1 }] } },
          ],
        })
      )
    ).toEqual([]);
  });

  it("refuses preview cases that are not a list of named, distinct cases", () => {
    const data = { buckets: [] };
    expect(problemsOf(valid({ preview: { name: "One", data } }))).toEqual([
      "preview must be a list of cases, each { name, data, settings? }",
    ]);
    expect(
      problemsOf(
        valid({
          preview: [
            { name: "One", data },
            { name: "One", data },
            { name: "", data },
            { name: "Two", data, settings: "7d" },
            null,
          ],
        })
      )
    ).toEqual([
      'preview[1].name "One" is used by another case',
      "preview[2].name must be a non-empty string",
      "preview[3].settings must be an object of setting values",
      "preview[4] must be { name, data, settings? }",
    ]);
  });

  it("refuses a preview case that cannot be sent to the browser as it is", () => {
    const listOf = (data: unknown) =>
      valid({ view: "list", preview: [{ name: "Case", data }] });
    const row = (value: unknown) => listOf({ items: [{ id: value }] });
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    // The control: a row of plain values passes.
    expect(problemsOf(row("a"))).toEqual([]);
    // A sparse array: JSON writes its hole as `null`, so it does not arrive
    // as it was.
    expect(problemsOf(listOf({ items: Array(1) }))[0]).toContain(
      "preview[0].data cannot be sent to the browser"
    );
    // An array judged by its indices, as JSON reads it, not by an iterator
    // that answers something else.
    const disguised: unknown[] = [1n];
    Object.defineProperty(disguised, Symbol.iterator, {
      value: function* () {
        yield "safe";
      },
    });
    expect(problemsOf(listOf({ items: [{ tags: disguised }] }))[0]).toContain(
      "preview[0].data.items[0].tags[0] is a bigint"
    );
    for (const value of [1n, new Date(0), circular, () => 1, Symbol("s")]) {
      const [problem] = problemsOf(row(value));
      expect(problem, String(typeof value)).toContain(
        "preview[0].data cannot be sent to the browser"
      );
    }
  });

  it("refuses preview data holding NaN or an infinity, as it refuses a card's data", () => {
    // JSON writes NaN and both infinities as `null`, so the preview would draw a number the
    // case does not hold. The same rule a card's data is held to says so, in the same words.
    for (const [value, said] of [
      [NaN, "NaN"],
      [Infinity, "Infinity"],
      [-Infinity, "-Infinity"],
    ] as const) {
      expect(
        problemsOf(
          valid({
            view: "figure",
            preview: [{ name: "N", data: { total: value } }],
          })
        )
      ).toEqual([
        `preview[0].data cannot be sent to the browser as it is: preview[0].data.total is ${said}`,
      ]);
    }
  });

  it("refuses preview data with a symbol-keyed property, which JSON drops", () => {
    const tag = Symbol("tag");
    const listOf = (data: unknown) =>
      valid({ view: "list", preview: [{ name: "Case", data }] });
    // The value is safe; the KEY is what JSON throws away, so this is a
    // different refusal from a symbol held as a value.
    const [problem] = problemsOf(listOf({ items: [{ [tag]: "paid" }] }));
    expect(problem).toContain(
      "preview[0].data.items[0] has a property keyed by Symbol(tag), which JSON drops"
    );
    // A non-enumerable symbol key is not data JSON would have carried, as the
    // array's own iterator above is not, so it is not refused.
    const hidden = { id: "a" };
    Object.defineProperty(hidden, tag, { value: "paid", enumerable: false });
    expect(problemsOf(listOf({ items: [hidden] }))).toEqual([]);
  });

  it("names a value it cannot write out without failing to report it", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    // `JSON.stringify` throws on both; the fault must still be reported.
    expect(problemsOf(valid({ access: 1n }))[0]).toContain("got 1n");
    expect(problemsOf(valid({ access: circular }))[0]).toContain("access");
  });

  it("refuses a description of more than one line, and never over its length", () => {
    expect(problemsOf(valid({ description: "One\nTwo" }))[0]).toContain(
      "one line"
    );
    // 🔴 A long title or description starts: the add gallery truncates it, and
    // refusing to start over a sentence's length stops a whole site for nothing.
    expect(
      problemsOf(
        valid({ title: "T".repeat(500), description: "x".repeat(2000) })
      )
    ).toEqual([]);
  });

  describe("refuses invalid settings", () => {
    it("of a type no setting has", () => {
      expect(
        problemsOf(valid({ settings: { a: { type: "colour" } } }))[0]
      ).toContain('"colour"');
    });

    it("whose starting value does not fit", () => {
      expect(
        problemsOf(
          valid({
            settings: {
              tone: {
                type: "select",
                options: [{ label: "Calm", value: "calm" }],
                defaultValue: "loud",
              },
            },
          })
        )[0]
      ).toContain("tone");
    });

    it("accepts each of the Collection, Filter, Sort and Group by builders", () => {
      // The control for the refusals around it, and the four content
      // settings judged by core's own rules rather than a second set.
      expect(
        problemsOf(
          valid({
            settings: {
              collection: settings.collection(),
              where: settings.filter({ of: "collection" }),
              order: settings.sort({ of: "collection", default: "-updatedAt" }),
              by: settings.groupBy({ of: "collection" }),
            },
          })
        )
      ).toEqual([]);
    });

    it("whose dependency names no Collection setting of the widget", () => {
      expect(
        problemsOf(
          valid({
            settings: {
              collection: { type: "collection" },
              by: { type: "groupBy", of: "colection" },
            },
          })
        )
      ).toEqual([
        'setting "by" depends on "colection", which is not a Collection setting of this widget',
      ]);
    });

    it("beside one that is not a setting at all, naming every fault", () => {
      // A malformed entry is named by its key, and does not keep its
      // well-formed siblings from being judged in the same restart.
      const problems = problemsOf(
        valid({
          settings: {
            broken: null,
            limit: { type: "number", defaultValue: "five" },
            by: { type: "groupBy", of: "missing" },
          },
        })
      );
      expect(problems).toHaveLength(3);
      expect(problems[0]).toContain(
        'setting "broken" must be a setting declaration'
      );
      expect(problems[1]).toContain('setting "limit"');
      expect(problems[2]).toContain(
        'setting "by" depends on "missing", which is not a Collection setting of this widget'
      );
      expect(problems.join("\n")).not.toContain(
        "every setting must be an object"
      );
    });

    it("over the limit, still saying so when one is malformed", () => {
      const many = Object.fromEntries(
        Array.from({ length: MAX_WIDGET_SETTINGS }, (_, index) => [
          `s${index}`,
          { type: "number" },
        ])
      );
      const problems = problemsOf(valid({ settings: { ...many, broken: 7 } }));
      expect(problems.join("\n")).toContain(
        'setting "broken" must be a setting declaration'
      );
      expect(problems.join("\n")).toContain(
        `at most ${MAX_WIDGET_SETTINGS} settings`
      );
    });
  });

  describe("refuses a malformed empty state", () => {
    it("with a test that is not a function", () => {
      expect(problemsOf(valid({ isEmpty: "never" }))).toEqual([
        "isEmpty must be a function of the widget's data",
      ]);
    });

    it("with the test written inside it, where it was before", () => {
      expect(problemsOf(valid({ empty: { when: () => true } }))).toEqual([
        '"when" is not a field of empty; the test is now "isEmpty", beside it',
      ]);
      expect(problemsOf(valid({ empty: { title: "None" } }))).toEqual([
        '"title" is not a field of empty, which holds a message and an action',
      ]);
    });

    it("with a message of more than one line", () => {
      expect(
        problemsOf(valid({ empty: { message: "One\nTwo" } }))[0]
      ).toContain("empty.message");
    });

    it.each([
      ["without a label", { link: "collections/products/create" }],
      ["with an absolute link", { label: "Add", link: "https://x.test/a" }],
      ["with a link from the root", { label: "Add", link: "/admin/a" }],
      // A browser resolves these before it navigates, so each would leave the
      // admin from under its prefix.
      ["with a parent segment", { label: "Add", link: "../logout" }],
      [
        "with a parent segment further in",
        { label: "Add", link: "collections/../../account" },
      ],
      ["with an encoded parent segment", { label: "Add", link: "%2E%2e/x" }],
      [
        "with an encoded slash",
        { label: "Add", link: "collections%2f..%2f..%2fx" },
      ],
      [
        "with a segment that cannot be decoded",
        { label: "Add", link: "collections/%e0%a4" },
      ],
      [
        "with a permission that is not a permission name",
        { label: "Add", link: "collections/a", permission: "Add things" },
      ],
    ])("with an action %s", (_label, action) => {
      expect(problemsOf(valid({ empty: { action } }))[0]).toContain(
        "empty.action"
      );
    });

    it("with an action opening anything but the card's settings", () => {
      expect(
        problemsOf(
          valid({ empty: { action: { label: "Open", opens: "sheet" } } })
        )
      ).toEqual([
        'empty.action.opens must be "settings", the card\'s own settings, got "sheet"',
      ]);
    });

    it.each([
      ["a link", { link: "collections/orders" }],
      ["a permission", { permission: "update-orders" }],
    ])(
      "with an action that opens the settings and also names %s",
      (_label, extra) => {
        // One or the other: the frame would otherwise have to pick what a click does.
        expect(
          problemsOf(
            valid({
              empty: {
                action: { label: "Choose", opens: "settings", ...extra },
              },
            })
          )
        ).toEqual([
          'empty.action opens the card\'s settings, so it takes no link or permission: give either { label, link, permission? } or { label, opens: "settings" }',
        ]);
      }
    );

    it("with an action that opens the settings of a widget that declares none", () => {
      expect(
        problemsOf(
          validComponent({
            empty: { action: { label: "Choose", opens: "settings" } },
          })
        )
      ).toEqual([
        "empty.action opens the card's settings, but the widget declares none: declare the setting it asks for, or give a link instead",
      ]);
    });
  });

  it("accepts an empty action that opens the card's own settings", () => {
    // The control for the refusals above: a widget with settings, and the action alone.
    expect(
      problemsOf(
        valid({
          empty: {
            message: "Pick what to group by",
            action: { label: "Choose", opens: "settings" },
          },
        })
      )
    ).toEqual([]);
  });

  it("refuses a field a widget declaration does not have", () => {
    // A plugin may not remove, hide, replace or move another widget, so a
    // declaration carrying such a field is a mistake to name, not to ignore.
    expect(problemsOf(valid({ hide: ["core/team"] }))).toEqual([
      '"hide" is not a field of a widget declaration',
    ]);
  });

  it("reports every fault in one declaration, not only the first", () => {
    // One restart per mistake is what reporting at startup is meant to save,
    // so three faults in one declaration are three problems, in field order.
    expect(
      problemsOf(
        valid({
          title: "",
          size: { default: { w: 8, h: 4 }, max: { w: 6, h: 6 } },
          view: "pie",
        })
      )
    ).toEqual([
      "title must be a non-empty string",
      "size.default must not be larger than size.max",
      'view must be one of core\'s views (figure, list, table, bars, series) or { component: "<module>#<Export>" }, got "pie"',
    ]);
  });

  it("refuses something that is not a declaration at all", () => {
    expect(problemsOf("acme/orders")).toEqual([
      "a widget declaration must be an object",
    ]);
  });

  it("names the owner and the widget on every fault", () => {
    expect(
      widgetDeclarationFaults(valid({ title: "" }), "the site config")
    ).toEqual([
      expect.objectContaining({
        owner: "the site config",
        widget: "acme/orders-by-state",
      }),
    ]);
  });
});

describe("startup with several declarations", () => {
  it("reports every fault, from every plugin, at once", () => {
    const faults = collectWidgetDeclarationFaults([
      {
        owner: 'plugin "@acme/shop"',
        declarations: [
          valid({ title: 3 }),
          valid({ id: "acme/b", size: { default: { w: 0, h: 4 } } }),
        ],
      },
      {
        owner: 'plugin "@other/stats"',
        declarations: [validComponent({ id: "other/c", category: "" })],
      },
    ]);
    expect(faults.map(fault => `${fault.owner} ${fault.widget}`)).toEqual([
      'plugin "@acme/shop" acme/orders-by-state',
      'plugin "@acme/shop" acme/b',
      'plugin "@other/stats" other/c',
    ]);
  });

  it("lets core's own group, and only it, declare in core's namespace, and keeps it there", () => {
    const core = (id: string) =>
      collectWidgetDeclarationFaults([
        { owner: "core", core: true, declarations: [valid({ id })] },
      ]).map(fault => fault.problem);
    expect(core("core/orders")).toEqual([]);
    // Core's per-collection and per-Single namespaces are for the cards it
    // generates, and a core declaration outside `core/` is a slip to name.
    expect(core("acme/orders")).toEqual([
      'id "acme/orders" is one of core\'s own widgets, so it must be in the "core/" namespace',
    ]);
    expect(core("collection/orders")).toEqual([
      'id "collection/orders" is one of core\'s own widgets, so it must be in the "core/" namespace',
    ]);
    // The control: the same id from any other group is refused as reserved.
    expect(
      collectWidgetDeclarationFaults([
        {
          owner: 'plugin "@acme/shop"',
          declarations: [valid({ id: "core/orders" })],
        },
      ]).map(fault => fault.problem)
    ).toEqual([
      'id "core/orders" is in the reserved "core/" namespace; use your own, such as your package\'s name',
    ]);
  });

  it("refuses one id declared twice, naming both owners", () => {
    const faults = collectWidgetDeclarationFaults([
      { owner: 'plugin "@acme/shop"', declarations: [valid()] },
      { owner: "the site config", declarations: [valid()] },
    ]);
    expect(faults).toEqual([
      {
        owner: "the site config",
        widget: "acme/orders-by-state",
        problem:
          'id "acme/orders-by-state" is already declared by plugin "@acme/shop"',
      },
    ]);
  });

  it("throws one error whose detail lists every fault", () => {
    const groups = [
      {
        owner: 'plugin "@acme/shop"',
        declarations: [
          valid({ title: 3 }),
          valid({ id: "acme/b", size: { default: { w: 0, h: 4 } } }),
        ],
      },
      {
        owner: 'plugin "@other/stats"',
        declarations: [validComponent({ id: "other/c", category: "" })],
      },
    ];
    let thrown: unknown;
    try {
      assertWidgetDeclarations(groups);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(NextlyError);
    const error = thrown as NextlyError;
    expect(error.code).toBe("NEXTLY_PLUGIN_ADMIN_WIDGET_INVALID");
    // The public message stays generic; the detail is for the log a boot
    // failure is read in.
    expect(error.publicMessage).toBe("Plugin configuration is invalid.");
    expect(error.logMessage).toContain("3 widget declarations cannot work");
    expect(error.logMessage).toContain('plugin "@acme/shop", widget "acme/b"');
    expect(error.logMessage).toContain(
      'plugin "@other/stats", widget "other/c"'
    );
  });

  it("does not throw when every declaration is valid", () => {
    expect(() =>
      assertWidgetDeclarations([
        {
          owner: 'plugin "@acme/shop"',
          declarations: [valid(), validComponent()],
        },
      ])
    ).not.toThrow();
  });
});
