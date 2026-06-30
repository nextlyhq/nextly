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
});
