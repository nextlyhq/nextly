import { describe, expect, it } from "vitest";

import { NextlyError } from "../errors/nextly-error";

import type { PluginDefinition } from "./plugin-context";
import {
  assertDocumentViews,
  contributedDocumentViews,
} from "./validate-document-views";

function asPlugins(defs: unknown[]): PluginDefinition[] {
  return defs as PluginDefinition[];
}

/** A plugin contributing the given document views on one slug. */
function plugin(
  name: string,
  slug: string,
  views: { path: string; component?: string; label?: string }[],
  extra: Record<string, unknown> = {}
): unknown {
  return {
    name,
    version: "1.0.0",
    nextly: "*",
    ...extra,
    contributes: {
      admin: {
        views: {
          [slug]: {
            documentViews: views.map(view => ({
              component: `${name}/admin#View`,
              ...view,
            })),
          },
        },
      },
    },
  };
}

/** The error a refused declaration throws, so its message can be read. */
function refusal(plugins: unknown[]): NextlyError {
  try {
    assertDocumentViews(asPlugins(plugins));
  } catch (error) {
    if (error instanceof NextlyError) return error;
    throw error;
  }
  throw new Error("assertDocumentViews accepted the declarations");
}

describe("assertDocumentViews", () => {
  it("refuses two plugins claiming one path on one document, naming both", () => {
    const error = refusal([
      plugin("@acme/builder", "pages", [{ path: "builder" }]),
      plugin("@other/builder", "pages", [{ path: "builder" }]),
    ]);

    expect(error.code).toBe("NEXTLY_PLUGIN_DOCUMENT_VIEW_INVALID");
    // Both claimants, the document and the path: an operator fixing this has
    // to know which two declarations to choose between.
    expect(error.logMessage).toContain("@acme/builder");
    expect(error.logMessage).toContain("@other/builder");
    expect(error.logMessage).toContain('"pages"');
    expect(error.logMessage).toContain('"builder"');
  });

  it("refuses one plugin declaring the same path twice on one document", () => {
    const error = refusal([
      plugin("@acme/builder", "pages", [
        { path: "builder" },
        { path: "builder" },
      ]),
    ]);
    expect(error.code).toBe("NEXTLY_PLUGIN_DOCUMENT_VIEW_INVALID");
  });

  it("judges a collision on the RESOLVED slug, after a rename", () => {
    // One declares on its own name for the collection, which the host renamed;
    // the other declares on the name the host uses. Both land on one route.
    const error = refusal([
      plugin("@acme/forms", "submissions", [{ path: "review" }], {
        renameMap: { submissions: "leads" },
      }),
      plugin("@other/review", "leads", [{ path: "review" }]),
    ]);
    expect(error.logMessage).toContain('"leads"');
  });

  it("reads a rename only from the map's own keys", () => {
    // `constructor` is a legal slug, and an inherited lookup answers it with a
    // function — which the admin then receives as no slug at all.
    const [view] = contributedDocumentViews(
      asPlugins([
        plugin("@acme/builder", "constructor", [{ path: "builder" }], {
          renameMap: {},
        }),
      ])
    );
    expect(view).toMatchObject({ slug: "constructor" });
  });

  it("checks a disabled plugin too, so enabling it cannot break boot later", () => {
    const error = refusal([
      plugin("@acme/builder", "pages", [{ path: "builder" }]),
      plugin("@other/builder", "pages", [{ path: "builder" }], {
        enabled: false,
      }),
    ]);
    expect(error.code).toBe("NEXTLY_PLUGIN_DOCUMENT_VIEW_INVALID");
  });

  it.each(["versions", "api"])(
    "refuses the path %s, which the document already uses",
    reserved => {
      const error = refusal([
        plugin("@acme/builder", "pages", [{ path: reserved }]),
      ]);
      expect(error.logMessage).toContain(`"${reserved}"`);
    }
  );

  it.each(["", "Builder", "/builder", "builder/", "a/b", "a b", "-builder"])(
    "refuses the malformed path %j",
    path => {
      const error = refusal([plugin("@acme/builder", "pages", [{ path }])]);
      expect(error.code).toBe("NEXTLY_PLUGIN_DOCUMENT_VIEW_INVALID");
    }
  );

  it("refuses a view with no component to draw", () => {
    const error = refusal([
      plugin("@acme/builder", "pages", [{ path: "builder", component: "" }]),
    ]);
    expect(error.code).toBe("NEXTLY_PLUGIN_DOCUMENT_VIEW_INVALID");
  });

  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;

  it.each([
    ["a BigInt", 10n],
    ["a number", 42],
    ["an object", { text: "Builder" }],
    ["a cyclic object", cyclic],
  ])(
    "refuses a label that is %s rather than text, naming it",
    (_case, label) => {
      // A label is published in the admin metadata, which is sent as JSON; one
      // that is not text fails that whole response rather than this one view.
      const error = refusal([
        plugin("@acme/builder", "pages", [
          { path: "builder", label: label as unknown as string },
        ]),
      ]);
      expect(error.code).toBe("NEXTLY_PLUGIN_DOCUMENT_VIEW_INVALID");
      expect(error.logMessage).toContain("label");
    }
  );

  it("accepts a view with no label", () => {
    // The control: an absent label is the common case, not a malformed one.
    expect(() =>
      assertDocumentViews(
        asPlugins([plugin("@acme/builder", "pages", [{ path: "builder" }])])
      )
    ).not.toThrow();
  });

  it("accepts one path on two different documents", () => {
    // The control for the collision cases: a check refusing every second
    // `builder` would pass them and stop a plugin serving two collections.
    expect(() =>
      assertDocumentViews(
        asPlugins([
          plugin("@acme/builder", "pages", [{ path: "builder" }]),
          plugin("@acme/builder-posts", "posts", [{ path: "builder" }]),
        ])
      )
    ).not.toThrow();
  });
});

