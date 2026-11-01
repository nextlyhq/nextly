/**
 * A Group by setting that takes its default from the collection: unset, or
 * set to a field this reader may not use, the card groups by what the
 * collection divides by. Registration admits it only on a Group by setting.
 */
import { describe, expect, it } from "vitest";

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
