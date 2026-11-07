/**
 * Which overrides and panel sections reach one collection's document screen.
 */
import { describe, expect, it } from "vitest";

import type { AdminContributionsMeta } from "nextly/config";

import type { PluginMetadata } from "@admin/types/branding";

import { documentSurfacesFor, panelOrderFor } from "./document-surfaces";

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

describe("panelOrderFor", () => {
  const contributions = {
    "collection.edit": {
      sidebarSection: [
        {
          id: "acme.design",
          kind: "sidebarSection",
          plugin: "@acme/designs",
          label: "Design",
          component: "a#Design",
        },
        { builtIn: "status" },
        {
          id: "acme.seo",
          kind: "sidebarSection",
          plugin: "@acme/seo",
          label: "SEO",
          component: "s#Seo",
          collections: ["pages"],
        },
        {
          id: "acme.featured",
          kind: "sidebarSection",
          plugin: "@acme/designs",
          label: "Featured",
          component: "a#Featured",
          visibleWhen: { field: "featured", equals: true },
        },
        { builtIn: "details" },
      ],
    },
  } as unknown as AdminContributionsMeta;

  it("keeps the server's order, built-ins and sections together", () => {
    expect(panelOrderFor(contributions, "pages", { featured: true })).toEqual([
      {
        kind: "section",
        id: "acme.design",
        plugin: "@acme/designs",
        title: "Design",
        component: "a#Design",
      },
      { kind: "builtIn", name: "status" },
      {
        kind: "section",
        id: "acme.seo",
        plugin: "@acme/seo",
        title: "SEO",
        component: "s#Seo",
      },
      {
        kind: "section",
        id: "acme.featured",
        plugin: "@acme/designs",
        title: "Featured",
        component: "a#Featured",
      },
      { kind: "builtIn", name: "details" },
    ]);
  });

  it("leaves out a section narrowed to other collections, or whose rule fails on the entry", () => {
    const ids = panelOrderFor(contributions, "posts", { featured: false })?.map(
      part => (part.kind === "section" ? part.id : part.name)
    );
    expect(ids).toEqual(["acme.design", "status", "details"]);
  });

  it("answers nothing when the place has no list, so the panel keeps its own order", () => {
    expect(panelOrderFor({}, "posts", {})).toBeUndefined();
    expect(panelOrderFor(undefined, "posts", {})).toBeUndefined();
  });
});
