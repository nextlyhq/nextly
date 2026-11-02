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
  readSiteCapability,
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

  it("stores the set on the RESOLVED Single, marked as the Settings write", async () => {
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
      data: { breakpoints: CHANGED },
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

describe("what the Site tab is told", () => {
  it("offers nothing to a caller without the site permission, whatever else it holds", async () => {
    const { caller } = holding("update-site_layouts", "publish-site_layouts");
    expect(await readSiteCapability(route({ caller }))).toEqual({
      mayManageSite: false,
      mayChooseDefaultLayout: false,
    });
  });

  it("offers the tab, and the default Layout only with the rights to update and publish Layouts", async () => {
    const site = holding("manage-page-builder-site");
    expect(await readSiteCapability(route({ caller: site.caller }))).toEqual({
      mayManageSite: true,
      mayChooseDefaultLayout: false,
    });
    const updateOnly = holding(
      "manage-page-builder-site",
      "update-site_layouts"
    );
    expect(
      (await readSiteCapability(route({ caller: updateOnly.caller })))
        .mayChooseDefaultLayout
    ).toBe(false);
    const publishOnly = holding(
      "manage-page-builder-site",
      "publish-site_layouts"
    );
    expect(
      (await readSiteCapability(route({ caller: publishOnly.caller })))
        .mayChooseDefaultLayout
    ).toBe(false);
    const all = holding(
      "manage-page-builder-site",
      "update-site_layouts",
      "publish-site_layouts"
    );
    expect(await readSiteCapability(route({ caller: all.caller }))).toEqual({
      mayManageSite: true,
      mayChooseDefaultLayout: true,
    });
    // Asked about the RESOLVED Layouts collection, as make-default asks.
    expect(all.asked).toContain("publish-site_layouts");
  });

  it("offers nothing to nobody", async () => {
    expect(await readSiteCapability(route({ caller: null }))).toEqual({
      mayManageSite: false,
      mayChooseDefaultLayout: false,
    });
  });
});
