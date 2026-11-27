/**
 * Comparing a declaration with the plugin's own definition: one case per kind
 * of difference, each made by changing one side of a pair that agrees, so a
 * case fails only when the comparison stops seeing that one difference.
 */
import { describe, expect, it } from "vitest";

import { col, defineTable } from "../../domains/schema/extension/dsl";
import { definePlugin, type PluginDefinition } from "../plugin-context";

import { comparePluginPackageDeclaration } from "./compare";
import type { PluginPackageDeclaration } from "./format";

/** A definition that has one of everything the comparison reads. */
function definition(
  overrides: Partial<PluginDefinition> = {}
): PluginDefinition {
  return definePlugin({
    name: "@acme/seo",
    version: "1.0.0",
    nextly: "^0.0.2-alpha.81",
    dependsOn: { "@acme/forms": "^2.0.0" },
    optionalDependsOn: { "@acme/media-tools": ">=1.0.0" },
    capabilities: {
      net: { outbound: ["api.example.com"] },
      secrets: ["apiKey"],
    },
    contributes: {
      schema: {
        tables: [defineTable("seo_redirects", { id: col.id() })],
      },
      collections: [{ slug: "redirects", fields: [] }],
      singles: [{ slug: "seo-settings", fields: [] }],
      extend: [
        { target: "posts", fields: [] },
        {
          target: { every: ["single", "collection"], except: ["users"] },
          fields: [],
        },
      ],
    },
    onInstall: () => {},
    ...overrides,
  });
}

/** The declaration that agrees with {@link definition}. */
function declaration(
  overrides: Partial<PluginPackageDeclaration> = {}
): PluginPackageDeclaration {
  return {
    format: 1,
    core: "^0.0.2-alpha.81",
    databases: ["postgresql", "mysql", "sqlite"],
    plugins: {
      requires: { "@acme/forms": "^2.0.0" },
      worksWith: { "@acme/media-tools": ">=1.0.0" },
    },
    access: { outbound: ["api.example.com"], secrets: ["apiKey"] },
    tables: ["seo_redirects"],
    collections: ["redirects"],
    singles: ["seo-settings"],
    extends: ["posts", { every: ["collection", "single"], except: ["users"] }],
    steps: { install: true, uninstall: false },
    ...overrides,
  };
}

