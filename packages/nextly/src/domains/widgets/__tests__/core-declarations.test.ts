/**
 * Core's Count, Breakdown, Over time and Recent entries cards, declared with
 * `defineWidget`: each passes the checks every declaration is held to, is
 * published as a card answered on the server with the skeleton it states, and
 * its `load` reads what its card draws at the size it is asked for and nothing
 * more, through the public read services alone.
 *
 * The loads are observed through mocked read services, so what each card ASKS
 * is visible: which reads, with which options. What a real database answers
 * those reads is `count-widget`, `count-scheduled`, `over-time-range`,
 * `breakdown` and `recent-entries-fields` in this directory, as integration
 * tests.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetWidgetRegistries } from "../../../di/registrations/register-widgets";
import * as loggerModule from "../../../observability/logger";
import { IN_RELEASE_KEY } from "../../collections/query/reserved-filter-keys";
import { addPanelFacts } from "../add-panel";
import { allWidgets, sizeFacts } from "../canonical";
import { rowsThatFit } from "../card-geometry";
import { breakdownWidget } from "../core-widgets/breakdown";
import { countWidget } from "../core-widgets/count";
import { overTimeWidget } from "../core-widgets/over-time";
import { recentEntriesWidget } from "../core-widgets/recent-entries";
import {
  resolveCardSettings,
  unsetSetting,
} from "../declaration/card-settings";
import type {
  WidgetCollectionDescription,
  WidgetLoadSize,
  WidgetReadServices,
} from "../declaration/define-widget";
import { DENSITY_OPTIONS } from "../declaration/setting-builders";
import { widgetDeclarationFaults } from "../declaration/validate";
import { getWidget } from "../registry";

beforeEach(() => {
  vi.spyOn(loggerModule, "getNextlyLogger").mockReturnValue({
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  } as unknown as ReturnType<typeof loggerModule.getNextlyLogger>);
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** The batch's one instant. */
const NOW = new Date("2026-06-15T10:00:00.000Z");

/** A collection with a status, a title, and a choice field, as `describe` answers it. */
const POSTS: WidgetCollectionDescription = {
  title: "title",
  status: true,
  fields: [
    { name: "title", type: "string", label: "Title" },
    {
      name: "status",
      type: "string",
      label: "Status",
      choices: [
        { value: "draft", label: "Draft" },
        { value: "published", label: "Published" },
      ],
    },
    {
      name: "category",
      type: "string",
      label: "Category",
      choices: [{ value: "news", label: "News" }],
    },
    { name: "updatedAt", type: "date", label: "Updated At" },
  ],
};

/** A collection with no status, no title and nothing to divide its entries by. */
const LOGS: WidgetCollectionDescription = {
  status: false,
  fields: [{ name: "message", type: "string", label: "Message" }],
};

/** The series every mocked `timeseries` read answers. */
const POINTS = [{ start: "2026-06-15T00:00:00.000Z", count: 4 }];

/** Read services, each a mock that records its calls, as core's batch hands a load them. */
function bound(options: { count?: () => Promise<number> } = {}) {
  return {
    count: vi.fn(options.count ?? (async () => 7)),
    find: vi.fn(async () => ({
      items: [{ id: "a", title: "First", updatedAt: NOW.toISOString() }],
      total: 12,
    })),
    groupBy: vi.fn(async () => ({
      buckets: [
        { value: "published", count: 3 },
        { value: "draft", count: 2 },
        { value: null, count: 1 },
      ],
      truncated: true,
    })),
    timeseries: vi.fn(async () => ({
      points: POINTS,
      interval: "day" as const,
    })),
    describe: vi.fn(async (collection: string) =>
      collection === "posts" ? POSTS : collection === "logs" ? LOGS : undefined
    ),
  } satisfies WidgetReadServices;
}

/** What a load is handed: the card's settings as stored, resolved as core's batch resolves them. */
function inputFor(
  widget: { settings?: unknown },
  stored: Record<string, unknown>,
  size: WidgetLoadSize,
  services: WidgetReadServices
) {
  return {
    settings: resolveCardSettings(widget.settings, stored),
    services,
    size,
    now: NOW,
    user: { id: "reader" },
    signal: new AbortController().signal,
    scope: {
      getOrCompute: <T>(_key: string, compute: () => Promise<T>) => compute(),
    },
  };
}

const SMALL: WidgetLoadSize = { w: 3, h: 2, tier: "small" };
const MEDIUM: WidgetLoadSize = { w: 4, h: 2, tier: "medium" };
const LARGE: WidgetLoadSize = { w: 8, h: 3, tier: "large" };

