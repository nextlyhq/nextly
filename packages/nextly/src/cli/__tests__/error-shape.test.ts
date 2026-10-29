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
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { stripVTControlCharacters } from "node:util";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  cliErrorSlug,
  formatCliError,
  toCliError,
  type CliErrorCode,
} from "../errors";
import type { SchemaEventRow } from "../../domains/schema/events/schema-events-repository";
import { migrateDownCore } from "../commands/migrate-down";
import { readBlockManifestState } from "../commands/generate-manifest";
import { createProgram } from "../program";
import { NextlyError } from "../../errors/nextly-error";
import { REFUSAL_KIND_KEY } from "../../domains/field-groups/migration/refusal-kind";
import { createLogger } from "../utils/logger";

import {
  buildDeclarationsInvalid,
  buildFailed,
  buildStrictWarnings,
} from "../errors/areas/commands";

import { ERROR_CASES } from "./error-cases";
import { uninstallRefused } from "./error-cases/plugins";

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
): Promise<{ stderr: string; stdout: string; code: number | undefined }> {
  const lines: string[] = [];
  // A real process stops at its first exit. Here the stopped exit is a throw, which a command's
  // own outer catch can meet and report again, so nothing written after the first exit counts.
  let first: number | undefined | null = null;
  const capture = (...parts: unknown[]) => {
    if (first === null) lines.push(parts.map(String).join(" "));
  };
  vi.spyOn(console, "error").mockImplementation(capture);
  vi.spyOn(console, "warn").mockImplementation(capture);
  const out: string[] = [];
  vi.spyOn(console, "log").mockImplementation((...parts: unknown[]) => {
    if (first === null) out.push(parts.map(String).join(" "));
  });
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
  return { stderr, stdout: out.join("\n"), code };
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
  // The internal envelope: a bracketed HTTP code, piped segments and the log context. A
  // one-letter label ("[A] Sync the database …") is a recovery option, not a code.
  expect(stderr).not.toMatch(/\[[A-Z][A-Z_]+\]/);
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

    // The frames name this machine's paths and line numbers; everything else is pinned.
    const frames = verbose.stderr.replace(
      /(\n {4}at [^\n]+)+/,
      "\n    at <frames>"
    );
    expect(plain.stderr).toMatchSnapshot("without --verbose");
    expect(frames).toMatchSnapshot("with --verbose");
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

describe("a rollback refused for want of consent", () => {
  /** The ledger's record of one applied migration. */
  function applied(filename: string): SchemaEventRow {
    return {
      id: `${filename}-applied`,
      eventType: "file_apply",
      status: "applied",
      source: "cli-migrate",
      filename,
      sha256: null,
      scopeKind: null,
      scopeSlug: null,
      startedAt: new Date(1000),
      endedAt: new Date(1000),
      durationMs: null,
      note: null,
      statementsExecuted: null,
      supersededEventIds: null,
      supersededBy: null,
    };
  }

  it("ends with what it would delete and the consent that allows it, running nothing", async () => {
    const executed: string[] = [];
    const error = await migrateDownCore({
      dialect: "postgresql",
      db: {},
      nodeEnv: "development",
      logger: createLogger({ quiet: true }),
      options: { step: 1, allowDataLoss: false, yes: false, dryRun: false },
      listFileApplies: async () => [applied("20261020_120000_add_summary.sql")],
      fileExists: async () => true,
      readDownSql: async () => ({
        sql: 'ALTER TABLE "dc_posts" DROP COLUMN "summary";',
        transaction: true,
      }),
      execDown: async (statements: readonly string[]) => {
        executed.push(...statements);
        return statements.length;
      },
      recordRolledBack: async () => true,
      recordFailed: async () => {},
      withLock: async <T>(
        _db: unknown,
        _dialect: unknown,
        fn: () => Promise<T>
      ): Promise<{ ran: true; value: T }> => ({ ran: true, value: await fn() }),
    }).then(
      () => undefined,
      (thrown: unknown) => thrown
    );

    expect(executed).toEqual([]);
    const text = formatCliError(toCliError(error));
    expectTheShape(
      text,
      "DATA_LOSS_CONSENT_REQUIRED",
      "data-loss-consent-required"
    );
    expect(shapeOf(text).next).toContain("--accept-data-loss");
    expect(text).toMatchSnapshot();
  });
});

describe("a plugin uninstall refused for want of consent", () => {
  // The uninstall judges its drops with the same consent as every command, so it ends with the
  // same codes, keeping its own way out (`--keep-data`) in the Next line.
  it.each([
    [undefined, "DATA_LOSS_CONSENT_REQUIRED"],
    ["seo_settings", "DATA_LOSS_CONSENT_NOT_COVERED"],
  ] as const)("with consent %s ends as %s", async (flag, code) => {
    const error = toCliError(await uninstallRefused(flag));
    expect(error.code).toBe(code);
    const text = formatCliError(error);
    expectTheShape(text, code, cliErrorSlug(code));
    expect(shapeOf(text).next).toContain("--keep-data");
  });
});

describe("the shape in colour", () => {
  it("lines a multi-line Why up under its first line, as it does without colour", async () => {
    // A coloured label carries escape codes a terminal does not show; the lines below it must be
    // indented by what the terminal shows.
    const error = toCliError(await ERROR_CASES.DATA_LOSS_CONSENT_REQUIRED());
    expect(error.why).toContain("\n");
    const coloured = formatCliError(error, { color: true });
    expect(coloured).not.toBe(formatCliError(error));
    expect(stripVTControlCharacters(coloured)).toBe(formatCliError(error));
  });
});

describe("which code an error reads as", () => {
  it("is the code for its own reason, even where a predicate for another error also holds", () => {
    // The field-group storage refusals are known by a context key, with no reason of their own;
    // a lock lost while held names its reason. One carrying both is the lock's.
    const error = toCliError(
      new NextlyError({
        code: "SERVICE_UNAVAILABLE",
        publicMessage:
          "The schema lock was lost while held: another run took it. Run it again once that finishes.",
        logContext: {
          reason: "schema lock lost while held",
          [REFUSAL_KIND_KEY]: "in-flight",
        },
      })
    );
    expect(error.code).toBe("SCHEMA_LOCK_LOST");
  });
});

describe("a build that fails twice over", () => {
  it("prints the warnings --strict failed on beside the invalid declarations", () => {
    // Under --strict the warnings print only inside the error, so a merged failure that dropped
    // them would never show them.
    const text = formatCliError(
      buildFailed([
        buildDeclarationsInvalid([
          {
            location: "collections.posts.rating",
            message: "unknown field type 'stars'",
          },
        ]),
        buildStrictWarnings(["collections.posts has no admin title field"]),
      ])
    );
    expectTheShape(text, "CONFIG_INVALID", "config-invalid");
    expect(text).toContain(
      "collections.posts.rating: unknown field type 'stars'"
    );
    expect(text).toContain("collections.posts has no admin title field");
    expect(text).toContain("without `--strict`");
  });
});

describe("a configuration that imports a package that is not installed", () => {
  it("names the package, as CONFIG_IMPORT_NOT_FOUND rather than a configuration that threw", () => {
    // A package import is left for Node to load when the compiled configuration runs, so it
    // fails as Node's own module-not-found error, with no esbuild message to read. That load
    // cannot run inside the test runner's sandbox, so Node raises the error in a process of its
    // own, and it is wrapped as the config loader wraps a load failure.
    const probe = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        'import("@acme/not-installed-plugin").catch(e => console.log(JSON.stringify({ code: e.code, message: e.message })))',
      ],
      { cwd: project, encoding: "utf8" }
    );
    const raised = JSON.parse(probe.stdout) as {
      code: string;
      message: string;
    };
    expect(raised.code).toBe("ERR_MODULE_NOT_FOUND");
    const cause = Object.assign(new Error(raised.message), {
      code: raised.code,
    });

    const error = toCliError(
      new NextlyError({
        code: "INVALID_INPUT",
        publicMessage: "Failed to load Nextly configuration.",
        statusCode: 400,
        logMessage: "Config loader error",
        logContext: {
          configPath: join(project, "nextly.config.ts"),
          reason: "load-error",
          cause: raised.message,
        },
        cause,
      })
    );
    expect(error.code).toBe("CONFIG_IMPORT_NOT_FOUND");
    expect(error.why).toBe(
      "`@acme/not-installed-plugin` is not installed in the project."
    );
  });
});

describe("a --json run that fails", () => {
  it("prints one JSON document and nothing else, as before", async () => {
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("DB_DIALECT", "");
    const { stdout, stderr, code } = await runCli(["migrate:status", "--json"]);
    expect(code).toBe(1);
    expect(JSON.parse(stdout)).toEqual({ error: expect.any(String) });
    // A reader taking standard output and error together still gets one document.
    expect(stderr).not.toContain("✗");
    expect(stderr).not.toContain("Docs:");
  });
});

describe("a block manifest that cannot be read", () => {
  it("is BLOCK_MANIFEST_UNREADABLE, read from the real read's own refusal", async () => {
    // A folder where the manifest goes: present, and not a file a read can open.
    const types = join(project, "src", "types", "nextly-types.ts");
    mkdirSync(join(project, "src", "types", "blocks.manifest.json"), {
      recursive: true,
    });
    const thrown = await readBlockManifestState([], types, project).then(
      () => undefined,
      (error: unknown) => error
    );
    const error = toCliError(thrown);
    expect(error.code).toBe("BLOCK_MANIFEST_UNREADABLE");
    expect(error.what).toContain("blocks.manifest.json");
    expect(error.why).toMatch(/EISDIR/);
  });
});
