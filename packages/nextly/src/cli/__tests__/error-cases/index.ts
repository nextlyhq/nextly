/**
 * Every code's case, one per code: the type check fails when a code has none.
 *
 * @module cli/__tests__/error-cases
 */
import type { CliErrorCode } from "../../errors";

import { COMMAND_CASES } from "./commands";
import { CONFIG_CASES } from "./config";
import { DATABASE_CASES } from "./database";
import { GENERAL_CASES } from "./general";
import { MIGRATE_CREATE_CASES } from "./migrate-create";
import { MIGRATION_CASES } from "./migrations";
import { PLUGIN_CONFIG_CASES } from "./plugin-config";
import { PLUGIN_CASES } from "./plugins";
import { SCHEMA_CASES } from "./schema";
import { SYNC_CASES } from "./sync";
import { UPGRADE_CASES } from "./upgrade";
import type { ErrorCase } from "./types";

export const ERROR_CASES = {
  ...CONFIG_CASES,
  ...DATABASE_CASES,
  ...MIGRATION_CASES,
  ...MIGRATE_CREATE_CASES,
  ...SCHEMA_CASES,
  ...SYNC_CASES,
  ...PLUGIN_CASES,
  ...PLUGIN_CONFIG_CASES,
  ...UPGRADE_CASES,
  ...COMMAND_CASES,
  ...GENERAL_CASES,
} satisfies Record<CliErrorCode, ErrorCase>;

export { PROJECT } from "./types";
