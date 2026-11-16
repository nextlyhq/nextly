/**
 * The site's settings: the one door its breakpoints change through, the route
 * that is that door, and what a caller is told it may change.
 *
 * @module site-settings.test
 */
import { describe, expect, it, vi } from "vitest";

import type { BreakpointRun, HoldingRun } from "./breakpoint-removal/run-store";
import type { BreakpointRemovalService } from "./breakpoint-removal/service";
import { LAYOUTS_SLUG } from "./collections/layouts";
import {
  MANAGE_SITE_PERMISSION,
  readSiteSettings,
  siteBreakpointRemovalStatusRoute,
  type BreakpointRemoval,
  writeSiteBreakpoints,
  type SiteSettingsDirectApi,
  type SiteSettingsRouteContext,
} from "./site-settings";
import {
  BREAKPOINTS_OUTSIDE_SETTINGS,
  refuseBreakpointsOutsideSettings,
  SITE_SETTINGS_WRITE_CONTEXT,
  SITE_STYLE_SLUG,
} from "./site-style-storage";

const SET = {
  viewport: [
    { id: "desktop", label: "Desktop" },
    { id: "tablet", label: "Tablet", maxWidth: 1024 },
  ],
  container: [],
};
/** The same set, stored with its keys in another order, as `jsonb` returns it. */
const SET_REORDERED = {
  container: [],
  viewport: [
    { label: "Desktop", id: "desktop" },
    { maxWidth: 1024, label: "Tablet", id: "tablet" },
  ],
};
const CHANGED = {
  viewport: [...SET.viewport, { id: "mobile", label: "Mobile", maxWidth: 640 }],
  container: [],
};
const author = { id: "user-1" };

function refused(run: () => void): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  return undefined;
}

describe("the site-style Single's one door for breakpoints", () => {
  it("refuses a signed-in write that changes the breakpoints, saying where they change", () => {
    const error = refused(() =>
      refuseBreakpointsOutsideSettings({
        data: { breakpoints: CHANGED },
        originalData: { breakpoints: SET },
        user: author,
        context: {},
      })
    );
    expect(error).toMatchObject({
      code: "FORBIDDEN",
      publicMessage: BREAKPOINTS_OUTSIDE_SETTINGS,
    });
  });

  it("refuses a person a plugin signs in, as it refuses a user", () => {
    const error = refused(() =>
      refuseBreakpointsOutsideSettings({
        data: { breakpoints: CHANGED },
        originalData: { breakpoints: SET },
        principal: { type: "principal", kind: "member", id: "m-1" },
        context: {},
      })
    );
    expect(error).toMatchObject({ code: "FORBIDDEN" });
  });

  it("lets the Settings route's own write through", () => {
    expect(
      refused(() =>
        refuseBreakpointsOutsideSettings({
          data: { breakpoints: CHANGED },
          originalData: { breakpoints: SET },
          user: author,
          context: { ...SITE_SETTINGS_WRITE_CONTEXT },
        })
      )
    ).toBeUndefined();
  });

  it("lets through a write that leaves the breakpoints alone", () => {
    for (const data of [
      { tokens: { tokens: [] } },
      { breakpoints: SET_REORDERED, tokens: { tokens: [] } },
    ]) {
      expect(
        refused(() =>
          refuseBreakpointsOutsideSettings({
            data,
            originalData: { breakpoints: SET },
            user: author,
            context: {},
          })
        )
      ).toBeUndefined();
    }
  });

  it("lets server code acting as nobody change them", () => {
    expect(
      refused(() =>
        refuseBreakpointsOutsideSettings({
          data: { breakpoints: CHANGED },
          originalData: { breakpoints: SET },
          context: {},
        })
      )
    ).toBeUndefined();
  });
});

function route(over: Partial<SiteSettingsRouteContext> = {}) {
  return {
    self: {
      collections: { [LAYOUTS_SLUG]: "site_layouts" },
      singles: { [SITE_STYLE_SLUG]: "site_style" },
    },
    user: author,
    caller: null,
    ...over,
  } satisfies SiteSettingsRouteContext;
}

