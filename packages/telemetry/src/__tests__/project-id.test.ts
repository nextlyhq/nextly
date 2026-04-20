import { describe, it, expect } from "vitest";

import { hashProjectId } from "../project-id.js";

describe("hashProjectId", () => {
  it("returns a 12-char hex string", () => {
    expect(hashProjectId("/Users/x/project", "salt")).toMatch(/^[0-9a-f]{12}$/);
  });
  it("is stable for the same inputs", () => {
    const a = hashProjectId("/Users/x/project", "salt");
    const b = hashProjectId("/Users/x/project", "salt");
    expect(a).toBe(b);
  });
  it("differs across different salts", () => {
    const a = hashProjectId("/Users/x/project", "salt-a");
    const b = hashProjectId("/Users/x/project", "salt-b");
    expect(a).not.toBe(b);
  });
  it("differs across different cwds", () => {
    const a = hashProjectId("/path/a", "salt");
    const b = hashProjectId("/path/b", "salt");
    expect(a).not.toBe(b);
  });
  it("does NOT contain the cwd verbatim", () => {
    const cwd = "/Users/secret-project";
    const out = hashProjectId(cwd, "salt");
    expect(out).not.toContain("secret");
    expect(out).not.toContain("Users");
  });
});
