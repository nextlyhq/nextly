/**
 * `nextly migrate:field-groups` — what it asks the engine for, and what it tells the operator.
 *
 * 🔴 The property that matters most is that PREVIEW IS THE DEFAULT. This command rewrites stored
 * customer content, and the difference between a safe first run and a destructive one is a single
 * boolean the operator never sees. A test asserting the command "works" would pass on a version
 * that applied by default, so the assertions below are about the ARGUMENTS handed to the engine,
 * not about it returning successfully.
 *
 * The second group is about the report. The engine deliberately refuses to summarise renames as a
 * count, and refuses to hide that a preview may describe a moving database. A caller that printed a
 * total, or quietly dropped `basis` and `lock`, would satisfy every "it ran" assertion while giving
 * the operator less than the engine took care to provide.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

const runFieldGroupMigration = vi.fn();

vi.mock("../../../domains/field-groups/migration/run", () => ({
  runFieldGroupMigration,
}));

vi.mock("../../utils/adapter", () => ({
  validateDatabaseEnv: () => ({ valid: true, errors: [] }),
  withAdapter: async (
    work: (adapter: unknown) => Promise<void>
  ): Promise<void> => {
    await work({ getCapabilities: () => ({ dialect: "postgresql" }) });
  },
}));

import { runMigrateFieldGroups } from "../migrate-field-groups";

/** Everything printed, in order, so the report can be asserted by content. */
const printed: string[] = [];

const logger = {
  info: (m: string) => printed.push(m),
  warn: (m: string) => printed.push(`WARN ${m}`),
  error: (m: string) => printed.push(`ERROR ${m}`),
  debug: vi.fn(),
  success: (m: string) => printed.push(`OK ${m}`),
  newline: vi.fn(),
  keyValue: (k: string, v: string) => printed.push(`${k}=${v}`),
} as unknown as Parameters<typeof runMigrateFieldGroups>[1]["logger"];

const context = { logger } as Parameters<typeof runMigrateFieldGroups>[1];

const DRY_RUN_OUTCOME = {
  ran: false as const,
  reason: "dry-run" as const,
  direction: "up" as const,
  renames: [
    { from: "dynamic_components", to: "dynamic_field_groups" },
    { from: "comp_hero", to: "fg_hero" },
  ],
  basis: { kind: "reconciled" as const },
  lock: { kind: "not-held" as const },
};

beforeEach(() => {
  printed.length = 0;
  runFieldGroupMigration.mockReset();
  runFieldGroupMigration.mockResolvedValue(DRY_RUN_OUTCOME);
});

describe("migrate:field-groups — what it asks the engine for", () => {
  it("previews by DEFAULT, with no flags at all", async () => {
    // The safety property of the whole command. A version that applied here would pass any test
    // that only checked the command completed.
    await runMigrateFieldGroups({}, context);

    expect(runFieldGroupMigration).toHaveBeenCalledTimes(1);
    expect(runFieldGroupMigration.mock.calls[0]![0]).toMatchObject({
      dryRun: true,
      direction: "up",
      backupConfirmed: false,
    });
  });

  it("only writes when --apply is given", async () => {
    runFieldGroupMigration.mockResolvedValue({
      ran: true,
      direction: "up",
      steps: 9,
    });

    await runMigrateFieldGroups(
      { apply: true, backupConfirmed: true },
      context
    );

    expect(runFieldGroupMigration.mock.calls[0]![0]).toMatchObject({
      dryRun: false,
      backupConfirmed: true,
    });
  });

  it("passes the backup acknowledgement through rather than judging it", async () => {
    // The engine refuses first, before it has read a catalog or contended for the lock. Deciding
    // it here as well would be a second implementation of one precondition, free to drift.
    await runMigrateFieldGroups({ apply: true }, context);

    expect(runFieldGroupMigration.mock.calls[0]![0]).toMatchObject({
      dryRun: false,
      backupConfirmed: false,
    });
  });

  it("rolls back only when --down is given", async () => {
    await runMigrateFieldGroups({ down: true }, context);
    expect(runFieldGroupMigration.mock.calls[0]![0]).toMatchObject({
      direction: "down",
      dryRun: true,
    });
  });
});

describe("migrate:field-groups — what it tells the operator", () => {
  it("lists every rename by name, and does not reduce them to a count", async () => {
    await runMigrateFieldGroups({}, context);

    const output = printed.join("\n");
    // By identity: the operator's question is whether THEIR table is in the list.
    expect(output).toContain("dynamic_components");
    expect(output).toContain("dynamic_field_groups");
    expect(output).toContain("comp_hero");
    expect(output).toContain("fg_hero");
    // And the count is not offered as the answer, because a run does more than rename.
    expect(output).not.toMatch(/\b2 (renames|tables|objects)\b/);
  });

  it("warns when the plan was NOT checked against the database", async () => {
    // An unreconciled plan is the manifest's proposal and an upper bound. Printing it identically
    // to a checked one would let an operator act on a list that may already be half applied.
    runFieldGroupMigration.mockResolvedValue({
      ...DRY_RUN_OUTCOME,
      basis: { kind: "unreconciled", reason: "a writer kept moving" },
    });

    await runMigrateFieldGroups({}, context);

    const output = printed.join("\n");
    expect(output).toContain("WARN");
    expect(output).toContain("NOT checked against your database");
    expect(output).toContain("a writer kept moving");
  });

  it("says a migration is in flight rather than printing a settled-looking plan", async () => {
    runFieldGroupMigration.mockResolvedValue({
      ...DRY_RUN_OUTCOME,
      lock: { kind: "held", owner: "host-7" },
    });

    await runMigrateFieldGroups({}, context);

    const output = printed.join("\n");
    expect(output).toContain("WARN");
    expect(output).toContain("running right now");
    expect(output).toContain("host-7");
  });

  it("separates 'nothing holds the lock' from 'the lock could not be read'", async () => {
    // The two send an operator in opposite directions, so collapsing them into silence would be
    // the more dangerous of the two reported as the safer one.
    runFieldGroupMigration.mockResolvedValue({
      ...DRY_RUN_OUTCOME,
      lock: { kind: "unknown", reason: "permission denied" },
    });

    await runMigrateFieldGroups({}, context);

    const output = printed.join("\n");
    expect(output).toContain("WARN");
    expect(output).toContain("could not be read");
    expect(output).not.toContain("No migration is currently running");
  });

  it("names the exact command that applies what was just previewed", async () => {
    await runMigrateFieldGroups({}, context);
    expect(printed.join("\n")).toContain(
      "nextly migrate:field-groups --apply --backup-confirmed"
    );
  });

  it("names the ROLLBACK command when previewing a rollback", async () => {
    runFieldGroupMigration.mockResolvedValue({
      ...DRY_RUN_OUTCOME,
      direction: "down",
    });
    await runMigrateFieldGroups({ down: true }, context);
    expect(printed.join("\n")).toContain(
      "nextly migrate:field-groups --down --apply --backup-confirmed"
    );
  });
});
