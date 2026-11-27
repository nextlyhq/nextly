/**
 * The declaration's format: what each field holds, and what is refused.
 *
 * Each field is tried on the smallest declaration that holds it, so a field
 * the schema stopped reading (or started refusing) fails its own case rather
 * than one shared fixture.
 */
import { describe, expect, it } from "vitest";

import { pluginPackageDeclarationJsonSchema } from "./format";
import { readPluginPackageDeclaration } from "./read";

/** The three fields every declaration has. */
const BASE = {
  format: 1,
  core: "^0.0.2-alpha.81",
  databases: ["postgresql", "mysql", "sqlite"],
};

const read = (fields: Record<string, unknown>) =>
  readPluginPackageDeclaration({
    name: "@acme/seo",
    nextly: { ...BASE, ...fields },
  });

describe("a declaration in format 1", () => {
  it("holds its format, the Nextly versions and the databases", () => {
    expect(read({})).toEqual({ kind: "declared", declaration: BASE });
  });

  // Each field, on its own, read back as written.
  it.each<[string, Record<string, unknown>]>([
    [
      "the registration",
      {
        plugin: {
          export: "seoPlugin",
          call: true,
          options: { siteUrl: { description: "The address", format: "url" } },
        },
      },
    ],
    ["companion packages", { companions: { "@acme/seo-ui": "^1.0.0" } }],
    [
      "plugins it requires, works with or conflicts with",
      {
        plugins: {
          requires: { "@acme/forms": "^2.0.0" },
          worksWith: { "@nextlyhq/plugin-seo": ">=0.0.1" },
          conflicts: ["@acme/old-seo"],
        },
      },
    ],
    [
      "env vars",
      {
        env: [
          {
            name: "SEO_API_KEY",
            description: "The key for the ranking service",
            required: true,
            secret: true,
          },
        ],
      },
    ],
    ["tables", { tables: ["seo_redirects"] }],
    ["collections", { collections: ["redirects"] }],
    ["Singles", { singles: ["seo-settings"] }],
    [
      "the content types it extends",
      { extends: ["posts", { every: ["collection"], except: ["users"] }] },
    ],
    [
      "project files, added and wrapped",
      {
        files: [
          { from: "templates/proxy.ts", to: "src/proxy.ts" },
          {
            edit: "wrap",
            to: "next.config.ts",
            wrapper: { import: "@acme/seo/next", export: "withSeo" },
          },
        ],
      },
    ],
    [
      "project files of the person's own that conflict",
      {
        conflictingFiles: [
          { path: "app/sitemap.ts", reason: "The plugin serves /sitemap.xml" },
        ],
      },
    ],
    ["commands", { commands: ["seo.audit"] }],
    ["agent tools", { agentTools: ["seo.suggest-title"] }],
    [
      "install and uninstall steps",
      { steps: { install: true, uninstall: false } },
    ],
    ["the live switch", { liveSwitch: true }],
    [
      "what it may access",
      {
        access: {
          content: {
            reads: [{ every: ["collection", "single"] }],
            writes: ["redirects"],
          },
          publicAddresses: ["/sitemap.xml", "/robots.txt"],
          outbound: ["api.example.com", "*.example.org"],
          secrets: ["apiKey"],
          rawSql: false,
          login: false,
        },
      },
    ],
    ["steps before removing it", { beforeRemove: ["Export your redirects."] }],
  ])("holds %s", (_, fields) => {
    expect(read(fields)).toEqual({
      kind: "declared",
      declaration: { ...BASE, ...fields },
    });
  });

  // Each malformed field is refused, naming where it is.
  it.each<[string, Record<string, unknown>, string]>([
    ["a format that is not a number", { format: "1" }, "nextly.format"],
    ["a format below 1", { format: 0 }, "nextly.format"],
    ["no Nextly versions", { core: undefined }, "nextly.core"],
    ["Nextly versions that are not a range", { core: "soon" }, "nextly.core"],
    ["no databases", { databases: [] }, "nextly.databases"],
    [
      "a database it does not know",
      { databases: ["oracle"] },
      "nextly.databases.0",
    ],
    [
      "a database twice",
      { databases: ["sqlite", "sqlite"] },
      "nextly.databases",
    ],
    [
      "a registration without its export",
      { plugin: { call: true } },
      "nextly.plugin.export",
    ],
    [
      "options without a call",
      { plugin: { export: "a", options: { x: { description: "X" } } } },
      "nextly.plugin",
    ],
    [
      "a companion that is not a package name",
      { companions: { "Not A Name": "^1" } },
      "nextly.companions",
    ],
    [
      "a companion without a range",
      { companions: { "@acme/x": "latest-ish" } },
      "nextly.companions.@acme/x",
    ],
    [
      "a required plugin without a range",
      { plugins: { requires: { "@acme/forms": "" } } },
      "nextly.plugins.requires.@acme/forms",
    ],
    [
      "a key under plugins it does not know",
      { plugins: { needs: {} } },
      "nextly.plugins",
    ],
    [
      "an env var with a lower-case name",
      {
        env: [
          { name: "api_key", description: "Key", required: true, secret: true },
        ],
      },
      "nextly.env.0.name",
    ],
    [
      "an env var that does not say whether it is secret",
      { env: [{ name: "API_KEY", description: "Key", required: true }] },
      "nextly.env.0.secret",
    ],
    [
      "an env var named twice",
      {
        env: [
          { name: "API_KEY", description: "Key", required: true, secret: true },
          {
            name: "API_KEY",
            description: "Key",
            required: false,
            secret: true,
          },
        ],
      },
      "nextly.env",
    ],
    [
      "a table name with a space",
      { tables: ["seo redirects"] },
      "nextly.tables.0",
    ],
    [
      "a collection listed twice",
      { collections: ["a", "a"] },
      "nextly.collections",
    ],
    ["a Single that is not a name", { singles: [""] }, "nextly.singles.0"],
    [
      "an extended scope of no kinds",
      { extends: [{ every: [] }] },
      "nextly.extends.0",
    ],
    [
      "a file climbing out of the project",
      { files: [{ from: "a.ts", to: "../x.ts" }] },
      "nextly.files.0",
    ],
    [
      "a file at an absolute path",
      { files: [{ from: "a.ts", to: "/etc/x.ts" }] },
      "nextly.files.0",
    ],
    [
      "a file at a drive path",
      { files: [{ from: "a.ts", to: "C:/x.ts" }] },
      "nextly.files.0",
    ],
    [
      "a wrap with no wrapper",
      { files: [{ edit: "wrap", to: "next.config.ts" }] },
      "nextly.files.0",
    ],
    [
      "a conflicting file with no reason",
      { conflictingFiles: [{ path: "app/sitemap.ts" }] },
      "nextly.conflictingFiles.0.reason",
    ],
    [
      "a command that is not a name",
      { commands: ["Seo Audit"] },
      "nextly.commands.0",
    ],
    [
      "an agent tool listed twice",
      { agentTools: ["a", "a"] },
      "nextly.agentTools",
    ],
    [
      "steps without uninstall",
      { steps: { install: true } },
      "nextly.steps.uninstall",
    ],
    [
      "a live switch that is not yes or no",
      { liveSwitch: "yes" },
      "nextly.liveSwitch",
    ],
    [
      "a public address without its slash",
      { access: { publicAddresses: ["sitemap.xml"] } },
      "nextly.access.publicAddresses.0",
    ],
    [
      "an access it does not know",
      { access: { filesystem: true } },
      "nextly.access",
    ],
    [
      "raw SQL that is not yes or no",
      { access: { rawSql: 1 } },
      "nextly.access.rawSql",
    ],
    [
      "an empty step before removing",
      { beforeRemove: [" "] },
      "nextly.beforeRemove.0",
    ],
    ["a field it does not know", { tier: "official" }, "nextly"],
  ])("refuses %s", (_, fields, path) => {
    const reading = read(fields);
    expect(reading.kind).toBe("invalid");
    const problems = reading.kind === "invalid" ? reading.problems : [];
    // At the field, or under it: a union or a record names the member or key
    // that failed below the field.
    expect(problems).toContainEqual(
      expect.stringMatching(
        new RegExp(`^${path.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}[.:]`)
      )
    );
  });

  it("is a declaration only once it names its format", () => {
    // Without `format`, only today's registration block is read, and the
    // rest is left alone as it always was.
    expect(
      readPluginPackageDeclaration({
        nextly: { plugin: { export: "seoPlugin" }, core: "soon" },
      })
    ).toEqual({
      kind: "registration",
      registration: { export: "seoPlugin" },
    });
  });
});

describe("the declaration's JSON Schema", () => {
  it("describes every field the format holds", () => {
    const schema = pluginPackageDeclarationJsonSchema() as {
      properties: Record<string, unknown>;
      required: string[];
      additionalProperties: boolean;
    };
    expect(Object.keys(schema.properties).sort()).toEqual(
      [
        "access",
        "agentTools",
        "beforeRemove",
        "collections",
        "commands",
        "companions",
        "conflictingFiles",
        "core",
        "databases",
        "env",
        "extends",
        "files",
        "format",
        "liveSwitch",
        "plugin",
        "plugins",
        "singles",
        "steps",
        "tables",
      ].sort()
    );
    expect(schema.required.sort()).toEqual(["core", "databases", "format"]);
    expect(schema.additionalProperties).toBe(false);
  });
});
