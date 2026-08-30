/**
 * Background jobs — domain surface.
 *
 * @module domains/jobs
 */

export {
  DEFAULT_MAX_ATTEMPTS,
  JobRegistry,
  defineJob,
  type JobContext,
  type JobDefinition,
  type JobDefinitionInput,
  type JobRetryPolicy,
} from "./job-registry";
export {
  BACKOFF_BASE_MS,
  BACKOFF_CAP_MS,
  nextAttempt,
  type NextAttempt,
} from "./job-backoff";
export {
  JobsRepository,
  type EnqueueResult,
  type FinalizeInput,
  type FinalizeOutcome,
  type JobRow,
  type JobsDatabase,
  type NewJob,
} from "./jobs-repository";
export {
  resolveRunAs,
  type RunAsDeps,
  type RunAsRefusal,
  type RunAsResult,
  type RunAsUser,
} from "../../shared/lib/resolve-run-as";
export { remainingPassMs } from "./remaining-pass";
export {
  DEFAULT_BATCH_SIZE,
  DEFAULT_MAX_DURATION_MS,
  runJobs,
  type JobsStore,
  type RunJobsDeps,
  type RunJobsResult,
} from "./run-jobs";
export {
  databaseRunAs,
  runJobsPass,
  sweepDedupeKey,
  type JobsPassDatabase,
  type RunJobsPassOptions,
} from "./jobs-runner";
