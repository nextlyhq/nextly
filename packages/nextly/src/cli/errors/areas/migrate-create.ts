/**
 * Codes `nextly migrate:create` raises itself.
 *
 * @module cli/errors/areas/migrate-create
 */

import { CliError } from "../cli-error";
import { defineCodes } from "../define";

export const MIGRATE_CREATE_CODES = defineCodes({
  MIGRATION_NAME_REQUIRED: {
    cause:
      "`nextly migrate:create` was given no name for a migration that is not blank.",
  },
  MIGRATION_CREATE_CANCELLED: {
    cause:
      "A prompt of `nextly migrate:create` was cancelled, so it wrote no migration.",
  },
});

/** A migration that is not `--blank` needs a name, positional or `--name`. */
export function migrationNameRequired(): CliError {
  return new CliError("MIGRATION_NAME_REQUIRED", {
    what: "`nextly migrate:create` needs a name for the migration.",
    why: "Only a `--blank` migration may be created without a name.",
    next: "Name it, as in `nextly migrate:create add_excerpt` or `--name=add_excerpt`, or pass `--blank` for an empty migration.",
  });
}

/** The operator closed a prompt; the prompt printed its own cancel line first. */
export function migrationCreateCancelled(): CliError {
  return new CliError("MIGRATION_CREATE_CANCELLED", {
    what: "`nextly migrate:create` was cancelled, and wrote no migration.",
    why: "A prompt was closed before it was answered.",
    next: "Run `nextly migrate:create` again when you are ready to answer its prompts.",
  });
}
