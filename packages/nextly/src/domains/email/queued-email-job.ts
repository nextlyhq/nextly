/**
 * The job type that attempts a queued email, in a leaf module so the job
 * registration, the reserved-slug check and the queue read one spelling.
 *
 * @module domains/email/queued-email-job
 */

/** The slug of the job that makes a queued email's attempts. */
export const QUEUED_EMAIL_JOB = "email:send";

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
