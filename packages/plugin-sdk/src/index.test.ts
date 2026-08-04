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
