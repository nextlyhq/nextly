/**
 * The knobs on a source that reads across collections and narrows by the
 * filters it declares (`WidgetSource.filters`): Collection and Only mine set a
 * key of the query's `where` there and leave its source alone, and Only mine
 * drives nothing on a source that does not narrow by it.
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
      id: "system:saves",
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

describe("Tab on a source that narrows by it", () => {
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

  it("sets where.tab to the chosen tab, Mine by default, and keeps the source", () => {
    const team = applyWidgetSettings(
      continueQuery,
      [tab],
      { tab: "team" },
      { source: tabbed }
    );
    expect(team.source).toBe("system:continue");
    expect(team.where).toEqual({ tab: "team" });
    expect(
      applyWidgetSettings(continueQuery, [tab], {}, { source: tabbed }).where
    ).toEqual({ tab: "mine" });
  });

  it("is not driven on a source that does not narrow by it", () => {
    // 🔴 The must-differ case: the same setting over a source declaring no
    // Tab filter is the widget's own select, and sets nothing it asks.
    expect(
      applyWidgetSettings(
        continueQuery,
        [tab],
        { tab: "team" },
        { source: { id: "system:continue", filters: ["collection"] as const } }
      ).where
    ).toBeUndefined();
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

  it("refuses an Only mine checkbox its cells would never be asked with", () => {
    // 🔴 Admitted, the card shows "only mine" on while every cell counts
    // everyone's rows: the admin asks each cell with no filter metadata.
    registerEdits();
    expect(
      widgetSettingsProblem([onlyMine], false, settingsSourceOf(cellsCard))
    ).toMatch(/"onlyMine" is applied through its source's filters/);
  });

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
