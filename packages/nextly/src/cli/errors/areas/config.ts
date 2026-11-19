/**
 * Codes for a configuration the CLI could not read.
 *
 * The loader reports every failure as one `INVALID_INPUT` with a `reason`, which is right for the
 * dev server's log and wrong for a terminal, where a missing file, a syntax error and a config
 * that threw each need their own next step. These tell them apart.
 *
 * @module cli/errors/areas/config
 */

import { basename } from "node:path";

import { NextlyError } from "../../../errors/nextly-error";
import {
  type BuildMessage,
  buildMessagesOf,
  formatBuildMessages,
} from "../../../shared/lib/build-messages";
import { CliError } from "../cli-error";
import { defineCodes } from "../define";
import { deepestMessage } from "../messages";

/** The messages of the esbuild failure behind `error`, or none when something else failed. */
function buildMessages(error: NextlyError): BuildMessage[] {
  return buildMessagesOf(error.cause);
}

/**
 * The package Node could not find when the compiled configuration ran, from its
 * `ERR_MODULE_NOT_FOUND` (or CommonJS `MODULE_NOT_FOUND`), or undefined for any other failure.
 */
function missingModule(error: NextlyError): string | undefined {
  // Read by shape: Node's loader raises it from its own realm, where `instanceof Error` can fail.
  const cause = error.cause as
    | { code?: unknown; message?: unknown }
    | undefined;
  if (typeof cause !== "object" || cause === null) return undefined;
  if (
    cause.code !== "ERR_MODULE_NOT_FOUND" &&
    cause.code !== "MODULE_NOT_FOUND"
  ) {
    return undefined;
  }
  return typeof cause.message === "string"
    ? /Cannot find (?:package|module) '([^']+)'/.exec(cause.message)?.[1]
    : undefined;
}

/**
 * What Node could not load, where it is a path inside a package that IS installed: Node's ES
 * module loader names the file it looked for (`…/node_modules/next/headers`) rather than the
 * import, when a package without an `exports` map is imported by a subpath. Undefined for a
 * package that is not installed, which Node names by its import.
 */
interface InstalledPathMiss {
  /** The installed package, e.g. `next` or `@scope/name`. */
  readonly pkg: string;
  /** The import as written, e.g. `next/headers`. */
  readonly specifier: string;
  /** The import Node suggests instead, e.g. `next/headers.js`, where it suggests one. */
  readonly suggestion?: string;
}

function installedPathMiss(error: NextlyError): InstalledPathMiss | undefined {
  const missing = missingModule(error);
  if (missing === undefined) return undefined;
  // The last `node_modules` segment holds the package; its scope, if any, is one more segment.
  const inPackage =
    /[\\/]node_modules[\\/]((?:@[^\\/]+[\\/])?[^\\/]+)[\\/](.+)$/.exec(missing);
  if (inPackage === null) return undefined;
  const pkg = inPackage[1].replace(/\\/g, "/");
  const specifier = `${pkg}/${inPackage[2].replace(/\\/g, "/")}`;
  const message = (error.cause as { message?: unknown }).message;
  const suggestion =
    typeof message === "string"
      ? /Did you mean to import "([^"]+)"\?/.exec(message)?.[1]
      : undefined;
  return suggestion === undefined
    ? { pkg, specifier }
    : { pkg, specifier, suggestion };
}

/** esbuild's wording for an import it could not find. */
const isUnresolved = (message: BuildMessage) =>
  message.text.startsWith("Could not resolve");

/** Each message at the place the user's editor shows, with its line (`formatBuildMessages`). */
function located(messages: readonly BuildMessage[]): string {
  return formatBuildMessages(messages);
}

/** What the file's default export was, as the loader recorded its `typeof`. */
function exportTypeOf(error: NextlyError): string {
  const type = error.logContext?.exportType;
  return typeof type === "string" ? type : "missing";
}

/** The configuration file as the user finds it in their project. */
function configFile(error: NextlyError): string {
  const path = error.logContext?.configPath;
  return typeof path === "string" ? basename(path) : "nextly.config.ts";
}

/**
 * What to do about a problem whose rule's own sentence says what is wrong but not how to put it
 * right, read from the failure itself: one code covers several. A field type nothing offers is
 * told to use a built-in one or install its plugin, while a registered type's option its own rule
 * refuses gets that rule's sentence alone, the plugin being installed. A rule whose sentence
 * already says it ("Rename one of them") has none.
 */
function problemFix(
  code: string | undefined,
  message: string
): string | undefined {
  if (code === "SLUG_INVALID_FORMAT") {
    return "use a lowercase address, such as 'blog-posts'.";
  }
  if (
    code === "FIELD_TYPE_INVALID" &&
    message.startsWith("Invalid field type ")
  ) {
    return "use a built-in field type, or install the plugin that offers this one.";
  }
  return undefined;
}

