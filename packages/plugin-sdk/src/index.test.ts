import { describe, it, expect } from "vitest";
import { definePlugin } from "./index";
import type { PluginDefinition } from "./index";

describe("@nextlyhq/plugin-sdk", () => {
  it("re-exports definePlugin and the contract types", () => {
    const def: PluginDefinition = definePlugin({
      name: "@acme/x",
      version: "1.0.0",
      nextly: "*",
      contributes: { permissions: [{ action: "manage", resource: "x" }] },
    });
    expect(def.name).toBe("@acme/x");
    expect(def.contributes?.permissions?.[0]?.resource).toBe("x");
  });

  it("re-exports NextlyError so a plugin can reject input with a type", async () => {
    // The reason this export exists: a hook throwing a plain Error is
    // indistinguishable from one that crashed, so its message is replaced
    // before the caller sees it. Asserted through the SDK's own entry point,
    // because importing it from core would pass while the stable surface
    // stayed empty.
    const { NextlyError } = await import("./index");
    const error = NextlyError.validation({
      errors: [{ path: "fields", code: "REQUIRED", message: "Required." }],
    });

    expect(NextlyError.is(error)).toBe(true);
    expect(error.publicData).toMatchObject({
      errors: [{ path: "fields", code: "REQUIRED" }],
    });
  });
});

describe("the dashboard widget surface is reachable from the SDK", () => {
  // AGENTS.md: a plugin imports only from `@nextlyhq/plugin-sdk` and
  // `@nextlyhq/ui`, never from core. The widget registry and the source
  // registry were exported from the `nextly` root alone, so an author
  // following that rule could not register a widget at all. Asserted through
  // the SDK's own entry point, for the same reason the `NextlyError` case
  // above is: importing from core would pass while the stable surface stayed
  // empty.
  it("re-exports the registration functions as callable values", async () => {
    const sdk = await import("./index");
    expect(typeof sdk.registerWidget).toBe("function");
    expect(typeof sdk.registerSource).toBe("function");
  });

  it("re-exports the vocabularies a declaration is checked against", async () => {
    // The runtime arrays, not just their types: a plugin picking a size or an
    // op from a list needs the values, and a type-only re-export would compile
    // and then be `undefined` at runtime.
    const sdk = await import("./index");
    expect(sdk.WIDGET_SIZES).toContain("md");
    expect(sdk.WIDGET_HEIGHTS).toContain("tall");
    expect(sdk.WIDGET_ARCHETYPES).toContain("metric");
    expect(sdk.WIDGET_OPS).toContain("count");
    expect(sdk.WIDGET_SOURCE_KINDS).toContain("collection");
    expect(sdk.WIDGET_SOURCE_FIELD_TYPES).toContain("string");
  });
});
