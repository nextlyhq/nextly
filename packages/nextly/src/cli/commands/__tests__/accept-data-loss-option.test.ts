/**
 * Every command that can delete data takes the one consent: the
 * `--accept-data-loss` option, given alone or with targets, and the
 * `NEXTLY_ACCEPT_DATA_LOSS` variable. `prune` and `migrate:fresh` are
 * exercised further in their own files; this one holds each command to the
 * option, and checks how `plugins uninstall`, `db:sync` and `migrate:down`
 * read it.
 */
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { exportDataLossConsent, registerDbSyncCommand } from "../db-sync";
import { downConsent, registerMigrateDownCommand } from "../migrate-down";
import { registerMigrateFreshCommand } from "../migrate-fresh";
import { registerPluginsCommand } from "../plugins";
import { registerPruneCommand } from "../prune";

const uninstall = vi.hoisted(() => vi.fn(async () => {}));

// `../program` imports every command, `migrate` with its whole graph among
// them; the commands under test need only its context factory.
vi.mock("../../program", () => ({
  createContext: () => ({
    logger: {
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
      success: () => {},
    },
  }),
}));

// `migrate` is the largest command module, and nothing here runs it.
vi.mock("../migrate", () => ({
  runMigrate: vi.fn(),
  parseSqlSections: vi.fn(),
}));

vi.mock("../plugin-lifecycle-runner", () => ({
  runPluginUninstall: uninstall,
}));

/** A program with every command that deletes data registered on it. */
function program(): Command {
  const root = new Command().exitOverride();
  registerDbSyncCommand(root);
  registerMigrateDownCommand(root);
  registerMigrateFreshCommand(root);
  registerPruneCommand(root);
  registerPluginsCommand(root);
  return root;
}

function command(root: Command, path: string[]): Command {
  let at = root;
  for (const name of path) {
    const next = at.commands.find(c => c.name() === name);
    if (!next) throw new Error(`no command ${path.join(" ")}`);
    at = next;
  }
  return at;
}

let savedEnv: string | undefined;
beforeEach(() => {
  savedEnv = process.env.NEXTLY_ACCEPT_DATA_LOSS;
  delete process.env.NEXTLY_ACCEPT_DATA_LOSS;
  uninstall.mockClear();
});
afterEach(() => {
  if (savedEnv === undefined) delete process.env.NEXTLY_ACCEPT_DATA_LOSS;
  else process.env.NEXTLY_ACCEPT_DATA_LOSS = savedEnv;
});

describe("--accept-data-loss on every command that deletes data", () => {
  it.each([
    [["db:sync"]],
    [["migrate:down"]],
    [["migrate:fresh"]],
    [["prune"]],
    [["plugins", "uninstall"]],
  ])("%j takes it, alone or with targets", path => {
    const option = command(program(), path).options.find(
      o => o.long === "--accept-data-loss"
    );
    expect(option).toBeDefined();
    // `[targets]`: the value is optional, so the flag alone is consent to
    // every deletion and `=posts,pages.summary` names what it covers.
    expect(option?.optional).toBe(true);
    expect(option?.description).toContain("NEXTLY_ACCEPT_DATA_LOSS");
  });
});

describe("plugins uninstall", () => {
  const run = (...args: string[]) =>
    program().parseAsync(["plugins", "uninstall", "@acme/x", ...args], {
      from: "user",
    });
  const consentPassed = () =>
    (uninstall.mock.calls[0] as unknown as [string, { consent: unknown }])[1]
      .consent;

  it("hands the uninstall the flag's targets", async () => {
    await run("--accept-data-loss=x__notes,x__tags.label");
    expect(consentPassed()).toEqual({
      given: {
        from: "flag",
        targets: {
          tables: new Set(["x__notes"]),
          columns: new Set(["x__tags.label"]),
        },
      },
      earlier: [],
      ignored: [],
    });
  });

  it("hands it the variable's consent when no flag is given", async () => {
    process.env.NEXTLY_ACCEPT_DATA_LOSS = "1";
    await run();
    expect(consentPassed()).toEqual({
      given: { from: "env", targets: "all" },
      earlier: [],
      ignored: [],
    });
  });

  it("hands it no consent for --yes alone", async () => {
    await run("--yes");
    expect(consentPassed()).toEqual({ given: null, earlier: [], ignored: [] });
  });
});

describe("db:sync", () => {
  it("hands the push the flag as NEXTLY_ACCEPT_DATA_LOSS", () => {
    const env: Record<string, string | undefined> = {
      NEXTLY_ACCEPT_DATA_LOSS: "1",
    };
    exportDataLossConsent("dc_posts.summary", env);
    expect(env.NEXTLY_ACCEPT_DATA_LOSS).toBe("dc_posts.summary");
    exportDataLossConsent(true, env);
    expect(env.NEXTLY_ACCEPT_DATA_LOSS).toBe("1");
  });

  it("leaves the variable as it is without the flag", () => {
    const env: Record<string, string | undefined> = {
      NEXTLY_ACCEPT_DATA_LOSS: "dc_posts",
    };
    exportDataLossConsent(undefined, env);
    expect(env.NEXTLY_ACCEPT_DATA_LOSS).toBe("dc_posts");
  });

  it("refuses a malformed list before the sync starts", () => {
    const env: Record<string, string | undefined> = {};
    expect(() => exportDataLossConsent("a.b.c", env)).toThrow(
      /is not a list of tables/
    );
    expect(env.NEXTLY_ACCEPT_DATA_LOSS).toBeUndefined();
  });
});

describe("migrate:down", () => {
  it("reads the flag and the variable", () => {
    const warn = vi.fn();
    expect(downConsent({ acceptDataLoss: true }, warn).given).toEqual({
      from: "flag",
      targets: "all",
    });
    process.env.NEXTLY_ACCEPT_DATA_LOSS = "1";
    expect(downConsent({}, warn).given).toEqual({
      from: "env",
      targets: "all",
    });
    expect(warn).not.toHaveBeenCalled();
  });

  it("honours --allow-data-loss, naming it deprecated", () => {
    const warn = vi.fn();
    expect(downConsent({ allowDataLoss: true }, warn).earlier).toEqual([
      "--allow-data-loss",
    ]);
    expect(warn).toHaveBeenCalledWith(
      expect.stringMatching(
        /--allow-data-loss is deprecated.*--accept-data-loss/
      )
    );
  });
});
