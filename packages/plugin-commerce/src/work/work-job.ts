import { defineJob, type JobDefinition } from "@nextlyhq/plugin-sdk";
import type {
  isUniqueViolation,
  PluginDatabase,
} from "@nextlyhq/plugin-sdk/schema";

import { WORK_JOB } from "../checkout/checkout-service";

import { recordJobRun } from "./job-health";
import { runDueWork, type WorkAlerts, type WorkHandler } from "./work-runner";

/** What the work job needs once the plugin has started. */
export interface WorkJobDeps {
  readonly db: PluginDatabase;
  readonly dialect: Parameters<typeof isUniqueViolation>[0];
  readonly handlers: Readonly<Record<string, WorkHandler>>;
  readonly alerts: WorkAlerts;
}

/**
 * The sweep that finishes commerce's follow-up work. Core keeps one queued,
 * so every jobs pass runs it: it records the run first, which is what the
 * checkout gate reads, then runs every due step until the pass's deadline,
 * leaving the rest to the next pass.
 */
export function workJob(deps: () => WorkJobDeps): JobDefinition {
  return defineJob({
    slug: WORK_JOB,
    sweep: true,
    handler: async (_input, context) => {
      const { db, dialect, handlers, alerts } = deps();
      await recordJobRun(db, dialect, WORK_JOB, context.now);
      await runDueWork({
        db,
        handlers,
        alerts,
        now: () => new Date(),
        deadline: context.deadline,
      });
    },
  });
}
