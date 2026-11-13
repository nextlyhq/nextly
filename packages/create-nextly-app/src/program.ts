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
import type { CreateNextlyOptions, DatabaseType, ProjectType } from "./types";

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

/**
 * The argument values that may be a connection string: any holding `://`
 * (whole, and after `=` in `--flag=value`), and the value given to any flag
 * spelt like `--database-url`, misspelt or not. Masked whole wherever a
 * message quotes them, since a fragment cut at a quote or a space would
 * otherwise slip through a URL pattern.
 */
function secretArguments(args: readonly string[]): string[] {
  const secrets: string[] = [];
  args.forEach((arg, index) => {
    const equals = arg.indexOf("=");
    const flag = equals < 0 ? arg : arg.slice(0, equals);
    const value = equals < 0 ? arg : arg.slice(equals + 1);
    if (flag.startsWith("--database-url")) {
      if (equals >= 0) secrets.push(value);
      else if (args[index + 1] !== undefined) secrets.push(args[index + 1]);
    }
    if (arg.includes("://")) secrets.push(arg, value);
  });
  return secrets.filter(secret => secret.length > 0 && secret !== "-");
}

/** `text` with every secret argument and every URL masked. */
function scrubbed(text: string, args: readonly string[]): string {
  let out = text;
  for (const secret of secretArguments(args)) {
    out = redactConnection(out, secret);
  }
  return redactUrlsIn(out);
}

/** Stop with a one-line refusal, before anything is written. */
function refuse(message: string, args: readonly string[]): never {
  // A value echoed back may be a connection string given to the wrong flag.
  console.error(`Error: ${scrubbed(message, args)}`);
  process.exit(1);
}

/** The value of a choice flag, refused with the nearest choice if unknown. */
function checkChoice<T extends string>(
  flag: string,
  value: string | undefined,
  choices: readonly T[],
  args: readonly string[]
): T | undefined {
  if (value === undefined) return undefined;
  if (!choices.includes(value as T)) {
    refuse(invalidChoiceMessage(flag, value, choices), args);
  }
  return value as T;
}

/** The checked answers from the command line, before any is acted on. */
function checkedAnswers(
  directory: string | undefined,
  options: CliOptions,
  args: readonly string[]
) {
  const { projectName, installInCwd } = resolveProjectArg(directory);
  // Reject malformed positional arguments up-front so the user sees the
  // error before the interactive flow starts. The interactive prompt
  // applies the same validator, so the two entry points stay in sync.
  const nameError = projectName ? validateProjectName(projectName) : undefined;
  if (nameError) {
    refuse(`Invalid project name '${projectName}'. ${nameError}.`, args);
  }
  // Against the template registry, which the interactive prompt offers too.
  const templateError = options.template
    ? validateTemplateName(options.template)
    : undefined;
  if (templateError) refuse(templateError, args);
  return {
    projectName,
    installInCwd,
    projectType: options.template as ProjectType | undefined,
    approach: checkChoice("--approach", options.approach, APPROACHES, args),
    database: checkChoice("--database", options.database, DATABASES, args),
    packageManager: checkChoice(
      "--package-manager",
      options.packageManager,
      PACKAGE_MANAGERS,
      args
    ),
  };
}

/**
 * The connection string from `--database-url`, read from standard input for
 * `-`, and checked against the database it is for.
 */
async function databaseUrlFrom(
  options: CliOptions,
  database: DatabaseType | undefined,
  stdin: NodeJS.ReadableStream & { isTTY?: boolean },
  args: readonly string[]
): Promise<{ url: string | undefined; fromStdin: boolean }> {
  const fromStdin = options.databaseUrl === "-";
  let url: string | undefined;
  if (fromStdin) {
    if (stdin.isTTY) {
      refuse(
        "--database-url - reads the connection string from standard input, " +
          `which is a terminal here. Pipe it in: printf '%s' "$DATABASE_URL" | create-nextly-app ... --database-url -`,
        args
      );
    }
    url = await readAll(stdin);
    if (!url) {
      refuse(
        "--database-url - read nothing from standard input. Pipe the connection string in.",
        args
      );
    }
  } else if (options.databaseUrl !== undefined) {
    url = options.databaseUrl.trim();
    if (!url) refuse("--database-url was given an empty value.", args);
  }
  const mismatch =
    url === undefined ? undefined : connectionMismatch(database, url);
  if (mismatch) refuse(mismatch, [...args, url as string]);
  return { url, fromStdin };
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
      outputError: (text, write) => write(scrubbed(text, rawArgs(program))),
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

      const args = rawArgs(program);
      let databaseUrl: string | undefined;
      try {
        const answers = checkedAnswers(directory, options, args);
        const given = await databaseUrlFrom(
          options,
          answers.database,
          stdin,
          args
        );
        databaseUrl = given.url;

        telemetry.capture("scaffold_started", {
          flags: {
            yes: Boolean(options.yes),
            skipInstall: Boolean(options.skipInstall),
            useYalc: Boolean(options.useYalc),
          },
        });

        await createNextly({
          cwd: process.cwd(),
          defaults: options.yes,
          projectType: answers.projectType,
          approach: answers.approach,
          database: answers.database,
          databaseUrl,
          databaseUrlInArguments: databaseUrl !== undefined && !given.fromStdin,
          packageManager: answers.packageManager,
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
          projectNameFromArg: answers.projectName,
          installInCwd: answers.installInCwd,
          // Standard input read for the URL is no terminal either.
          interactive: Boolean(stdin.isTTY) && !given.fromStdin,
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

/**
 * The arguments being parsed. Commander keeps them as `rawArgs` from the
 * start of a parse, before any error is written, but leaves it out of its
 * types.
 */
function rawArgs(program: Command): readonly string[] {
  return (program as unknown as { rawArgs?: string[] }).rawArgs ?? [];
}
