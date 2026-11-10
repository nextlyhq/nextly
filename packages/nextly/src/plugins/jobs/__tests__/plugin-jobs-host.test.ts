/**
 * The host a plugin context runs a sweep through: the installation it runs
 * on is the one its context's resolver answers, never the process container.
 *
 * The runner is replaced with a recorder, so what is observed is exactly the
 * database and registry it is handed.
 *
 * @module plugins/jobs/__tests__/plugin-jobs-host.test
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { container } from "../../../di/container";
import { JobRegistry } from "../../../domains/jobs/job-registry";
import type { JobsPassDatabase } from "../../../domains/jobs/jobs-runner";

const handed: { database: unknown; registry: unknown; slug: string }[] = [];

vi.mock("../../../domains/jobs/jobs-runner", () => ({
  runSweepNow: async (database: unknown, registry: unknown, slug: string) => {
    handed.push({ database, registry, slug });
    return { claimed: 1, done: 1, failed: 0, retried: 0, unrecorded: 0 };
  },
}));

const { contextSweepHost } = await import("../plugin-jobs");

afterEach(() => {
  handed.length = 0;
});

describe("the installation a sweep run now runs on", () => {
  it("runs on the database and registry its context's resolver answers", async () => {
    const mine = new JobRegistry();
    const database = { mine: true } as unknown as JobsPassDatabase;
    // The process container holds nothing a run could use: a host that read
    // it would throw or run elsewhere.
    expect(container.has("jobRegistry")).toBe(false);

    const host = contextSweepHost({
      registry: () => mine,
      database: () => database,
    });
    await host.run("acme:reindex", 5_000);

    expect(host.registry()).toBe(mine);
    expect(handed).toEqual([
      { database, registry: mine, slug: "acme:reindex" },
    ]);
  });
});
