/**
 * Source writes through a masked logger, never to the console directly, and the files exempt
 * from that may only be the ones `eslint-console-allowlist.json` names.
 *
 * Outside development and test, every email address Nextly logs is masked, but only on the way
 * through a logger: a bare `console.*` call writes whatever it is handed. `no-console` refuses
 * one anywhere in `src/`, apart from the `terminal` writers (the sinks the loggers end in, and
 * output for a person at a terminal) and the `pending` files not yet routed through a logger.
 *
 * As with the bare-`Error` allowlist, calls are counted by ESLINT rather than by a text search:
 * the rule also refuses a reference such as `const log = console.log`, which a search for calls
 * would miss, and one question gets one answer. The controls lint through the configurations as
 * committed, so a deleted rule block or a `files` pattern that stopped matching fails here rather
 * than reading as clean.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

const packageRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../.."
);
const repoRoot = resolve(packageRoot, "../..");

const ALLOWLIST_FILE = "eslint-console-allowlist.json";

interface ConsoleAllowlist {
  terminal: ReadonlyMap<string, string>;
  pending: ReadonlyMap<string, number>;
}

/** An object section of the allowlist, or a TypeError naming it. */
function section(parsed: unknown, name: "terminal" | "pending"): object {
  const value: unknown =
    typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)[name]
      : undefined;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${ALLOWLIST_FILE} must hold a "${name}" object`);
  }
  return value;
}

/** Terminal entries are permanent, so each one says why. */
function readTerminal(parsed: unknown): ReadonlyMap<string, string> {
  const terminal = new Map<string, string>();
  for (const [path, reason] of Object.entries(section(parsed, "terminal"))) {
    if (typeof reason !== "string" || reason.trim() === "") {
      throw new TypeError(`${ALLOWLIST_FILE}: ${path} must give its reason`);
    }
    terminal.set(path, reason);
  }
  return terminal;
}

/** A converted file leaves the list rather than sitting at zero. */
function readPending(parsed: unknown): ReadonlyMap<string, number> {
  const pending = new Map<string, number>();
  for (const [path, count] of Object.entries(section(parsed, "pending"))) {
    if (typeof count !== "number" || !Number.isInteger(count) || count < 1) {
      throw new TypeError(
        `${ALLOWLIST_FILE}: ${path} must map to a positive integer, got ${String(count)}`
      );
    }
    pending.set(path, count);
  }
  return pending;
}

/** Read as JSON, as the ESLint config reads it, and narrowed rather than asserted. */
function readAllowlist(): ConsoleAllowlist {
  const parsed: unknown = JSON.parse(
    readFileSync(join(packageRoot, ALLOWLIST_FILE), "utf8")
  );
  return { terminal: readTerminal(parsed), pending: readPending(parsed) };
}

const ALLOWLIST = readAllowlist();

/** A production file the allowlist does not cover: the subject of the positive control. */
const UNEXEMPTED_FILE = "src/errors/error-codes.ts";

/** A terminal file, for the complement. */
const TERMINAL_FILE = "src/shared/types/index.ts";

/** A console write the guard must refuse, appended to a real file so the project can parse it. */
const PROBE_SOURCE = `
export function __consoleGuardProbe(): void {
  console.log("probe");
}
`;

/** The rule ids ESLint reports for `source` at `relativePath`, through the config at `cwd` as committed. */
async function ruleIds(
  cwd: string,
  relativePath: string,
  source: string
): Promise<string[]> {
  const results = await new ESLint({ cwd }).lintText(source, {
    filePath: join(cwd, relativePath),
  });
  const messages = results[0]?.messages ?? [];
  // A parse failure is a fatal message with no rule, which would otherwise read as "the rule did
  // not fire": the same answer a working exemption gives.
  const fatal = messages.find(message => message.fatal);
  if (fatal)
    throw new Error(`${relativePath} failed to parse: ${fatal.message}`);
  return messages
    .map(message => message.ruleId)
    .filter((ruleId): ruleId is string => ruleId !== null);
}

function withProbe(relativePath: string): string {
  return readFileSync(join(packageRoot, relativePath), "utf8") + PROBE_SOURCE;
}

/** Console writes in a file the rule exempts, counted by re-enabling the rule for that path. */
async function consoleCount(relativePath: string): Promise<number> {
  const eslint = new ESLint({
    cwd: packageRoot,
    // The package config is kept, not replaced: it supplies the TypeScript parser.
    overrideConfig: {
      files: ["**/*.ts", "**/*.tsx"],
      rules: { "no-console": "error" },
    },
    ignore: false,
  });
  const results = await eslint.lintText(
    readFileSync(join(packageRoot, relativePath), "utf8"),
    { filePath: join(packageRoot, relativePath) }
  );
  const messages = results[0]?.messages ?? [];
  return messages.filter(m => m.ruleId === "no-console").length;
}

describe("the console guard", () => {
  it("refuses a console write in a file the allowlist does not cover", async () => {
    // The positive control. Every other check here is a form of "nothing was reported".
    expect(
      await ruleIds(packageRoot, UNEXEMPTED_FILE, withProbe(UNEXEMPTED_FILE))
    ).toContain("no-console");
  }, 60_000);

  it("refuses it through the repository-root config too", async () => {
    // lint-staged runs from the root, where only the root config is read.
    expect(
      await ruleIds(
        repoRoot,
        `packages/nextly/${UNEXEMPTED_FILE}`,
        withProbe(UNEXEMPTED_FILE)
      )
    ).toContain("no-console");
  }, 60_000);

  it("does not refuse it in a terminal file or a pending one", async () => {
    // The complement: the exemptions are what suppress the rule. A pending
    // file is checked while there is one; an empty list is where it ends.
    const pendingFile = [...ALLOWLIST.pending.keys()][0];
    const exempt =
      pendingFile === undefined
        ? [TERMINAL_FILE]
        : [TERMINAL_FILE, pendingFile];
    for (const file of exempt) {
      expect(await ruleIds(packageRoot, file, withProbe(file))).not.toContain(
        "no-console"
      );
    }
  }, 60_000);

  it("names only paths that exist", () => {
    // A stale entry would exempt whatever later appears at that path.
    const missing = [
      ...ALLOWLIST.terminal.keys(),
      ...ALLOWLIST.pending.keys(),
    ].filter(
      entry => !existsSync(join(packageRoot, entry.replace(/\/\*\*$/, "")))
    );
    expect(missing).toEqual([]);
  });

  it("holds exactly the console writes it pins for each pending file", async () => {
    // A write added to a pending file fails here, and so does one removed without lowering its
    // number: the list only shrinks, and only on purpose.
    const drift: string[] = [];
    for (const [file, pinned] of ALLOWLIST.pending) {
      const actual = await consoleCount(file);
      if (actual !== pinned)
        drift.push(`${file}: pinned ${pinned}, has ${actual}`);
    }
    expect(drift).toEqual([]);
  }, 300_000);
});
