/**
 * How the scaffold runs the installed `nextly migrate:create initial`: through
 * the package manager's own binary runner, in the project, reading the
 * database from the project's `.env` alone, and saying why when it fails.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const execa = vi.hoisted(() => vi.fn());
vi.mock("execa", () => ({ execa }));

import {
  initialMigrationCommand,
  writeInitialMigration,
} from "../installers/initial-migration";

beforeEach(() => {
  execa.mockReset();
});

describe("the initial migration command", () => {
  it("is spelled with each package manager's binary runner", () => {
    expect(initialMigrationCommand("npm")).toBe(
      "npx nextly migrate:create initial"
    );
    expect(initialMigrationCommand("pnpm")).toBe(
      "pnpm exec nextly migrate:create initial"
    );
    expect(initialMigrationCommand("yarn")).toBe(
      "yarn nextly migrate:create initial"
    );
    expect(initialMigrationCommand("bun")).toBe(
      "bunx nextly migrate:create initial"
    );
  });

  it("runs in the project, with the shell's database settings left out", async () => {
    execa.mockResolvedValue({ stdout: "" });
    vi.stubEnv("DATABASE_URL", "postgres://elsewhere/db");
    vi.stubEnv("NODE_ENV", "production");
    try {
      await expect(writeInitialMigration("/p/app", "pnpm")).resolves.toBe(
        undefined
      );
    } finally {
      vi.unstubAllEnvs();
    }

    expect(execa).toHaveBeenCalledTimes(1);
    const [file, args, options] = execa.mock.calls[0] as [
      string,
      string[],
      { cwd: string; env: Record<string, string | undefined>; stdin: string },
    ];
    expect([file, ...args]).toEqual([
      "pnpm",
      "exec",
      "nextly",
      "migrate:create",
      "initial",
    ]);
    expect(options.cwd).toBe("/p/app");
    // Unset, so the project's `.env` names the database and its dialect.
    expect(options.env.DATABASE_URL).toBeUndefined();
    expect("DATABASE_URL" in options.env).toBe(true);
    expect(options.env.NODE_ENV).toBeUndefined();
    expect(options.stdin).toBe("ignore");
  });

  it("answers why it failed, from what the command said", async () => {
    execa.mockRejectedValue(
      Object.assign(new Error("Command failed"), {
        stderr: "✗ The configuration could not be loaded.",
      })
    );
    await expect(writeInitialMigration("/p/app", "npm")).resolves.toContain(
      "The configuration could not be loaded."
    );
  });
});
