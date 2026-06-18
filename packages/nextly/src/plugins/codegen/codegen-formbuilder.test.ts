import { describe, expect, it } from "vitest";

import type { NextlyServiceConfig } from "../../di/register";
import { TypeGenerator } from "../../domains/schema/services/type-generator";
import { definePlugin, type PluginDefinition } from "../plugin-context";
import { applyPluginSchemaContributions } from "../schema/apply-contributions";
import { collectCodegenNames } from "./collect-codegen-names";

/**
 * Codegen dogfood (D47/R4) — drives the form-builder plugin's REAL `contributes`
 * shape (forms/form-submissions collections + the `export`/`submissions` custom
 * permission) through the full fold → collect → generate pipeline, and asserts
 * the generated `Config` carries form-builder's typed permission + events.
 * (nextly can't import the @nextlyhq/plugin-form-builder package — wrong dep
 * direction — so we reproduce its exact contributes here; the real package's
 * typecheck against the narrowed PermissionSlug/EventName is covered by the
 * full build in the phase verification.)
 */
function formBuilder(): PluginDefinition {
  return definePlugin({
    name: "@nextlyhq/plugin-form-builder",
    version: "2.0.0",
    nextly: "*",
    contributes: {
      collections: [
        { slug: "forms", fields: [] },
        { slug: "form-submissions", fields: [] },
      ],
      permissions: [
        {
          action: "export",
          resource: "submissions",
          label: "Export Submissions",
        },
      ],
    },
  } as unknown as PluginDefinition);
}

function generate(plugin: PluginDefinition): string {
  const merged = applyPluginSchemaContributions(
    { collections: [] } as unknown as NextlyServiceConfig,
    [plugin]
  );
  const { permissionSlugs, eventNames } = collectCodegenNames(merged, [plugin]);
  return new TypeGenerator().generateTypesFile(
    [],
    [],
    [],
    [],
    permissionSlugs,
    eventNames
  ).code;
}

describe("codegen dogfood: form-builder (D47/R4)", () => {
  it("types form-builder's custom permission + per-collection events", () => {
    const code = generate(formBuilder());

    // Custom permission from contributes.permissions.
    expect(code).toContain('"export-submissions": true;');
    // Auto-seeded CRUD for the plugin's collections.
    expect(code).toContain('"create-form-submissions": true;');
    expect(code).toContain('"read-forms": true;');
    // Per-collection domain events.
    expect(code).toContain('"collection.form-submissions.created": true;');
    expect(code).toContain('"collection.forms.created": true;');
  });

  it("follows a framework .rename() of the submissions collection (D54)", () => {
    const renamed = formBuilder().rename!({ "form-submissions": "leads" });
    const code = generate(renamed);

    // The renamed slug flows into events + CRUD perms.
    expect(code).toContain('"collection.leads.created": true;');
    expect(code).toContain('"create-leads": true;');
    // The custom permission (resource "submissions") is unaffected by the rename.
    expect(code).toContain('"export-submissions": true;');
    // The old slug is gone.
    expect(code).not.toContain('"collection.form-submissions.created": true;');
  });
});
