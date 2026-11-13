/**
 * A code-first project's first migration, written from its own config by the
 * `nextly migrate:create` the install brought.
 *
 * The build a template gives runs `nextly migrate`, which applies the files in
 * the folder the config reads and creates nothing else. A code-first blog's
 * schema is its config, the plugins it registers included, so its first
 * migration is generated from that config for the database the project was
 * scaffolded for, rather than copied from SQL written by hand for the visual
 * blog. The command needs the installed `nextly` and the project's `.env`, so
 * it runs after both.
 *
 * @module installers/initial-migration
 */
import { execa } from "execa";

import type { PackageManager, ProjectApproach, ProjectType } from "../types";
import { binaryRunner } from "../utils/package-manager-commands";

/** The arguments to `nextly` that write the first migration. */
const MIGRATE_CREATE_ARGS = ["migrate:create", "initial"] as const;

/**
 * Whether a new project gets its first migration written from its config: a
 * fresh project whose template has a code-first approach. A visual project
 * runs the template's own migration, and a template without approaches
 * (blank, plugin) declares nothing to migrate.
 */
export function writesInitialMigration(project: {
  isFreshProject: boolean;
  projectType: ProjectType;
  approach: ProjectApproach | undefined;
}): boolean {
  return (
    project.isFreshProject &&
    project.projectType !== "plugin" &&
    project.approach === "code-first"
  );
}

/** The command, as the person runs it in the project with `packageManager`. */
export function initialMigrationCommand(
  packageManager: PackageManager
): string {
  return [binaryRunner(packageManager), "nextly", ...MIGRATE_CREATE_ARGS].join(
    " "
  );
}

/**
 * Runs `nextly migrate:create initial` in `projectDir`. Resolves undefined
 * once it has written the migration, or with what went wrong, so the caller
 * can name the command to run by hand rather than stop a scaffold that is
 * otherwise whole.
 *
 * The shell's `DATABASE_URL`, `DB_DIALECT` and `NODE_ENV` are left out, so the
 * migration is written for the database the project's `.env` names, not one a
 * variable in the person's shell happens to name. Nothing is read from stdin:
 * a first migration has no rename to ask about.
 */
export async function writeInitialMigration(
  projectDir: string,
  packageManager: PackageManager
): Promise<string | undefined> {
  const [file, ...runnerArgs] = binaryRunner(packageManager).split(" ");
  try {
    await execa(file, [...runnerArgs, "nextly", ...MIGRATE_CREATE_ARGS], {
      cwd: projectDir,
      env: {
        DATABASE_URL: undefined,
        DB_DIALECT: undefined,
        NODE_ENV: undefined,
      },
      stdin: "ignore",
    });
    return undefined;
  } catch (error) {
    const said = (error as { stderr?: unknown }).stderr;
    return typeof said === "string" && said.trim().length > 0
      ? said.trim()
      : (error as Error).message;
  }
}
