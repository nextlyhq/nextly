import { getCachedNextly, type PluginContext } from "@nextlyhq/plugin-sdk";

import { accountsError } from "../errors";
import type { FlowDeps } from "../flows/deps";
import { PLUGIN_NAME } from "../schema/definition";

import type { AccountsServer } from "./contract";
import { accountsService } from "./service";

/** The key the plugin registers its server functions under, in `contributes.services`. */
export const ACCOUNTS_SERVICE = "accounts";

/** The started plugin's deps, as it records them for server code. */
type InstalledDeps = () => FlowDeps;

/**
 * Where the started plugin keeps its deps for `accountsServer`.
 *
 * On `globalThis` under a registered symbol, as core keeps its own booted
 * instance, rather than in a module variable: a Next.js build can load this
 * package more than once, in separate server bundles, and a module variable
 * set in one copy is empty in the others. The booted instance core hands
 * server code types no plugin namespace, so this is how a site's own server
 * code reaches the plugin's functions.
 */
const INSTALLED = Symbol.for("@nextlyhq/plugin-accounts/installed");
const holder = globalThis as typeof globalThis & {
  [INSTALLED]?: InstalledDeps;
};

/** Record the started plugin's deps. Called from `init`. */
export function rememberInstalled(deps: InstalledDeps): void {
  holder[INSTALLED] = deps;
}

/**
 * Forget the deps a stopped plugin recorded, so `accountsServer` refuses
 * rather than answering over a closed database. Only those deps are
 * forgotten: a newer boot that recorded its own before this one's teardown
 * ran keeps them.
 */
export function forgetInstalled(deps: InstalledDeps): void {
  if (holder[INSTALLED] === deps) delete holder[INSTALLED];
}

/**
 * The plugin's server functions, for a site's own server code: a server
 * action, a route handler, a server component. Waits for Nextly to finish
 * starting first, so a call made while the boot migrations run answers once
 * they have.
 *
 * @experimental
 * @throws `ACCOUNTS_NOT_STARTED` when the plugin is not in the site's plugins
 */
export async function accountsServer(): Promise<AccountsServer> {
  await getCachedNextly();
  return fromInstalled();
}

/** The started plugin's functions, from the deps it recorded. */
export function fromInstalled(): AccountsServer {
  const deps = holder[INSTALLED];
  if (deps === undefined) throw accountsError("ACCOUNTS_NOT_STARTED");

  return accountsService(deps);
}

/**
 * The plugin's server functions, for another plugin, through its own
 * context.
 *
 * @experimental
 * @throws `ACCOUNTS_NOT_STARTED` when the accounts plugin is not installed
 */
export function accountsServices(ctx: PluginContext): AccountsServer {
  const service = ctx.services.plugins[PLUGIN_NAME]?.[ACCOUNTS_SERVICE];
  // The plugins' namespace is typed `unknown` per service, so what came back
  // is checked once here rather than cast at every call site.
  if (!isAccountsServer(service))
    throw accountsError("ACCOUNTS_NOT_STARTED", { service: ACCOUNTS_SERVICE });

  return service;
}

/**
 * The functions a caller is promised, checked by name. A record of every
 * key rather than a list, so the compiler refuses one that misses a
 * function the contract gains.
 */
const METHODS = Object.keys({
  signUp: true,
  verifyAddress: true,
  resendVerification: true,
  removeUnverifiedAccount: true,
  signIn: true,
  signOut: true,
  signOutEverywhere: true,
  requestPasswordReset: true,
  resetPassword: true,
  changePassword: true,
  changeAddress: true,
  confirmAddressChange: true,
  cancelAddressChange: true,
  deleteAccount: true,
  currentAccount: true,
  visitorFrom: true,
  checkOrigin: true,
  returnPath: true,
  signInPath: true,
  cookieWrite: true,
} satisfies Record<keyof AccountsServer, true>);

function isAccountsServer(value: unknown): value is AccountsServer {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;

  return METHODS.every(method => typeof record[method] === "function");
}