function post(body: unknown): Request {
  return new Request("http://local/site/breakpoints", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("the breakpoints route", () => {
  it("is guarded by the site permission", async () => {
    const { siteBreakpointsRoute } = await import("./site-settings");
    expect(siteBreakpointsRoute().requiredPermission).toBe(
      "manage-page-builder-site"
    );
    expect(MANAGE_SITE_PERMISSION).toBe("manage-page-builder-site");
  });

  it("stores the set on the RESOLVED Single, marked as the Settings write, whatever is stored", async () => {
    const updateSingle = vi.fn<SiteSettingsDirectApi["updateSingle"]>(
      async () => ({})
    );
    const response = await writeSiteBreakpoints(
      post({ breakpoints: CHANGED }),
      route(),
      { updateSingle }
    );
    expect(response.status).toBe(200);
    expect(updateSingle).toHaveBeenCalledWith({
      slug: "site_style",
      // The screen saves the whole set it shows, without reading first.
      data: { breakpoints: CHANGED, _overwrite: true },
      overrideAccess: true,
      context: SITE_SETTINGS_WRITE_CONTEXT,
      user: author,
    });
  });

  it("refuses a set the Single would refuse, and stores nothing", async () => {
    const updateSingle = vi.fn<SiteSettingsDirectApi["updateSingle"]>(
      async () => ({})
    );
    const duplicated = {
      viewport: [
        ...SET.viewport,
        { id: "tablet", label: "Again", maxWidth: 900 },
      ],
      container: [],
    };
    for (const body of [
      { breakpoints: duplicated },
      { breakpoints: SET, extra: true },
      {},
      "not json",
    ]) {
      await expect(
        writeSiteBreakpoints(post(body), route(), { updateSingle })
      ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    }
    expect(updateSingle).not.toHaveBeenCalled();
  });
});

describe("a confirmed removal's write of the shared styles", () => {
  it("is not made when what it takes out cannot be kept, and the removal is dropped", async () => {
    const stored = {
      breakpoints: CHANGED,
      classes: [
        {
          id: "c-1",
          slug: "one",
          orderIndex: 0,
          styles: { base: { base: { color: "#0" }, mobile: { color: "#9" } } },
        },
      ],
      version: "v1",
    };
    const service = {
      holding: vi.fn(async () => []),
      retire: vi.fn(async () => {}),
      begin: vi.fn(async () => ({ id: "run-1" })),
      abandon: vi.fn(async () => {}),
      publish: vi.fn(async () => {}),
      discardFragment: vi.fn(async () => {}),
      keepFragment: vi.fn(async () => {
        throw new Error("the fragments table refused the row");
      }),
    };
    const removal = {
      stored: async () => stored,
      count: async () => ({ removed: [], unreadable: 0, complete: true }),
      cascade: { service: () => service, walkMs: 1000, countMs: 1000 },
    } as unknown as BreakpointRemoval;
    const updateSingle = vi.fn(async () => ({}));
    await expect(
      writeSiteBreakpoints(
        post({ breakpoints: SET, confirmRemoval: true, version: "v1" }),
        route({ caller: holding("manage-page-builder-site").caller }) as never,
        { updateSingle } as never,
        removal
      )
    ).rejects.toThrow("refused the row");
    // What it would take out was offered to be kept, before any write.
    expect(service.keepFragment).toHaveBeenCalledWith({
      runId: "run-1",
      host: null,
      form: "site",
      fragment: {
        classes: { "c-1": { base: { mobile: { color: "#9" } } } },
        overridden: [],
      },
    });
    expect(updateSingle).not.toHaveBeenCalled();
    expect(service.abandon).toHaveBeenCalledWith("run-1");
  });
});

/** A caller holding exactly the grants named, recording what it was asked. */
function holding(...grants: string[]) {
  const asked: string[] = [];
  return {
    asked,
    caller: {
      can: async (action: string, resource: string) => {
        asked.push(`${action}-${resource}`);
        return grants.includes(`${action}-${resource}`);
      },
    },
  };
}

const LAYOUTS = [
  { id: "main", title: "Main" },
  { id: "bare", title: "No header or footer" },
];

/** The Direct API slice the read uses, recording what it was asked. */
function siteData(
  defaultLayout: string | null,
  layouts: ReadonlyArray<{ id: string; title: string }> = LAYOUTS,
  pageSize = 100
) {
  const finds: Array<Record<string, unknown>> = [];
  return {
    finds,
    nextly: {
      findSingle: async (args: { slug: string }) =>
        args.slug === "site_style" ? { breakpoints: SET } : { defaultLayout },
      find: async (args: Record<string, unknown>) => {
        finds.push(args);
        const where = args.where as { id?: { in?: string[] } } | undefined;
        const only = where?.id?.in;
        const all = layouts.filter(
          l => only === undefined || only.includes(l.id)
        );
        const page = (args.page as number | undefined) ?? 1;
        return {
          items: all.slice((page - 1) * pageSize, page * pageSize),
          meta: { hasNext: page * pageSize < all.length },
        };
      },
    } as unknown as Parameters<typeof readSiteSettings>[1],
  };
}

describe("what the Site tab reads", () => {
  it("tells a caller without the site permission nothing, whatever else it holds", async () => {
    const { caller } = holding("update-site_layouts", "publish-site_layouts");
    const data = siteData("main");
    expect(await readSiteSettings(route({ caller }), data.nextly)).toEqual({
      mayManageSite: false,
      mayChooseDefaultLayout: false,
      defaultLayout: null,
      breakpoints: null,
      layouts: [],
    });
    expect(data.finds).toEqual([]);
  });

  it("offers every published Layout to a caller who may choose the default", async () => {
    const all = holding(
      "manage-page-builder-site",
      "update-site_layouts",
      "publish-site_layouts"
    );
    const data = siteData("main");
    expect(
      await readSiteSettings(route({ caller: all.caller }), data.nextly)
    ).toEqual({
      mayManageSite: true,
      mayChooseDefaultLayout: true,
      defaultLayout: "main",
      breakpoints: SET,
      layouts: LAYOUTS,
    });
    // Published only, from the RESOLVED Layouts collection.
    expect(data.finds[0]).toMatchObject({
      collection: "site_layouts",
      status: "published",
    });
  });

  it("names only the current default to a caller who may not choose it", async () => {
    for (const grants of [
      ["manage-page-builder-site"],
      ["manage-page-builder-site", "update-site_layouts"],
      ["manage-page-builder-site", "publish-site_layouts"],
    ]) {
      const data = siteData("bare");
      const read = await readSiteSettings(
        route({ caller: holding(...grants).caller }),
        data.nextly
      );
      expect(read).toEqual({
        mayManageSite: true,
        mayChooseDefaultLayout: false,
        defaultLayout: "bare",
        breakpoints: SET,
        layouts: [{ id: "bare", title: "No header or footer" }],
      });
    }
  });

  it("reads no Layouts for a site with no default, to a caller who may not choose", async () => {
    const data = siteData(null);
    const read = await readSiteSettings(
      route({ caller: holding("manage-page-builder-site").caller }),
      data.nextly
    );
    expect(read.layouts).toEqual([]);
    expect(data.finds).toEqual([]);
  });

  it("offers every published Layout, past the first page", async () => {
    const many = Array.from({ length: 5 }, (_, n) => ({
      id: `l${n}`,
      title: `Layout ${n}`,
    }));
    const data = siteData("l4", many, 2);
    const all = holding(
      "manage-page-builder-site",
      "update-site_layouts",
      "publish-site_layouts"
    );
    const read = await readSiteSettings(
      route({ caller: all.caller }),
      data.nextly
    );
    expect(read.layouts.map(layout => layout.id)).toEqual([
      "l0",
      "l1",
      "l2",
      "l3",
      "l4",
    ]);
    expect(data.finds.length).toBe(3);
  });

  it("tells nobody nothing", async () => {
    const data = siteData("main");
    expect(
      await readSiteSettings(route({ caller: null }), data.nextly)
    ).toMatchObject({ mayManageSite: false, layouts: [] });
  });

  it("reports the removals still holding what they removed: the open one first, then the newest done ones", async () => {
    const { removal, holdingAsked } = removals([
      held(run("0190a000-0000-7000-8000-000000000001", ["mobile"], false), [
        "pending-draft",
      ]),
      // The oldest: a done run opened again to retry what it left.
      held(run("0190a000-0000-7000-8000-000000000000", ["phone"], true), []),
      held(run("0190a000-0000-7000-8000-000000000003", ["mobile"], false), [
        "pending-draft",
        "unreadable",
      ]),
      held(run("0190a000-0000-7000-8000-000000000002", ["tablet"], false), [
        "pending-draft",
      ]),
      // Every id defined again: it holds none of them.
      held(run("0190a000-0000-7000-8000-000000000005", [], false), [
        "pending-draft",
      ]),
      // A save still preparing it: it may yet be abandoned.
      held(
        run("0190a000-0000-7000-8000-000000000006", ["mobile"], true, true),
        []
      ),
    ]);
    const read = await readSiteSettings(
      route({ caller: holding("manage-page-builder-site").caller }),
      siteData("main").nextly,
      undefined,
      removal
    );
    expect(read.removals).toEqual([
      {
        runId: "0190a000-0000-7000-8000-000000000000",
        labels: ["Phone"],
        open: true,
        left: 0,
        waitingOnDrafts: false,
      },
      {
        runId: "0190a000-0000-7000-8000-000000000003",
        labels: ["Mobile"],
        open: false,
        left: 2,
        waitingOnDrafts: false,
      },
      {
        runId: "0190a000-0000-7000-8000-000000000002",
        labels: ["Tablet"],
        open: false,
        left: 1,
        waitingOnDrafts: true,
      },
    ]);
    expect(holdingAsked()).toBe(1);
  });

  it("asks nothing about removals for a caller who may not manage the site", async () => {
    const { removal, holdingAsked } = removals([]);
    const read = await readSiteSettings(
      route({ caller: holding().caller }),
      siteData("main").nextly,
      undefined,
      removal
    );
    expect(read).not.toHaveProperty("removals");
    expect(holdingAsked()).toBe(0);
  });

  it("still answers, with no removals and the failure logged, when the runs cannot be read", async () => {
    const logError = vi.fn();
    const { removal } = removals(new Error("runs unreadable"), logError);
    const read = await readSiteSettings(
      route({ caller: holding("manage-page-builder-site").caller }),
      siteData("main").nextly,
      undefined,
      removal
    );
    expect(read).toMatchObject({ mayManageSite: true, breakpoints: SET });
    expect(read).not.toHaveProperty("removals");
    expect(logError).toHaveBeenCalledTimes(1);
  });
});

describe("reading one removal", () => {
  const RUNS = [
    held(run("0190a000-0000-7000-8000-000000000004", ["phone"], false), [
      "unreadable",
    ]),
    held(run("0190a000-0000-7000-8000-000000000003", ["tablet"], false), [
      "unreadable",
    ]),
    held(run("0190a000-0000-7000-8000-000000000002", ["tablet"], false), [
      "unreadable",
    ]),
    // The oldest, past the list's cap of three.
    held(run("0190a000-0000-7000-8000-000000000001", ["mobile"], false), [
      "pending-draft",
      "pending-draft",
    ]),
    held(
      run("0190a000-0000-7000-8000-000000000009", ["mobile"], true, true),
      []
    ),
  ];

  async function ask(query: string) {
    const { removal } = removals(RUNS);
    const statusRoute = siteBreakpointRemovalStatusRoute(
      removal as Parameters<typeof siteBreakpointRemovalStatusRoute>[0]
    );
    return statusRoute.handler(
      new Request(`http://site.test/site/breakpoints/removal${query}`),
      route() as never
    );
  }

  it("answers a run the Site tab's list leaves out past its cap", async () => {
    const answer = await ask("?runId=0190a000-0000-7000-8000-000000000001");
    expect(await answer.json()).toEqual({
      removal: {
        runId: "0190a000-0000-7000-8000-000000000001",
        labels: ["Mobile"],
        open: false,
        left: 2,
        waitingOnDrafts: true,
      },
    });
  });

  it("answers null for a run holding nothing, an unknown one, or one still preparing", async () => {
    for (const id of [
      "0190a000-0000-7000-8000-00000000000f",
      "0190a000-0000-7000-8000-000000000009",
    ]) {
      expect(await (await ask(`?runId=${id}`)).json()).toEqual({
        removal: null,
      });
    }
  });

  it("answers a read naming no run with the removals alone, as the Site tab reports them", async () => {
    const answer = (await (await ask("")).json()) as {
      removals: { runId: string }[];
      undoable: unknown;
    };
    expect(answer.removals.length).toBeGreaterThan(0);
    expect(answer.undoable).toBeNull();
  });

  it("refuses a read naming a run that is not one", async () => {
    await expect(ask("?runId=")).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });
});

/** The set every run here removed from, as the stylesheet was emitted then. */
const EMITTED = {
  viewport: [
    { id: "tablet", label: "Tablet", maxWidth: 1024 },
    { id: "mobile", label: "Mobile", maxWidth: 640 },
    { id: "phone", label: "Phone", maxWidth: 400 },
  ],
  container: [],
};

/** A removal run, as the run store hands it out. */
function run(
  id: string,
  removedIds: string[],
  open: boolean,
  preparing = false
): BreakpointRun {
  return {
    id,
    phase: open ? "converting" : "done",
    cursor: null,
    removedIds,
    readdedIds: [],
    before: null,
    beforeEmitted: EMITTED,
    startedBy: "user:user-1",
    open,
    preparing,
    undoes: null,
  };
}

function held(r: BreakpointRun, leftReasons: string[]): HoldingRun {
  return { run: r, leftReasons };
}

/** An installed removal whose runs are `runs`, or whose read throws it. */
function removals(
  runs: HoldingRun[] | Error,
  logError?: (message: string, meta: Record<string, unknown>) => void
) {
  let asked = 0;
  const service = {
    holding: async () => {
      asked += 1;
      if (runs instanceof Error) throw runs;
      return runs;
    },
    undoable: async () => null,
  } as unknown as BreakpointRemovalService;
  const removal = {
    stored: async () => ({}),
    count: async () => ({ removed: [], unreadable: 0, complete: true }),
    cascade: {
      service: () => service,
      walkMs: 1000,
      countMs: 1000,
      ...(logError === undefined ? {} : { logError }),
    },
  } as unknown as BreakpointRemoval;
  return { removal, holdingAsked: () => asked };
}
