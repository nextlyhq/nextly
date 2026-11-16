/**
 * The knobs on a source that reads across collections and narrows by the
 * filters it declares (`WidgetSource.filters`): Collection sets a key of the
 * query's `where` there and leaves its source alone. A setting named Only mine
 * or Tab drives nothing, on any source: no setting drives a query because of
 * its name.
 */
import { afterEach, describe, expect, it } from "vitest";

import type { WidgetQuery } from "../query";
import {
  type AnyWidgetSetting,
  applyWidgetSettings,
  settingsSourceOf,
  widgetSettingsProblem,
} from "../settings";
import { clearSources } from "../sources";
import { clearSystemResolvers, registerSystemSource } from "../system-sources";

const collection: AnyWidgetSetting = { name: "collection", type: "collection" };
const onlyMine: AnyWidgetSetting = {
  name: "onlyMine",
  type: "checkbox",
  defaultValue: false,
};

/** A source reading every collection, narrowing by one and by its reader's own rows. */
const filtering = {
  id: "system:saves",
  filters: ["collection", "onlyMine"] as const,
};
const query: WidgetQuery = {
  source: "system:saves",
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
    expect(out.source).toBe("system:saves");
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

describe("a setting named for a filter its source narrows by", () => {
  const tab: AnyWidgetSetting = {
    name: "tab",
    type: "select",
    defaultValue: "mine",
    quick: true,
    options: [
      { label: "Mine", value: "mine" },
      { label: "Team", value: "team" },
    ],
  };
  const tabbed = { id: "system:continue", filters: ["tab"] as const };
  const continueQuery: WidgetQuery = {
    source: "system:continue",
    op: "list",
    limit: 5,
  };

  it("drives nothing for Only mine, even on a source that narrows by it", () => {
    // A declared widget's settings reach its `load`, which asks its source
    // as it chooses; a checkbox's name sets nothing a card asks.
    expect(asked([onlyMine], { onlyMine: true }).where).toBeUndefined();
    expect(
      applyWidgetSettings(
        query,
        [onlyMine],
        { onlyMine: true },
        { source: filtering }
      )
    ).toBe(query);
  });

  it("drives nothing for Tab, even on a source that narrows by it", () => {
    expect(
      applyWidgetSettings(
        continueQuery,
        [tab],
        { tab: "team" },
        { source: tabbed }
      )
    ).toBe(continueQuery);
  });

  it("still carries Collection beside them, which is a knob by its type", () => {
    // The control: the knobs that remain still apply on the same source.
    const out = applyWidgetSettings(
      { ...query, where: { kept: true } },
      [onlyMine, collection],
      { onlyMine: true, collection: "pages" },
      { source: filtering }
    );
    expect(out.where).toEqual({ kept: true, collection: "pages" });
  });
});

describe("a cells card over a source that narrows by its filters", () => {
  afterEach(() => {
    clearSources();
    clearSystemResolvers();
  });

  const cellsCard = {
    cells: [{ key: "edits", query: { source: "system:edits", op: "list" } }],
  };

  function registerEdits(): void {
    registerSystemSource(
      {
        id: "system:edits",
        label: "Edits",
        kind: "system",
        supports: ["list"],
        fields: [{ name: "entryTitle", type: "string" }],
        filters: ["collection", "onlyMine"],
      },
      async () => ({ op: "list", items: [] })
    );
  }

  it("refuses a Collection setting only a cell source's filter could apply", () => {
    registerEdits();
    expect(
      widgetSettingsProblem([collection], false, settingsSourceOf(cellsCard))
    ).toMatch(/"collection" is applied through its source's filters/);
  });

  it("admits both on a card's own query, which is asked with its filters", () => {
    registerEdits();
    expect(
      widgetSettingsProblem(
        [collection, onlyMine],
        false,
        settingsSourceOf({ query: { source: "system:edits", op: "list" } })
      )
    ).toBeUndefined();
  });
});
