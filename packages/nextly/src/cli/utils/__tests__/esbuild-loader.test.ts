/**
 * The one place this package reaches for esbuild.
 *
 * esbuild is ~9.6 MB and exists to compile the user's `nextly.config.ts`.
 * Three things need it, and none of them is serving a request:
 *
 *   - development, where boot-apply and the HMR listener re-read the config;
 *   - the CLI (`nextly migrate` and friends);
 *   - production ONLY when `db.runMigrationsOnBoot` is switched on, which is
 *     opt-in and off by default.
 *
 * So an ordinary production install downloads it and never executes a line.
 * Making it optional is what this loader is for, and the absence has to arrive
 * as an instruction rather than as a module-not-found from three call paths.
 */
import { describe, expect, it } from "vitest";

import {
  ESBUILD_INSTALL_COMMAND,
  isEsbuildAvailable,
  loadEsbuild,
} from "../esbuild-loader";

describe("the esbuild loader", () => {
  it("names a command a user can run", () => {
    expect(ESBUILD_INSTALL_COMMAND).toContain("esbuild");
    expect(ESBUILD_INSTALL_COMMAND).toMatch(/install|add/);
  });

  it("finds the library here, where it stays a devDependency", () => {
    expect(isEsbuildAvailable()).toBe(true);
  });

  it("loads a module exposing build", async () => {
    const esbuild = await loadEsbuild();

    // The CALLABLE this package uses, rather than a shape: esbuild ships both
    // CommonJS and ESM, so which interop form arrives depends on the host.
    expect(typeof esbuild.build).toBe("function");
  });

  it("explains what to install when it cannot be had", async () => {
    // Throws rather than returning null, unlike the sharp loader beside it.
    // Compiling the config is not optional for the caller that asks: there is
    // no degraded outcome, so the decision does not belong to each call site.
    await expect(
      loadEsbuild({
        resolver: () => {
          throw new Error("ERR_MODULE_NOT_FOUND");
        },
      })
    ).rejects.toThrow(/esbuild/);
  });

  it("names the exact command in the message it throws", async () => {
    await expect(loadEsbuild({ resolver: () => null })).rejects.toThrow(
      /npm install (--save-dev|-D) esbuild/
    );
  });

  it("reads the CommonJS default when that is what arrives", async () => {
    const real = { build: () => ({}) };

    await expect(
      loadEsbuild({ resolver: () => ({ default: real }) })
    ).resolves.toBe(real);
  });
});
