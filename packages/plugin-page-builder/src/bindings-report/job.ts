/**
 * The check of every document for the "Bindings to fix" report, as a sweep:
 * the runner keeps one queued, so every jobs pass asks whether the schema
 * changed since the last complete check, and carries on a check under way.
 * A pass with nothing changed reads the schema's fingerprint and one row.
 *
 * @module bindings-report/job
 */
import { defineJob, type JobDefinition } from "@nextlyhq/plugin-sdk";

/** The job's slug. */
export const BINDINGS_REPORT_JOB = "page-builder:bindings-report";

/** The sweep, running one pass of the check until the runner's deadline. */
export function bindingsReportJob(
  run: (deadline: Date) => Promise<unknown>
): JobDefinition {
  return defineJob({
    slug: BINDINGS_REPORT_JOB,
    sweep: true,
    handler: async (_input, context) => {
      await run(context.deadline);
    },
  });
}
