/**
 * `nextly repair-columns` hands `--apply` to the run that converts, and its absence to the dry run.
 *
 * Everything around the choice stands in for itself: the database settings, the configuration, the
 * adapter and the two runs. So each case reaches the choice and observes which run it made, with
 * the arguments it gave, rather than stopping on a configuration that does not load.
 */
import type { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runs = vi.hoisted(() => ({
  apply: vi.fn(),
  dryRun: vi.fn(),
}));

vi.mock("../../utils/adapter", () => ({
  validateDatabaseEnv: () => ({
    valid: true,
    dialect: "sqlite",
    databaseUrl: "file:./unused.db",
  }),
  createCliAdapter: () =>
    Promise.resolve({ disconnect: () => Promise.resolve() }),
}));
vi.mock("../../utils/config-loader", () => ({
  loadConfig: () =>
    Promise.resolve({
      config: { db: { migrationsDir: "migrations" } },
      projectRoot: "/project",
    }),
}));
vi.mock("../../utils/registry-resolver", () => ({
  installRegistryResolver: () => {},
}));
vi.mock("../../../domains/schema/repair-columns/read-entities", () => ({
  readRepairEntities: () => Promise.resolve([]),
}));
vi.mock("../../../domains/schema/repair-columns/apply", () => ({
  applyRepairs: runs.apply,
}));
vi.mock("../../../domains/schema/repair-columns/run-report", () => ({
  dryRunReport: runs.dryRun,
  formatReport: () => [],
}));

import { createContext } from "../../context";
import { repairColumnsAction } from "../repair-columns";

const command = (globals: Record<string, unknown>) =>
  ({ optsWithGlobals: () => globals }) as unknown as Command;

/** A run's document, naming its mode, ending with the code a converted column gives. */
const documentOf = (mode: "dry-run" | "apply") => ({
  schema: "nextly.repair-columns/1",
  command: "repair-columns",
  nextlyVersion: "test",
  ok: true,
  exitCode: 0,
  result: { mode },
  errors: [],
  warnings: [],
});

describe("repair-columns --apply reaches the run that converts", () => {
  beforeEach(() => {
    runs.apply.mockResolvedValue(documentOf("apply"));
    runs.dryRun.mockResolvedValue(documentOf("dry-run"));
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    runs.apply.mockReset();
    runs.dryRun.mockReset();
    process.exitCode = undefined;
  });

  it("with --apply, runs the apply over the entities read, and never the dry run", async () => {
    await repairColumnsAction(createContext)(
      { json: true, apply: true },
      command({ cwd: "/project" })
    );
    expect(runs.apply).toHaveBeenCalledTimes(1);
    expect(runs.apply).toHaveBeenCalledWith(
      expect.objectContaining({ dialect: "sqlite", entities: [] })
    );
    expect(runs.dryRun).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(0);
  });

  it("without --apply, runs the dry run, and never the apply", async () => {
    await repairColumnsAction(createContext)(
      { json: true },
      command({ cwd: "/project" })
    );
    expect(runs.dryRun).toHaveBeenCalledTimes(1);
    expect(runs.apply).not.toHaveBeenCalled();
  });
});
