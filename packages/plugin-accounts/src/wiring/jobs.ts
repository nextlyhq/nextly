import { defineJob, type JobDefinition } from "@nextlyhq/plugin-sdk";

import type { AccountsEmail } from "../flows/mail";

/**
 * The job that sends one queued email, its secrets queued by ref.
 * Namespaced, since core reserves its own prefixes. A slug of its own, not
 * the earlier one: an instance still running the earlier code during a
 * deployment does not know it, and core leaves the job for an instance that
 * does, rather than that instance sending the email with its links blank.
 */
export const SEND_EMAIL_JOB = "accounts:send-email-by-ref";

/**
 * The slug emails were queued under before their secrets were queued by
 * ref, still run for the jobs queued then, which hold their links whole.
 */
export const SEND_EMAIL_JOB_BEFORE_REFS = "accounts:send-email";

/** The job that keeps the plugin's tables swept. */
export const SWEEP_JOB = "accounts:sweep";

/** Sends emails a few times over before giving up, as a mail server can be down a while. */
const SEND_ATTEMPTS = 5;

/**
 * An email as its job holds it: its kind, account and recipient, the
 * fields that carry no secret, and the refs of those that do, by field. A
 * row queued before secrets were queued by ref holds its fields whole and
 * no refs.
 */
export type QueuedAccountsEmail = Readonly<
  {
    kind: AccountsEmail["kind"];
    accountId: string | null;
    to: string;
    refs?: Readonly<Record<string, string>>;
  } & Record<string, unknown>
>;

/** The attempt a send runs in: its job's id, the same on every attempt, and the runner's now. */
export interface SendAttempt {
  jobId: string;
  now: Date;
}

/**
 * The job that sends a queued email, so a flow's answer never waits on a mail
 * server. `send` throws when the email did not go, and the runner tries again;
 * it is handed the job's id, so a retry of a job whose email went sends
 * nothing more.
 */
export function sendEmailJob(
  send: (email: QueuedAccountsEmail, attempt: SendAttempt) => Promise<void>,
  slug:
    | typeof SEND_EMAIL_JOB
    | typeof SEND_EMAIL_JOB_BEFORE_REFS = SEND_EMAIL_JOB
): JobDefinition {
  return defineJob({
    slug,
    retry: { maxAttempts: SEND_ATTEMPTS },
    handler: async (input, context) => {
      const email = input?.email;
      if (!isQueuedEmail(email))
        throw new TypeError("A queued accounts email is malformed.");
      await send(email, { jobId: context.jobId, now: context.now });
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
 * plugin queues this job, so a check of its shape is enough: every email
 * names its account, but an invitation to an address with no account,
 * which names none; and its refs, where it has them, are strings by field.
 */
function isQueuedEmail(value: unknown): value is QueuedAccountsEmail {
  if (typeof value !== "object" || value === null) return false;
  const { kind, to, accountId, refs } = value as Record<string, unknown>;

  return (
    typeof kind === "string" &&
    typeof to === "string" &&
    (kind === "invitation"
      ? accountId === null
      : typeof accountId === "string") &&
    (refs === undefined || isRefs(refs))
  );
}

/** Refs by field, as a queued email's secrets are held: strings, by name. */
function isRefs(value: unknown): value is Readonly<Record<string, string>> {
  return (
    typeof value === "object" &&
    value !== null &&
    Object.values(value).every(ref => typeof ref === "string")
  );
}
