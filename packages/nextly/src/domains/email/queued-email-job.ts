/**
 * The job type that attempts a queued email, in a leaf module so the job
 * registration, the reserved-slug check and the queue read one spelling.
 *
 * @module domains/email/queued-email-job
 */

/** The slug of the job that makes a queued email's attempts. */
export const QUEUED_EMAIL_JOB = "email:send";

/**
 * The slug of the sweep that removes settled queued emails, on every jobs
 * run, whatever the delivery records' retention.
 */
export const QUEUED_EMAIL_PRUNE_JOB = "email:queue-prune";

/**
 * How many attempts a queued email gets before it fails for good.
 *
 * The job queue's backoff doubles from one second and is capped at an hour,
 * so fifteen attempts spread over roughly one and a half to three hours. That
 * outlasts a provider's short outage and the fifteen minutes after which a
 * send whose response was lost may be taken over under its key
 * (`CLAIM_TAKEOVER_MS`).
 */
export const QUEUED_EMAIL_MAX_ATTEMPTS = 15;

/**
 * How long a settled queued email's row is kept: seven days, as the job
 * queue keeps a finished job. A failed email's message is held for that
 * long, so it can still be read after a provider is fixed, and is then
 * removed with its row.
 */
export const QUEUED_EMAIL_HOLD_MS = 7 * 24 * 60 * 60_000;
