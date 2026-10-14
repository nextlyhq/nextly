import { definePlugin, type PluginContext } from "@nextlyhq/plugin-sdk";

import { version as PLUGIN_VERSION } from "../package.json";

import { readAccountsCore } from "./core/adapter";
import type { AccountsCore } from "./core/ports";
import { accountsError } from "./errors";
import { ACCOUNTS_EVENTS } from "./flows/deps";
import { accountKind } from "./http/principal";
import { accountsRoutes } from "./http/routes";
import { accountsSchema, PLUGIN_NAME } from "./schema/definition";
import { SCHEMA_VERSION } from "./schema/tables";
import {
  ACCOUNTS_SERVICE,
  forgetInstalled,
  rememberInstalled,
} from "./server/installed";
import { accountsService } from "./server/service";
import { resolveAccountsSettings, type AccountsOptions } from "./settings";
import { accountsEmailTemplates } from "./wiring/emails";
import { sendEmailJob, sweepJob } from "./wiring/jobs";
import { flowDepsFor, sendQueuedEmail, sweepAll } from "./wiring/runtime";

/**
 * Site accounts for a Nextly site: its own tables, its email templates,
 * the events it emits, the jobs that send its email and sweep its tables,
 * and its settings checked before anything starts.
 *
 * @experimental
 * @throws `ACCOUNTS_INVALID_OPTIONS` for an option outside its bounds
 */
export function accounts(options: AccountsOptions) {
  return buildAccounts(options, readAccountsCore);
}

/**
 * The plugin, with where it finds core's helpers given: on the plugin
 * context, as a site runs it, or stand-ins, as `./testing` builds it.
 */
export function buildAccounts(
  options: AccountsOptions,
  coreFor: (ctx: PluginContext) => AccountsCore
) {
  // Checked when the site's configuration is read, so a site never boots on
  // a number it did not choose.
  const settings = resolveAccountsSettings(options);

  // The plugin's context, captured when it starts: a job runs outside any
  // request and reaches the plugin's database and core's services through it.
  let context: PluginContext | null = null;
  const started = (): PluginContext => {
    if (context === null) throw accountsError("ACCOUNTS_NOT_STARTED");
    return context;
  };

  // A flow's deps for a request, built from the started plugin's context.
  const deps = () => flowDepsFor(started(), settings, coreFor(started()));

  return definePlugin({
    name: PLUGIN_NAME,
    version: PLUGIN_VERSION,
    // Every package versions in lockstep, so a core at least as new as this
    // build carries every API it calls.
    nextly: `>=${PLUGIN_VERSION}`,
    schemaVersion: SCHEMA_VERSION,
    contributes: {
      schema: accountsSchema,
      principals: [accountKind(deps)],
      routes: accountsRoutes(deps),
      // The typed server functions, for other plugins; a site's own server
      // code reaches the same through `accountsServer`.
      services: { [ACCOUNTS_SERVICE]: () => accountsService(deps) },
      emailTemplates: accountsEmailTemplates(),
      events: ACCOUNTS_EVENTS.map(name => ({ name })),
      jobs: [
        sendEmailJob(email => sendQueuedEmail(started(), email)),
        sweepJob(now =>
          sweepAll({ db: started().db, settings, now: () => now }, now)
        ),
      ],
    },
    init: ctx => {
      context = ctx;
      rememberInstalled(deps);
    },
    destroy: () => {
      forgetInstalled(deps);
      context = null;
    },
  });
}
