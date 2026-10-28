/**
 * What a widget may declare, and what a stored value means.
 *
 * 🔴 The two halves pull in opposite directions on purpose. A malformed
 * DECLARATION is refused, because it belongs to the author running the boot who
 * can fix it. A malformed stored VALUE is tolerated, because it belongs to a
 * reader who cannot — and a card that refuses to draw is a worse answer than
 * one drawn the way its author intended.
 */
import { describe, expect, it } from "vitest";

import { NextlyError } from "../../../errors/nextly-error";
import type { PublishedContentSource } from "../publish";
import type { SourcelessWidgetQuery } from "../query";
import {
  type AnyWidgetSetting,
  applyWidgetSettings,
  CONTENT_SETTING_NOT_DRAWN,
  effectiveWidgetSettings,
  fieldsSettingQueryProblem,
  MAX_CHOSEN_FIELDS,
  MAX_WIDGET_SETTINGS,
  resolveWidgetSettings,
  validateWidgetSettings,
  widgetSettingsProblem,
  widgetSettingsProblems,
  type WidgetSetting,
} from "../settings";

const limit: WidgetSetting = {
  name: "limit",
  type: "number",
  label: "Rows",
  defaultValue: 5,
};
const compact: WidgetSetting = {
  name: "compact",
  type: "checkbox",
  defaultValue: false,
};

