/**
 * The text a command's error prints:
 *
 * ```
 * ✗ <what happened, one plain sentence>
 *   Why:  <the cause>
 *   Next: <the command or action that fixes it>
 *   Docs: <link to the code's page>  (<CODE>)
 * ```
 *
 * `--verbose` adds the internal context and the stack below it, never in place of it.
 *
 * @module cli/errors/render
 */

import pc from "picocolors";

import { NextlyError } from "../../errors/nextly-error";

import { CliError } from "./cli-error";
import { cliErrorDocsUrl } from "./registry";

export interface FormatOptions {
  /** Add the context and the stack. */
  verbose?: boolean;
  /** Colour the mark and labels. Off by default, so the text is the same in every log. */
  color?: boolean;
}

/**
 * A labelled line, with any further lines of its value under the value's first column. The
 * indent is measured on the plain label: a coloured one carries escape codes no terminal shows.
 */
function labelled(
  label: string,
  value: string,
  paint: (text: string) => string
): string {
  const indent = " ".repeat(label.length + 2);
  return value
    .split("\n")
    .map((line, i) =>
      i === 0 ? `  ${paint(label)}${line}` : `${indent}${line}`
    )
    .join("\n");
}

/** The error and each cause under it, outermost first. */
function chainOf(error: Error): Error[] {
  const chain: Error[] = [];
  let current: unknown = error;
  while (current instanceof Error && chain.length < 6) {
    chain.push(current);
    current = current.cause;
  }
  return chain;
}

/**
 * Each context along the chain, one line of JSON each. An error from below the CLI is shown with
 * its own code, which the CLI code replaced on the lines above.
 */
function contextLines(error: CliError): string[] {
  const lines: string[] = [];
  for (const link of chainOf(error)) {
    if (!NextlyError.is(link)) continue;
    const own = link.logContext ?? {};
    const context =
      link instanceof CliError ? own : { code: String(link.code), ...own };
    if (Object.keys(context).length === 0) continue;
    try {
      lines.push(`  Context: ${JSON.stringify(context)}`);
    } catch {
      // A context that cannot be printed is left out rather than hiding the rest.
    }
  }
  return lines;
}

/** The stack of the deepest error that has one: where the fault was thrown. */
function stackLines(error: CliError): string[] {
  const deepest = chainOf(error)
    .reverse()
    .find(link => typeof link.stack === "string" && link.stack.length > 0);
  if (deepest?.stack === undefined) return [];
  return [
    "  Stack:",
    ...deepest.stack.split("\n").map(line => `    ${line.trim()}`),
  ];
}

export function formatCliError(
  error: CliError,
  options: FormatOptions = {}
): string {
  const colors = pc.createColors(options.color === true);
  const lines = [
    `${colors.red("✗")} ${error.what}`,
    labelled("Why:  ", error.why, colors.dim),
    labelled("Next: ", error.next, colors.dim),
    `  ${colors.dim("Docs: ")}${cliErrorDocsUrl(error.code)}  (${error.code})`,
  ];
  if (options.verbose === true) {
    lines.push("", ...contextLines(error), ...stackLines(error));
  }
  return lines.join("\n");
}