export const CONFIG_CODES = defineCodes({
  CONFIG_NOT_FOUND: {
    cause:
      "The configuration file named with `-c` or `--config` does not exist.",
    from: [
      {
        code: "INVALID_INPUT",
        reason: "config-not-found",
        describe: error => {
          const requested = error.logContext?.requested;
          const path = error.logContext?.configPath;
          const named =
            typeof requested === "string" ? requested : configFile(error);
          return {
            what: `\`-c ${named}\` names a configuration file that does not exist.`,
            why: `Nothing is at ${typeof path === "string" ? path : named}.`,
            next: "Pass `-c` the path of your configuration file, relative to the project folder, or leave `-c` out to use the project's `nextly.config.ts`.",
          };
        },
      },
    ],
  },
  CONFIG_SYNTAX_ERROR: {
    cause:
      "The configuration file is not valid TypeScript, so it could not be compiled.",
    from: [
      {
        code: "INVALID_INPUT",
        reason: "load-error",
        when: error => {
          const messages = buildMessages(error);
          return messages.length > 0 && !messages.some(isUnresolved);
        },
        // The place is named once, in Why with its line: Next says what to do without
        // naming it again, nor a file, since the error may be in a file the configuration
        // imports.
        describe: error => ({
          what: `\`${configFile(error)}\` has a syntax error, so it could not be read.`,
          why: located(buildMessages(error)),
          next: "Fix the code shown above, then run the command again.",
        }),
      },
    ],
  },
  CONFIG_IMPORT_NOT_FOUND: {
    cause:
      "The configuration file imports a file or package that could not be found.",
    from: [
      {
        // A package the configuration imports is left for Node to load when the bundle runs, so
        // one that is not installed fails then, as Node's own module-not-found error.
        code: "INVALID_INPUT",
        reason: "load-error",
        when: error => missingModule(error) !== undefined,
        describe: error => {
          const what = `\`${configFile(error)}\` imports something that could not be found.`;
          // A path inside a package that is installed: saying it "is not installed" sends the
          // reader to install what they already have.
          const miss = installedPathMiss(error);
          if (miss?.suggestion !== undefined) {
            return {
              what,
              why: `\`${miss.pkg}\` is installed, but Node can't load \`${miss.specifier}\` from it as written: the package doesn't export that path, so Node needs the file's extension, \`${miss.suggestion}\`.`,
              next: `Import \`${miss.suggestion}\` instead, or move that import out of the configuration, then run the command again.`,
            };
          }
          if (miss !== undefined) {
            return {
              what,
              why: `\`${miss.pkg}\` is installed, but it has no file at \`${miss.specifier}\`.`,
              next: "Correct the import's path, then run the command again.",
            };
          }
          return {
            what,
            why: `\`${missingModule(error) ?? "a package"}\` is not installed in the project.`,
            next: "Install the package it names, or correct the import, then run the command again.",
          };
        },
      },
      {
        code: "INVALID_INPUT",
        reason: "load-error",
        when: error => buildMessages(error).some(isUnresolved),
        describe: error => ({
          what: `\`${configFile(error)}\` imports something that could not be found.`,
          why: located(buildMessages(error).filter(isUnresolved)),
          next: "Correct the import's path, or install the package it names, then run the command again.",
        }),
      },
    ],
  },
  CONFIG_LOAD_FAILED: {
    cause: "The configuration file compiled, but threw an error while it ran.",
    from: [
      {
        code: "INVALID_INPUT",
        reason: "load-error",
        describe: error => ({
          what: `\`${configFile(error)}\` threw an error while it was loading.`,
          why: deepestMessage(error.cause) ?? "The error carried no message.",
          next: `Fix the code that throws in \`${configFile(error)}\` or a file it imports; \`--verbose\` shows where it was thrown.`,
        }),
      },
    ],
  },
  CONFIG_INVALID_EXPORT: {
    cause:
      "The configuration file's default export is not a configuration object.",
    from: [
      {
        code: "INVALID_INPUT",
        reason: "invalid-config-export",
        describe: error => ({
          what: `\`${configFile(error)}\` does not export a configuration.`,
          why: `Its default export is ${exportTypeOf(error)}, not the object \`defineConfig\` returns.`,
          next: "End the file with `export default defineConfig({ … })`.",
        }),
      },
    ],
  },
  PLUGIN_SETUP_FAILED: {
    cause:
      "A plugin's `setup` function threw while the configuration was loading.",
    from: [
      {
        code: "INVALID_INPUT",
        reason: "plugin-setup-transformer-failed",
        describe: error => {
          const plugin = error.logContext?.pluginName;
          const named =
            typeof plugin === "string"
              ? `The \`${plugin}\` plugin`
              : "A plugin";
          return {
            what: `${named} failed while the configuration was loading.`,
            why:
              deepestMessage(error.cause) ??
              "Its `setup` threw an error with no message.",
            next: "Check the options this plugin is given in `nextly.config.ts`, or update the plugin; `--verbose` shows where it failed.",
          };
        },
      },
    ],
  },
  CONFIG_INVALID: {
    cause:
      "The configuration, or a definition it loads, declares something Nextly cannot use.",
    from: [
      {
        // The load's check of every entity (`configurationProblems`): each problem, first to last,
        // at its path, with what to do where the rule's own sentence does not say, then a count.
        code: "VALIDATION_ERROR",
        reason: "config-invalid",
        describe: error => {
          const problems = (
            (
              error.publicData as
                | {
                    errors?: Array<{
                      path?: string;
                      code?: string;
                      message?: string;
                    }>;
                  }
                | undefined
            )?.errors ?? []
          ).filter(problem => typeof problem.message === "string");
          const count = `${problems.length} problem${problems.length === 1 ? "" : "s"}`;
          return {
            what: `\`${configFile(error)}\` has ${count}, so it cannot be used.`,
            why: [
              ...problems.flatMap(problem => {
                const fix = problemFix(problem.code, problem.message ?? "");
                const line = `${problem.path ?? ""}: ${problem.message ?? ""}`;
                return fix === undefined ? [line] : [line, `  Fix: ${fix}`];
              }),
              `${count}.`,
            ].join("\n"),
            next: "Fix each problem listed, then run the command again.",
          };
        },
      },
      {
        // A validation failure no narrower code reads: the issues it lists, by their path.
        code: "VALIDATION_ERROR",
        describe: error => {
          const issues = (
            (
              error.publicData as
                | { errors?: Array<{ path?: string; message?: string }> }
                | undefined
            )?.errors ?? []
          ).filter(issue => typeof issue.message === "string");
          return {
            what:
              issues.length === 1
                ? "A declaration Nextly cannot use was found."
                : `${issues.length || "Some"} declarations Nextly cannot use were found.`,
            why:
              issues
                .map(issue =>
                  issue.path
                    ? `${issue.path}: ${issue.message ?? ""}`
                    : (issue.message ?? "")
                )
                .join("\n") || error.publicMessage,
            next: "Fix each declaration listed, in `nextly.config.ts` or the plugin that declares it, then run the command again.",
          };
        },
      },
    ],
  },
  WORKFLOW_CANNOT_ATTACH: {
    cause:
      "A workflow in the configuration is attached to a collection or Single it cannot run on.",
    from: [
      {
        code: "VALIDATION_ERROR",
        issue: "workflow_needs_drafts",
        describe: error => {
          const issues = (
            (
              error.publicData as
                | { errors?: Array<{ code?: string; message?: string }> }
                | undefined
            )?.errors ?? []
          ).filter(issue => issue.code === "workflow_needs_drafts");
          return {
            what:
              issues.length === 1
                ? "A workflow cannot be attached where the configuration attaches it."
                : `${issues.length} workflows cannot be attached where the configuration attaches them.`,
            why: issues.map(issue => issue.message ?? "").join("\n"),
            next: "Give each target what its workflow needs, such as drafts, or attach the workflow elsewhere, then run the command again.",
          };
        },
      },
    ],
  },
  CONFIG_TOOLING_UNAVAILABLE: {
    cause:
      "Reading the configuration needs the optional `esbuild` package, which is not installed.",
    from: [
      {
        code: "NEXTLY_CONFIG_TOOLING_UNAVAILABLE",
        describe: () => ({
          what: "The configuration could not be read: the `esbuild` package is not installed.",
          why: "The CLI and development compile `nextly.config.ts` with esbuild, an optional dependency of `nextly`.",
          next: "Install it as a development dependency, for example `pnpm add -D esbuild`, then run the command again.",
        }),
      },
    ],
  },
});

