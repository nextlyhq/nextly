/**
 * The knobs on a source that reads across collections and narrows by the
 * filters it declares (`WidgetSource.filters`): Collection and Only mine set a
 * key of the query's `where` there and leave its source alone, and Only mine
 * drives nothing on a source that does not narrow by it.
 */
import { describe, expect, it } from "vitest";

import type { WidgetQuery } from "../query";

import {
  type AnyWidgetSetting,
  applyWidgetSettings,
  widgetSettingsProblem,
} from "../settings";

const collection: AnyWidgetSetting = { name: "collection", type: "collection" };
const onlyMine: AnyWidgetSetting = {
  name: "onlyMine",
  type: "checkbox",
  defaultValue: false,
};

/** A source reading every collection, narrowing by one and by its reader's own rows. */
const filtering = {
  id: "system:recent-edits",
  filters: ["collection", "onlyMine"] as const,
};
const query: WidgetQuery = {
  source: "system:recent-edits",
  op: "list",
  limit: 5,
};

const asked = (
  settings: AnyWidgetSetting[],
  config: Record<string, unknown>,
  source: {
    id: string;
    filters?: readonly ("collection" | "onlyMine")[];
  } = filtering
) => applyWidgetSettings(query, settings, config, { source });

describe("Collection on a source that narrows by it", () => {
  it("sets the query's where.collection and keeps the source", () => {
    const out = asked([collection], { collection: "pages" });
    expect(out.source).toBe("system:recent-edits");
    expect(out.where).toEqual({ collection: "pages" });
  });

  it("asks every collection when none is chosen", () => {
    expect(asked([collection], {}).where).toBeUndefined();
  });

  it("replaces the source on a collection source, as before", () => {
    // 🔴 The other branch of the same knob: a collection card reads the
    // collection it is set to.
    const posts: WidgetQuery = {
      source: "collection:posts",
      op: "list",
      limit: 5,
    };
    const out = applyWidgetSettings(
      posts,
      [collection],
      { collection: "pages" },
      {
        source: { id: "collection:posts" },
      }
    );
    expect(out.source).toBe("collection:pages");
    expect(out.where).toBeUndefined();
  });
});

describe("Only mine on a source that narrows by it", () => {
  it("sets where.onlyMine when on, and nothing when off", () => {
    expect(asked([onlyMine], { onlyMine: true }).where).toEqual({
      onlyMine: true,
    });
    expect(asked([onlyMine], { onlyMine: false }).where).toBeUndefined();
    expect(asked([onlyMine], {}).where).toBeUndefined();
  });

  it("carries both filters together, beside the query's own where", () => {
    const out = applyWidgetSettings(
      { ...query, where: { kept: true } },
      [onlyMine, collection],
      { onlyMine: true, collection: "pages" },
      { source: filtering }
    );
    expect(out.where).toEqual({
      kept: true,
      onlyMine: true,
      collection: "pages",
    });
  });

  it("is not driven on a source that does not narrow by it", () => {
    // Only Collection declared: Only mine is the widget's own checkbox there,
    // admitted as any checkbox is, and it sets nothing the card asks.
    const collectionOnly = {
      id: "system:recent-edits",
      filters: ["collection"] as const,
    };
    expect(
      asked([onlyMine], { onlyMine: true }, collectionOnly).where
    ).toBeUndefined();
    // Admitted beside Collection where the source declares both.
    expect(
      widgetSettingsProblem([onlyMine, collection], false, filtering)
    ).toBeUndefined();
  });
});
