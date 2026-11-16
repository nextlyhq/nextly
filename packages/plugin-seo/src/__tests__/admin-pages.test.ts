/**
 * A component for every page the plugin declares, under the export its path
 * names: a site's generated component map registers each page by importing
 * that export from `@nextlyhq/plugin-seo/admin`, so one missing draws nothing.
 */
import { describe, expect, it } from "vitest";

import * as admin from "../admin/index";
import { seoPlugin } from "../plugin";

describe("the admin module", () => {
  it("exports a component under the name each declared page's path ends in", () => {
    const pages =
      seoPlugin({ collections: ["posts"] }).contributes?.admin?.pages ?? [];
    expect(pages.length).toBeGreaterThan(0);
    const exported = admin as Record<string, unknown>;
    for (const page of pages) {
      const [module, name = ""] = page.component.split("#");
      expect(module).toBe("@nextlyhq/plugin-seo/admin");
      expect(typeof exported[name], name).toBe("function");
    }
  });
});
