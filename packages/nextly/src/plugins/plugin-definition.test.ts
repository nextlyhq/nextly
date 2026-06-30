import { describe, it, expect } from "vitest";
import { definePlugin } from "./plugin-context";

describe("PluginDefinition contract", () => {
  it("definePlugin returns its input and accepts the new contract fields", () => {
    const def = definePlugin({
      name: "@acme/plugin-x",
      version: "1.0.0",
      nextly: ">=0.0.2-alpha.0",
      dependsOn: { "@acme/plugin-y": "^1.0.0" },
      optionalDependsOn: { "@acme/plugin-z": "^2.0.0" },
      enabled: true,
      contributes: { events: [{ name: "x.did.thing" }] },
      setup: config => config,
      init: () => {},
      destroy: () => {},
    });
    expect(def.name).toBe("@acme/plugin-x");
    expect(def.nextly).toBe(">=0.0.2-alpha.0");
    expect(def.contributes?.events?.[0]?.name).toBe("x.did.thing");
  });
});
