import { definePlugin } from "@nextlyhq/plugin-sdk";

import { version as PLUGIN_VERSION } from "../package.json";

import { accountsSchema, PLUGIN_NAME } from "./schema/definition";
import { SCHEMA_VERSION } from "./schema/tables";
import { resolveAccountsSettings, type AccountsOptions } from "./settings";

/**
 * Site accounts for a Nextly site: its own tables, and its settings checked
 * before anything starts.
 *
 * @experimental
 * @throws `ACCOUNTS_INVALID_OPTIONS` for an option outside its bounds
 */
export function accounts(options: AccountsOptions) {
  // Checked when the site's configuration is read, so a site never boots on
  // a number it did not choose.
  resolveAccountsSettings(options);

  return definePlugin({
    name: PLUGIN_NAME,
    version: PLUGIN_VERSION,
    // Every package versions in lockstep, so a core at least as new as this
    // build carries every API it calls.
    nextly: `>=${PLUGIN_VERSION}`,
    schemaVersion: SCHEMA_VERSION,
    contributes: { schema: accountsSchema },
  });
}
