// Asserts the cross-platform spawn shape: we spawn `node` (process.execPath),
// not `npx`, and the first arg is an absolute path to next's JS entry.
// Guards against regression to the spawn-npx-ENOENT-on-Windows bug.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildNextDevSupervisorOptions } from "./build-next-dev-supervisor-options.js";

describe("buildNextDevSupervisorOptions", () => {
  let fixtureDir: string;

  beforeEach(() => {
    fixtureDir = mkdtempSync(join(tmpdir(), "nextly-builder-test-"));
    writeFileSync(
      join(fixtureDir, "package.json"),
      JSON.stringify({ name: "fixture-project", version: "0.0.0" })
    );
    const nextDir = join(fixtureDir, "node_modules", "next");
    mkdirSync(join(nextDir, "dist", "bin"), { recursive: true });
    writeFileSync(
      join(nextDir, "package.json"),
      JSON.stringify({
        name: "next",
        version: "15.0.0",
        bin: { next: "dist/bin/next" },
      })
    );
    writeFileSync(
      join(nextDir, "dist", "bin", "next"),
      "#!/usr/bin/env node\n"
    );
  });

  afterEach(() => {
    rmSync(fixtureDir, { recursive: true, force: true });
  });

  it("spawns node directly, not npx", () => {
    const opts = buildNextDevSupervisorOptions({
      cwd: fixtureDir,
      port: "3000",
      env: process.env,
      onExit: () => {},
    });
    expect(opts.command).toBe(process.execPath);
    expect(opts.command).not.toBe("npx");
  });

  it("passes an absolute path to next's JS entry as the first arg", () => {
    const opts = buildNextDevSupervisorOptions({
      cwd: fixtureDir,
      port: "3000",
      env: process.env,
      onExit: () => {},
    });
    expect(opts.args[0]).toMatch(/[/\\]next[/\\]dist[/\\]bin[/\\]next$/);
    // Cross-platform absolute-path check.
    expect(
      opts.args[0]!.startsWith("/") || /^[A-Za-z]:[\\/]/.test(opts.args[0]!)
    ).toBe(true);
  });

  it("passes dev + port flags after the binary path", () => {
    const opts = buildNextDevSupervisorOptions({
      cwd: fixtureDir,
      port: "4321",
      env: process.env,
      onExit: () => {},
    });
    expect(opts.args.slice(1)).toEqual(["dev", "-p", "4321"]);
  });

  it("forwards cwd and env through unchanged", () => {
    const fakeEnv = {
      NEXTLY_IPC_TOKEN: "test-token",
      NODE_ENV: "development",
    };
    const opts = buildNextDevSupervisorOptions({
      cwd: fixtureDir,
      port: "3000",
      env: fakeEnv as NodeJS.ProcessEnv,
      onExit: () => {},
    });
    expect(opts.cwd).toBe(fixtureDir);
    expect(opts.env).toBe(fakeEnv);
  });
});
