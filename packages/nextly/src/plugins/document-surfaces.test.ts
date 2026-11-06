/**
 * The boot check over the document actions plugins override and the panel
 * sections they add, and what the admin is given of them.
 *
 * @module plugins/document-surfaces.test
 */
import { describe, expect, it } from "vitest";

import { NextlyError } from "../errors/nextly-error";

import {
  assertDocumentSurfaces,
  publishedDocumentSurfaces,
} from "./document-surfaces";
import type { PluginDefinition } from "./plugin-context";

/** A plugin whose `views` are as given, read as plain JavaScript hands it over. */
function plugin(
  name: string,
  views: Record<string, unknown>,
  extra: Record<string, unknown> = {}
): PluginDefinition {
  return {
    name,
    version: "1.0.0",
    nextly: "*",
    ...extra,
    contributes: { admin: { views } },
  } as unknown as PluginDefinition;
}

/** The error a refused declaration throws, so its message can be read. */
function refusal(plugins: PluginDefinition[]): NextlyError {
  try {
    assertDocumentSurfaces(plugins);
  } catch (error) {
    if (error instanceof NextlyError) return error;
    throw error;
  }
  throw new Error("assertDocumentSurfaces accepted the declarations");
}

describe("assertDocumentSurfaces", () => {
  it("accepts a hidden action, a replaced one and a panel section", () => {
    expect(() =>
      assertDocumentSurfaces([
        plugin("layouts", {
          layouts: {
            documentActions: {
              unpublish: "hidden",
              delete: { component: "layouts#Remove", label: "Remove layout…" },
            },
            panelSections: [{ title: "Used by", component: "layouts#Usage" }],
          },
        }),
      ])
    ).not.toThrow();
  });

  it("refuses an action no plugin may override, naming it", () => {
    const error = refusal([
      plugin("layouts", {
        layouts: { documentActions: { publish: "hidden" } },
      }),
    ]);
    expect(error.code).toBe("NEXTLY_PLUGIN_DOCUMENT_SURFACE_INVALID");
    expect(error.logMessage).toContain('"publish" action on "layouts"');
  });

  it.each([
    ["no component", { label: "Remove" }],
    ["an empty component", { component: "" }],
    ["a label that is not text", { component: "x#Y", label: 3 }],
    ["neither hidden nor a component", "gone"],
  ])("refuses a replacement with %s", (_name, override) => {
    const error = refusal([
      plugin("layouts", { layouts: { documentActions: { delete: override } } }),
    ]);
    expect(error.code).toBe("NEXTLY_PLUGIN_DOCUMENT_SURFACE_INVALID");
    expect(error.logContext).toMatchObject({
      collection: "layouts",
      action: "delete",
    });
  });

  it.each([
    ["no title", { component: "x#Y" }],
    ["a blank title", { title: "  ", component: "x#Y" }],
    ["no component", { title: "Used by" }],
  ])("refuses a panel section with %s", (_name, section) => {
    const error = refusal([
      plugin("layouts", { layouts: { panelSections: [section] } }),
    ]);
    expect(error.code).toBe("NEXTLY_PLUGIN_DOCUMENT_SURFACE_INVALID");
  });

  // Read as plain JavaScript hands it over: a plugin or a setup transformer
  // is not held to the type, and a declaration of the wrong shape must be
  // refused by name rather than crash the boot with a TypeError.
  it.each([
    ["panelSections that is not a list", { panelSections: "Used by" }],
    ["a panel section that is not an object", { panelSections: [null] }],
    [
      "a panel section among good ones that is not an object",
      { panelSections: [{ title: "Used by", component: "x#Y" }, 3] },
    ],
    ["documentActions that is not an object", { documentActions: "hidden" }],
    ["documentActions that is a list", { documentActions: ["delete"] }],
  ])("refuses %s, naming the plugin", (_name, view) => {
    const error = refusal([plugin("layouts", { layouts: view })]);
    expect(error.code).toBe("NEXTLY_PLUGIN_DOCUMENT_SURFACE_INVALID");
    expect(error.logContext).toMatchObject({
      plugin: "layouts",
      collection: "layouts",
    });
  });

  it("refuses two plugins overriding one action on one collection, naming both", () => {
    const error = refusal([
      plugin("layouts", { pages: { documentActions: { delete: "hidden" } } }),
      plugin("archive", {
        pages: { documentActions: { delete: { component: "archive#X" } } },
      }),
    ]);
    expect(error.code).toBe("NEXTLY_PLUGIN_DOCUMENT_SURFACE_INVALID");
    expect(error.logContext).toMatchObject({
      plugin: "archive",
      other: "layouts",
      collection: "pages",
      action: "delete",
    });
  });

  it("lets two plugins override different actions, or one on different collections", () => {
    expect(() =>
      assertDocumentSurfaces([
        plugin("layouts", { pages: { documentActions: { delete: "hidden" } } }),
        plugin("archive", {
          pages: { documentActions: { unpublish: "hidden" } },
          posts: { documentActions: { delete: "hidden" } },
        }),
      ])
    ).not.toThrow();
  });

  it("judges the slug a rename gives, so a collision through one is refused", () => {
    const error = refusal([
      plugin("layouts", { pages: { documentActions: { delete: "hidden" } } }),
      plugin(
        "archive",
        { docs: { documentActions: { delete: "hidden" } } },
        { renameMap: { docs: "pages" } }
      ),
    ]);
    expect(error.logContext).toMatchObject({ collection: "pages" });
  });

  it("judges a disabled plugin's declarations too", () => {
    const error = refusal([
      plugin(
        "layouts",
        { layouts: { documentActions: { publish: "hidden" } } },
        { enabled: false }
      ),
    ]);
    expect(error.code).toBe("NEXTLY_PLUGIN_DOCUMENT_SURFACE_INVALID");
  });
});

