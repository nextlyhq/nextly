/**
 * What every command's `--dry-run` says: one "Would …" line per change the
 * real run would make, the real run's refusals, what the dry run cannot
 * simulate, and a last line saying nothing was changed. One meaning and one
 * help line for the flag on every command.
 */
import { posix, win32 } from "node:path";

import { Command } from "commander";
import { describe, expect, it } from "vitest";

import { DRY_RUN_HELP, dryRunLines, projectPath, withDryRun } from "../dry-run";

describe("dryRunLines", () => {
  it("says what each change would be, then that nothing was changed", () => {
    expect(
      dryRunLines({
        changes: [
          { action: "write", target: "nextly.config.ts" },
          { action: "remove", target: "src/blocks.manifest.json" },
          { action: "run", target: "pnpm add @nextlyhq/plugin-seo" },
        ],
      })
    ).toEqual([
      "Would write nextly.config.ts",
      "Would remove src/blocks.manifest.json",
      "Would run pnpm add @nextlyhq/plugin-seo",
      "Dry run: nothing was changed.",
    ]);
  });

  it("names the real run's refusals and what the dry run cannot show", () => {
    expect(
      dryRunLines({
        changes: [{ action: "write", target: "migrations/0002_add.sql" }],
        refusals: ["the migrations folder holds an unsealed file"],
        notes: ["The plugin's install hook would run; a dry run skips it."],
      })
    ).toEqual([
      "Would write migrations/0002_add.sql",
      "A real run would refuse: the migrations folder holds an unsealed file",
      "The plugin's install hook would run; a dry run skips it.",
      "Dry run: nothing was changed.",
    ]);
  });

  it("says so when the real run would change nothing either", () => {
    expect(dryRunLines({ changes: [] })).toEqual([
      "Nothing would change.",
      "Dry run: nothing was changed.",
    ]);
  });
});

describe("withDryRun", () => {
  it("adds --dry-run with the one help line every command shares", () => {
    const option = withDryRun(new Command("x")).options.find(
      each => each.long === "--dry-run"
    );
    expect(option?.description).toBe(DRY_RUN_HELP);
    expect(DRY_RUN_HELP).toBe("Show what would change; change nothing");
  });

  it("reads as off when the flag is not given", () => {
    const command = withDryRun(new Command("x")).action(() => {});
    command.parse([], { from: "user" });
    expect(command.opts<{ dryRun?: boolean }>().dryRun).toBeFalsy();
    command.parse(["--dry-run"], { from: "user" });
    expect(command.opts<{ dryRun?: boolean }>().dryRun).toBe(true);
  });
});

describe("projectPath", () => {
  // What a dry run names, read on any machine: the path from the project
  // folder, with `/` between its parts, whichever separator the machine uses.
  it("names a file from the project folder with forward slashes on Windows", () => {
    expect(
      projectPath("C:\\site", "C:\\site\\migrations\\0001_init.sql", win32)
    ).toBe("migrations/0001_init.sql");
  });

  it("names it the same way on POSIX", () => {
    expect(projectPath("/site", "/site/src/types/nextly-types.ts", posix)).toBe(
      "src/types/nextly-types.ts"
    );
  });
});
