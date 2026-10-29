import {
  definePlugin,
  type PluginContext,
  type PluginDefinition,
} from "@nextlyhq/plugin-sdk";

import { version as PLUGIN_VERSION } from "../package.json";

import { ADMIN_PAGES, adminPageHref } from "./admin-contract";
import {
  assertLimitsShared,
  readAccountPrincipals,
  readAccountsCore,
} from "./core/adapter";
import { accountsLimitRules } from "./core/limit-rules";
import type { AccountsCore } from "./core/ports";
import { accountsError } from "./errors";
import { ACCOUNTS_EVENTS } from "./flows/deps";
import { primedPasswordPacer, type PasswordPacer } from "./flows/pacer";
import { reportEveryAccountDeleted } from "./flows/uninstall";
import { accountKind } from "./http/principal";
import { accountsRoutes } from "./http/routes";
import {
  READ_ACCOUNTS,
  STAFF_AUDIT,
  STAFF_PERMISSIONS,
  staffRoutes,
} from "./http/staff";
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
import {
  accountPrincipals,
  flowDepsFor,
  sendQueuedEmail,
  sweepAll,
} from "./wiring/runtime";

/**
 * Site accounts for a Nextly site: its own tables, its email templates,
 * the events it emits, the jobs that send its email and sweep its tables,
 * and its settings checked before anything starts.
 *
 * @experimental
 * @throws `ACCOUNTS_INVALID_OPTIONS` for an option outside its bounds
 * @throws at start, `ACCOUNTS_CORE_MISSING` on a core that does not lend
 *   every helper the plugin is built on, and in production
 *   `ACCOUNTS_LIMITS_NOT_SHARED` on limit counts each instance keeps apart
 */
export function accounts(options: AccountsOptions): PluginDefinition {
  return buildAccounts(options, readAccountsCore);
}

/**
 * The plugin, with where it finds core's helpers given: on the plugin
 * context, as a site runs it, or stand-ins, as `./testing` builds it, which
 * also hands the plugin the view of its database the stand-ins watch.
 */
export function buildAccounts(
  options: AccountsOptions,
  coreFor: (ctx: PluginContext) => AccountsCore,
  /** How the started plugin reaches its database: its own `ctx.db`, or a view of it the stand-ins watch. */
  databaseFor: (ctx: PluginContext) => PluginContext["db"] = ctx => ctx.db,
  /** Whether the site runs in production, as core judges it. */
  production: () => boolean = () => process.env.NODE_ENV === "production"
): PluginDefinition {
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

  // One pacer for the started plugin, made with its first request's deps
  // and kept, so a refusal waits as long as the checks timed before it.
  let pacer: PasswordPacer | null = null;

  // A flow's deps for a request, built from the started plugin's context.
  const deps = () => {
    const ctx = started();
    const core = coreFor(ctx);
    pacer ??= primedPasswordPacer(core.passwords);

    return flowDepsFor(ctx, settings, core, pacer, databaseFor(ctx));
  };

  return definePlugin({
    name: PLUGIN_NAME,
    version: PLUGIN_VERSION,
    // Every package versions in lockstep, so a core at least as new as this
    // build carries every API it calls.
    nextly: `>=${PLUGIN_VERSION}`,
    schemaVersion: SCHEMA_VERSION,
    contributes: {
      schema: accountsSchema,
      // The limit rules every flow reserves on, from the site's settings;
      // core checks each against its bounds at start.
      limits: accountsLimitRules(settings),
      principals: [accountKind(deps)],
      routes: [...accountsRoutes(deps), ...staffRoutes(deps)],
      permissions: STAFF_PERMISSIONS,
      audit: STAFF_AUDIT,
      // The typed server functions, for other plugins; a site's own server
      // code reaches the same through `accountsServer`.
      services: { [ACCOUNTS_SERVICE]: () => accountsService(deps) },
      // The list of accounts and an account's page, both behind
      // read-accounts; what staff may do there is the routes' to decide.
      admin: {
        menu: [
          {
            label: "Accounts",
            to: adminPageHref("list"),
            icon: "Contact",
            requiredPermission: READ_ACCOUNTS,
          },
        ],
        pages: [ADMIN_PAGES.list, ADMIN_PAGES.account].map(page => ({
          ...page,
          requiredPermission: READ_ACCOUNTS,
        })),
      },
      emailTemplates: accountsEmailTemplates(),
      events: ACCOUNTS_EVENTS.map(name => ({ name })),
      jobs: [
        sendEmailJob((email, attempt) =>
          sendQueuedEmail(started(), email, attempt)
        ),
        sweepJob(now => sweepAll({ ...deps(), now: () => now }, now)),
      ],
    },
    init: ctx => {
      // Refuses to start, before any route or job can run, on a core that
      // does not lend every helper the plugin is built on, and in
      // production on limit counts each instance keeps apart, which would
      // multiply every limit by the number of instances.
      const core = coreFor(ctx);
      readAccountPrincipals(ctx);
      assertLimitsShared(core.limits, production());
      context = ctx;
      rememberInstalled(deps);
    },
    destroy: () => {
      forgetInstalled(deps);
      context = null;
      pacer = null;
    },
    // An uninstall that drops the plugin's tables deletes every account:
    // each is reported to core first, while the tables are still readable,
    // so none stays named in the audit trail. Kept data deletes nothing.
    onUninstall: async (ctx, { keepData }) => {
      if (keepData) return;
      await reportEveryAccountDeleted({
        db: databaseFor(ctx),
        events: {
          emit: (name, payload) => ctx.events.emit(name, payload),
        },
        principals: accountPrincipals(ctx),
      });
    },
  });
}
