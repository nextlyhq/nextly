import type { PluginContext } from "@nextlyhq/plugin-sdk";

import { readAccountPrincipals } from "../core/adapter";
import type { AccountsCore, OneTimeSecrets } from "../core/ports";
import type { AccountPrincipals, FlowDeps } from "../flows/deps";
import type { PasswordPacer } from "../flows/pacer";
import {
  carriesSecrets,
  fieldsFromSecrets,
  withoutSecrets,
} from "../flows/secret-fields";
import { sweepUnverifiedAccounts } from "../flows/sweep-unverified";
import { ACCOUNT_PRINCIPAL } from "../http/principal";
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
import {
  SEND_EMAIL_JOB,
  type QueuedAccountsEmail,
  type SendAttempt,
} from "./jobs";

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
      // The job holds the email without its secrets, each queued by the ref
      // core derives it again by at send time: the jobs table never holds a
      // live link or code, queued, sent or failed.
      queue: async email => {
        await ctx.services.jobs.queue({
          task: SEND_EMAIL_JOB,
          input: { email: withoutSecrets(email) },
        });
      },
    },
    events: { emit: (name, payload) => ctx.events.emit(name, payload) },
    principals: accountPrincipals(ctx),
    ...(ctx.audit === undefined ? {} : { audit: ctx.audit }),
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
 * What a send needs to put a queued email's secrets back: core's secrets,
 * which derive each again from its ref, the site's pages their links land
 * on, and where to say an email whose secret is gone was not sent.
 */
export interface SecretsAtSend {
  secrets: Pick<OneTimeSecrets, "reveal">;
  settings: Pick<AccountsSettings, "origin" | "pages">;
  logger: FlowDeps["logger"];
}

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
 *
 * Its secrets are derived again from their refs for this attempt alone,
 * and never leave it: an error that names one is thrown with it blanked
 * out, as the runner keeps the error on the job's row. An email whose
 * secret is spent, replaced or expired is not sent, since its link or code
 * would be refused; the job ends, and the log says which and why.
 */
export async function sendQueuedEmail(
  ctx: EmailContext,
  email: QueuedAccountsEmail,
  attempt: SendAttempt,
  atSend: SecretsAtSend
): Promise<void> {
  if (await emailSentBy(ctx.db, attempt.jobId)) return;
  const revealed = await revealSecrets(email, atSend);
  if (revealed === null) return;
  let sent: { success: boolean };
  try {
    // Names the account the email is to, so core erases the delivery
    // record with the account when it is reported deleted; an invitation
    // to an address with no account names nobody.
    sent = await ctx.services.email.sendWithTemplate(
      templateSlug(email.kind),
      email.to,
      emailVariables({ ...email, ...revealed.fields }),
      email.accountId === null
        ? undefined
        : { person: { kind: ACCOUNT_PRINCIPAL, id: email.accountId } }
    );
  } catch (error) {
    throw new Error(
      blankedOut(
        error instanceof Error ? error.message : String(error),
        revealed.secrets
      )
    );
  }
  if (!sent.success) throw new Error(`The ${email.kind} email did not send.`);
  await recordEmailSent(ctx.db, ctx.dialect, attempt.jobId, attempt.now);
}

/**
 * A queued email's secret fields, rebuilt from their refs, with the
 * secrets themselves; null, logged, when one can no longer be used. An
 * email that carries no secret has none, and a row queued before secrets
 * were queued by ref still holds its own.
 */
async function revealSecrets(
  email: QueuedAccountsEmail,
  atSend: SecretsAtSend
): Promise<{ fields: Record<string, string>; secrets: string[] } | null> {
  if (!carriesSecrets(email.kind) || email.refs === undefined)
    return { fields: {}, secrets: [] };
  const secrets: Record<string, string> = {};
  for (const [field, ref] of Object.entries(email.refs)) {
    const revealed = await atSend.secrets.reveal({ ref });
    if (!revealed.ok) {
      atSend.logger.warn(
        "[accounts] a queued email was not sent: its secret can no longer be used",
        {
          kind: email.kind,
          accountId: email.accountId,
          field,
          reason: revealed.reason,
        }
      );
      return null;
    }
    secrets[field] = revealed.secret;
  }

  return {
    fields: fieldsFromSecrets(atSend.settings, email.kind, secrets),
    secrets: Object.values(secrets),
  };
}

/** The text with every secret in it blanked out. */
function blankedOut(text: string, secrets: readonly string[]): string {
  return secrets.reduce(
    (blanked, secret) => blanked.split(secret).join("[secret]"),
    text
  );
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