describe("publishedDocumentSurfaces", () => {
  it("gives the admin each override and section on the slug the host registered", () => {
    const published = publishedDocumentSurfaces(
      plugin(
        "layouts",
        {
          layouts: {
            documentActions: {
              unpublish: "hidden",
              delete: { component: "layouts#Remove" },
            },
            panelSections: [{ title: "Used by", component: "layouts#Usage" }],
          },
        },
        { renameMap: { layouts: "site-layouts" } }
      )
    );
    expect(published.documentActions).toEqual([
      { slug: "site-layouts", action: "unpublish", override: "hidden" },
      {
        slug: "site-layouts",
        action: "delete",
        override: { component: "layouts#Remove" },
      },
    ]);
    expect(published.panelSections).toEqual([
      { slug: "site-layouts", title: "Used by", component: "layouts#Usage" },
    ]);
  });

  it("publishes only the component and label a replacement declares", () => {
    // Anything else on the declaration stays behind: here a value that cannot
    // be written as JSON, and a `toJSON` that would rewrite the override.
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const published = publishedDocumentSurfaces(
      plugin("layouts", {
        layouts: {
          documentActions: {
            delete: {
              component: "layouts#Remove",
              label: "Remove layout…",
              extra: circular,
              toJSON: () => ({ component: "elsewhere#Other" }),
            },
            unpublish: "hidden",
          },
        },
      })
    );
    expect(published.documentActions).toEqual([
      {
        slug: "layouts",
        action: "delete",
        override: { component: "layouts#Remove", label: "Remove layout…" },
      },
      { slug: "layouts", action: "unpublish", override: "hidden" },
    ]);
    expect(JSON.parse(JSON.stringify(published.documentActions))).toEqual(
      published.documentActions
    );
  });

  it("gives nothing for a disabled plugin", () => {
    expect(
      publishedDocumentSurfaces(
        plugin(
          "layouts",
          {
            layouts: {
              documentActions: { delete: "hidden" },
              panelSections: [{ title: "Used by", component: "l#U" }],
            },
          },
          { enabled: false }
        )
      )
    ).toEqual({ documentActions: [], panelSections: [] });
  });
});