/** A plugin contributing a field type and, optionally, views scoped to types. */
function fieldTypePlugin(
  name: string,
  ownTypes: string[],
  views: { path: string; fieldType: string; label?: string }[],
  slugViews: Record<string, { path: string }[]> = {}
): unknown {
  return {
    name,
    version: "1.0.0",
    nextly: "*",
    contributes: {
      fieldTypes: ownTypes.map(type => ({
        type,
        storage: "json",
        component: `${name}/admin#Field`,
      })),
      admin: {
        documentViews: views.map(view => ({
          component: `${name}/admin#View`,
          ...view,
        })),
        views: Object.fromEntries(
          Object.entries(slugViews).map(([slug, list]) => [
            slug,
            {
              documentViews: list.map(view => ({
                component: `${name}/admin#View`,
                ...view,
              })),
            },
          ])
        ),
      },
    },
  };
}

describe("document views scoped to a field type", () => {
  it("accepts a view on a field type the plugin contributes itself", () => {
    expect(() =>
      assertDocumentViews(
        asPlugins([
          fieldTypePlugin(
            "@acme/builder",
            ["blocks"],
            [{ path: "builder", fieldType: "blocks" }]
          ),
        ])
      )
    ).not.toThrow();
  });

  it("refuses a view on a field type the plugin does not contribute", () => {
    // Least privilege: scoped to "text", a plugin would add a screen to every
    // document that has a title.
    const error = refusal([
      fieldTypePlugin(
        "@acme/builder",
        ["blocks"],
        [{ path: "builder", fieldType: "text" }]
      ),
    ]);
    expect(error.code).toBe("NEXTLY_PLUGIN_DOCUMENT_VIEW_INVALID");
    expect(error.logMessage).toContain("@acme/builder");
    expect(error.logMessage).toContain('"text"');
  });

  it("refuses its path when any other view anywhere already uses it, naming both", () => {
    // Which documents carry the field is not known at boot, so a field-type
    // view's path has to be unique among every view, on any document.
    const error = refusal([
      plugin("@other/review", "posts", [{ path: "builder" }]),
      fieldTypePlugin(
        "@acme/builder",
        ["blocks"],
        [{ path: "builder", fieldType: "blocks" }]
      ),
    ]);
    expect(error.logMessage).toContain("@acme/builder");
    expect(error.logMessage).toContain("@other/review");
  });

  it("refuses two field-type views on one path", () => {
    const error = refusal([
      fieldTypePlugin(
        "@acme/builder",
        ["blocks"],
        [{ path: "builder", fieldType: "blocks" }]
      ),
      fieldTypePlugin(
        "@other/canvas",
        ["canvas"],
        [{ path: "builder", fieldType: "canvas" }]
      ),
    ]);
    expect(error.logMessage).toContain("@other/canvas");
  });

  it("refuses a slug view declared after a field-type view on its path", () => {
    const error = refusal([
      fieldTypePlugin(
        "@acme/builder",
        ["blocks"],
        [{ path: "builder", fieldType: "blocks" }]
      ),
      plugin("@other/review", "posts", [{ path: "builder" }]),
    ]);
    expect(error.code).toBe("NEXTLY_PLUGIN_DOCUMENT_VIEW_INVALID");
  });

  it("applies the path rules to a field-type view as well", () => {
    const error = refusal([
      fieldTypePlugin(
        "@acme/builder",
        ["blocks"],
        [{ path: "versions", fieldType: "blocks" }]
      ),
    ]);
    expect(error.logMessage).toContain('"versions"');
  });

  it("publishes a field-type view by its field type rather than a slug", () => {
    expect(
      contributedDocumentViews(
        asPlugins([
          fieldTypePlugin(
            "@acme/builder",
            ["blocks"],
            [{ path: "builder", fieldType: "blocks", label: "Page Builder" }]
          ),
        ])
      )
    ).toEqual([
      {
        fieldType: "blocks",
        path: "builder",
        component: "@acme/builder/admin#View",
        label: "Page Builder",
        plugin: "@acme/builder",
      },
    ]);
  });
});

describe("contributedDocumentViews", () => {
  it("lists enabled plugins' views by resolved slug, with their owner", () => {
    const views = contributedDocumentViews(
      asPlugins([
        plugin(
          "@acme/forms",
          "submissions",
          [{ path: "review", label: "Review" }],
          { renameMap: { submissions: "leads" } }
        ),
        plugin("@other/builder", "pages", [{ path: "builder" }], {
          enabled: false,
        }),
      ])
    );

    // A disabled plugin contributes nothing to the admin, as for its pages.
    expect(views).toEqual([
      {
        slug: "leads",
        path: "review",
        component: "@acme/forms/admin#View",
        label: "Review",
        plugin: "@acme/forms",
      },
    ]);
  });
});
