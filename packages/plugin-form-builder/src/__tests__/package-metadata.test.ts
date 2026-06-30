import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { formBuilder } from "../plugin";

const pkg = JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url), "utf8")
) as { version: string; keywords: string[] };

describe("form-builder package metadata", () => {
  it("definePlugin version matches package.json (no hardcoded drift)", () => {
    expect(formBuilder().plugin.version).toBe(pkg.version);
  });

  it("declares the nextly-plugin keyword for discoverability", () => {
    expect(pkg.keywords).toContain("nextly-plugin");
  });
});