describe("validateWidgetSettings refuses what an author can fix", () => {
  it("accepts a declaration and undefined alike", () => {
    expect(() =>
      validateWidgetSettings([limit, compact], "core/x")
    ).not.toThrow();
    expect(() => validateWidgetSettings(undefined, "core/x")).not.toThrow();
  });

  it("refuses a duplicate name", () => {
    // Two settings of one name make the resolved value depend on read order,
    // which the author cannot see.
    expect(() =>
      validateWidgetSettings([limit, { ...limit, label: "Other" }], "core/x")
    ).toThrow(/duplicate setting "limit"/);
  });

  it("refuses a type the admin cannot draw", () => {
    expect(() =>
      validateWidgetSettings(
        [{ name: "body", type: "richText" } as never],
        "core/x"
      )
    ).toThrow(/expected one of/);
  });

  it("refuses a nameless setting", () => {
    expect(() =>
      validateWidgetSettings([{ type: "text" } as never], "core/x")
    ).toThrow(/non-empty "name"/);
  });

  /*
   * 🔴 A function default is refused rather than called. `defaultValue` may be
   * a thunk on a collection field; a widget definition is serialized to the
   * admin as JSON, where a function simply disappears — so the setting would
   * silently have no default at all.
   */
  it("refuses a function default, which could not cross the wire", () => {
    expect(() =>
      validateWidgetSettings(
        [{ name: "limit", type: "number", defaultValue: () => 5 } as never],
        "core/x"
      )
    ).toThrow(/function default/);
  });

  it("takes rows on a Collection setting alone, and only titled", () => {
    expect(() =>
      validateWidgetSettings(
        [{ name: "collection", type: "collection", rows: "titled" }],
        "core/x"
      )
    ).not.toThrow();
    expect(() =>
      validateWidgetSettings(
        [{ name: "note", type: "text", rows: "titled" } as never],
        "core/x"
      )
    ).toThrow(/declares rows, which only a Collection setting takes/);
    expect(() =>
      validateWidgetSettings(
        [{ name: "collection", type: "collection", rows: "all" } as never],
        "core/x"
      )
    ).toThrow(/has rows "all"; expected "titled"/);
  });

  /*
   * 🔴 A default is judged by the SAME predicate a stored value is. A stored
   * value that fails it falls back to the default; a DEFAULT that fails it is
   * what everything falls back to, so nothing downstream can correct it — the
   * string reached the query where a row count goes.
   */
  it("refuses a default that is not a value of its own type", () => {
    expect(() =>
      validateWidgetSettings(
        [{ name: "limit", type: "number", defaultValue: "ten" }],
        "core/x"
      )
    ).toThrow(/limit/);
    expect(() =>
      validateWidgetSettings(
        [{ name: "compact", type: "checkbox", defaultValue: "yes" }],
        "core/x"
      )
    ).toThrow(/compact/);
  });

  it("accepts a default that IS a value of its own type", () => {
    // The control. A rule that refused every default would satisfy the case
    // above while making `defaultValue` undeclarable.
    expect(() =>
      validateWidgetSettings(
        [{ name: "limit", type: "number", defaultValue: 10 }],
        "core/x"
      )
    ).not.toThrow();
  });

  it("refuses a number default JSON cannot carry", () => {
    // `NaN` and the infinities are numbers that serialize to `null`, so a
    // default declared as one arrives at the admin absent -- the same outcome
    // as the function default beside it, reached by a different route.
    expect(() =>
      validateWidgetSettings(
        [{ name: "limit", type: "number", defaultValue: Number.NaN }],
        "core/x"
      )
    ).toThrow(/limit/);
  });

  it("refuses a select that offers no options", () => {
    // A select with nothing to choose can hold no value at all, so every
    // stored one falls back and the form draws an empty control.
    expect(() =>
      validateWidgetSettings([{ name: "mode", type: "select" }], "core/x")
    ).toThrow(/options/);
    expect(() =>
      validateWidgetSettings(
        [{ name: "mode", type: "select", options: [] }],
        "core/x"
      )
    ).toThrow(/options/);
    expect(() =>
      validateWidgetSettings(
        [{ name: "mode", type: "select", options: [{ value: "a" }] }],
        "core/x"
      )
    ).toThrow(/options/);
  });

  it("refuses a select default that is not one of its options", () => {
    expect(() =>
      validateWidgetSettings(
        [
          {
            name: "mode",
            type: "select",
            defaultValue: "gone",
            options: [{ label: "A", value: "a" }],
          },
        ],
        "core/x"
      )
    ).toThrow(/gone/);
  });

  it("accepts a select default that IS one of its options", () => {
    // The control for the pair above: the options rule must still permit a
    // well-formed select, or the two refusals could be one rule rejecting all.
    expect(() =>
      validateWidgetSettings(
        [
          {
            name: "mode",
            type: "select",
            defaultValue: "a",
            options: [{ label: "A", value: "a" }],
          },
        ],
        "core/x"
      )
    ).not.toThrow();
  });

  it("refuses a select option whose value is blank", () => {
    // `FieldRenderer` hands each option to a Radix `SelectItem`, which reserves
    // the empty string for "nothing selected" and throws rather than rendering
    // -- so an author's blank value crashes the panel for the first reader to
    // open it. Whitespace too: it is blank to everything except `!== ""`.
    for (const value of ["", "   "]) {
      expect(() =>
        validateWidgetSettings(
          [
            {
              name: "mode",
              type: "select",
              options: [{ label: "None", value }],
            },
          ],
          "core/x"
        )
      ).toThrow(/options/);
    }
  });

  it("refuses a number default outside the range the setting declares", () => {
    expect(() =>
      validateWidgetSettings(
        [{ name: "limit", type: "number", min: 1, max: 10, defaultValue: 20 }],
        "core/x"
      )
    ).toThrow(/range/);
  });

  it("accepts a number default inside the range", () => {
    // The control for the pair: a bounds check that refused everything would
    // satisfy the case above while making a bounded setting undeclarable.
    expect(() =>
      validateWidgetSettings(
        [{ name: "limit", type: "number", min: 1, max: 10, defaultValue: 5 }],
        "core/x"
      )
    ).not.toThrow();
  });

  it("refuses bounds that are not finite numbers, or a range nothing satisfies", () => {
    expect(() =>
      validateWidgetSettings(
        [{ name: "limit", type: "number", min: "one" }],
        "core/x"
      )
    ).toThrow(/finite number/);
    // An empty range makes every value fall back -- including the default,
    // which falls back to itself -- so the setting is permanently unusable.
    expect(() =>
      validateWidgetSettings(
        [{ name: "limit", type: "number", min: 10, max: 1 }],
        "core/x"
      )
    ).toThrow(/no value can satisfy/);
  });

  /*
   * 🔴 The refusal must survive the value it is describing. `JSON.stringify`
   * throws on a BigInt, so building the diagnostic threw a native `TypeError`
   * before the `NextlyError` it was describing could be raised -- and the
   * author saw an error naming neither the widget nor the setting.
   */
  it("refuses a BigInt default as a NextlyError, not a TypeError", () => {
    let caught: unknown;
    try {
      validateWidgetSettings(
        [{ name: "limit", type: "number", defaultValue: 1n }],
        "core/x"
      );
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(NextlyError);
    expect((caught as Error).message).toMatch(/limit/);
  });

  /*
   * 🔴 The same, for the value no fallback could print: a cycle defeats
   * `JSON.stringify`, and an object with no prototype has no `toString` for
   * `String()` to call, so a formatter falling back from one to the other
   * threw on both and the refusal never reached the author.
   */
  it("refuses a cyclic prototype-free default as a NextlyError naming the setting", () => {
    const cyclic = Object.create(null) as Record<string, unknown>;
    cyclic.self = cyclic;
    let caught: unknown;
    try {
      validateWidgetSettings(
        [{ name: "limit", type: "number", defaultValue: cyclic }],
        "core/x"
      );
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(NextlyError);
    expect((caught as Error).message).toMatch(/"limit" is typed "number"/);
  });

  it("refuses more settings than the ceiling allows", () => {
    const many = Array.from({ length: MAX_WIDGET_SETTINGS + 1 }, (_, i) => ({
      name: `s${i}`,
      type: "text" as const,
    }));
    expect(() => validateWidgetSettings(many, "core/x")).toThrow(/at most/);
  });
});

describe("resolveWidgetSettings reads a stored value without punishing it", () => {
  const declared = [limit, compact];

  it("takes a stored value that matches its declared type", () => {
    expect(resolveWidgetSettings(declared, { limit: 10 })).toEqual({
      limit: 10,
      compact: false,
    });
  });

  it("defaults a setting the stored config does not mention", () => {
    expect(resolveWidgetSettings(declared, {})).toEqual({
      limit: 5,
      compact: false,
    });
  });

  /*
   * 🔴 The upgrade case. A plugin that changes a setting's type across a
   * release leaves every stored value wrongly typed, and refusing would take
   * the card down for readers who never touched it.
   */
  it("falls back to the default when the stored value is the wrong type", () => {
    expect(resolveWidgetSettings(declared, { limit: "ten" })).toEqual({
      limit: 5,
      compact: false,
    });
  });

  it("ignores a key no setting declares", () => {
    // Returned config carries only declared names, so a caller cannot act on
    // something the widget never offered.
    const resolved = resolveWidgetSettings(declared, { limit: 3, stray: "x" });
    expect(resolved).toEqual({ limit: 3, compact: false });
    expect("stray" in resolved).toBe(false);
  });

  it("omits a declared setting that has no default and no stored value", () => {
    // Absent is different from defaulted: a caller can tell "the reader chose
    // nothing and the author offered nothing" from "the value is the default".
    const title: WidgetSetting = { name: "title", type: "text" };
    expect(resolveWidgetSettings([title], {})).toEqual({});
  });

  /*
   * 🔴 A select's stored value is checked against its OPTIONS, not merely
   * against being a string. A plugin that renames or retires a choice leaves
   * every reader who picked it holding a value the declaration no longer
   * offers: the card drew it and the settings form could not show it, which is
   * the upgrade this whole reading exists to survive.
   */
  it("falls back when a stored select value is no longer offered", () => {
    const mode: WidgetSetting = {
      name: "mode",
      type: "select",
      defaultValue: "list",
      options: [
        { label: "List", value: "list" },
        { label: "Grid", value: "grid" },
      ],
    };
    expect(resolveWidgetSettings([mode], { mode: "gallery" })).toEqual({
      mode: "list",
    });
  });

  it("keeps a stored select value the declaration still offers", () => {
    // The control. Without it, refusing every select value would satisfy the
    // case above while making the setting impossible to change.
    const mode: WidgetSetting = {
      name: "mode",
      type: "select",
      defaultValue: "list",
      options: [
        { label: "List", value: "list" },
        { label: "Grid", value: "grid" },
      ],
    };
    expect(resolveWidgetSettings([mode], { mode: "grid" })).toEqual({
      mode: "grid",
    });
  });

  it("falls back when a stored number leaves the declared range", () => {
    // The same rule the select case follows: a value the declaration no longer
    // accepts takes the default. An author narrowing a range, or a config
    // written straight through the API, produces exactly this.
    const bounded: WidgetSetting = {
      name: "limit",
      type: "number",
      min: 1,
      max: 10,
      defaultValue: 5,
    };
    expect(resolveWidgetSettings([bounded], { limit: 20 })).toEqual({
      limit: 5,
    });
    expect(resolveWidgetSettings([bounded], { limit: 0 })).toEqual({
      limit: 5,
    });
  });

  it("keeps a stored number inside the declared range", () => {
    // The control. Refusing every bounded number would satisfy the case above
    // while making the setting impossible to change.
    const bounded: WidgetSetting = {
      name: "limit",
      type: "number",
      min: 1,
      max: 10,
      defaultValue: 5,
    };
    expect(resolveWidgetSettings([bounded], { limit: 7 })).toEqual({
      limit: 7,
    });
  });

  /*
   * 🔴 A setting NAME is chosen by a plugin, so the record it fills cannot be a
   * plain object. `resolved["__proto__"] = v` invokes the legacy prototype
   * setter rather than creating an own property, so the declared setting
   * vanished from the result and read back as `Object.prototype`. A stored
   * config reaches this through `JSON.parse`, which creates `__proto__` as a
   * real own property -- so the value genuinely arrives.
   */
  it("resolves a setting named __proto__ as data", () => {
    const odd: WidgetSetting = {
      name: "__proto__",
      type: "text",
      defaultValue: "d",
    };
    const stored = JSON.parse('{"__proto__":"stored"}') as Record<
      string,
      unknown
    >;

    const resolved = resolveWidgetSettings([odd], stored);

    expect(Object.keys(resolved)).toEqual(["__proto__"]);
    expect(resolved["__proto__"]).toBe("stored");
    // And nothing leaked onto the prototype every other object inherits.
    expect(({} as Record<string, unknown>).stored).toBeUndefined();
  });

  it("answers empty for a widget that declares nothing", () => {
    expect(resolveWidgetSettings(undefined, { limit: 9 })).toEqual({});
    expect(resolveWidgetSettings([], { limit: 9 })).toEqual({});
  });

  it("rejects a non-finite number, which JSON cannot round-trip", () => {
    expect(resolveWidgetSettings(declared, { limit: Number.NaN })).toEqual({
      limit: 5,
      compact: false,
    });
  });
});

describe("applyWidgetSettings drives only the knobs it declares", () => {
  const base = { source: "collection:posts", op: "list" as const, limit: 5 };

  it("takes the reader's row count", () => {
    const out = applyWidgetSettings(base, [limit], { limit: 12 });
    expect(out.limit).toBe(12);
  });

  it("falls back to the declared default when the reader chose nothing", () => {
    expect(applyWidgetSettings(base, [limit], {}).limit).toBe(5);
  });

  /*
   * 🔴 The name is the contract AND so is the type. A `text` setting called
   * `limit` drives nothing rather than putting a string where a row count goes
   * — which would reach the query compiler as `LIMIT "ten"`.
   */
  it("ignores a setting whose name matches but whose type does not", () => {
    const textLimit: WidgetSetting = { name: "limit", type: "text" };
    const out = applyWidgetSettings(base, [textLimit], { limit: "ten" });
    expect(out.limit).toBe(5);
  });

  it("ignores a setting that drives no knob", () => {
    const out = applyWidgetSettings(base, [compact], { compact: true });
    expect(out.limit).toBe(5);
  });

  it("returns the very same object when nothing applies", () => {
    // Identity, not equality: callers apply this to every card, and a copy per
    // card would break the memoisation the grid relies on to avoid refetching.
    expect(applyWidgetSettings(base, undefined, { limit: 9 })).toBe(base);
    expect(applyWidgetSettings(base, [compact], {})).toBe(base);
  });

  it("does not mutate the query it was given", () => {
    const out = applyWidgetSettings(base, [limit], { limit: 12 });
    expect(base.limit).toBe(5);
    expect(out).not.toBe(base);
  });

  /*
   * Deliberately NOT clamped here. `validateReadWidgetQuery` bounds every query
   * the endpoint accepts, and a second implementation of that rule in this
   * module would agree on the day it was written and drift afterwards.
   */
  it("passes an out-of-range value through for the endpoint to bound", () => {
    expect(applyWidgetSettings(base, [limit], { limit: 100000 }).limit).toBe(
      100000
    );
  });

  it("reads the collection a card is set to, in place of the one declared", () => {
    const collection: AnyWidgetSetting = {
      name: "collection",
      type: "collection",
    };
    const out = applyWidgetSettings(base, [collection], {
      collection: "pages",
    });
    expect(out.source).toBe("collection:pages");
    // The rest of the query is the widget's own.
    expect(out).toEqual({ ...base, source: "collection:pages" });
    expect(base.source).toBe("collection:posts");
  });

  it("reads the declared collection when the card is set to none, and keeps the query otherwise", () => {
    const withDefault: AnyWidgetSetting = {
      name: "collection",
      type: "collection",
      defaultValue: "pages",
    };
    expect(applyWidgetSettings(base, [withDefault], {}).source).toBe(
      "collection:pages"
    );
    const without: AnyWidgetSetting = {
      name: "collection",
      type: "collection",
    };
    // Nothing chosen and nothing declared: the source the widget names stands.
    expect(applyWidgetSettings(base, [without], {})).toBe(base);
  });

  it("reads only a value shaped like a collection slug as a collection", () => {
    // A special default such as "*" names no collection, so the declared query
    // is asked as it is rather than for a source that cannot exist.
    const wildcard: AnyWidgetSetting = {
      name: "collection",
      type: "collection",
      defaultValue: "*",
    };
    expect(applyWidgetSettings(base, [wildcard], {})).toBe(base);
    expect(
      applyWidgetSettings(base, [wildcard], { collection: "Not A Slug" })
    ).toBe(base);
    expect(
      applyWidgetSettings(base, [wildcard], { collection: "pages" }).source
    ).toBe("collection:pages");
  });

  it("drives the collection only over a collection source, or none", () => {
    const collection: AnyWidgetSetting = {
      name: "collection",
      type: "collection",
    };
    // A system source is one read of its own: a Collection setting there would
    // mean something else, so this knob leaves it as declared.
    const system = { source: "system:releases", op: "list" as const, limit: 5 };
    expect(
      applyWidgetSettings(system, [collection], { collection: "pages" })
    ).toBe(system);
    // The source handed in is the one judged, whatever the query names.
    expect(
      applyWidgetSettings(
        base,
        [collection],
        { collection: "pages" },
        {
          source: { id: "system:releases" },
        }
      )
    ).toBe(base);
    // No declared source at all: the card's collection is its source.
    // Typed with the source it does not have yet, which the knob gives it.
    const sourceless: { source?: string; op: "list"; limit: number } = {
      op: "list",
      limit: 5,
    };
    expect(
      applyWidgetSettings(sourceless, [collection], { collection: "pages" })
        .source
    ).toBe("collection:pages");
  });
});

describe("the content settings: a collection, and a filter, sort or grouping over it", () => {
  const content: AnyWidgetSetting[] = [
    { name: "collection", type: "collection" },
    { name: "where", type: "filter", of: "collection" },
    {
      name: "order",
      type: "sort",
      of: "collection",
      defaultValue: "-updatedAt",
    },
    { name: "by", type: "groupBy", of: "collection" },
  ];

  it("passes every rule, each type with its key as its name", () => {
    // The rule set the declaration's channel reads: every type, one table.
    expect(widgetSettingsProblems(content)).toEqual([]);
    for (const setting of content) {
      const set =
        setting.type === "collection" ? [setting] : [content[0], setting];
      expect(widgetSettingsProblems(set), setting.type).toEqual([]);
    }
  });

  it("refuses a Fields setting over a Collection setting that is not titled", () => {
    // 🔴 Only a titled list's first field is its title; on any other, keeping
    // the first field would ask one the reader never chose.
    expect(
      widgetSettingsProblems([
        { name: "collection", type: "collection" },
        { name: "shown", type: "fields", of: "collection" },
      ])
    ).toEqual([
      'setting "shown" is a Fields setting over "collection", which must be a Collection setting with rows "titled"',
    ]);
    expect(
      widgetSettingsProblems([
        { name: "collection", type: "collection", rows: "titled" },
        { name: "shown", type: "fields", of: "collection" },
      ])
    ).toEqual([]);
  });

  it("refuses a Fields setting on a widget whose query is not a list", () => {
    const settings = [
      { name: "collection", type: "collection", rows: "titled" },
      { name: "shown", type: "fields", of: "collection" },
    ];
    for (const op of ["count", "groupBy", "timeseries"]) {
      expect(
        fieldsSettingQueryProblem({ settings, query: { op } }),
        op
      ).toMatch(/only a list query's rows can show/);
    }
    expect(
      fieldsSettingQueryProblem({ settings, query: { op: "list" } })
    ).toBeUndefined();
  });

  it("refuses a dependency that names no Collection setting of the widget", () => {
    expect(
      widgetSettingsProblems([
        { name: "collection", type: "collection" },
        { name: "by", type: "groupBy", of: "colection" },
        // A setting of another type is not a Collection setting either.
        { name: "count", type: "number" },
        { name: "order", type: "sort", of: "count" },
      ])
    ).toEqual([
      'setting "by" depends on "colection", which is not a Collection setting of this widget',
      'setting "order" depends on "count", which is not a Collection setting of this widget',
    ]);
  });

  it("names a setting's own fault and a dependency's at once", () => {
    // Plain JavaScript learns of every fault from one restart, not one kind at
    // a time.
    const problems = widgetSettingsProblems([
      { name: "limit", type: "number", defaultValue: "five" as never },
      { name: "by", type: "groupBy", of: "colection" },
    ]);
    expect(problems).toHaveLength(2);
    expect(problems[0]).toContain('setting "limit"');
    expect(problems[1]).toBe(
      'setting "by" depends on "colection", which is not a Collection setting of this widget'
    );
  });

  it("counts a faulty Collection setting by its name, so its dependents are not misnamed", () => {
    // The Collection setting's own fault is the one to fix; its dependent
    // names it correctly and must not be reported as well.
    const problems = widgetSettingsProblems([
      { name: "collection", type: "collection", defaultValue: " " },
      { name: "by", type: "groupBy", of: "collection" },
    ]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('setting "collection" is typed "collection"');
  });

  it("refuses a starting value its type cannot hold", () => {
    const [blank] = widgetSettingsProblems([
      { name: "collection", type: "collection", defaultValue: " " },
    ]);
    expect(blank).toContain('setting "collection" is typed "collection"');
    const [list] = widgetSettingsProblems([
      { name: "collection", type: "collection" },
      {
        name: "where",
        type: "filter",
        of: "collection",
        defaultValue: ["not", "conditions"] as never,
      },
    ]);
    expect(list).toContain('setting "where" is typed "filter"');
  });

  it("admits a Collection setting at registration over a collection source, or none", () => {
    // The collection a card reads becomes its query's source, so the setting
    // changes what the card shows and is drawn rather than refused.
    expect(widgetSettingsProblem([content[0]])).toBeUndefined();
    expect(
      widgetSettingsProblem([content[0]], false, { id: "collection:posts" })
    ).toBeUndefined();
    expect(() => validateWidgetSettings([content[0]], "core/x")).not.toThrow();
  });

  it("refuses a content setting at registration over a source no knob drives it on", () => {
    // Every content knob reads a collection: on a system source the setting
    // would be drawn and saved and change nothing, so it is refused with the
    // mark, the core-built widget aside.
    for (const setting of content) {
      const set =
        setting.type === "collection" ? [setting] : [content[0], setting];
      expect(
        widgetSettingsProblem(set, false, { id: "system:releases" }),
        setting.type
      ).toContain(CONTENT_SETTING_NOT_DRAWN);
    }
    expect(() =>
      validateWidgetSettings([content[0]], "core/x", false, {
        id: "system:releases",
      })
    ).toThrow(CONTENT_SETTING_NOT_DRAWN);
  });

  it("refuses a content setting on a widget that asks nothing a knob could drive", () => {
    // No query and no cells: the setting would be drawn and saved and change
    // nothing the card shows.
    for (const setting of content) {
      const set =
        setting.type === "collection" ? [setting] : [content[0], setting];
      expect(widgetSettingsProblem(set, false, null), setting.type).toContain(
        CONTENT_SETTING_NOT_DRAWN
      );
    }
    // The widget whose data core builds holds them, as before.
    expect(widgetSettingsProblem([content[0]], true, null)).toBeUndefined();
  });

  it("refuses a second Collection setting, which would always lose to the first", () => {
    const two = [
      { name: "collection", type: "collection" as const },
      { name: "other", type: "collection" as const },
    ];
    expect(widgetSettingsProblem(two)).toContain(
      'declares 2 Collection settings ("collection", "other")'
    );
    expect(widgetSettingsProblem(two, true)).toBeUndefined();
  });

  it("is admitted at registration, since a knob drives each one into the card's query", () => {
    // A registered widget's settings reach its query only through the knobs of
    // `applyWidgetSettings`; each content type has one, so none of them is a
    // control that would change nothing.
    for (const setting of content) {
      const set =
        setting.type === "collection" ? [setting] : [content[0], setting];
      expect(widgetSettingsProblem(set), setting.type).toBeUndefined();
    }
    expect(() => validateWidgetSettings(content, "core/x")).not.toThrow();
  });

  describe("driving the card's query", () => {
    // Sourceless, as a per-collection widget declares it: the Collection
    // setting supplies the source.
    const base: SourcelessWidgetQuery = { op: "list", limit: 5 };
    const fields = [
      { name: "title", offered: true, groupable: true },
      { name: "status", offered: true, groupable: true },
      { name: "updatedAt", offered: true, groupable: false },
      { name: "salary", offered: false, groupable: true },
    ];
    const ctx = {
      fieldsOf: (collection: string) =>
        collection === "posts" ? fields : undefined,
    };

    it("reads the chosen collection, and its filter, sort and grouping over it", () => {
      expect(
        applyWidgetSettings(
          base,
          content,
          {
            collection: "posts",
            where: { status: { equals: "draft" } },
            order: "-title",
            by: "status",
          },
          ctx
        )
      ).toEqual({
        ...base,
        source: "collection:posts",
        where: { status: { equals: "draft" } },
        sort: "-title",
        groupBy: "status",
      });
    });

    it("asks with a setting's default, before the query is built, where the stored one names a field the reader may not use", () => {
      const out = applyWidgetSettings(
        base,
        content,
        {
          collection: "posts",
          // Through an `or`, so a field named only inside a branch counts.
          where: { or: [{ title: { equals: "a" } }, { salary: { gt: 1 } }] },
          order: "salary",
          by: "salary",
        },
        ctx
      );
      // The filter and the grouping have no default, so they are left off;
      // the sort takes its declared one.
      expect(out).toEqual({
        ...base,
        source: "collection:posts",
        sort: "-updatedAt",
      });
    });

    it("hands the card the same values its query was asked with, not the stored ones it set aside", () => {
      // 🔴 Drawn from the stored values, a card links its number to a filter
      // the query never counted under.
      const stored = {
        collection: "posts",
        where: { salary: { gt: 1 } },
        order: "salary",
        by: "status",
      };
      expect({
        ...effectiveWidgetSettings(content, stored, ctx),
      }).toEqual({ collection: "posts", order: "-updatedAt", by: "status" });
      // Without the reader's fields, nothing is known to be withheld.
      expect(effectiveWidgetSettings(content, stored).where).toEqual({
        salary: { gt: 1 },
      });
    });

    it("narrows a declared condition with the reader's Filter, keeping the declared keys at the top level", () => {
      // A workflow condition is read only at the top level, so the Filter
      // joins it under `and` rather than wrapping it.
      const scheduled = { ...base, where: { _inRelease: true } };
      const filter = { title: { contains: "news" } };
      expect(
        applyWidgetSettings(
          scheduled,
          content,
          { collection: "posts", where: filter },
          ctx
        ).where
      ).toEqual({ _inRelease: true, and: [filter] });
      // A declared `and` keeps its branches, and the Filter is one more.
      const both = {
        ...base,
        where: { and: [{ status: { equals: "draft" } }] },
      };
      expect(
        applyWidgetSettings(
          both,
          content,
          { collection: "posts", where: filter },
          ctx
        ).where
      ).toEqual({ and: [{ status: { equals: "draft" } }, filter] });
    });

    it("leaves a grouping off when its field can be read but not grouped by", () => {
      const out = applyWidgetSettings(
        base,
        content,
        { collection: "posts", by: "updatedAt" },
        ctx
      );
      expect(out.groupBy).toBeUndefined();
    });

    it("reaches back as far as the card's Date range, as its query's since", () => {
      const dateRange = {
        name: "dateRange",
        type: "select" as const,
        defaultValue: "30d",
        options: [
          { label: "7 days", value: "7d" },
          { label: "30 days", value: "30d" },
        ],
      };
      // On a count, which a window bounds.
      const counted = { ...base, op: "count" as const };
      expect(applyWidgetSettings(counted, [dateRange], {}).since).toBe("30d");
      expect(
        applyWidgetSettings(counted, [dateRange], { dateRange: "7d" }).since
      ).toBe("7d");
      // A list takes no window, so the same setting leaves it as declared.
      expect(applyWidgetSettings(base, [dateRange], { dateRange: "7d" })).toBe(
        base
      );
    });

    it("sets a ranged chart's range from the card's Date range, never a since beside it", () => {
      // 🔴 Joined by a since, the query names two windows and the server
      // refuses it, so the chart would never draw.
      const dateRange = {
        name: "dateRange",
        type: "select" as const,
        defaultValue: "30d",
        options: [
          { label: "7 days", value: "7d" },
          { label: "30 days", value: "30d" },
          { label: "60 days", value: "60d" },
          { label: "12 months", value: "12m" },
        ],
      };
      const ranged = {
        op: "timeseries" as const,
        dateField: "createdAt",
        range: "30d" as const,
      };
      const asked = applyWidgetSettings(ranged, [dateRange], {
        dateRange: "12m",
      });
      expect(asked).toMatchObject({ range: "12m" });
      expect(asked).not.toHaveProperty("since");
      // A span that is no range leaves the declared range as it was.
      expect(
        applyWidgetSettings(ranged, [dateRange], { dateRange: "60d" })
      ).toBe(ranged);
    });

    describe("a titled list", () => {
      const titled = {
        name: "collection",
        type: "collection" as const,
        rows: "titled" as const,
      };
      const list: {
        op: "list";
        sort: string;
        limit: number;
        select?: string[];
      } = { op: "list", sort: "-updatedAt", limit: 5 };
      const published = (over: Partial<PublishedContentSource> = {}) => ({
        sourceOf: (collection: string) =>
          collection === "posts"
            ? {
                collection: "posts",
                label: "Posts",
                lifecycle: true,
                titleField: "headline",
                fields: [
                  { name: "headline", type: "string" as const },
                  { name: "updatedAt", type: "date" as const },
                ],
                ...over,
              }
            : undefined,
      });

      it("asks each row's title, its status and when it was updated, and nothing else", () => {
        expect(
          applyWidgetSettings(
            list,
            [titled],
            { collection: "posts" },
            published()
          )
        ).toEqual({
          ...list,
          source: "collection:posts",
          select: ["headline", "status", "updatedAt"],
        });
        // No lifecycle, no status.
        expect(
          applyWidgetSettings(
            list,
            [titled],
            { collection: "posts" },
            published({ lifecycle: false })
          ).select
        ).toEqual(["headline", "updatedAt"]);
      });

      it.each([
        ["names no title", { titleField: undefined }],
        [
          "has no updatedAt",
          { fields: [{ name: "headline", type: "string" as const }] },
        ],
      ])(
        "asks nothing of a collection that %s, rather than whole rows",
        (_why, over) => {
          // 🔴 Given its source with no select, the read would return every
          // column of every row.
          expect(
            applyWidgetSettings(
              list,
              [titled],
              { collection: "posts" },
              published(over)
            )
          ).toBe(list);
        }
      );

      it("drops the source and fields it was declared with, set to a collection it cannot title", () => {
        // 🔴 Kept, the card would read pages' rows under a setting naming posts.
        const declared = {
          ...list,
          source: "collection:pages",
          select: ["title", "updatedAt"],
        };
        expect(
          applyWidgetSettings(
            declared,
            [titled],
            { collection: "posts" },
            published({ titleField: undefined })
          )
        ).toEqual(list);
      });

      it("asks nothing where the reader's collections are not known", () => {
        expect(
          applyWidgetSettings(list, [titled], { collection: "posts" })
        ).toBe(list);
      });

      describe("with the fields its rows show chosen", () => {
        const chosen = {
          name: "fields",
          type: "fields" as const,
          of: "collection",
        };
        // What this reader is offered of posts: a read-ruled `salary` is not.
        const offered = {
          ...published(),
          fieldsOf: (collection: string) =>
            collection === "posts"
              ? [
                  { name: "headline", offered: true },
                  { name: "updatedAt", offered: true },
                  { name: "category", offered: true },
                  { name: "salary", offered: false },
                ]
              : undefined,
        };

        it("asks the chosen fields after the title, in the order chosen", () => {
          expect(
            applyWidgetSettings(
              list,
              [titled, chosen],
              { collection: "posts", fields: ["category", "updatedAt"] },
              offered
            ).select
          ).toEqual(["headline", "category", "updatedAt"]);
        });

        it("never asks the title twice", () => {
          expect(
            applyWidgetSettings(
              list,
              [titled, chosen],
              { collection: "posts", fields: ["headline", "updatedAt"] },
              offered
            ).select
          ).toEqual(["headline", "updatedAt"]);
        });

        it("asks the list's own fields where a chosen one is not offered to this reader", () => {
          // 🔴 A stored choice naming a read-ruled field, saved before the rule or by
          // another reader, must not reach the read: the row keeps its defaults.
          expect(
            applyWidgetSettings(
              list,
              [titled, chosen],
              { collection: "posts", fields: ["category", "salary"] },
              offered
            ).select
          ).toEqual(["headline", "status", "updatedAt"]);
        });

        it("asks the list's own fields where nothing is chosen", () => {
          expect(
            applyWidgetSettings(
              list,
              [titled, chosen],
              { collection: "posts" },
              offered
            ).select
          ).toEqual(["headline", "status", "updatedAt"]);
        });

        it("asks the list's own fields where a chosen one is a field no row can print", () => {
          // 🔴 A structured or many-valued field would be asked for and drawn as an empty place.
          const unprintable = {
            ...published(),
            fieldsOf: (collection: string) =>
              collection === "posts"
                ? [
                    { name: "headline", offered: true },
                    { name: "category", offered: true },
                    { name: "tags", offered: true, presentable: false },
                  ]
                : undefined,
          };
          expect(
            applyWidgetSettings(
              list,
              [titled, chosen],
              { collection: "posts", fields: ["category", "tags"] },
              unprintable
            ).select
          ).toEqual(["headline", "status", "updatedAt"]);
        });

        it("applies the Collection setting before its Fields, whatever order they are declared in", () => {
          // 🔴 Applied in declared order, the titled Collection setting came second
          // and replaced the chosen fields with its own.
          expect(
            applyWidgetSettings(
              list,
              [chosen, titled],
              { collection: "posts", fields: ["category"] },
              offered
            ).select
          ).toEqual(["headline", "category"]);
        });

        it("leaves a query that is not a list as it was asked", () => {
          const grouped = {
            op: "groupBy" as const,
            groupBy: "category",
            limit: 5,
          } as unknown as typeof list;
          expect(
            applyWidgetSettings(
              grouped,
              [titled, chosen],
              { collection: "posts", fields: ["category"] },
              offered
            )
          ).not.toHaveProperty("select");
        });

        it("asks the list's own fields where more are chosen than a row's meta line holds", () => {
          const many = ["a", "b", "c", "d"];
          const plenty = {
            ...published(),
            fieldsOf: (collection: string) =>
              collection === "posts"
                ? [
                    { name: "headline", offered: true },
                    ...many.map(name => ({ name, offered: true })),
                  ]
                : undefined,
          };
          expect(MAX_CHOSEN_FIELDS).toBe(3);
          expect(
            applyWidgetSettings(
              list,
              [titled, chosen],
              { collection: "posts", fields: many.slice(0, 3) },
              plenty
            ).select
          ).toEqual(["headline", "a", "b", "c"]);
          expect(
            applyWidgetSettings(
              list,
              [titled, chosen],
              { collection: "posts", fields: many },
              plenty
            ).select
          ).toEqual(["headline", "status", "updatedAt"]);
        });
      });
    });

    it("leaves a widget's own select named dateRange alone when it offers anything but the query's spans", () => {
      // A plugin card that reads its own "week" or "month" in its component,
      // as it did before the knob existed: never sent to the query as since.
      const ownRange = {
        name: "dateRange",
        type: "select" as const,
        defaultValue: "week",
        options: [
          { label: "This week", value: "week" },
          { label: "Last 30 days", value: "30d" },
        ],
      };
      const counted = { ...base, op: "count" as const };
      expect(applyWidgetSettings(counted, [ownRange], {})).toBe(counted);
      expect(
        applyWidgetSettings(counted, [ownRange], { dateRange: "30d" })
      ).toBe(counted);
    });

    it("applies a stored value as it is where the collection's fields are not known, for the server to judge", () => {
      const out = applyWidgetSettings(base, content, {
        collection: "posts",
        order: "salary",
      });
      expect(out.sort).toBe("salary");
    });
  });

  it("is admitted where core builds the card's query from it, and still judged by every other rule", () => {
    // A declared widget's query is built from these settings on the server, so they reach the
    // data it shows: there is nothing to refuse.
    expect(widgetSettingsProblem(content, true)).toBeUndefined();
    expect(() => validateWidgetSettings(content, "core/x", true)).not.toThrow();
    // Admitted is not unchecked: a dependent setting naming no Collection setting is still
    // refused for what it is.
    const orphan = {
      name: "where",
      label: "Where",
      type: "filter",
      of: "nothing",
    };
    expect(widgetSettingsProblem([orphan], true)).toBeDefined();
    expect(widgetSettingsProblem([orphan], true)).not.toContain(
      CONTENT_SETTING_NOT_DRAWN
    );
  });

  it("reads a stored value its type can hold, and the starting value otherwise", () => {
    expect(
      resolveWidgetSettings(content, {
        collection: "posts",
        where: { status: { equals: "draft" } },
        order: "title",
        by: "status",
      })
    ).toEqual({
      collection: "posts",
      where: { status: { equals: "draft" } },
      order: "title",
      by: "status",
    });
    // A blank name and a list are not values of these types.
    expect(
      resolveWidgetSettings(content, {
        collection: "posts",
        where: ["status"],
        order: " ",
      })
    ).toEqual({ collection: "posts", order: "-updatedAt" });
  });

  it("hides a dependent setting while its Collection setting has no value", () => {
    // Nothing to sort, so the stored sort is not handed on; its starting
    // value is, as for any setting without a usable value.
    expect(
      resolveWidgetSettings(content, { order: "title", by: "status" })
    ).toEqual({
      order: "-updatedAt",
    });
    // Declared AFTER its dependents, the Collection setting is still read
    // first, so the order of the declaration does not decide what is hidden.
    expect(
      resolveWidgetSettings([...content].reverse(), {
        collection: "posts",
        order: "title",
      })
    ).toEqual({ collection: "posts", order: "title" });
  });
});

describe("the quick setting: at most one sits on the card", () => {
  const range: AnyWidgetSetting = {
    name: "range",
    type: "select",
    options: [
      { label: "Last 7 days", value: "7d" },
      { label: "Last 30 days", value: "30d" },
    ],
    defaultValue: "30d",
  };
  const style: AnyWidgetSetting = {
    name: "style",
    type: "select",
    options: [
      { label: "Line", value: "line" },
      { label: "Bars", value: "bars" },
    ],
    defaultValue: "line",
  };

  it("accepts one quick setting, or none", () => {
    expect(widgetSettingsProblems([{ ...range, quick: true }, style])).toEqual(
      []
    );
    expect(widgetSettingsProblems([range, style])).toEqual([]);
    expect(widgetSettingsProblem([{ ...range, quick: true }])).toBeUndefined();
  });

  it("refuses a widget that marks two settings quick, naming both", () => {
    expect(
      widgetSettingsProblems([
        { ...range, quick: true },
        { ...style, quick: true },
      ])
    ).toEqual([
      'settings "range", "style" are all marked quick; a widget may mark at most one',
    ]);
    // Registration reads the same rule.
    expect(() =>
      validateWidgetSettings(
        [
          { ...range, quick: true },
          { ...style, quick: true },
        ],
        "core/x"
      )
    ).toThrow(/at most one/);
  });

  it("refuses a quick mark that is not true or false", () => {
    expect(
      widgetSettingsProblems([{ ...range, quick: "yes" } as never])
    ).toEqual(['setting "range" has quick "yes"; expected true or false']);
  });
});

describe("a date setting holds the ISO 8601 date its picker writes", () => {
  const since: WidgetSetting = {
    name: "since",
    type: "date",
    defaultValue: "2026-01-01",
  };

  it("takes a date, with or without its time, and refuses anything else as a default", () => {
    expect(widgetSettingsProblems([since])).toEqual([]);
    expect(
      widgetSettingsProblems([
        { ...since, defaultValue: "2026-10-28T21:00:00.000Z" },
      ])
    ).toEqual([]);
    // 🔴 `Date.parse` alone takes both of these; no picker writes either.
    for (const loose of ["March 3", "2026", "2026-02-30"]) {
      expect(
        widgetSettingsProblems([{ ...since, defaultValue: loose }]),
        loose
      ).toEqual([
        `setting "since" is typed "date" but defaults to ${JSON.stringify(loose)}`,
      ]);
    }
  });

  it("reads a stored value that is no date as its default", () => {
    expect(resolveWidgetSettings([since], { since: "2026-03-04" })).toEqual({
      since: "2026-03-04",
    });
    // A cleared picker writes null.
    expect(resolveWidgetSettings([since], { since: null })).toEqual({
      since: "2026-01-01",
    });
  });
});

describe("a Field setting names one field of the collection it works over", () => {
  it("passes every rule over a Collection setting", () => {
    expect(
      widgetSettingsProblems([
        { name: "collection", type: "collection" },
        {
          name: "column",
          type: "field",
          of: "collection",
          defaultValue: "title",
        },
      ])
    ).toEqual([]);
  });

  it("is refused over a setting that is not a Collection setting", () => {
    expect(
      widgetSettingsProblems([
        { name: "title", type: "text" },
        { name: "column", type: "field", of: "title" },
      ])
    ).toEqual([
      'setting "column" depends on "title", which is not a Collection setting of this widget',
    ]);
  });

  it("is hidden, and handed its default, while its collection has no value", () => {
    const settings: AnyWidgetSetting[] = [
      { name: "collection", type: "collection" },
      {
        name: "column",
        type: "field",
        of: "collection",
        defaultValue: "title",
      },
    ];
    expect(resolveWidgetSettings(settings, { column: "price" })).toEqual({
      column: "title",
    });
    expect(
      resolveWidgetSettings(settings, { collection: "orders", column: "price" })
    ).toEqual({ collection: "orders", column: "price" });
  });
});
