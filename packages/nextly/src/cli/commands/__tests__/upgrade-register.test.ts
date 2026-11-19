/**
 * @module cli/commands/__tests__/upgrade-register
 * @since v0.0.3-alpha (Plan B)
 */
import { Command } from "commander";
import { describe, it, expect } from "vitest";

import { registerUpgradeCommand } from "../upgrade";

describe("registerUpgradeCommand", () => {
  it("registers the upgrade command, taking a release and still parsing the flags of the work it used to do", () => {
    const program = new Command();
    registerUpgradeCommand(program);

    const upgrade = program.commands.find(c => c.name() === "upgrade");
    expect(upgrade).toBeDefined();

    const longFlags = upgrade!.options.map(o => o.long);
    expect(longFlags).toContain("--confirm-backed-up");
    expect(longFlags).toContain("--force");
    expect(longFlags).toContain("--target-table-name");
    expect(longFlags).toContain("--reconcile-core");
    expect(longFlags).toContain("--force-unlock");
    expect(longFlags).toContain("--accept-data-loss");
    expect(longFlags).toContain("--dry-run");
    // The release is the command's one argument, and optional.
    expect(
      upgrade!.registeredArguments.map(a => [a.name(), a.required])
    ).toEqual([["version", false]]);
  });
});
