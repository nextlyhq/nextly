import { describe, expect, it } from "vitest";

import { buildInstallArgs } from "./add";

describe("buildInstallArgs (nextly add, D70)", () => {
  it("uses `add` for pnpm/yarn and `install` for npm", () => {
    expect(buildInstallArgs("pnpm", "@acme/p", false)).toEqual([
      "add",
      "@acme/p",
    ]);
    expect(buildInstallArgs("yarn", "@acme/p", false)).toEqual([
      "add",
      "@acme/p",
    ]);
    expect(buildInstallArgs("npm", "@acme/p", false)).toEqual([
      "install",
      "@acme/p",
    ]);
  });

  it("inserts the dev flag before the package", () => {
    expect(buildInstallArgs("pnpm", "@acme/p", true)).toEqual([
      "add",
      "-D",
      "@acme/p",
    ]);
    expect(buildInstallArgs("npm", "@acme/p", true)).toEqual([
      "install",
      "-D",
      "@acme/p",
    ]);
  });
});
