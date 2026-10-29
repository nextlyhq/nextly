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
import { CliError } from "../cli-error";
import { defineCodes } from "../define";
import { deepestMessage } from "../messages";

/** One message of esbuild's build failure, as far as these codes read it. */
interface BuildMessage {
  text: string;
  location: { file: string; line: number; column: number } | null;
}

/** The messages of the esbuild failure behind `error`, or none when something else failed. */
function buildMessages(error: NextlyError): BuildMessage[] {
  const cause: unknown = error.cause;
  if (typeof cause !== "object" || cause === null || !("errors" in cause)) {
    return [];
  }
  const { errors } = cause;
  if (!Array.isArray(errors)) return [];
  return errors.filter(
    (message): message is BuildMessage =>
      typeof message === "object" &&
      message !== null &&
      typeof (message as { text?: unknown }).text === "string"
  );
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

/** esbuild's wording for an import it could not find. */
const isUnresolved = (message: BuildMessage) =>
  message.text.startsWith("Could not resolve");

/** Each message as `file:line:column: text`, one per line, as the user's editor names it. */
function located(messages: readonly BuildMessage[]): string {
  return messages
    .map(({ text, location }) =>
      location === null
        ? text
        : `${location.file}:${location.line}:${location.column}: ${text}`
    )
    .join("\n");
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
        describe: error => {
          const messages = buildMessages(error);
          const first = messages[0]?.location;
          return {
            what: `\`${configFile(error)}\` has a syntax error, so it could not be read.`,
            why: located(messages),
            next:
              first === null || first === undefined
                ? `Fix the code esbuild names in \`${configFile(error)}\`, then run the command again.`
                : `Fix line ${first.line} of \`${first.file}\`, then run the command again.`,
          };
        },
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
        describe: error => ({
          what: `\`${configFile(error)}\` imports something that could not be found.`,
          why: `\`${missingModule(error) ?? "a package"}\` is not installed in the project.`,
          next: "Install the package it names, or correct the import, then run the command again.",
        }),
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
      "The configuration declares something Nextly cannot use, such as a field type no installed plugin offers.",
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
