import { createRequire } from "module";

import { describe, expect, it } from "vitest";

import { getCoreVersion } from "./core-version";

const require = createRequire(import.meta.url);
const pkg = require("../../package.json") as { version: string };

describe("getCoreVersion", () => {
  it("returns a non-empty semver string", () => {
    const version = getCoreVersion();
    expect(typeof version).toBe("string");
    expect(version.length).toBeGreaterThan(0);
  });

  it("matches the nextly package.json version (injected via build/test define)", () => {
    expect(getCoreVersion()).toBe(pkg.version);
  });
});