/** Count's load, as core's batch calls it. */
function loadCount(
  stored: Record<string, unknown>,
  size: WidgetLoadSize,
  services: WidgetReadServices
) {
  return countWidget.load(
    inputFor(countWidget, stored, size, services) as Parameters<
      typeof countWidget.load
    >[0]
  );
}

describe("core's declared cards", () => {
  const declared = [
    countWidget,
    breakdownWidget,
    overTimeWidget,
    recentEntriesWidget,
  ];

  it.each(declared.map(widget => [widget.id, widget] as const))(
    "%s passes the checks every declaration is held to, as core's own",
    (_id, widget) => {
      expect(widgetDeclarationFaults(widget, "core", true)).toEqual([]);
    }
  );

  it("are published under core as cards answered on the server, by their own components, sketched as they load", () => {
    resetWidgetRegistries([]);
    const published = Object.fromEntries(
      declared.map(widget => [widget.id, getWidget(widget.id)])
    );
    expect(published).toMatchObject({
      "core/count": {
        component: "core#Count",
        offered: "per-collection",
        sketch: "metric",
      },
      "core/breakdown": {
        component: "core#Breakdown",
        offered: "per-collection",
        sketch: "bars",
      },
      "core/over-time": {
        component: "core#OverTime",
        offered: "per-collection",
        sketch: "timeseries",
      },
      "core/recent-entries": {
        component: "core#RecentEntries",
        offered: "per-collection",
        sketch: "list",
      },
    });
    for (const widget of declared) {
      expect(getWidget(widget.id), widget.id).toMatchObject({
        archetype: "custom",
        serverData: true,
      });
    }
  });

  it("sketches each one's add-panel row by the skeleton it states", () => {
    resetWidgetRegistries([]);
    const sketches = Object.fromEntries(
      allWidgets()
        .filter(widget => declared.some(each => each.id === widget.id))
        .map(widget => [widget.id, addPanelFacts(widget).sketch])
    );
    expect(sketches).toEqual({
      "core/count": "metric",
      "core/breakdown": "bars",
      "core/over-time": "timeseries",
      "core/recent-entries": "list",
    });
  });

  it("offers each any number of times", () => {
    resetWidgetRegistries([]);
    const several = Object.fromEntries(
      allWidgets()
        .filter(widget => declared.some(each => each.id === widget.id))
        .map(widget => [widget.id, sizeFacts(widget).allowsSeveral])
    );
    expect(several).toEqual({
      "core/count": true,
      "core/breakdown": true,
      "core/over-time": true,
      "core/recent-entries": true,
    });
  });

  it("offers Recent entries the shared Density, one option for every density", () => {
    expect(recentEntriesWidget.settings?.density).toMatchObject({
      type: "select",
      defaultValue: "default",
      options: [...DENSITY_OPTIONS],
    });
  });

  it("loads a card left to its collection's grouping or its own fields, and asks for a collection first", () => {
    // Group by and Fields unset still mean something: the collection's own
    // grouping, the list's own fields.
    for (const widget of [breakdownWidget, recentEntriesWidget]) {
      const settings = resolveCardSettings(widget.settings, {
        collection: "posts",
      });
      expect(
        unsetSetting(widget.settings, settings),
        widget.id
      ).toBeUndefined();
    }
    // The control: a Collection setting with no value is still missing.
    expect(
      unsetSetting(
        breakdownWidget.settings,
        resolveCardSettings(breakdownWidget.settings, {})
      )
    ).toEqual({ name: "collection", label: "Collection" });
  });
});

