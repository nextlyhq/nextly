/**
 * The Overview's setup checklist is asked for in the admin's startup request
 * when a tab opens on the Overview: the prebuilt admin page names the
 * Overview by the address its menu item links to, with the path the
 * Overview's own read of the checklist asks for, so that read takes the
 * startup request's answer.
 */
import { adminStartupScreensJson, pluginRouteFullPath } from "nextly/config";
import { describe, expect, it } from "vitest";

import { CHECKLIST_ROUTE_PATH, OVERVIEW_PAGE_HREF } from "../overview/contract";
import { seoPlugin } from "../plugin";
import { SEO_PLUGIN_NAME } from "../settings/contract";

describe("the Overview's startup read", () => {
  it("is the checklist, named at the Overview's address as its own read asks for it", () => {
    const screens = JSON.parse(
      adminStartupScreensJson([seoPlugin({ collections: ["posts"] })]) ?? "{}"
    ) as Record<string, string[]>;

    expect(screens).toEqual({
      [OVERVIEW_PAGE_HREF]: [
        pluginRouteFullPath(SEO_PLUGIN_NAME, CHECKLIST_ROUTE_PATH),
      ],
    });
  });
});
