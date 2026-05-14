import { describe, expect, it } from "vitest";

describe("openapi subpath scaffolding", () => {
  it("resolves the nextly/openapi subpath and exposes defineOpenApi", async () => {
    const mod = await import("../index");
    expect(typeof mod.defineOpenApi).toBe("function");
    // The identity helper round-trips its argument.
    const cfg = mod.defineOpenApi({
      info: { title: "Acme API", version: "2.1.0" },
    });
    expect(cfg.info?.title).toBe("Acme API");
  });

  it("re-exports the fallback renderer", async () => {
    const mod = await import("../index");
    expect(mod.fallbackRenderer).toBeDefined();
    expect(mod.fallbackRenderer.name).toBe("fallback");
  });

  it("resolves the nextly/api/openapi subpath", async () => {
    const mod = await import("../../api/openapi");
    expect(mod.openApiHandler).toBeDefined();
    expect(typeof mod.openApiHandler.GET).toBe("function");
  });
});
