/**
 * The errors a `nextly` command ends with: one shape, one code per cause, one docs page per code.
 *
 * @module cli/errors
 */

export { CliError } from "./cli-error";
export { configDeclarationError } from "./areas/config";
export { databaseEnvError } from "./areas/database";
export { dataLossRefusal } from "./areas/migrations";
export { toCliError } from "./from-thrown";
export { formatCliError } from "./render";
export {
  exitAfterJsonError,
  exitWithError,
  failWithError,
  printCliError,
  reportCliError,
} from "./report";
export { CLI_ERROR_CODES, cliErrorSlug, type CliErrorCode } from "./registry";
