/**
 * Every code a `nextly` command can end with.
 *
 * The codes are a published surface of their own, apart from the HTTP error codes the REST API
 * returns: scripts, CI logs and agents match on them, and each has a docs page. So each code has
 * one cause and keeps it once released (`released-codes.json`), and a new code is added in its
 * area's file under `areas/`.
 *
 * @module cli/errors/registry
 */

import { COMMAND_CODES } from "./areas/commands";
import { CONFIG_CODES } from "./areas/config";
import { DATABASE_CODES } from "./areas/database";
import { GENERAL_CODES } from "./areas/general";
import { MIGRATION_CODES } from "./areas/migrations";
import { PLUGIN_CODES } from "./areas/plugins";
import { SCHEMA_CODES } from "./areas/schema";
import { SYNC_CODES } from "./areas/sync";
import { UPGRADE_CODES } from "./areas/upgrade";
import type { CliCodeDefinition } from "./define";

/** Each area's codes. A code is declared in one area only: the registry test holds them apart. */
export const CLI_ERROR_AREAS = [
  CONFIG_CODES,
  DATABASE_CODES,
  MIGRATION_CODES,
  SCHEMA_CODES,
  SYNC_CODES,
  PLUGIN_CODES,
  UPGRADE_CODES,
  COMMAND_CODES,
  GENERAL_CODES,
] as const;

export const CLI_ERROR_CODES = {
  ...CONFIG_CODES,
  ...DATABASE_CODES,
  ...MIGRATION_CODES,
  ...SCHEMA_CODES,
  ...SYNC_CODES,
  ...PLUGIN_CODES,
  ...UPGRADE_CODES,
  ...COMMAND_CODES,
  ...GENERAL_CODES,
} as const satisfies Record<string, CliCodeDefinition>;

export type CliErrorCode = keyof typeof CLI_ERROR_CODES;

/** Where the CLI's error pages are published; one page per code. */
export const CLI_ERROR_DOCS_BASE = "https://nextlyhq.com/docs/cli/errors/";

/** A code's docs page name: `CONFIG_NOT_FOUND` is `config-not-found`. */
export function cliErrorSlug(code: CliErrorCode): string {
  return code.toLowerCase().replace(/_/g, "-");
}

/** The link the error's Docs line prints. */
export function cliErrorDocsUrl(code: CliErrorCode): string {
  return `${CLI_ERROR_DOCS_BASE}${cliErrorSlug(code)}`;
}
