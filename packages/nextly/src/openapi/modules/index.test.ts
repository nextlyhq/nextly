import { describe, expect, it } from "vitest";

import { builtinModules } from "./index";

describe("builtinModules", () => {
  it("registers all 12 built-in modules in stable order", () => {
    expect(builtinModules.map(m => m.name)).toEqual([
      "health",
      "auth",
      "users",
      "media",
      "email-providers",
      "email-templates",
      "email-send",
      "components",
      "singles",
      "collections-schema",
      "rbac",
      "system",
    ]);
  });

  it("every module has a tag", () => {
    for (const m of builtinModules) {
      expect(m.tag).toBeDefined();
      expect(m.tag?.name).toMatch(/.+/);
    }
  });

  it("every module declares at least one operation", () => {
    for (const m of builtinModules) {
      expect(m.operations.length).toBeGreaterThan(0);
    }
  });

  it("the bundle declares no duplicate operationId across modules", () => {
    const seen = new Set<string>();
    for (const m of builtinModules) {
      for (const op of m.operations) {
        expect(seen.has(op.operationId), op.operationId).toBe(false);
        seen.add(op.operationId);
      }
    }
  });

  it("the bundle declares no duplicate path+method across modules", () => {
    const seen = new Set<string>();
    for (const m of builtinModules) {
      for (const op of m.operations) {
        const key = `${op.method} ${op.path}`;
        expect(seen.has(key), key).toBe(false);
        seen.add(key);
      }
    }
  });
});
