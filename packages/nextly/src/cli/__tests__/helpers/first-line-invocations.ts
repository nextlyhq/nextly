/**
 * Every command the program defines, each with arguments it accepts, as the
 * runs that are timed to their first line of output. Shared by the test that
 * holds each command to printing that line before its code loads and by the
 * script that times it (`scripts/check-cli-startup.mjs`).
 *
 * The arguments are a table, since what a command accepts is the command's
 * own; a command with no entry is refused rather than run without one, so a
 * new command cannot ship untimed.
 */
import { stripVTControlCharacters } from "node:util";

import type { Command } from "commander";

import { declaredFirstLine } from "../../first-line";

import { commandAt, commandPaths } from "./answer-only-invocations";

/**
 * The arguments each command is run with, by the words that name it. Each
 * set gets the command past Commander's own checks to its action; a run is
 * stopped at its first line, so what the command would go on to do never
 * happens. A parent that only holds subcommands is run alone, which answers
 * with its help.
 */
export const FIRST_LINE_ARGUMENTS: Readonly<Record<string, readonly string[]>> =
  {
    add: ["@nextlyhq/plugin-seo"],
    build: [],
    "db:sync": [],
    events: [],
    "events abandon": [],
    "events report": [],
    "generate:manifest": [],
    "generate:schema": [],
    "generate:types": [],
    "generate:widget": ["first-line-widget"],
    "i18n:convert-zoned-dates": [],
    "i18n:restore": ["--collection", "fl_posts"],
    init: [],
    media: [],
    "media orphans": [],
    "media reindex-usage": [],
    "media remove-sizes": [],
    migrate: [],
    "migrate:baseline": [],
    "migrate:check": [],
    "migrate:create": ["--name", "first_line"],
    "migrate:down": [],
    "migrate:field-groups": [],
    "migrate:fresh": [],
    "migrate:resolve": [],
    "migrate:status": [],
    "permissions:cleanup": [],
    plugins: [],
    "plugins add": ["@nextlyhq/plugin-seo"],
    "plugins info": ["first-line-plugin"],
    "plugins install": [],
    "plugins list": [],
    "plugins uninstall": ["first-line-plugin"],
    prune: [],
    "repair-columns": [],
    "setup-token": [],
    telemetry: [],
    "telemetry disable": [],
    "telemetry enable": [],
    "telemetry reset": [],
    "telemetry status": [],
    upgrade: [],
    "users:clear-plaintext-passwords": [],
    "users:create-admin": [],
    "webhooks:prune": [],
    "workflow:move-stranded": [
      "--to",
      "draft",
      "--as",
      "admin@example.com",
      "--comment",
      "timing",
    ],
    "workflow:stranded": [],
  };

/**
 * Every command `program` defines, as the words that name it followed by the
 * arguments it is timed with. Throws naming each command the table leaves
 * out, and each entry that names no command, so the table and the program
 * cannot drift apart unseen.
 */
export function firstLineInvocations(program: Command): string[][] {
  const paths = commandPaths(program);
  const names = new Set(paths.map(path => path.join(" ")));
  const missing = [...names].filter(name => !(name in FIRST_LINE_ARGUMENTS));
  const stale = Object.keys(FIRST_LINE_ARGUMENTS).filter(
    name => !names.has(name)
  );
  if (missing.length > 0 || stale.length > 0) {
    throw new Error(
      [
        missing.length > 0
          ? `No arguments to time ${missing.join(", ")} with: add each to FIRST_LINE_ARGUMENTS.`
          : "",
        stale.length > 0
          ? `FIRST_LINE_ARGUMENTS names ${stale.join(", ")}, which the program does not define.`
          : "",
      ]
        .filter(Boolean)
        .join(" ")
    );
  }
  return paths.map(path => [
    ...path,
    ...(FIRST_LINE_ARGUMENTS[path.join(" ")] ?? []),
    ...dryRunOf(commandAt(program, path)),
  ]);
}

/**
 * `--dry-run` for a command that takes it: what the command would go on to do
 * is never done, even when a run outlasts the stop at its first line. Read
 * from the command's own options, so a command that gains the flag is run
 * with it.
 */
function dryRunOf(command: Command): string[] {
  return command.options.some(option => option.long === "--dry-run")
    ? ["--dry-run"]
    : [];
}

/** The words of `args` that name a command under `program`, before its own arguments. */
export function commandPathOf(
  program: Command,
  args: readonly string[]
): string[] {
  const path: string[] = [];
  let at = program;
  for (const word of args) {
    const child = at.commands.find(each => each.name() === word);
    if (child === undefined) break;
    path.push(word);
    at = child;
  }
  return path;
}

/**
 * Why `line`, the first a run of the command `path` names printed, is not the
 * one it declared, or `undefined` when it is: the `Database: …` line, its
 * start line, or, for a command that prints its own at once, any line but
 * Commander's refusal (the arguments never reached it). A parent that only
 * holds subcommands answers with its help.
 */
export function wrongFirstLine(
  program: Command,
  path: readonly string[],
  line: string | undefined
): string | undefined {
  if (line === undefined) return "printed nothing";
  if (line.startsWith("error:")) return `refused before it ran: ${line}`;
  const command = commandAt(program, path);
  if (command.commands.length > 0) {
    return line.startsWith("Usage:")
      ? undefined
      : `expected its help, got: ${line}`;
  }
  const first = declaredFirstLine(command);
  if (first === undefined) return "declares no first line";
  if (first.kind === "database") {
    return line.startsWith("Database: ")
      ? undefined
      : `expected the Database line, got: ${line}`;
  }
  if (first.kind === "start") {
    return line === first.line
      ? undefined
      : `expected "${first.line}", got: ${line}`;
  }
  return first.pattern.test(line)
    ? undefined
    : `expected a line matching ${String(first.pattern)}, got: ${line}`;
}

/**
 * The runs the start-up timing stops once their command's code has loaded:
 * every command with an action of its own (`hasAction`), with the arguments
 * it is timed to its first line with. A parent that only holds subcommands
 * answers with its help and loads nothing, so it is not among them. A variant of a command's
 * arguments would time the same thing: the run stops as the action's module
 * loads, before the action reads them.
 */
export function codeLoadInvocations(program: Command): string[][] {
  return firstLineInvocations(program).filter(args =>
    hasAction(commandAt(program, commandPathOf(program, args)))
  );
}

/**
 * Whether `command` has an action of its own: a leaf's, or a parent's that
 * Commander runs instead of answering with its help. Read from the handler
 * Commander keeps (`_actionHandler`, set by `.action()`, the one its own run
 * dispatches on), since it offers no public way to ask; the test of this
 * helper builds a parent with an action, so a rename reads as none and fails
 * there.
 */
export function hasAction(command: Command): boolean {
  const handler: unknown = Reflect.get(command, "_actionHandler");
  return typeof handler === "function";
}

/** Whether the command `path` names under `program` runs an action itself, holding no subcommands. */
export function runsAnAction(
  program: Command,
  path: readonly string[]
): boolean {
  return commandAt(program, path).commands.length === 0;
}

/** The first line of `output` that is not blank, its colour codes removed. */
export function firstNonBlankLine(output: string): string | undefined {
  return (
    // Colour codes carry no words.
    stripVTControlCharacters(output)
      .split("\n")
      .map(line => line.trim())
      .find(line => line !== "")
  );
}
