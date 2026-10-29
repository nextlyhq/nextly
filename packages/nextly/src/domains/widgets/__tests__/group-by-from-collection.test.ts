/**
 * A Group by setting that takes its default from the collection: unset, or
 * set to a field this reader may not use, the card groups by what the
 * collection divides by. Registration admits it only on a Group by setting,
 * and a grouped query may leave its key to a setting only when that setting
 * always gives one.
 */
import { describe, expect, it } from "vitest";

import type { WidgetDefinition } from "../definition";
import { validateWidgetDefinition } from "../definition";
import type { PublishedContentSource } from "../publish";
import type { SourcelessWidgetQuery } from "../query";
import {
  type AnyWidgetSetting,
  applyWidgetSettings,
  effectiveWidgetSettings,
  type KnobContext,
  widgetSettingsProblem,
} from "../settings";

const choices = [{ value: "a", label: "A" }];

/** What each collection publishes this reader. */
const SOURCES: Record<string, PublishedContentSource> = {
  posts: {
    collection: "posts",
    label: "Posts",
    lifecycle: true,
    fields: [
      { name: "kind", type: "string", choices },
      { name: "status", type: "string", choices },
    ],
  },
  // No lifecycle; its first choice field is `kind`. A field a read rule could
  // refuse is not published at all, so `secret` is not among them.
  products: {
    collection: "products",
    label: "Products",
    lifecycle: false,
    fields: [
      { name: "title", type: "string" },
      { name: "kind", type: "string", choices },
      { name: "colour", type: "string", choices },
    ],
  },
  notes: {
    collection: "notes",
    label: "Notes",
    lifecycle: false,
    fields: [{ name: "title", type: "string" }],
  },
};

const ctx: KnobContext = {
  sourceOf: collection => SOURCES[collection],
  fieldsOf: collection => SOURCES[collection]?.fields,
};

const grouped: SourcelessWidgetQuery = { op: "groupBy", status: "all" };

const fromCollection: AnyWidgetSetting[] = [
  { name: "collection", type: "collection", label: "Collection" },
  {
    name: "groupBy",
    type: "groupBy",
    of: "collection",
    label: "Group by",
    defaultFrom: "collection",
  },
];

const asked = (stored: Record<string, unknown>, context = ctx) =>
  applyWidgetSettings(grouped, fromCollection, stored, context).groupBy;

describe("a Group by setting that takes its default from the collection", () => {
  it("groups an unset card by status where the collection has a lifecycle, else by its first choice field", () => {
    // 🔴 Unset is the case a converted card is in: it stores its collection
    // alone. Read only when a stored value does not fit, it grouped by nothing.
    expect(asked({ collection: "posts" })).toBe("status");
    expect(asked({ collection: "products" })).toBe("kind");
  });

  it("groups by nothing where the collection has nothing to divide by", () => {
    expect(asked({ collection: "notes" })).toBeUndefined();
  });

  it("keeps a stored grouping the reader may use, and replaces one they may not", () => {
    expect(asked({ collection: "products", groupBy: "colour" })).toBe("colour");
    // A field a read rule withholds is not published, so it does not fit.
    expect(asked({ collection: "products", groupBy: "secret" })).toBe("kind");
  });

  it("hands the component the grouping its query was asked with", () => {
    expect(
      effectiveWidgetSettings(fromCollection, { collection: "products" }, ctx)
        .groupBy
    ).toBe("kind");
  });

  it("takes nothing from the collection when its source is not known", () => {
    expect(asked({ collection: "posts" }, {})).toBeUndefined();
  });

  it("is not how a Group by setting without the flag behaves", () => {
    // The control: an unset plain Group by setting still groups by nothing.
    const plain = fromCollection.map(setting =>
      setting.type === "groupBy"
        ? { name: "groupBy", type: "groupBy" as const, of: "collection" }
        : setting
    );
    expect(
      applyWidgetSettings(grouped, plain, { collection: "posts" }, ctx).groupBy
    ).toBeUndefined();
  });

  it("is admitted on a Group by setting alone, spelt as `collection`", () => {
    expect(widgetSettingsProblem(fromCollection)).toBeUndefined();
    expect(
      widgetSettingsProblem([
        fromCollection[0]!,
        {
          name: "order",
          type: "sort",
          of: "collection",
          defaultFrom: "collection",
        } as unknown as AnyWidgetSetting,
      ])
    ).toContain('setting "order" has defaultFrom');
    expect(
      widgetSettingsProblem([
        fromCollection[0]!,
        {
          ...fromCollection[1]!,
          defaultFrom: "collections",
        } as unknown as AnyWidgetSetting,
      ])
    ).toContain('setting "groupBy" has defaultFrom');
  });
});

describe("a grouped query that leaves its key to a setting", () => {
  const definition = (settings: AnyWidgetSetting[]): WidgetDefinition =>
    ({
      id: "core/grouped",
      title: "Grouped",
      archetype: "bars",
      offered: "per-collection",
      size: { default: { w: 4, h: 3 } },
      settings,
      query: grouped,
    }) as WidgetDefinition;

  it("is admitted where a Group by setting always gives one", () => {
    expect(() =>
      validateWidgetDefinition(definition(fromCollection))
    ).not.toThrow();
  });

  it("is refused for a cell on a source the Group by setting does not reach", () => {
    // 🔴 Read widget-wide, the defaulted setting excused every grouped cell,
    // and this one, on a system source no content knob drives, registered with
    // no group key and was dropped on every load.
    const cells = (second: Record<string, unknown>) =>
      ({
        id: "core/grouped-cells",
        title: "Grouped cells",
        archetype: "custom",
        component: "core#GroupedCells",
        offered: "per-collection",
        size: { default: { w: 4, h: 3 } },
        settings: fromCollection,
        cells: [
          { key: "byCollection", query: grouped },
          { key: "second", query: second },
        ],
      }) as WidgetDefinition;
    expect(() =>
      validateWidgetDefinition(
        cells({ source: "system:activity", op: "groupBy", status: "all" })
      )
    ).toThrow(/its cell "second" names no groupBy/);
    // The control: a second cell the setting does reach is admitted.
    expect(() =>
      validateWidgetDefinition(cells({ op: "groupBy", status: "all" }))
    ).not.toThrow();
  });

  it("is refused where nothing would give one", () => {
    // 🔴 Without the rule this registers, and every card is asked a grouping
    // of nothing, which the endpoint refuses on every load.
    expect(() =>
      validateWidgetDefinition(
        definition([
          fromCollection[0]!,
          { name: "groupBy", type: "groupBy", of: "collection" },
        ])
      )
    ).toThrow(/names no groupBy, and no Group by setting with a default/);
  });
});
