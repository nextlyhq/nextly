import { describe, expect, it } from "vitest";

describe("openapi subpath scaffolding", () => {
  it("resolves the nextly/openapi subpath", async () => {
    const mod = await import("../index");
    expect(mod.__OPENAPI_SUBPATH_RESERVED__).toBe(true);
  });

  it("resolves the nextly/api/openapi subpath", async () => {
    const mod = await import("../../api/openapi");
    expect(mod.openApiHandler).toBeDefined();
    expect(typeof mod.openApiHandler.GET).toBe("function");
  });
});
