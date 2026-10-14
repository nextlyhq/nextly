import type { PluginContext } from "@nextlyhq/plugin-sdk";

import type { AccountsCore } from "../core/ports";
import type { FlowDeps } from "../flows/deps";
import type { AccountsEmail } from "../flows/mail";
import type { PasswordPacer } from "../flows/pacer";
import { sweepUnverifiedAccounts } from "../flows/sweep-unverified";
import type { AccountsSettings } from "../settings";
import { sweepKnownBrowsers } from "../storage/known-browsers";
import { sweepPendingChanges } from "../storage/pending-changes";
import { sweepSessions } from "../storage/sessions";

import { emailVariables, templateSlug } from "./emails";
import { SEND_EMAIL_JOB } from "./jobs";

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
    pacer,
    logger: { warn: (message, context) => ctx.logger.warn(message, context) },
    now: () => new Date(),
  };
}

/** Sends a queued email through core's email service, with its kind's template; throws when it did not go. */
export async function sendQueuedEmail(
  ctx: PluginContext,
  email: AccountsEmail
): Promise<void> {
  const sent = await ctx.services.email.sendWithTemplate(
    templateSlug(email.kind),
    email.to,
    emailVariables(email)
  );
  if (!sent.success) throw new Error(`The ${email.kind} email did not send.`);
}

/** One pass of every sweep the plugin's tables need. */
export async function sweepAll(
  deps: Pick<FlowDeps, "db" | "settings" | "now" | "events">,
  now: Date
): Promise<void> {
  await sweepSessions(deps.db, now);
  await sweepKnownBrowsers(deps.db, now, deps.settings.knownBrowsers.days);
  await sweepPendingChanges(deps.db, now);
  await sweepUnverifiedAccounts({ ...deps, now: () => now });
}
