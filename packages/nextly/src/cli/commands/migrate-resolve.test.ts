/**
 * @module cli/commands/migrate-resolve.test
 * @since v0.0.3-alpha (Plan C3)
 */
import { Command } from "commander";
import { describe, expect, it } from "vitest";

import { registerMigrateResolveCommand } from "./migrate-resolve";

describe("registerMigrateResolveCommand", () => {
  it("registers migrate:resolve with the three resolve flags", () => {
    const program = new Command();
    registerMigrateResolveCommand(program);

    const cmd = program.commands.find(c => c.name() === "migrate:resolve");
    expect(cmd).toBeDefined();

    const longs = cmd!.options.map(o => o.long);
    expect(longs).toContain("--applied");
    expect(longs).toContain("--rolled-back");
    expect(longs).toContain("--failed-cleanup");
    expect(longs).toContain("--skip-verify");
  });
});
