import { describe, expect, it } from "vitest";

import type { PluginDefinition } from "./plugin-context";

import { applyPluginAdminViews, type CollectionWithAdmin } from "./admin-views";

function asPlugins(defs: unknown[]): PluginDefinition[] {
  return defs as PluginDefinition[];
}

const base = { name: "@acme/p", version: "1.0.0", nextly: "*" } as const;

describe("applyPluginAdminViews", () => {
  it("maps each view key to the matching collection's admin.components slot", () => {
    const collections: CollectionWithAdmin[] = [{ slug: "forms" }];
    const [forms] = applyPluginAdminViews(
      collections,
      asPlugins([
        {
          ...base,
          contributes: {
            admin: {
              views: {
                forms: {
                  edit: "@acme/p/admin#Edit",
                  list: "@acme/p/admin#List",
                  beforeList: "@acme/p/admin#BL",
                  afterList: "@acme/p/admin#AL",
                  beforeEdit: "@acme/p/admin#BE",
                  afterEdit: "@acme/p/admin#AE",
                },
              },
            },
          },
        },
      ])
    );
    expect(forms.admin?.components?.views?.Edit?.Component).toBe(
      "@acme/p/admin#Edit"
    );
    expect(forms.admin?.components?.views?.List?.Component).toBe(
      "@acme/p/admin#List"
    );
    expect(forms.admin?.components?.BeforeListTable).toBe("@acme/p/admin#BL");
    expect(forms.admin?.components?.AfterListTable).toBe("@acme/p/admin#AL");
    expect(forms.admin?.components?.BeforeEdit).toBe("@acme/p/admin#BE");
    expect(forms.admin?.components?.AfterEdit).toBe("@acme/p/admin#AE");
  });

  it("resolves a renamed slug via the plugin renameMap", () => {
    const collections: CollectionWithAdmin[] = [{ slug: "leads" }];
    const [leads] = applyPluginAdminViews(
      collections,
      asPlugins([
        {
          ...base,
          renameMap: { submissions: "leads" },
          contributes: {
            admin: { views: { submissions: { edit: "@acme/p/admin#Edit" } } },
          },
        },
      ])
    );
    expect(leads.admin?.components?.views?.Edit?.Component).toBe(
      "@acme/p/admin#Edit"
    );
  });

  it("does not clobber a component already set on the collection (collection wins)", () => {
    const collections: CollectionWithAdmin[] = [
      {
        slug: "forms",
        admin: { components: { views: { Edit: { Component: "host#Edit" } } } },
      },
    ];
    const [forms] = applyPluginAdminViews(
      collections,
      asPlugins([
        {
          ...base,
          contributes: {
            admin: { views: { forms: { edit: "@acme/p/admin#Edit" } } },
          },
        },
      ])
    );
    expect(forms.admin?.components?.views?.Edit?.Component).toBe("host#Edit");
  });

  it("skips disabled plugins", () => {
    const collections: CollectionWithAdmin[] = [{ slug: "forms" }];
    const [forms] = applyPluginAdminViews(
      collections,
      asPlugins([
        {
          ...base,
          enabled: false,
          contributes: {
            admin: { views: { forms: { edit: "@acme/p/admin#Edit" } } },
          },
        },
      ])
    );
    expect(forms.admin?.components?.views?.Edit).toBeUndefined();
  });

  it("leaves collections without a matching plugin view unchanged", () => {
    const collections: CollectionWithAdmin[] = [{ slug: "posts" }];
    const [posts] = applyPluginAdminViews(
      collections,
      asPlugins([
        {
          ...base,
          contributes: {
            admin: { views: { forms: { edit: "@acme/p/admin#Edit" } } },
          },
        },
      ])
    );
    expect(posts.admin?.components).toBeUndefined();
  });
});
