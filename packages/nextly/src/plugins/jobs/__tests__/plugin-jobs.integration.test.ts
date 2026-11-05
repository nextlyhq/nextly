/**
 * A booted plugin running one of its own sweeps now, through the context it
 * was handed, against a REAL database.
 *
 * The unit test holds the ownership rule over a fake runner. This holds the
 * part only a boot can: that `ctx.services.jobs` IS the plugin's namespace,
 * built for that plugin, and that its runner reaches the installation's own
 * adapter and job registry, so the sweep the plugin contributes actually runs.
 *
 * Runs against whichever dialects the integration run configures; CI covers
 * SQLite, PostgreSQL and MySQL.
 */
import { afterEach, describe, expect, it } from "vitest";

import { defineJob } from "../../../domains/jobs/job-registry";
import { NextlyError } from "../../../errors/nextly-error";
import { definePlugin, type PluginContext } from "../../plugin-context";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../test-nextly";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

describe.each(getConfiguredTestDialects())(
  "a plugin running its own sweep now (%s)",
  dialect => {
    it("runs the sweep it contributes, and refuses one it does not", async () => {
      const ran: string[] = [];
      let context: PluginContext | undefined;
      const plugin = definePlugin({
        name: "@test/pj-sweeps",
        version: "1.0.0",
        nextly: ">=0.0.0",
        contributes: {
          jobs: [
            defineJob({
              slug: "test-pj:reindex",
              sweep: true,
              handler: async (_input, job) => {
                ran.push(job.jobId);
              },
            }),
          ],
        },
        init(ctx) {
          context = ctx;
        },
      });
      current = await createTestNextly(
        dialect === "sqlite"
          ? { plugins: [plugin] }
          : { dialect, plugins: [plugin] }
      );
      if (context === undefined) throw new Error("the plugin was not set up");

      await expect(
        context.services.jobs.runSweepNow("test-pj:reindex", {
          maxDurationMs: 5_000,
        })
      ).resolves.toEqual({ ran: true });
      expect(ran).toHaveLength(1);

      // Core's own release drain is a sweep the registry holds, and not this
      // plugin's to run.
      const refusal = await context.services.jobs
        .runSweepNow("releases:drain")
        .catch((error: unknown) => error);
      expect(NextlyError.is(refusal) && refusal.code).toBe("FORBIDDEN");
      expect(ran).toHaveLength(1);
    });
  }
);
