import type { PluginContext } from "@nextlyhq/plugin-sdk";

import { readAccountPrincipals } from "../core/adapter";
import type { AccountsCore } from "../core/ports";
import type { AccountPrincipals, FlowDeps } from "../flows/deps";
import type { AccountsEmail } from "../flows/mail";
import type { PasswordPacer } from "../flows/pacer";
import { sweepUnverifiedAccounts } from "../flows/sweep-unverified";
import { ACCOUNT_PRINCIPAL } from "../http/routes";
import type { AccountsSettings } from "../settings";
import { sweepKnownBrowsers } from "../storage/known-browsers";
import { sweepPendingChanges } from "../storage/pending-changes";
import {
  emailSentBy,
  recordEmailSent,
  sweepSentEmails,
} from "../storage/sent-emails";
import { sweepSessions } from "../storage/sessions";

import { emailVariables, templateSlug } from "./emails";
import { SEND_EMAIL_JOB, type SendAttempt } from "./jobs";

/**
 * A flow's deps from the plugin's context: its database, core's helpers,
 * the site's settings, mail queued as a job, events on core's bus, and the
 * plugin's own pacer, which times core's checks across requests.
 */
export function flowDepsFor(
  ctx: PluginContext,
  settings: AccountsSettings,
  core: AccountsCore,
  pacer: PasswordPacer,
  db: PluginContext["db"] = ctx.db
): FlowDeps {
  return {
    db,
    dialect: ctx.dialect,
    core,
    settings,
    mail: {
      queue: async email => {
        await ctx.services.jobs.queue({
          task: SEND_EMAIL_JOB,
          input: { email: { ...email } },
        });
      },
    },
    events: { emit: (name, payload) => ctx.events.emit(name, payload) },
    principals: accountPrincipals(ctx),
    pacer,
    logger: { warn: (message, context) => ctx.logger.warn(message, context) },
    now: () => new Date(),
  };
}

/** What sending a queued email needs of the plugin's context. */
export type EmailContext = Pick<PluginContext, "db" | "dialect"> & {
  services: {
    email: Pick<PluginContext["services"]["email"], "sendWithTemplate">;
  };
};

/**
 * Core's record of the plugin's people, as the flows report to it: an
 * account by its id, under the plugin's own kind.
 */
export function accountPrincipals(ctx: PluginContext): AccountPrincipals {
  return {
    reportDeleted: async (accountId, tx) => {
      await readAccountPrincipals(ctx).reportDeleted(
        { kind: ACCOUNT_PRINCIPAL, id: accountId },
        { tx }
      );
    },
  };
}

/**
 * Sends a queued email through core's email service, with its kind's
 * template, once per job: a retry of a job whose email went sends nothing,
 * and a send that went is recorded straight after. Throws when it did not
 * go, so the runner tries again. A crash between the send and its record,
 * or a provider that took the email and answered a failure, can still send
 * it twice; only a key core's email service passes on could close that.
 */
export async function sendQueuedEmail(
  ctx: EmailContext,
  email: AccountsEmail,
  attempt: SendAttempt
): Promise<void> {
  if (await emailSentBy(ctx.db, attempt.jobId)) return;
  // Names the account the email is to, so core erases the delivery
  // record with the account when it is reported deleted.
  const sent = await ctx.services.email.sendWithTemplate(
    templateSlug(email.kind),
    email.to,
    emailVariables(email),
    { person: { kind: ACCOUNT_PRINCIPAL, id: email.accountId } }
  );
  if (!sent.success) throw new Error(`The ${email.kind} email did not send.`);
  await recordEmailSent(ctx.db, ctx.dialect, attempt.jobId, attempt.now);
}

/** How long a send is remembered: a week, long past any retry of its job. */
const SENT_KEPT_MS = 7 * 24 * 60 * 60 * 1000;

/** One pass of every sweep the plugin's tables need. */
export async function sweepAll(
  deps: Pick<FlowDeps, "db" | "settings" | "now" | "events" | "principals">,
  now: Date
): Promise<void> {
  await sweepSessions(deps.db, now);
  await sweepKnownBrowsers(deps.db, now, deps.settings.knownBrowsers.days);
  await sweepPendingChanges(deps.db, now);
  await sweepSentEmails(deps.db, new Date(now.getTime() - SENT_KEPT_MS));
  await sweepUnverifiedAccounts({ ...deps, now: () => now });
}
