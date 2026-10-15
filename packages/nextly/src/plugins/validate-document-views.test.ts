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
