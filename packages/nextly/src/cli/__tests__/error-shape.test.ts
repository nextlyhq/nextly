/**
 * How a `nextly` command reads when it ends with an error.
 *
 * Every error ends in one shape: a line saying what happened, then the cause, the next action and
 * the code's docs page, under the code. Never an internal envelope (`[INVALID_INPUT] … | context:
 * {…}`), and never one message twice, which is what a missing configuration and a configuration
 * with a syntax error printed before.
 *
 * The commands run in this process through the real program, so the text asserted is the text a
 * terminal shows: the command's own catch, or the entry point's for an error thrown out of it.
 *
 * @module cli/__tests__/error-shape.test
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stripVTControlCharacters } from "node:util";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  cliErrorSlug,
  formatCliError,
  toCliError,
  type CliErrorCode,
} from "../errors";
import { createProgram } from "../program";

import { ERROR_CASES } from "./error-cases";

/** `process.exit`, stopped: the test's run ends where the command's would. */
class Exited extends Error {
  constructor(readonly code: number | undefined) {
    super(`process.exit(${String(code)})`);
  }
}

let project: string;

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), "nextly-error-shape-"));
  vi.stubEnv("NEXTLY_TELEMETRY_DISABLED", "1");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  rmSync(project, { recursive: true, force: true });
});

/** Runs `nextly <args>` in the project folder, returning what it wrote to standard error. */
async function runCli(
  args: string[]
): Promise<{ stderr: string; code: number | undefined }> {
  const lines: string[] = [];
  // A real process stops at its first exit. Here the stopped exit is a throw, which a command's
  // own outer catch can meet and report again, so nothing written after the first exit counts.
  let first: number | undefined | null = null;
  const capture = (...parts: unknown[]) => {
    if (first === null) lines.push(parts.map(String).join(" "));
  };
  vi.spyOn(console, "error").mockImplementation(capture);
  vi.spyOn(console, "warn").mockImplementation(capture);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(process, "exit").mockImplementation(code => {
    const exitCode = typeof code === "number" ? code : undefined;
    if (first === null) first = exitCode;
    throw new Exited(exitCode);
  });

  let code: number | undefined;
  try {
    await createProgram().parseAsync([
      "node",
      "nextly",
      ...args,
      "--cwd",
      project,
      "--no-color",
    ]);
  } catch (error) {
    if (!(error instanceof Exited)) throw error;
  }
  code = first ?? undefined;
  const stderr = stripVTControlCharacters(lines.join("\n"))
    .split(project)
    .join("<project>");
  return { stderr, code };
}

/** The four lines of the shape, each found by its label, or undefined where one is missing. */
function shapeOf(stderr: string) {
  const lines = stderr.split("\n");
  const start = lines.findIndex(line => line.startsWith("✗ "));
  const after = lines.slice(start);
  const labelled = (label: string) =>
    after.find(line => line.startsWith(`  ${label}`));
  return {
    what: lines[start],
    why: labelled("Why:"),
    next: labelled("Next:"),
    docs: labelled("Docs:"),
  };
}

/** Each sentence of `text` that it says more than once. */
function repeatedSentences(text: string): string[] {
  const seen = new Set<string>();
  const repeated: string[] = [];
  for (const sentence of text.split(/(?<=[.:])\s+|\n/)) {
    const key = sentence.trim();
    if (key.length < 12) continue;
    if (seen.has(key)) repeated.push(key);
    seen.add(key);
  }
  return repeated;
}

/** What every error must and must not print, whatever its cause. */
function expectTheShape(stderr: string, code: string, slug: string): void {
  const shape = shapeOf(stderr);
  expect(shape.what).toMatch(/^✗ \S/);
  expect(shape.why).toMatch(/^ {2}Why: {2}\S/);
  expect(shape.next).toMatch(/^ {2}Next: \S/);
  expect(shape.docs).toBe(
    `  Docs: https://nextlyhq.com/docs/cli/errors/${slug}  (${code})`
  );
  // The internal envelope: a bracketed HTTP code, piped segments and the log context.
  expect(stderr).not.toMatch(/\[[A-Z_]+\]/);
  expect(stderr).not.toContain(" | ");
  expect(stderr).not.toContain("context:");
  expect(repeatedSentences(stderr)).toEqual([]);
}

describe("a command that ends with an error", () => {
  it("names a missing configuration file, the flag that named it, and what to do", async () => {
    const { stderr, code } = await runCli([
      "generate:types",
      "-c",
      "missing.config.ts",
    ]);

    expect(code).toBe(1);
    expectTheShape(stderr, "CONFIG_NOT_FOUND", "config-not-found");
    expect(shapeOf(stderr).what).toContain("missing.config.ts");
    expect(stderr).toMatchSnapshot();
  });

  it("names a configuration's syntax error once, with its file, line and column", async () => {
    writeFileSync(
      join(project, "nextly.config.ts"),
      'export default {\n  collections: [\n    { slug: "posts" fields: [] },\n  ],\n};\n'
    );

    const { stderr, code } = await runCli(["generate:types"]);

    expect(code).toBe(1);
    expectTheShape(stderr, "CONFIG_SYNTAX_ERROR", "config-syntax-error");
    expect(shapeOf(stderr).why).toContain("nextly.config.ts:3:");
    expect(stderr).toMatchSnapshot();
  });

  it("adds the context and stack under --verbose, below the same plain message", async () => {
    writeFileSync(
      join(project, "nextly.config.ts"),
      'export default {\n  collections: [\n    { slug: "posts" fields: [] },\n  ],\n};\n'
    );

    const plain = await runCli(["generate:types"]);
    const verbose = await runCli(["generate:types", "--verbose"]);

    expect(verbose.code).toBe(1);
    const shape = shapeOf(verbose.stderr);
    expect(shape).toEqual(shapeOf(plain.stderr));
    const below = verbose.stderr.slice(verbose.stderr.indexOf(shape.docs));
    expect(below).toMatch(/\n {2}Context: \{.*"reason":"load-error"/);
    // The stack opens with its message, which may run to several lines, then its frames.
    expect(below).toMatch(/\n {2}Stack:\n(?: {4}\S.*\n)+ {4}at /);
    expect(plain.stderr).not.toContain("Stack:");
    expect(plain.stderr).not.toContain("Context:");
  });
});

describe("each code, as a command ends with it", () => {
  it.each(Object.keys(ERROR_CASES) as CliErrorCode[])("%s", async code => {
    const error = toCliError(await ERROR_CASES[code]());

    // The case reaches its code: a mapping that never matched would read as UNEXPECTED_ERROR.
    expect(error.code).toBe(code);
    const text = formatCliError(error);
    expectTheShape(text, code, cliErrorSlug(code));
    // What happened is one sentence on one line.
    expect(error.what).not.toContain("\n");
    expect(text).toMatchSnapshot();
  });
});
