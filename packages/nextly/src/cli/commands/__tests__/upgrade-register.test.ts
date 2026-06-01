/**
 * @module cli/commands/__tests__/upgrade-register
 * @since v0.0.3-alpha (Plan B)
 */
import { Command } from "commander";
import { describe, it, expect } from "vitest";

import { registerUpgradeCommand } from "../upgrade";

describe("registerUpgradeCommand", () => {
  it("registers the upgrade command with the documented flags", () => {
    const program = new Command();
    registerUpgradeCommand(program);

    const upgrade = program.commands.find(c => c.name() === "upgrade");
    expect(upgrade).toBeDefined();

    const longFlags = upgrade!.options.map(o => o.long);
    expect(longFlags).toContain("--confirm-backed-up");
    expect(longFlags).toContain("--force");
    expect(longFlags).toContain("--target-table-name");
    expect(longFlags).toContain("--reconcile-core");
  });
});