describe("Count's load", () => {
  it("reads the number alone on a small card: no scheduled figure, no trend, no period before", async () => {
    const services = bound();
    const data = await loadCount({ collection: "posts" }, SMALL, services);
    expect(services.groupBy).toHaveBeenCalledTimes(1);
    expect(services.groupBy).toHaveBeenCalledWith("posts", {
      field: "status",
      status: "all",
    });
    expect(services.count).not.toHaveBeenCalled();
    expect(services.timeseries).not.toHaveBeenCalled();
    // The buckets' sum, the null bucket included.
    expect(data).toEqual({ total: 6, split: { published: 3, draft: 2 } });
  });

  it("reads what a scheduled release will publish from the medium tier, for a collection with a status", async () => {
    const services = bound();
    const data = await loadCount({ collection: "posts" }, MEDIUM, services);
    expect(services.count).toHaveBeenCalledTimes(1);
    expect(services.count).toHaveBeenCalledWith("posts", {
      status: "all",
      where: { [IN_RELEASE_KEY]: true },
    });
    expect(services.timeseries).not.toHaveBeenCalled();
    expect(data).toEqual({
      total: 6,
      split: { published: 3, draft: 2 },
      scheduled: 7,
    });
  });

  it("reads the last 30 days and the 30 before them on a large card alone", async () => {
    const services = bound({ count: async () => 2 });
    const data = await loadCount({ collection: "posts" }, LARGE, services);
    expect(services.timeseries).toHaveBeenCalledTimes(1);
    expect(services.timeseries).toHaveBeenCalledWith("posts", {
      range: "30d",
      dateField: "createdAt",
      status: "all",
    });
    // The period before: the window as long that ends where the series starts.
    expect(services.count).toHaveBeenCalledWith("posts", {
      status: "all",
      window: { range: "30d", previous: true },
    });
    expect(data.trend).toEqual({ points: POINTS, prior: 2 });
  });

  it("counts every read under the card's Filter", async () => {
    const services = bound();
    const filter = { title: { equals: "launch" } };
    await loadCount({ collection: "posts", filter }, LARGE, services);
    expect(services.groupBy).toHaveBeenCalledWith("posts", {
      field: "status",
      status: "all",
      where: filter,
    });
    // Joined under `and`, so the release condition keeps its top-level key.
    expect(services.count).toHaveBeenCalledWith("posts", {
      status: "all",
      where: { [IN_RELEASE_KEY]: true, and: [filter] },
    });
    expect(services.timeseries).toHaveBeenCalledWith(
      "posts",
      expect.objectContaining({ where: filter })
    );
    expect(services.count).toHaveBeenCalledWith(
      "posts",
      expect.objectContaining({
        window: { range: "30d", previous: true },
        where: filter,
      })
    );
  });

  it("counts a collection without a status plainly, with no scheduled figure", async () => {
    const services = bound();
    const data = await loadCount({ collection: "logs" }, MEDIUM, services);
    expect(services.groupBy).not.toHaveBeenCalled();
    expect(services.count).toHaveBeenCalledTimes(1);
    expect(services.count).toHaveBeenCalledWith("logs", { status: "all" });
    expect(data).toEqual({ total: 7 });
  });

  it("leaves the scheduled figure out for a reader with no release to read, keeping the number", async () => {
    const services = bound({
      count: async () => {
        throw new Error("not available");
      },
    });
    const data = await loadCount({ collection: "posts" }, MEDIUM, services);
    expect(data).toEqual({ total: 6, split: { published: 3, draft: 2 } });
  });
});

describe("Breakdown's load", () => {
  function loadBreakdown(
    stored: Record<string, unknown>,
    services: WidgetReadServices
  ) {
    return breakdownWidget.load(
      inputFor(breakdownWidget, stored, MEDIUM, services) as Parameters<
        typeof breakdownWidget.load
      >[0]
    );
  }

  it("groups by what the collection divides by when its Group by is unset, naming its values", async () => {
    const services = bound();
    const data = await loadBreakdown({ collection: "posts" }, services);
    expect(services.groupBy).toHaveBeenCalledWith("posts", {
      field: "status",
      status: "all",
    });
    expect(data).toEqual({
      buckets: [
        { value: "published", count: 3 },
        { value: "draft", count: 2 },
        { value: null, count: 1 },
      ],
      // The grouped field as the collection describes it.
      field: {
        name: "status",
        type: "string",
        label: "Status",
        choices: [
          { value: "draft", label: "Draft" },
          { value: "published", label: "Published" },
        ],
      },
      truncated: true,
    });
  });

  it("groups by its Group by, under its Filter", async () => {
    const services = bound();
    const filter = { title: { equals: "launch" } };
    await loadBreakdown(
      { collection: "posts", groupBy: "category", filter },
      services
    );
    expect(services.groupBy).toHaveBeenCalledWith("posts", {
      field: "category",
      status: "all",
      where: filter,
    });
  });

  it("falls back to what the collection divides by from a Group by this reader may not use", async () => {
    const services = bound();
    // `secret` is not among the fields the collection describes to this reader.
    await loadBreakdown({ collection: "posts", groupBy: "secret" }, services);
    expect(services.groupBy).toHaveBeenCalledWith("posts", {
      field: "status",
      status: "all",
    });
  });

  it("asks nothing of a collection with nothing to divide by", async () => {
    const services = bound();
    const data = await loadBreakdown({ collection: "logs" }, services);
    expect(services.groupBy).not.toHaveBeenCalled();
    expect(data).toEqual({ buckets: null });
  });
});

