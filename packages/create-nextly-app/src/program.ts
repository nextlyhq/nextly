import * as telemetry from "@nextlyhq/telemetry";
import { Command } from "commander";

import {
  resolveProjectArg,
  validateProjectName,
  validateTemplateName,
} from "./cli-args";
import { createNextly as runCreateNextly } from "./create-nextly";
import {
  APPROACHES,
  DATABASES,
  PACKAGE_MANAGERS,
  connectionMismatch,
} from "./lib/choices";
import { redactConnection, redactUrlsIn } from "./lib/connection-string";
import { packageVersion } from "./lib/package-version";
import { invalidChoiceMessage } from "./lib/suggest";
import { getAvailableTemplateNames } from "./lib/templates";
import type {
  CreateNextlyOptions,
  DatabaseType,
  PackageManager,
  ProjectApproach,
  ProjectType,
} from "./types";

/** What the program runs against; tests replace the standard input. */
export interface ProgramDeps {
  createNextly?: (options: CreateNextlyOptions) => Promise<void>;
  /** Where `--database-url -` reads from, and whether a terminal is there. */
  stdin?: NodeJS.ReadableStream & { isTTY?: boolean };
}

interface CliOptions {
  yes?: boolean;
  template?: string;
  approach?: string;
  database?: string;
  databaseUrl?: string;
  packageManager?: string;
  // Commander sets it from --no-git: true unless that is passed.
  git?: boolean;
  branch?: string;
  localTemplate?: string;
  skipInstall?: boolean;
  useYalc?: boolean;
  // Commander sets it from --no-skills: true unless that is passed.
  skills?: boolean;
}

/** Stop with a one-line refusal, before anything is written. */
function refuse(message: string): never {
  // A value echoed back may be a connection string given to the wrong flag.
  console.error(`Error: ${redactUrlsIn(message)}`);
  process.exit(1);
}

/** Everything on standard input, trimmed: where `--database-url -` reads. */
async function readAll(stream: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString("utf-8").trim();
}

