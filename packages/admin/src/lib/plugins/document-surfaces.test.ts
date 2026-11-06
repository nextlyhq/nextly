/**
 * Which overrides and panel sections reach one collection's document screen.
 */
import { describe, expect, it } from "vitest";

import type { PluginMetadata } from "@admin/types/branding";

import { documentSurfacesFor } from "./document-surfaces";

const plugins = [
  {
    name: "@acme/layouts",
    documentActions: [
      { slug: "layouts", action: "delete", override: { component: "a#X" } },
      { slug: "pages", action: "unpublish", override: "hidden" },
    ],
    panelSections: [
      { slug: "layouts", title: "Used by", component: "a#Usage" },
      { slug: "pages", title: "Layout", component: "a#Layout" },
    ],
  },
  {
    name: "@acme/other",
    // Boot refuses this; were it to arrive, the first plugin's stands.
    documentActions: [
      { slug: "layouts", action: "delete", override: "hidden" },
    ],
    panelSections: [{ slug: "layouts", title: "Notes", component: "o#Notes" }],
  },
] as unknown as PluginMetadata[];

describe("documentSurfacesFor", () => {
  it("answers only the collection asked about", () => {
    expect(documentSurfacesFor(plugins, "pages")).toEqual({
      actions: { unpublish: "hidden" },
      sections: [
        { plugin: "@acme/layouts", title: "Layout", component: "a#Layout" },
      ],
    });
  });

  it("keeps the first override of an action, and every section in order", () => {
    expect(documentSurfacesFor(plugins, "layouts")).toEqual({
      actions: { delete: { component: "a#X" } },
      sections: [
        { plugin: "@acme/layouts", title: "Used by", component: "a#Usage" },
        { plugin: "@acme/other", title: "Notes", component: "o#Notes" },
      ],
    });
  });

  it("answers nothing before admin-meta has loaded", () => {
    expect(documentSurfacesFor(undefined, "layouts")).toEqual({
      actions: {},
      sections: [],
    });
  });
});
