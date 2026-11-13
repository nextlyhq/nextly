import { createRequire } from "node:module";

import { describe, expect, it } from "vitest";

import rule from "../rules/no-experimental-sdk.js";
import { createRuleTester } from "./rule-tester.js";

const manifest = createRequire(import.meta.url)("../sdk-stability.json");

const ROOT = "@nextlyhq/plugin-sdk";
const SCHEMA = "@nextlyhq/plugin-sdk/schema";

// Experimental names are taken from the generated manifest rather than spelled
// here, so a surface graduating changes the manifest and not these cases. The
// stable anchors (`definePlugin`, `ctx.events`) are the SDK's founding
// surfaces, listed in its stable table.
const rootExperimental = manifest.imports[ROOT][0];
const schemaExperimental = manifest.imports[SCHEMA][0];
const contextTop = manifest.context.find(path => !path.includes("."));
const contextNested = manifest.context.find(path => path.includes("."));
const [nestedParent, nestedChild] = contextNested.split(".");

describe("the generated manifest these cases draw on", () => {
  it("names experimental surfaces of both kinds", () => {
    expect(rootExperimental).toBeTruthy();
    expect(schemaExperimental).toBeTruthy();
    expect(contextTop).toBeTruthy();
    expect(contextNested).toBeTruthy();
  });

  it("leaves the founding stable surfaces out", () => {
    expect(manifest.imports[ROOT]).not.toContain("definePlugin");
    expect(manifest.imports[ROOT]).not.toContain("PluginContext");
    expect(manifest.context).not.toContain("events");
    expect(manifest.context).not.toContain("services");
  });
});

const ruleTester = createRuleTester({
  languageOptions: { parserOptions: { lang: "ts" } },
});
const CONTEXT = [{ context: true }];
const definePluginImport = `import { definePlugin } from "${ROOT}";`;

ruleTester.run("no-experimental-sdk", rule, {
  valid: [
    // Stable surfaces of the SDK.
    `import { definePlugin } from "${ROOT}";`,
    `import type { PluginContext } from "${ROOT}";`,
    // The same name from another package is not the SDK's.
    `import { ${rootExperimental} } from "some-other-package";`,
    // Adopted on purpose.
    {
      code: `import { ${rootExperimental} } from "${ROOT}";`,
      options: [{ allow: [rootExperimental] }],
    },
    // Context members are followed only when asked for.
    `${definePluginImport} definePlugin({ init(ctx) { ctx.${contextTop}; } });`,
    // A stable member of the context.
    {
      code: `${definePluginImport} definePlugin({ init(ctx) { ctx.events.on("x", () => {}); } });`,
      options: CONTEXT,
    },
    // A nested stable member whose parent is stable too.
    {
      code: `${definePluginImport} definePlugin({ init(ctx) { ctx.services.collections; } });`,
      options: CONTEXT,
    },
    // The same property name on something that is not the context.
    {
      code: `const store = { ${contextTop}: 1 }; store.${contextTop};`,
      options: CONTEXT,
    },
    // An `init` that `definePlugin` is not given.
    {
      code: `const other = { init(ctx) { ctx.${contextTop}; } };`,
      options: CONTEXT,
    },
    // A parameter shadowing the namespace import is not the SDK.
    `import * as sdk from "${ROOT}"; export function read(sdk) { return sdk.${rootExperimental}; }`,
    // A parameter shadowing definePlugin: its argument's lifecycle is not a plugin's.
    {
      code: `${definePluginImport} export function wrap(definePlugin) { return definePlugin({ init(ctx) { ctx.${contextTop}; } }); }`,
      options: CONTEXT,
    },
    // A local type shadowing PluginContext describes something else.
    {
      code: `import type { PluginContext } from "${ROOT}"; export function f() { type PluginContext = { ${contextTop}: number }; const c: PluginContext = { ${contextTop}: 1 }; return c.${contextTop}; }`,
      options: CONTEXT,
    },
    // A context member adopted on purpose.
    {
      code: `${definePluginImport} definePlugin({ init(ctx) { ctx.${contextTop}; } });`,
      options: [{ context: true, allow: [contextTop] }],
    },
  ],
  invalid: [
    {
      code: `import { ${rootExperimental} } from "${ROOT}";`,
      errors: [
        {
          messageId: "experimentalImport",
          data: { name: rootExperimental, source: ROOT },
        },
      ],
    },
    {
      // Renamed locally: still the SDK's experimental export.
      code: `import { ${rootExperimental} as renamed } from "${ROOT}";`,
      errors: [{ messageId: "experimentalImport" }],
    },
    {
      // A subpath entry point, imported for its type alone.
      code: `import type { ${schemaExperimental} } from "${SCHEMA}";`,
      errors: [
        {
          messageId: "experimentalImport",
          data: { name: schemaExperimental, source: SCHEMA },
        },
      ],
    },
    {
      // Through a namespace import.
      code: `import * as sdk from "${ROOT}"; sdk.${rootExperimental};`,
      errors: [{ messageId: "experimentalImport" }],
    },
    {
      // Re-exported to the plugin's own users.
      code: `export { ${rootExperimental} } from "${ROOT}";`,
      errors: [{ messageId: "experimentalImport" }],
    },
    {
      // A lifecycle's context parameter.
      code: `${definePluginImport} definePlugin({ init(ctx) { ctx.${contextTop}; } });`,
      options: CONTEXT,
      errors: [
        { messageId: "experimentalContext", data: { path: contextTop } },
      ],
    },
    {
      // A nested member, under a lifecycle written as an arrow function.
      code: `${definePluginImport} definePlugin({ onReady: async ctx => { await ctx.${contextNested}; } });`,
      options: CONTEXT,
      errors: [
        { messageId: "experimentalContext", data: { path: contextNested } },
      ],
    },
    {
      // Destructured in the parameter list, at both depths.
      code: `${definePluginImport} definePlugin({ destroy({ ${contextTop}, ${nestedParent}: { ${nestedChild} } }) {} });`,
      options: CONTEXT,
      errors: [
        { messageId: "experimentalContext", data: { path: contextTop } },
        { messageId: "experimentalContext", data: { path: contextNested } },
      ],
    },
    {
      // A renamed definePlugin.
      code: `import { definePlugin as plugin } from "${ROOT}"; plugin({ init(c) { c.${contextTop}; } });`,
      options: CONTEXT,
      errors: [{ messageId: "experimentalContext" }],
    },
    {
      // A helper whose parameter is annotated as the context.
      code: `import type { PluginContext } from "${ROOT}"; function helper(c: PluginContext) { return c.${contextTop}; }`,
      options: CONTEXT,
      errors: [{ messageId: "experimentalContext" }],
    },
    {
      // A module variable annotated as the context, under a local alias.
      code: `import type { PluginContext as Ctx } from "${ROOT}"; let saved: Ctx; export const read = () => saved.${contextTop};`,
      options: CONTEXT,
      errors: [{ messageId: "experimentalContext" }],
    },
  ],
});
