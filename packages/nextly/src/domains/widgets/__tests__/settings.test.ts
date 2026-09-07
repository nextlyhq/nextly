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

import {
  applyWidgetSettings,
  MAX_WIDGET_SETTINGS,
  resolveWidgetSettings,
  validateWidgetSettings,
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
});