describe("comparing a declaration with the plugin's definition", () => {
  it("finds nothing when they agree", () => {
    // The positive control every case below changes one side of.
    expect(
      comparePluginPackageDeclaration(declaration(), definition())
    ).toEqual([]);
  });

  it.each<
    [
      string,
      Partial<PluginPackageDeclaration>,
      Partial<PluginDefinition>,
      string,
      RegExp,
    ]
  >([
    [
      "a different Nextly range",
      { core: "^1.0.0" },
      {},
      "core",
      /"\^1\.0\.0".*"\^0\.0\.2-alpha\.81"/,
    ],
    [
      "a required plugin only the definition names",
      { plugins: { worksWith: { "@acme/media-tools": ">=1.0.0" } } },
      {},
      "requires",
      /definition has the required plugin "@acme\/forms"/,
    ],
    [
      "a required plugin's range",
      {
        plugins: {
          requires: { "@acme/forms": "^3.0.0" },
          worksWith: { "@acme/media-tools": ">=1.0.0" },
        },
      },
      {},
      "requires",
      /"@acme\/forms" the range "\^3\.0\.0".*"\^2\.0\.0"/,
    ],
    [
      "a plugin it works with only the declaration names",
      {},
      { optionalDependsOn: {} },
      "works-with",
      /declaration lists the plugin it works with "@acme\/media-tools"/,
    ],
    [
      "an outbound host only the definition calls",
      { access: { secrets: ["apiKey"] } },
      {},
      "access",
      /outbound host "api\.example\.com", which the declaration does not list/,
    ],
    [
      "a secret only the declaration keeps",
      {
        access: { outbound: ["api.example.com"], secrets: ["apiKey", "token"] },
      },
      {},
      "access",
      /secret setting "token", which the plugin's definition does not have/,
    ],
    [
      "raw SQL the declaration leaves out",
      {},
      {
        capabilities: {
          net: { outbound: ["api.example.com"] },
          secrets: ["apiKey"],
          db: { rawSql: true },
        },
      },
      "access",
      /runs raw SQL/,
    ],
    [
      "deciding who is signed in, through a determineUser hook",
      {},
      {
        contributes: {
          ...definition().contributes,
          auth: { hooks: { determineUser: () => null } },
        },
      },
      "access",
      /decides who is signed in/,
    ],
    [
      "a login the declaration claims and the definition lacks",
      {
        access: {
          outbound: ["api.example.com"],
          secrets: ["apiKey"],
          login: true,
        },
      },
      {},
      "access",
      /declaration's access says the plugin decides who is signed in/,
    ],
    [
      "a table only the declaration lists",
      { tables: ["seo_redirects", "seo_logs"] },
      {},
      "tables",
      /table "seo_logs", which the plugin's definition does not have/,
    ],
    [
      "a collection only the definition adds",
      { collections: [] },
      {},
      "collections",
      /collection "redirects", which the declaration does not list/,
    ],
    [
      "a Single only the declaration lists",
      { singles: ["seo-settings", "robots"] },
      {},
      "singles",
      /Single "robots"/,
    ],
    [
      "an extended content type only the definition extends",
      { extends: [{ every: ["collection", "single"], except: ["users"] }] },
      {},
      "extends",
      /extended content type "posts", which the declaration does not list/,
    ],
    [
      "an install step the declaration leaves out",
      { steps: { install: false, uninstall: false } },
      {},
      "steps",
      /has an install step \(onInstall\)/,
    ],
    [
      "an uninstall step the definition lacks",
      { steps: { install: true, uninstall: true } },
      {},
      "steps",
      /steps\.uninstall says .* no onUninstall/,
    ],
    [
      "a command the definition does not register",
      { commands: ["seo.audit"] },
      {},
      "commands",
      /command "seo\.audit", which the plugin's definition does not have/,
    ],
    [
      "an agent tool the definition does not register",
      { agentTools: ["seo.suggest-title"] },
      {},
      "agent-tools",
      /agent tool "seo\.suggest-title"/,
    ],
  ])("names %s", (_, declared, defined, kind, message) => {
    const differences = comparePluginPackageDeclaration(
      declaration(declared),
      definition(defined)
    );
    expect(differences).toHaveLength(1);
    expect(differences[0]?.kind).toBe(kind);
    expect(differences[0]?.message).toMatch(message);
  });

  it("names a scope of extended types that excepts different types on each side", () => {
    // A scope is one target: a different exception is the definition's scope
    // missing from the declaration and the declaration's absent from the
    // definition, with the kinds in either order reading the same.
    expect(
      comparePluginPackageDeclaration(
        declaration({
          extends: [
            "posts",
            { every: ["collection", "single"], except: ["media"] },
          ],
        }),
        definition()
      )
    ).toEqual([
      {
        kind: "extends",
        message:
          'The plugin\'s definition has the extended content type "every collection and single except users", which the declaration does not list.',
      },
      {
        kind: "extends",
        message:
          'The declaration lists the extended content type "every collection and single except media", which the plugin\'s definition does not have.',
      },
    ]);
  });

  it("names a range for a plugin it works with that differs", () => {
    expect(
      comparePluginPackageDeclaration(
        declaration(),
        definition({ optionalDependsOn: { "@acme/media-tools": "^2.0.0" } })
      )
    ).toEqual([
      {
        kind: "works-with",
        message:
          'The declaration\'s plugins.worksWith gives "@acme/media-tools" the range ">=1.0.0", and the definition\'s optionalDependsOn gives it "^2.0.0".',
      },
    ]);
  });

  it("names a range a plugin written in JavaScript left out or gave as something else", () => {
    // Types do not hold a JavaScript plugin: the comparison names what it
    // finds instead of throwing on it.
    const untyped = {
      ...definition(),
      nextly: undefined,
      dependsOn: { "@acme/forms": 2 },
    } as unknown as PluginDefinition;
    expect(comparePluginPackageDeclaration(declaration(), untyped)).toEqual([
      {
        kind: "core",
        message:
          'The declaration says the plugin works with Nextly "^0.0.2-alpha.81", and its definition says no range.',
      },
      {
        kind: "requires",
        message:
          'The declaration\'s plugins.requires gives "@acme/forms" the range "^2.0.0", and the definition\'s dependsOn gives it no range.',
      },
    ]);
  });

  it("names a collection the definition adds the older way", () => {
    // `collections` beside `contributes` is still read at start, so it is a
    // collection the plugin adds.
    const differences = comparePluginPackageDeclaration(
      declaration(),
      definition({ collections: [{ slug: "legacy", fields: [] }] })
    );
    expect(differences).toEqual([
      {
        kind: "collections",
        message:
          'The plugin\'s definition has the collection "legacy", which the declaration does not list.',
      },
    ]);
  });

  it("names every difference at once", () => {
    const kinds = comparePluginPackageDeclaration(
      declaration({ core: "^9", tables: [], commands: ["x"] }),
      definition()
    ).map(difference => difference.kind);
    expect(kinds).toEqual(["core", "tables", "commands"]);
  });
});