/** The `create-nextly-app` command, ready to parse. */
export function buildProgram(deps: ProgramDeps = {}): Command {
  const createNextly = deps.createNextly ?? runCreateNextly;
  const stdin = deps.stdin ?? process.stdin;
  const program = new Command();

  program
    .name("create-nextly-app")
    .description(
      "Scaffold a new Nextly CMS project or add Nextly to an existing Next.js app"
    )
    .version(packageVersion())
    // A misspelt flag is refused, with the nearest one named. Commander
    // quotes the whole argument, so `--database-urll=postgresql://user:pw@…`
    // would print the password: every error it writes is scrubbed of URLs.
    .showSuggestionAfterError(true)
    .configureOutput({
      outputError: (text, write) => write(redactUrlsIn(text)),
    })
    // No default value here on purpose: when the user omits the argument we
    // want `directory` to arrive as `undefined` so the interactive prompt
    // can ask for a folder name. The earlier default of "." caused no-arg
    // invocations to be silently treated as "install in cwd" and then abort
    // when the cwd was non-empty.
    .argument(
      "[directory]",
      "Project name or '.' to install in the current directory (omit to be prompted)"
    )
    .option(
      "-y, --yes",
      "Skip prompts and use defaults (blank template, SQLite, local storage)"
    )
    .option(
      "-t, --template <template>",
      // From the registry, so --help names every template the flag accepts.
      `Project template (${getAvailableTemplateNames().join(", ")})`
    )
    .option("-a, --approach <approach>", "Schema approach (code-first, visual)")
    .option("-d, --database <db>", "Database type (sqlite, postgresql, mysql)")
    .option(
      "--database-url <url>",
      "Connection string for PostgreSQL or MySQL, written only to the ignored .env. " +
        "Pass - to read it from standard input; use that for a URL with a password, " +
        "since shell history and the process list keep the command line"
    )
    .option(
      "--package-manager <pm>",
      "Package manager to install and run the project with (npm, pnpm, yarn, bun)"
    )
    .option("--no-git", "Do not make a git repository or a first commit")
    // No default: with none given, a downloaded template comes from this CLI's
    // own release, which an explicit `--branch main` does not.
    .option(
      "-b, --branch <branch>",
      "Git branch to take the template from (default: this release)"
    )
    .option(
      "--local-template <path>",
      "Path to local templates directory (development only)"
    )
    .option(
      "--skip-install",
      "Skip dependency installation (for local testing)"
    )
    .option(
      "--no-skills",
      "Do not add the Nextly skills for coding agents to the project"
    )
    .option(
      "--use-yalc",
      "Use yalc for local package installation (development only)"
    )
    .addHelpText(
      "after",
      `
Examples:
  $ npx create-nextly-app@alpha             (prompts for folder name)
  $ npx create-nextly-app@alpha my-project
  $ npx create-nextly-app@alpha my-project -y
  $ npx create-nextly-app@alpha my-blog -t blog -a code-first
  $ npx create-nextly-app@alpha my-project --database postgresql
  $ npx create-nextly-app@alpha .           (install in the current directory)

Without a terminal (CI), pass every answer, or --yes for the defaults.
A connection string with a password, kept out of the command line:
  $ printf '%s' "$DATABASE_URL" | npx create-nextly-app@alpha my-project \\
      -d postgresql --database-url - --package-manager pnpm --yes
`
    )
    .action(async (directory: string | undefined, options: CliOptions) => {
      // Initialize telemetry. Cheap, no network. Prints one-time banner if needed.
      await telemetry.init({
        cliName: "create-nextly-app",
        cliVersion: packageVersion(),
      });

      let databaseUrl: string | undefined;
      try {
        const cwd = process.cwd();
        const { projectName, installInCwd } = resolveProjectArg(directory);

        // Reject malformed positional arguments up-front so the user sees the
        // error before the interactive flow starts. The interactive prompt
        // applies the same validator, so the two entry points stay in sync.
        if (projectName) {
          const nameError = validateProjectName(projectName);
          if (nameError) {
            refuse(`Invalid project name '${projectName}'. ${nameError}.`);
          }
        }

        const projectType = options.template as ProjectType | undefined;

        // Validate --template flag against the template registry, which is
        // also what the interactive prompt offers.
        const templateError = projectType
          ? validateTemplateName(projectType)
          : undefined;
        if (templateError) refuse(templateError);

        if (
          options.approach &&
          !APPROACHES.includes(options.approach as ProjectApproach)
        ) {
          refuse(
            invalidChoiceMessage("--approach", options.approach, APPROACHES)
          );
        }
        if (
          options.database &&
          !DATABASES.includes(options.database as DatabaseType)
        ) {
          refuse(
            invalidChoiceMessage("--database", options.database, DATABASES)
          );
        }
        if (
          options.packageManager &&
          !PACKAGE_MANAGERS.includes(options.packageManager as PackageManager)
        ) {
          refuse(
            invalidChoiceMessage(
              "--package-manager",
              options.packageManager,
              PACKAGE_MANAGERS
            )
          );
        }

        const fromStdin = options.databaseUrl === "-";
        if (fromStdin) {
          if (stdin.isTTY) {
            refuse(
              "--database-url - reads the connection string from standard input, " +
                `which is a terminal here. Pipe it in: printf '%s' "$DATABASE_URL" | create-nextly-app ... --database-url -`
            );
          }
          databaseUrl = await readAll(stdin);
          if (!databaseUrl) {
            refuse(
              "--database-url - read nothing from standard input. Pipe the connection string in."
            );
          }
        } else if (options.databaseUrl !== undefined) {
          databaseUrl = options.databaseUrl.trim();
          if (!databaseUrl) refuse("--database-url was given an empty value.");
        }

        if (databaseUrl !== undefined) {
          const mismatch = connectionMismatch(
            options.database as DatabaseType | undefined,
            databaseUrl
          );
          if (mismatch) refuse(mismatch);
        }

        telemetry.capture("scaffold_started", {
          flags: {
            yes: Boolean(options.yes),
            skipInstall: Boolean(options.skipInstall),
            useYalc: Boolean(options.useYalc),
          },
        });

        await createNextly({
          cwd,
          defaults: options.yes,
          projectType,
          approach: options.approach as ProjectApproach | undefined,
          database: options.database as DatabaseType | undefined,
          databaseUrl,
          databaseUrlInArguments: databaseUrl !== undefined && !fromStdin,
          packageManager: options.packageManager as PackageManager | undefined,
          git: options.git,
          branch: options.branch,
          localTemplatePath: options.localTemplate,
          skipInstall: options.skipInstall,
          useYalc: options.useYalc,
          // Only --no-skills answers the skills prompt; commander's default
          // true is no answer, so the prompt (or, with no terminal, the list
          // of missing answers) still covers it.
          skills:
            program.getOptionValueSource("skills") === "cli"
              ? options.skills
              : undefined,
          projectNameFromArg: projectName,
          installInCwd,
          // Standard input read for the URL is no terminal either.
          interactive: Boolean(stdin.isTTY) && !fromStdin,
        });
      } catch (error) {
        // An error nothing above caught still never prints the connection
        // string (a driver's message can quote it).
        if (databaseUrl === undefined) throw error;
        // Not process.exit: the telemetry below still flushes.
        console.error(
          `Error: ${redactConnection((error as Error).message, databaseUrl)}`
        );
        process.exitCode = 1;
      } finally {
        // Always flush. shutdown() has its own 2s timeout so this never hangs.
        await telemetry.shutdown();
      }
    });

  return program;
}
