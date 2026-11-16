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
import { allWidgets, sizeFacts } from "../canonical";
import { breakdownWidget } from "../core-widgets/breakdown";
import { countWidget, trendFrom } from "../core-widgets/count";
import { overTimeWidget } from "../core-widgets/over-time";
import { recentEntriesWidget } from "../core-widgets/recent-entries";
import {
  resolveCardSettings,
  unsetSetting,
} from "../declaration/card-settings";
import { CORE_OWNER, declaredWidget } from "../declaration/declared-widgets";
import type {
  WidgetCollectionDescription,
  WidgetInterval,
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

/** A `count` read's arguments, as a load hands them. */
type CountRead = (
  collection: string,
  options?: { window?: unknown }
) => Promise<number>;

/** Read services, each a mock that records its calls, as core's batch hands a load them. */
function bound(options: { count?: CountRead } = {}) {
  return {
    count: vi.fn<CountRead>(options.count ?? (async () => 7)),
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
      interval: "day" as WidgetInterval,
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
        sketch: "table",
      },
    });
    for (const widget of declared) {
      expect(getWidget(widget.id), widget.id).toMatchObject({
        archetype: "custom",
      });
      // Answered on the server from the declaration core keeps for it.
      expect(declaredWidget(widget.id)?.owner, widget.id).toBe(CORE_OWNER);
    }
  });

  it("publishes each one's loading shape by the skeleton it states", () => {
    resetWidgetRegistries([]);
    // The registry's `sketch`, which the card's skeleton is drawn as.
    const sketches = Object.fromEntries(
      allWidgets()
        .filter(widget => declared.some(each => each.id === widget.id))
        .map(widget => [widget.id, widget.sketch])
    );
    expect(sketches).toEqual({
      "core/count": "metric",
      "core/breakdown": "bars",
      "core/over-time": "timeseries",
      "core/recent-entries": "table",
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
  /** The 7-day window the change line counts over. */
  const WEEK = { range: "7d" };

  it("reads the number and the change this week by default, nothing else", async () => {
    const services = bound({
      count: async (_c: string, options?: { window?: unknown }) =>
        options?.window === undefined ? 24 : 3,
    });
    const data = await loadCount({ collection: "posts" }, SMALL, services);
    expect(services.count).toHaveBeenCalledTimes(2);
    expect(services.count).toHaveBeenCalledWith("posts", { status: "all" });
    expect(services.count).toHaveBeenCalledWith("posts", {
      status: "all",
      window: WEEK,
    });
    expect(services.groupBy).not.toHaveBeenCalled();
    expect(services.timeseries).not.toHaveBeenCalled();
    expect(data).toEqual({
      total: 24,
      counted: "all",
      line: "change",
      change: 3,
    });
  });

  it("reads the same at every width: the size never changes what is asked", async () => {
    const asked = async (size: WidgetLoadSize) => {
      const services = bound();
      await loadCount({ collection: "posts" }, size, services);
      return services.count.mock.calls;
    };
    expect(await asked(LARGE)).toEqual(await asked(SMALL));
    expect(await asked(MEDIUM)).toEqual(await asked(SMALL));
  });

  it("counts the published entries alone, and their change, under Count: Published", async () => {
    const services = bound();
    const data = await loadCount(
      { collection: "posts", count: "published" },
      SMALL,
      services
    );
    // A read naming no status reads the published entries.
    expect(services.count).toHaveBeenCalledWith("posts", {});
    expect(services.count).toHaveBeenCalledWith("posts", { window: WEEK });
    expect(data.counted).toBe("published");
  });

  it("counts the drafts alone, and only drafts in the change, under Count: Drafts", async () => {
    const drafts = { status: { equals: "draft" } };
    const services = bound();
    const data = await loadCount(
      { collection: "posts", count: "draft" },
      SMALL,
      services
    );
    expect(services.count).toHaveBeenCalledWith("posts", {
      status: "all",
      where: drafts,
    });
    // 🔴 The change counts what the number counts: a week of new published
    // entries is no change to the drafts.
    expect(services.count).toHaveBeenCalledWith("posts", {
      status: "all",
      where: drafts,
      window: WEEK,
    });
    expect(data.counted).toBe("draft");
  });

  it("reads the split by status with one read for the number, and what scheduled releases will publish", async () => {
    const services = bound();
    const data = await loadCount(
      { collection: "posts", show: "split" },
      SMALL,
      services
    );
    expect(services.groupBy).toHaveBeenCalledTimes(1);
    expect(services.groupBy).toHaveBeenCalledWith("posts", {
      field: "status",
      status: "all",
    });
    expect(services.count).toHaveBeenCalledTimes(1);
    expect(services.count).toHaveBeenCalledWith("posts", {
      status: "all",
      where: { [IN_RELEASE_KEY]: true },
    });
    // The buckets' sum, the null bucket included.
    expect(data).toEqual({
      total: 6,
      counted: "all",
      line: "split",
      split: { published: 3, draft: 2, scheduled: 7 },
    });
  });

  it("draws the change in place of a split of anything but every entry", async () => {
    for (const count of ["published", "draft"]) {
      const services = bound();
      const data = await loadCount(
        { collection: "posts", count, show: "split" },
        SMALL,
        services
      );
      expect(services.groupBy).not.toHaveBeenCalled();
      expect(data.line).toBe("change");
      expect(data.split).toBeUndefined();
    }
  });

  it("reads the trend over the weeks of the last 90 days, ending at the number", async () => {
    const services = bound({ count: async () => 10 });
    services.timeseries.mockResolvedValue({
      points: [1, 0, 2, 0, 1, 0, 0, 3, 0, 1, 0, 0, 2].map((count, i) => ({
        start: new Date(Date.UTC(2026, 2, 16 + i * 7)).toISOString(),
        count,
      })),
      interval: "week" as const,
    });
    const data = await loadCount(
      { collection: "posts", show: "trend" },
      SMALL,
      services
    );
    expect(services.timeseries).toHaveBeenCalledWith("posts", {
      range: "90d",
      status: "all",
    });
    expect(services.count).toHaveBeenCalledTimes(1);
    // Walked back from 10: the last week made 2, the one before 0, and so on.
    expect(data.trend).toEqual([4, 4, 4, 7, 7, 8, 8, 8, 10]);
    expect(data.line).toBe("trend");
  });

  it("draws nothing under the number under Nothing, reading the number alone", async () => {
    const services = bound();
    const data = await loadCount(
      { collection: "posts", show: "none" },
      SMALL,
      services
    );
    expect(services.count).toHaveBeenCalledTimes(1);
    expect(data).toEqual({ total: 7, counted: "all", line: "none" });
  });

  it("counts every read under the card's Filter", async () => {
    const filter = { title: { equals: "launch" } };
    const split = bound();
    await loadCount(
      { collection: "posts", filter, show: "split" },
      SMALL,
      split
    );
    expect(split.groupBy).toHaveBeenCalledWith("posts", {
      field: "status",
      status: "all",
      where: filter,
    });
    // Joined under `and`, so the release condition keeps its top-level key.
    expect(split.count).toHaveBeenCalledWith("posts", {
      status: "all",
      where: { [IN_RELEASE_KEY]: true, and: [filter] },
    });
    const change = bound();
    await loadCount({ collection: "posts", filter }, SMALL, change);
    expect(change.count).toHaveBeenCalledWith("posts", {
      status: "all",
      where: filter,
      window: WEEK,
    });
    const trend = bound();
    await loadCount(
      { collection: "posts", filter, show: "trend" },
      SMALL,
      trend
    );
    expect(trend.timeseries).toHaveBeenCalledWith(
      "posts",
      expect.objectContaining({ where: filter })
    );
  });

  it("counts every entry of a collection without a status, whatever its Count or line asks", async () => {
    const services = bound();
    const data = await loadCount(
      { collection: "logs", count: "draft", show: "split" },
      SMALL,
      services
    );
    expect(services.groupBy).not.toHaveBeenCalled();
    expect(services.count).toHaveBeenCalledWith("logs", { status: "all" });
    expect(data).toMatchObject({ total: 7, counted: "all", line: "change" });
  });

  it("leaves out a line it cannot read, keeping the number", async () => {
    const refusesWindows = bound({
      count: async (_c: string, options?: { window?: unknown }) => {
        if (options?.window !== undefined) throw new Error("not available");
        return 5;
      },
    });
    expect(
      await loadCount({ collection: "posts" }, SMALL, refusesWindows)
    ).toEqual({ total: 5, counted: "all", line: "change" });

    const refusesReleases = bound({
      count: async () => {
        throw new Error("not available");
      },
    });
    expect(
      await loadCount(
        { collection: "posts", show: "split" },
        SMALL,
        refusesReleases
      )
    ).toEqual({
      total: 6,
      counted: "all",
      line: "split",
      split: { published: 3, draft: 2 },
    });
  });
});

describe("trendFrom", () => {
  it("is the number alone for a series with nothing before this week", () => {
    expect(trendFrom([{ count: 4 }], 4)).toEqual([4]);
  });

  it("never draws below zero", () => {
    expect(trendFrom([{ count: 0 }, { count: 9 }], 3)).toEqual([0, 3]);
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
    [10, 2, "default"],
    [10, 8, "default"],
    [10, 8, "compact"],
    [20, 2, "default"],
    [20, 8, "default"],
    [20, 8, "compact"],
  ] as const)(
    "asks its Number of entries of %i and one more on a card %i rows tall at %s density",
    async (limit, h, density) => {
      const services = bound();
      await loadRecent(
        { collection: "posts", limit, density },
        { w: 6, h, tier: "medium" },
        services
      );
      expect(services.find).toHaveBeenCalledWith(
        "posts",
        expect.objectContaining({ limit: limit + 1 })
      );
    }
  );

  it("asks the same rows at every height: its size never decides them", async () => {
    // The control for the cases above: a load that still read its size asks fewer on the card
    // two rows tall, which holds no whole row, than on the one eight rows tall.
    const asked: unknown[] = [];
    for (const h of [2, 3, 5, 8]) {
      const services = bound();
      await loadRecent(
        { collection: "posts", limit: 20 },
        { w: 6, h, tier: "medium" },
        services
      );
      const [, options] = services.find.mock.calls[0] as unknown as [
        string,
        { limit?: number },
      ];
      asked.push(options.limit);
    }
    expect(asked).toEqual([21, 21, 21, 21]);
  });

  it("asks at most its Number of entries, and one more", async () => {
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
      // Five, the Number of entries a card holds until its reader sets one, and one more.
      limit: 6,
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
