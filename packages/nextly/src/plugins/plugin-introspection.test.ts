import { describe, expect, it } from "vitest";

import type { NextlyServiceConfig } from "../di/register";

import type { PluginDefinition } from "./plugin-context";
import { collectPluginInfo, findPluginInfo } from "./plugin-introspection";

function cfg(partial: Record<string, unknown> = {}): NextlyServiceConfig {
  return partial as unknown as NextlyServiceConfig;
}

// A bare dependency so form-builder's `dependsOn` resolves (D5 — missing deps fail).
function basePlugin(): PluginDefinition {
  return {
    name: "@acme/base",
    version: "1.0.0",
    nextly: "*",
  } as unknown as PluginDefinition;
}

function fbPlugin(overrides: Record<string, unknown> = {}): PluginDefinition {
  return {
    name: "@nextlyhq/plugin-form-builder",
    version: "2.0.0",
    nextly: "*",
    dependsOn: { "@acme/base": "^1.0.0" },
    contributes: {
      collections: [{ slug: "forms" }, { slug: "form-submissions" }],
      singles: [{ slug: "form-settings" }],
      components: [{ slug: "field-group" }],
      permissions: [
        {
          action: "export",
          resource: "submissions",
          label: "Export Submissions",
        },
      ],
      events: [{ name: "form-builder.submitted" }],
      routes: [
        {
          method: "GET",
          path: "/export",
          handler: () => new Response(null, { status: 204 }),
        },
      ],
      admin: {
        menu: [{ label: "Forms", to: "/forms" }],
        pages: [
          {
            path: "submissions",
            component: "@nextlyhq/plugin-form-builder/admin#Submissions",
          },
        ],
        settings: { component: "@nextlyhq/plugin-form-builder/admin#Settings" },
      },
    },
    ...overrides,
  } as unknown as PluginDefinition;
}

describe("collectPluginInfo (D48)", () => {
  it("summarizes a plugin's contributions without running it", () => {
    const infos = collectPluginInfo(cfg(), [basePlugin(), fbPlugin()], {
      coreVersion: "1.0.0",
    });
    expect(infos).toHaveLength(2);

    const fb = findPluginInfo(infos, "@nextlyhq/plugin-form-builder")!;
    expect(fb.name).toBe("@nextlyhq/plugin-form-builder");
    expect(fb.version).toBe("2.0.0");
    expect(fb.enabled).toBe(true);
    expect(fb.dependsOn).toEqual(["@acme/base"]);
    expect(fb.collections).toEqual(["forms", "form-submissions"]);
    expect(fb.singles).toEqual(["form-settings"]);
    expect(fb.components).toEqual(["field-group"]);
    expect(fb.permissions).toEqual(["export-submissions"]);
    expect(fb.events).toEqual(["form-builder.submitted"]);
    expect(fb.routeCount).toBe(1);
    expect(fb.adminMenuCount).toBe(1);
    expect(fb.adminPageCount).toBe(1);
    expect(fb.hasSettings).toBe(true);
  });

  it("reports a disabled plugin: schema listed, behavior counts zeroed (D49)", () => {
    const infos = collectPluginInfo(
      cfg(),
      [basePlugin(), fbPlugin({ enabled: false })],
      { coreVersion: "1.0.0" }
    );
    const fb = findPluginInfo(infos, "@nextlyhq/plugin-form-builder")!;
    expect(fb.enabled).toBe(false);
    // Schema contributions still apply when disabled.
    expect(fb.collections).toEqual(["forms", "form-submissions"]);
    // Behavior (routes + admin UI) is skipped.
    expect(fb.routeCount).toBe(0);
    expect(fb.adminMenuCount).toBe(0);
    expect(fb.adminPageCount).toBe(0);
    expect(fb.hasSettings).toBe(false);
  });

  it("findPluginInfo matches by exact name", () => {
    const infos = collectPluginInfo(cfg(), [basePlugin(), fbPlugin()], {
      coreVersion: "1.0.0",
    });
    expect(
      findPluginInfo(infos, "@nextlyhq/plugin-form-builder")?.version
    ).toBe("2.0.0");
    expect(findPluginInfo(infos, "nope")).toBeUndefined();
  });
});
