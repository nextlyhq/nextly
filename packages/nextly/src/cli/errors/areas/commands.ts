/**
 * Codes for the project, admin and maintenance commands.
 *
 * Most are raised by the commands themselves, through the helpers below, so each refusal keeps
 * the wording its command printed before, split into what, why and next. The one mapping reads
 * the block manifest's read failure, thrown wherever the manifest is settled.
 *
 * @module cli/errors/areas/commands
 */

import { CliError } from "../cli-error";
import { defineCodes } from "../define";
import { deepestMessage } from "../messages";

/** `count` with its noun, as the commands print it: `1 error`, `2 errors`. */
function counted(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

export const COMMAND_CODES = defineCodes({
  PROJECT_ALREADY_INITIALIZED: {
    cause:
      "The folder already has a `nextly.config.ts`, so `nextly init` did not overwrite it.",
  },
  PACKAGE_INSTALL_FAILED: {
    cause:
      "The package manager could not install the package `nextly add` was given.",
  },
  BUILD_STRICT_WARNINGS: {
    cause:
      "`nextly build --strict` found validation warnings, and `--strict` fails the build on any warning.",
  },
  BUILD_GENERATION_FAILED: {
    cause: "The build could not generate its type or Zod schema files.",
  },
  BUILD_MIGRATIONS_NOT_APPLIED: {
    cause:
      "`nextly build --strict` found migrations the database has not applied, or that failed.",
  },
  CORE_TABLES_NOT_RECONCILED: {
    cause:
      "The database's existing core tables could not be brought up to date before the sync.",
  },
  DATABASE_CATALOG_UNREADABLE: {
    cause:
      "The database catalog could not be read, so the command could not tell which field-group registry table the database uses.",
  },
  CORE_TABLES_NOT_CREATED: {
    cause:
      "The command could not create the core tables on a database that has none.",
  },
  SCHEMA_SYNC_IN_PRODUCTION: {
    cause:
      "`NODE_ENV` is `production`, where schema changes are applied by migrations and never synced automatically.",
  },
  BLOCK_MANIFEST_STALE: {
    cause:
      "The committed block manifest does not match what the configuration generates.",
  },
  BLOCK_MANIFEST_UNREADABLE: {
    cause: "The block manifest exists but could not be read.",
    from: [
      {
        code: "INVALID_INPUT",
        reason: "block-manifest-unreadable",
        describe: error => {
          const path = error.logContext?.path;
          const detail = error.logContext?.detail;
          const file =
            typeof path === "string" ? path : "The block manifest's file";
          return {
            what: `The block manifest at ${file} could not be read.`,
            why:
              typeof detail === "string"
                ? detail
                : "The file system gave no reason.",
            next: "Check that the file can be read, or remove it and run `nextly generate:manifest` to write it again.",
          };
        },
      },
    ],
  },
  MEDIA_STORAGE_UNLISTABLE: {
    cause:
      "The media storage cannot list its files, so it cannot be searched for left-behind thumbnails.",
  },
  MEDIA_THUMBNAILS_NOT_REMOVED: {
    cause:
      "Some left-behind thumbnails could not be removed, or could not be checked just before their removal.",
  },
  MEDIA_CONFIG_OUTSIDE_PROJECT: {
    cause:
      "`nextly media orphans --apply` was given a configuration from outside the project, whose storage may be another project's.",
  },
  MEDIA_APPLY_OUTSIDE_PROJECT: {
    cause:
      "`nextly media orphans --apply` was run from outside the project `--cwd` names, so the database settings it read may be another project's.",
  },
  SETUP_IN_PROGRESS: {
    cause:
      "Another setup holds this install's setup claim, so the command changed nothing.",
  },
  SETUP_ALREADY_COMPLETE: {
    cause:
      "This install already has an administrator, so setup is complete and the command changed nothing.",
  },
  SETUP_TOKEN_SET_BY_ENV: {
    cause:
      "`NEXTLY_SETUP_TOKEN` sets this install's setup token, so there is no generated one to replace.",
  },
  ADMIN_EMAIL_INVALID: {
    cause:
      "`nextly users:create-admin` was given no email, or one that is not an email address.",
  },
  ADMIN_NAME_MISSING: {
    cause:
      "`nextly users:create-admin` was given no name for the administrator.",
  },
  ADMIN_PASSWORDS_DIFFER: {
    cause: "The two passwords typed at the prompt differ.",
  },
  ADMIN_PASSWORD_MISSING: {
    cause:
      "No password was given: `NEXTLY_ADMIN_PASSWORD` is not set and none was typed at a prompt.",
  },
  ADMIN_PASSWORD_TOO_WEAK: {
    cause:
      "The administrator's password does not meet the install's password rules.",
  },
  ADMIN_EMAIL_IN_USE: {
    cause:
      "An account already uses the email given for the first administrator.",
  },
  PASSWORD_CLEAR_UNCONFIRMED: {
    cause:
      "`nextly users:clear-plaintext-passwords --apply` was run without `--confirm-default-hasher`.",
  },
});

// ── nextly init ─────────────────────────────────────────────────────────────

/** `nextly init` without `--force`, in a folder that already has a configuration. */
export function projectAlreadyInitialized(configPath: string): CliError {
  return new CliError("PROJECT_ALREADY_INITIALIZED", {
    what: "Nextly is already initialized in this directory.",
    why: `${configPath} already exists.`,
    next: "Use `--force` to overwrite the existing configuration.",
  });
}

// ── nextly add ──────────────────────────────────────────────────────────────

/** The package manager `nextly add` ran ended with a failing code. */
export function packageInstallFailed(
  packageManager: string,
  pkg: string,
  code: number
): CliError {
  return new CliError("PACKAGE_INSTALL_FAILED", {
    what: `Install failed (${packageManager} exited ${code}).`,
    why: `${packageManager} could not install \`${pkg}\`; its own output above says why.`,
    next: `Fix what ${packageManager} reports, then run \`nextly add ${pkg}\` again.`,
  });
}

// ── nextly build ────────────────────────────────────────────────────────────

/** A declaration the build's validators refused, at its place in the configuration. */
export interface BuildDeclarationIssue {
  /** The entity's slug, and the field's name when the issue is a field's. */
  location: string;
  message: string;
}

/** The build's validators refused declarations: the configuration's own code, one line each. */
export function buildDeclarationsInvalid(
  issues: readonly BuildDeclarationIssue[]
): CliError {
  return new CliError("CONFIG_INVALID", {
    what: `Validation failed with ${counted(issues.length, "error")}, so the build stopped.`,
    why: issues.map(issue => `${issue.location}: ${issue.message}`).join("\n"),
    next: "Fix each declaration listed in `nextly.config.ts`, then run `nextly build` again.",
  });
}

/** `--strict` turned the build's validation warnings into a failure. */
export function buildStrictWarnings(warnings: readonly string[]): CliError {
  return new CliError("BUILD_STRICT_WARNINGS", {
    what: `Build failed due to ${counted(warnings.length, "warning")} (--strict mode).`,
    why: warnings.join("\n"),
    next: "Fix each warning listed, or run `nextly build` without `--strict` to let warnings pass.",
  });
}

/** Writing the generated files failed. */
export function buildGenerationFailed(error: unknown): CliError {
  return new CliError(
    "BUILD_GENERATION_FAILED",
    {
      what: "File generation failed, so the build stopped.",
      why: deepestMessage(error) ?? "The error carried no message.",
      next: "Check that the output folders in `nextly.config.ts` can be written to, then run `nextly build` again; `--verbose` shows where it failed.",
    },
    error instanceof Error ? error : undefined
  );
}

/** `--strict` turned migrations the database has not applied into a failure. */
export function buildMigrationsNotApplied(status: {
  pendingMigrations: readonly string[];
  failedMigrations: readonly string[];
}): CliError {
  const issues: string[] = [];
  const why: string[] = [];
  if (status.pendingMigrations.length > 0) {
    issues.push(`${status.pendingMigrations.length} pending migration(s)`);
    why.push(`Pending: ${status.pendingMigrations.join(", ")}`);
  }
  if (status.failedMigrations.length > 0) {
    issues.push(`${status.failedMigrations.length} failed migration(s)`);
    why.push(`Failed: ${status.failedMigrations.join(", ")}`);
  }
  return new CliError("BUILD_MIGRATIONS_NOT_APPLIED", {
    what: `Migration issues: ${issues.join(", ")}.`,
    why: why.join("\n"),
    next: "Run `nextly migrate` to apply pending migrations.",
  });
}

/**
 * The build's failure, as the first step that failed reports it. A later failure in the same
 * run, which only `--strict` warnings can be beside invalid declarations, adds what it says and
 * its reasons to the Why line, so the run's every reason is printed once.
 */
export function buildFailed(failures: readonly CliError[]): CliError {
  const [first, ...rest] = failures;
  if (first === undefined) {
    return new CliError("UNEXPECTED_ERROR", {
      what: "The build failed without saying why.",
      why: "No step reported the failure.",
      next: "Run it again with `--verbose` to see the details, and report it at https://github.com/nextlyhq/nextly/issues if it keeps happening.",
    });
  }
  if (rest.length === 0) return first;
  return new CliError(
    first.code,
    {
      what: first.what,
      // A later failure brings its own lines, such as the warnings `--strict` failed on, which
      // nothing else prints under `--strict`; and its next step, where it has another.
      why: [
        first.why,
        ...rest.flatMap(failure => [failure.what, failure.why]),
      ].join("\n"),
      next: [
        ...new Set([first.next, ...rest.map(failure => failure.next)]),
      ].join("\n"),
    },
    first
  );
}

// ── db:sync's core tables ───────────────────────────────────────────────────

/** The existing database's system tables could not be repaired before the sync. */
export function coreTablesNotReconciled(): CliError {
  return new CliError("CORE_TABLES_NOT_RECONCILED", {
    what: "Core tables could not be reconciled.",
    why: "Creating the system tables this version of Nextly adds failed on the existing database; `--verbose` shows the statement that failed.",
    next: "Run `nextly migrate` to repair the schema before syncing.",
  });
}

/** The catalog read that names the field-group registry failed, so nothing was created. */
export function databaseCatalogUnreadable(): CliError {
  return new CliError("DATABASE_CATALOG_UNREADABLE", {
    what: "Could not read the database catalog, so core tables were not created.",
    why: "The catalog says which field-group registry this database uses, and creating the tables without it would leave a database that cannot repair itself.",
    next: "Re-run once the database is reachable; `--verbose` shows why the catalog could not be read.",
  });
}

/** The schema push that creates the core tables on an empty database failed. */
export function coreTablesNotCreated(error: unknown): CliError {
  return new CliError(
    "CORE_TABLES_NOT_CREATED",
    {
      what: "Core tables not found, and they could not be created.",
      why: `The schema push that creates them failed: ${deepestMessage(error) ?? "it gave no reason."}`,
      next: "Run `nextly migrate` first to create the database schema.",
    },
    error instanceof Error ? error : undefined
  );
}

/** The sync refuses to change the schema in production, naming what it would have changed. */
export function schemaSyncInProduction(pending: readonly string[]): CliError {
  return new CliError("SCHEMA_SYNC_IN_PRODUCTION", {
    what: "Cannot auto-sync schema in production mode.",
    why: `\`NODE_ENV\` is \`production\`, and ${counted(pending.length, "collection")} would change: ${pending.join(", ")}.`,
    next: 'Run `nextly migrate:create --name="<migration-name>"` to create migrations, then `nextly migrate` to apply.',
  });
}

// ── nextly generate:manifest ────────────────────────────────────────────────

/** `--check` found the committed manifest out of date; `drift` says how. */
export function blockManifestStale(drift: string): CliError {
  return new CliError("BLOCK_MANIFEST_STALE", {
    what: "The committed block manifest does not match this config.",
    why: drift,
    next: "Run `nextly generate:manifest` and commit the result.",
  });
}

// ── nextly media orphans ────────────────────────────────────────────────────

/** The media storage's adapter cannot list what it holds. */
export function mediaStorageUnlistable(storageType: string): CliError {
  return new CliError("MEDIA_STORAGE_UNLISTABLE", {
    what: `The media storage (${storageType}) cannot list its files, so it cannot be searched for left-behind thumbnails.`,
    why: `The ${storageType} storage adapter offers no listing of the files it holds. Nothing was changed.`,
    next: "Remove left-behind thumbnails with the storage provider's own tools, or use a storage plugin that can list its files.",
  });
}

/** `--apply` left some listed thumbnails in place; `lines` names each, as the command says it. */
export function mediaThumbnailsNotRemoved(
  count: number,
  lines: readonly string[]
): CliError {
  return new CliError("MEDIA_THUMBNAILS_NOT_REMOVED", {
    what: `${count} left-behind thumbnail(s) were not removed.`,
    why: lines.join("\n"),
    next: "Run `nextly media orphans --apply` again to list and remove what is left.",
  });
}

/** `--apply` with a configuration from outside the project `--cwd` names. */
export function mediaConfigOutsideProject(
  configPath: string,
  cwd: string
): CliError {
  return new CliError("MEDIA_CONFIG_OUTSIDE_PROJECT", {
    what: `Nothing was changed: the config ${configPath} is outside ${cwd}.`,
    why: `${cwd}'s database settings would be read, so the config's storage may be another project's.`,
    next: "Run the command from that config's project to remove files.",
  });
}

/** `--apply` from another folder than the one `--cwd` names. */
export function mediaApplyOutsideProject(cwd: string): CliError {
  return new CliError("MEDIA_APPLY_OUTSIDE_PROJECT", {
    what: `Nothing was changed: --apply was run from outside ${cwd}.`,
    why: `The database settings were read before --cwd named ${cwd}, so they may be another project's.`,
    next: `Run the command from ${cwd} to remove files.`,
  });
}

// ── nextly setup-token and nextly users:create-admin ───────────────────────

/** The two commands that change setup, by what each would have changed. */
export type SetupCommand = "setup-token" | "users:create-admin";

const ONE_SETUP =
  "One setup runs at a time, and another setup, from the web or this command, holds this install's setup claim.";

/** Another setup holds the claim. */
export function setupInProgress(command: SetupCommand): CliError {
  return command === "setup-token"
    ? new CliError("SETUP_IN_PROGRESS", {
        what: "A setup is in progress on this install, so the token was not replaced.",
        why: ONE_SETUP,
        next: "Run `nextly setup-token` again in a moment.",
      })
    : new CliError("SETUP_IN_PROGRESS", {
        what: "Another setup is in progress for this install, so nothing was created.",
        why: ONE_SETUP,
        next: "Try again once it ends: run `nextly users:create-admin` again.",
      });
}

/** The install has an administrator, so setup is over. */
export function setupAlreadyComplete(command: SetupCommand): CliError {
  return command === "setup-token"
    ? new CliError("SETUP_ALREADY_COMPLETE", {
        what: "This install already has an administrator: setup is complete, and no token is needed.",
        why: "A setup token only opens setup, which ends once an administrator exists.",
        next: "Sign in as an administrator; nothing else asks for a setup token.",
      })
    : new CliError("SETUP_ALREADY_COMPLETE", {
        what: "Setup is already complete: this install has an administrator. Nothing was created.",
        why: "Only the first administrator is created here, and this install has one.",
        next: "Sign in as that administrator, and add other accounts from the admin.",
      });
}

/** The operator's variable sets the token, so there is no stored one to replace. */
export function setupTokenSetByEnv(variable: string): CliError {
  return new CliError("SETUP_TOKEN_SET_BY_ENV", {
    what: `${variable} sets this install's token, so there is no generated one to replace.`,
    why: `A token set by ${variable} is read from the environment, not stored in the install's database.`,
    next: "Change the variable where it is set.",
  });
}

// ── nextly users:create-admin ───────────────────────────────────────────────

/** No email, or one that is not an email address. */
export function adminEmailInvalid(given: string | null): CliError {
  return new CliError("ADMIN_EMAIL_INVALID", {
    what: "No valid email was given for the administrator.",
    why:
      given === null
        ? "No email was given with `--email` or at the prompt."
        : `\`${given}\` is not an email address.`,
    next: "Give a valid email with `--email`.",
  });
}

/** No name. */
export function adminNameMissing(): CliError {
  return new CliError("ADMIN_NAME_MISSING", {
    what: "No name was given for the administrator.",
    why: "No name was given with `--name` or at the prompt.",
    next: "Give the administrator's name with `--name`.",
  });
}

/** The prompt's two answers differ. */
export function adminPasswordsDiffer(): CliError {
  return new CliError("ADMIN_PASSWORDS_DIFFER", {
    what: "The two passwords differ, so nothing was created.",
    why: "The password is asked for twice, and the two answers must match.",
    next: "Run `nextly users:create-admin` again and type the same password both times.",
  });
}

/** No password from the environment or a prompt. */
export function adminPasswordMissing(variable: string): CliError {
  return new CliError("ADMIN_PASSWORD_MISSING", {
    what: "No password was given for the administrator.",
    why: `${variable} is not set, and no password was typed at a prompt. The password is never taken from an argument.`,
    next: `Set ${variable}, or run this in a terminal to be asked.`,
  });
}

/** The password breaks the install's rules; `rules` names each one broken. */
export function adminPasswordTooWeak(rules: readonly string[]): CliError {
  return new CliError("ADMIN_PASSWORD_TOO_WEAK", {
    what: "That password is too weak, so nothing was created.",
    why: rules.join("\n"),
    next: "Choose a password that meets each rule listed, then run `nextly users:create-admin` again.",
  });
}

/** The email belongs to an account already. */
export function adminEmailInUse(): CliError {
  return new CliError("ADMIN_EMAIL_IN_USE", {
    what: "An account already uses that email. Nothing was created.",
    why: "That account would be given the administrator role and keep its own password, so the password given would be ignored.",
    next: "Choose another email.",
  });
}

// ── nextly users:clear-plaintext-passwords ──────────────────────────────────

/** `--apply` without the operator's statement about the hasher. */
export function passwordClearUnconfirmed(
  confirmFlag: string,
  command: string
): CliError {
  return new CliError("PASSWORD_CLEAR_UNCONFIRMED", {
    what: `Nothing was changed: --apply also needs ${confirmFlag}.`,
    why: `${confirmFlag} is your statement that no stored password was written by a custom passwordHasher, now or earlier. A custom hasher's hashes can look like plain text here, and clearing them locks those people out.`,
    next: `If no custom passwordHasher ever wrote a password, run \`nextly ${command} --apply ${confirmFlag}\`.`,
  });
}