describe("Over time's load", () => {
  it("reads the entries created in each interval of its Date range, under its Filter", async () => {
    const services = bound();
    const filter = { title: { equals: "launch" } };
    const data = await overTimeWidget.load(
      inputFor(
        overTimeWidget,
        { collection: "posts", dateRange: "90d", filter },
        MEDIUM,
        services
      ) as Parameters<typeof overTimeWidget.load>[0]
    );
    expect(services.timeseries).toHaveBeenCalledWith("posts", {
      range: "90d",
      dateField: "createdAt",
      status: "all",
      where: filter,
    });
    expect(data).toEqual({ points: POINTS, interval: "day" });
  });

  it("draws the last 30 days until its Date range is chosen", async () => {
    const services = bound();
    await overTimeWidget.load(
      inputFor(
        overTimeWidget,
        { collection: "posts" },
        MEDIUM,
        services
      ) as Parameters<typeof overTimeWidget.load>[0]
    );
    expect(services.timeseries).toHaveBeenCalledWith(
      "posts",
      expect.objectContaining({ range: "30d" })
    );
  });
});

describe("Recent entries' load", () => {
  function loadRecent(
    stored: Record<string, unknown>,
    size: WidgetLoadSize,
    services: WidgetReadServices
  ) {
    return recentEntriesWidget.load(
      inputFor(recentEntriesWidget, stored, size, services) as Parameters<
        typeof recentEntriesWidget.load
      >[0]
    );
  }

  it.each([
    [4, "default"],
    [8, "default"],
    [6, "compact"],
  ] as const)(
    "asks the rows a card %i rows tall holds at %s density, and one more",
    async (h, density) => {
      const services = bound();
      // The most items a card offers, so its height alone decides the rows.
      await loadRecent(
        { collection: "posts", limit: 10, density },
        { w: 6, h, tier: "medium" },
        services
      );
      expect(services.find).toHaveBeenCalledWith(
        "posts",
        expect.objectContaining({
          limit: rowsThatFit({ h }, { density }) + 1,
        })
      );
    }
  );

  it("asks a different number of rows at two heights", async () => {
    // The control for the cases above: a load that ignored its size would ask
    // the same at both.
    const asked: unknown[] = [];
    for (const h of [4, 8]) {
      const services = bound();
      await loadRecent(
        { collection: "posts", limit: 10 },
        { w: 6, h, tier: "medium" },
        services
      );
      const [, options] = services.find.mock.calls[0] as unknown as [
        string,
        { limit?: number },
      ];
      asked.push(options.limit);
    }
    expect(asked[0]).not.toEqual(asked[1]);
  });

  it("asks at most its Number of items, and one more", async () => {
    const services = bound();
    await loadRecent(
      { collection: "posts", limit: 2 },
      { w: 6, h: 8, tier: "large" },
      services
    );
    expect(services.find).toHaveBeenCalledWith(
      "posts",
      expect.objectContaining({ limit: 3 })
    );
  });

  it("asks each row by its title, status and when it was updated, in its Sort, and how many match", async () => {
    const services = bound();
    const data = await loadRecent(
      { collection: "posts" },
      { w: 6, h: 5, tier: "medium" },
      services
    );
    expect(services.find).toHaveBeenCalledWith("posts", {
      select: ["title", "status", "updatedAt"],
      sort: "-updatedAt",
      limit: Math.min(5, rowsThatFit({ h: 5 }, { density: "default" })) + 1,
      status: "all",
      total: true,
    });
    expect(data).toEqual({
      title: "title",
      rows: [{ id: "a", title: "First", updatedAt: NOW.toISOString() }],
      // Headed as the collection describes each column, title first.
      columns: [
        { name: "title", type: "string", label: "Title" },
        {
          name: "status",
          type: "string",
          label: "Status",
          choices: [
            { value: "draft", label: "Draft" },
            { value: "published", label: "Published" },
          ],
        },
        { name: "updatedAt", type: "date", label: "Updated At" },
      ],
      total: 12,
    });
  });

  it("asks the fields its reader chose after the title", async () => {
    const services = bound();
    await loadRecent(
      { collection: "posts", fields: ["category"] },
      { w: 6, h: 5, tier: "medium" },
      services
    );
    expect(services.find).toHaveBeenCalledWith(
      "posts",
      expect.objectContaining({ select: ["title", "category"] })
    );
  });

  it("asks nothing of a collection that names no title", async () => {
    const services = bound();
    const data = await loadRecent(
      { collection: "logs" },
      { w: 6, h: 5, tier: "medium" },
      services
    );
    expect(services.find).not.toHaveBeenCalled();
    expect(data).toEqual({ title: null, rows: [], columns: [] });
  });
});
