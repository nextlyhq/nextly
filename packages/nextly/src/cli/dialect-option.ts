/**
 * `--dialect`, for a command that reads no database (`migrate:check`, `migrate:create`): the
 * database its migrations are for, where neither the migration history nor the environment says
 * (`projectDialect`).
 *
 * @module cli/dialect-option
 */
import { Option } from "commander";

import type { SupportedDialect } from "./utils/adapter";

/** The dialects, as `--dialect` and `DB_DIALECT` spell them. Kept here, light, for the help. */
export const DIALECTS: readonly SupportedDialect[] = [
  "postgresql",
  "mysql",
  "sqlite",
];

/** The option, its values limited to the dialects Nextly runs on. */
export function dialectOption(): Option {
  return new Option(
    "--dialect <dialect>",
    "The database the migrations are for, where no migration file names it and neither DB_DIALECT nor DATABASE_URL is set"
  ).choices(DIALECTS);
}