/** The issue code the field-declaration check gives each declaration at fault. */
const FIELD_DECLARATION_ISSUE = "FIELD_TYPE_INVALID";

/**
 * A failed check of the configuration's declarations, as the command's error: one line per
 * declaration at fault, by its path in the configuration. Undefined when `error` is not such a
 * failure, so the caller reads it as any other error.
 */
export function configDeclarationError(error: unknown): CliError | undefined {
  if (!NextlyError.is(error) || error.code !== "VALIDATION_ERROR")
    return undefined;
  const data = error.publicData as
    | { errors?: Array<{ path?: string; code?: string; message?: string }> }
    | undefined;
  // Only the field-declaration check's own issues: another check's (a workflow that cannot
  // attach) has a cause and a fix of its own, and reads as its own code.
  const issues = (data?.errors ?? []).filter(
    issue => issue.code === FIELD_DECLARATION_ISSUE
  );
  if (issues.length === 0) return undefined;
  return new CliError(
    "CONFIG_INVALID",
    {
      what:
        issues.length === 1
          ? "The configuration declares a field Nextly cannot use."
          : `The configuration declares ${issues.length} fields Nextly cannot use.`,
      why: issues
        .map(issue => `${issue.path ?? ""}: ${issue.message ?? ""}`.trim())
        .join("\n"),
      next: "Fix each declaration listed in `nextly.config.ts`, or install the plugin that offers its field type, then run the command again.",
    },
    error
  );
}
