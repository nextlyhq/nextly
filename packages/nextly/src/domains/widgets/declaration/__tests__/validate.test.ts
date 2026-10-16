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
import {
  assertWidgetDeclarations,
  collectWidgetDeclarationFaults,
  widgetDeclarationFaults,
} from "../validate";

/** A valid declaration drawn by a core display, as plain JavaScript. */
function valid(overrides: Record<string, unknown> = {}): unknown {
  return {
    id: "acme/orders-by-state",
    title: "Orders by state",
    description: "How many orders sit in each state",
    category: "Shop",
    widths: ["1/3", "1/2"],
    width: "1/2",
    settings: {
      collection: { type: "collection" },
      by: { type: "groupBy", of: "collection", defaultValue: "state" },
      top: { type: "number", defaultValue: 5, min: 1, max: 25 },
    },
    data: async () => ({ buckets: [] }),
    display: "bars",
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
    widths: ["full"],
    width: "full",
    data: { query: () => ({ collection: "orders", op: "count" }) },
    display: { component: "@acme/shop/admin#RevenueCard" },
    ...overrides,
  };
}

/** The same declaration with one field taken out. */
function without(field: string): unknown {
  const declaration = { ...(valid() as Record<string, unknown>) };
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

  describe("refuses each required field left out", () => {
    it.each(["id", "title", "description", "category", "data", "display"])(
      "%s",
      field => {
        const problems = problemsOf(without(field));
        expect(problems).toHaveLength(1);
        expect(problems[0]).toContain(field);
      }
    );
  });

  it("refuses widths left out, empty, or holding something that is not a width", () => {
    expect(problemsOf(without("widths"))[0]).toContain("widths");
    expect(problemsOf(valid({ widths: [] }))[0]).toContain("widths");
    expect(
      problemsOf(valid({ widths: ["1/2", "half"], width: "1/2" }))[0]
    ).toContain('"half"');
  });

  it("refuses a starting width the widget does not allow", () => {
    expect(problemsOf(valid({ width: "full" }))).toEqual([
      'width "full" is not one of the widths it allows (1/3, 1/2)',
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
  ])("refuses a permission that is %s", (_label, permission) => {
    expect(problemsOf(valid({ permission }))[0]).toContain("permission");
  });

  it("accepts a permission name, and refuses `several` that is not a boolean", () => {
    expect(problemsOf(valid({ permission: "read-orders" }))).toEqual([]);
    expect(problemsOf(valid({ several: "yes" }))[0]).toContain("several");
  });

  it("refuses a sketch that names no core display", () => {
    expect(problemsOf(valid({ sketch: "pie" }))[0]).toContain("sketch");
    expect(problemsOf(valid({ sketch: "bars" }))).toEqual([]);
  });

  it("refuses a display that is neither a core display nor a component", () => {
    expect(problemsOf(valid({ display: "pie" }))[0]).toContain("display");
    expect(
      problemsOf(validComponent({ display: { component: " " } }))[0]
    ).toContain("component");
  });

  it("refuses data that is neither a data function nor a query", () => {
    expect(problemsOf(valid({ data: "orders" }))[0]).toContain("data");
    expect(problemsOf(valid({ data: { query: "orders" } }))[0]).toContain(
      "query"
    );
  });

  it("refuses example data without the shape a core display draws", () => {
    expect(problemsOf(valid({ example: { total: 3 } }))[0]).toContain(
      "example"
    );
    expect(
      problemsOf(valid({ example: { buckets: [{ value: "paid", count: 1 }] } }))
    ).toEqual([]);
  });

  it("refuses an example that cannot be sent to the browser as it is", () => {
    const row = (value: unknown) =>
      valid({ display: "list", example: { items: [{ id: value }] } });
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    // The control: a row of plain values passes.
    expect(problemsOf(row("a"))).toEqual([]);
    // A sparse array: JSON writes its hole as `null`, so it does not arrive
    // as it was.
    expect(
      problemsOf(valid({ display: "list", example: { items: Array(1) } }))[0]
    ).toContain("example cannot be sent to the browser");
    // An array judged by its indices, as JSON reads it, not by an iterator
    // that answers something else.
    const disguised: unknown[] = [1n];
    Object.defineProperty(disguised, Symbol.iterator, {
      value: function* () {
        yield "safe";
      },
    });
    expect(
      problemsOf(
        valid({ display: "list", example: { items: [{ tags: disguised }] } })
      )[0]
    ).toContain("example.items[0].tags[0] is a bigint");
    for (const value of [1n, new Date(0), circular, () => 1, Symbol("s")]) {
      const [problem] = problemsOf(row(value));
      expect(problem, String(typeof value)).toContain(
        "example cannot be sent to the browser"
      );
    }
  });

  it("names a value it cannot write out without failing to report it", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    // `JSON.stringify` throws on both; the fault must still be reported.
    expect(problemsOf(valid({ width: 1n }))[0]).toContain("got 1n");
    expect(problemsOf(valid({ width: circular }))[0]).toContain("width");
  });

  it("refuses a description of more than one line or 80 characters", () => {
    expect(problemsOf(valid({ description: "One\nTwo" }))[0]).toContain(
      "one line"
    );
    expect(problemsOf(valid({ description: "x".repeat(81) }))[0]).toContain(
      "80"
    );
    expect(problemsOf(valid({ description: "x".repeat(80) }))).toEqual([]);
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
  });

  describe("refuses a malformed empty state", () => {
    it("with a test that is not a function", () => {
      expect(problemsOf(valid({ empty: { when: "never" } }))[0]).toContain(
        "empty.when"
      );
    });

    it("on a component widget, with no test", () => {
      expect(
        problemsOf(validComponent({ empty: { message: "Nothing yet" } }))[0]
      ).toContain("empty.when");
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
      [
        "with a permission that is not a permission name",
        { label: "Add", link: "collections/a", permission: "Add things" },
      ],
    ])("with an action %s", (_label, action) => {
      expect(problemsOf(valid({ empty: { action } }))[0]).toContain(
        "empty.action"
      );
    });
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
      problemsOf(valid({ title: "", width: "full", sketch: "pie" }))
    ).toEqual([
      "title must be a non-empty string",
      'width "full" is not one of the widths it allows (1/3, 1/2)',
      'sketch must name one of core\'s displays (metric, table, list, bars, timeseries), got "pie"',
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
          valid({ id: "acme/b", width: "full" }),
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
          valid({ id: "acme/b", width: "full" }),
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
