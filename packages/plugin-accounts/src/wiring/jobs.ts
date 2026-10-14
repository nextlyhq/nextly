import { defineJob, type JobDefinition } from "@nextlyhq/plugin-sdk";

import type { AccountsEmail } from "../flows/mail";

/** The job that sends one queued email. Namespaced, since core reserves its own prefixes. */
export const SEND_EMAIL_JOB = "accounts:send-email";

/** The job that keeps the plugin's tables swept. */
export const SWEEP_JOB = "accounts:sweep";

/** Sends emails a few times over before giving up, as a mail server can be down a while. */
const SEND_ATTEMPTS = 5;

/**
 * The job that sends a queued email, so a flow's answer never waits on a mail
 * server. `send` throws when the email did not go, and the runner tries again.
 */
export function sendEmailJob(
  send: (email: AccountsEmail) => Promise<void>
): JobDefinition {
  return defineJob({
    slug: SEND_EMAIL_JOB,
    retry: { maxAttempts: SEND_ATTEMPTS },
    handler: async input => {
      const email = input?.email;
      if (!isQueuedEmail(email))
        throw new TypeError("A queued accounts email is malformed.");
      await send(email);
    },
  });
}

/**
 * The sweep the runner keeps queued: expired sessions, browsers known too
 * long ago, address changes past their time, and accounts nobody verified.
 */
export function sweepJob(sweep: (now: Date) => Promise<void>): JobDefinition {
  return defineJob({
    slug: SWEEP_JOB,
    sweep: true,
    handler: async (_input, context) => {
      await sweep(context.now);
    },
  });
}

/**
 * The plugin's own queued email, read back from the job's row. Only the
 * plugin queues this job, so a check of its shape is enough.
 */
function isQueuedEmail(value: unknown): value is AccountsEmail {
  if (typeof value !== "object" || value === null) return false;
  const { kind, to, accountId } = value as Record<string, unknown>;

  return (
    typeof kind === "string" &&
    typeof to === "string" &&
    typeof accountId === "string"
  );
}
