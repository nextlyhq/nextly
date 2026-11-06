/**
 * The site's settings: the one door its breakpoints change through, the route
 * that is that door, and what a caller is told it may change.
 *
 * @module site-settings.test
 */
import { describe, expect, it, vi } from "vitest";

import { LAYOUTS_SLUG } from "./collections/layouts";
import {
  MANAGE_SITE_PERMISSION,
  readSiteSettings,
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
});
