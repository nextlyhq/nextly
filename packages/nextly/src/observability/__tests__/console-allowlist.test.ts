/**
 * Source writes through a masked logger, never to the console directly, and the files exempt
 * from that may only be the ones `eslint-console-allowlist.json` names.
 *
 * Outside development and test, every email address Nextly logs is masked, but only on the way
 * through a logger: a bare `console.*` call writes whatever it is handed, and so does `console`
 * itself handed over as a logger. `no-console` and `no-restricted-globals` refuse both anywhere
 * in `src/`, apart from the `terminal` writers: the sinks the loggers end in, and output for a
 * person at a terminal. Each says why it may.
 *
 * The controls lint through the configurations as committed, so a deleted rule block or a
 * `files` pattern that stopped matching fails here rather than reading as clean.
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

/**
 * The terminal entries, read as JSON as the ESLint config reads them, and narrowed rather than
 * asserted. The file holds that one section: any other would be an exemption nothing here
 * checks, so it is refused.
 */
function readTerminal(): ReadonlyMap<string, string> {
  const parsed: unknown = JSON.parse(
    readFileSync(join(packageRoot, ALLOWLIST_FILE), "utf8")
  );
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new TypeError(`${ALLOWLIST_FILE} must be an object`);
  }
  const sections = Object.keys(parsed);
  if (sections.length !== 1 || sections[0] !== "terminal") {
    throw new TypeError(
      `${ALLOWLIST_FILE} must hold only "terminal", got ${sections.join(", ")}`
    );
  }
  const section: unknown = (parsed as Record<string, unknown>).terminal;
  if (typeof section !== "object" || section === null) {
    throw new TypeError(`${ALLOWLIST_FILE}: "terminal" must be an object`);
  }
  const terminal = new Map<string, string>();
  for (const [path, reason] of Object.entries(section)) {
    // Every entry is permanent, so each one says why.
    if (typeof reason !== "string" || reason.trim() === "") {
      throw new TypeError(`${ALLOWLIST_FILE}: ${path} must give its reason`);
    }
    terminal.set(path, reason);
  }
  return terminal;
}

const TERMINAL = readTerminal();

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

/**
 * The console handed over as a value, as a logger argument is: it writes as directly as a call,
 * and `no-console` does not see it.
 */
const VALUE_PROBE_SOURCE = `
export const __consoleValueProbe: unknown = console;
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

function withSource(relativePath: string, probe: string): string {
  return readFileSync(join(packageRoot, relativePath), "utf8") + probe;
}

describe("the console guard", () => {
  it("refuses a console write in a file the allowlist does not cover", async () => {
    // The positive control. Every other check here is a form of "nothing was reported".
    expect(
      await ruleIds(
        packageRoot,
        UNEXEMPTED_FILE,
        withSource(UNEXEMPTED_FILE, PROBE_SOURCE)
      )
    ).toContain("no-console");
  }, 60_000);

  it("refuses the console handed over as a value, outside the exempt files", async () => {
    expect(
      await ruleIds(
        packageRoot,
        UNEXEMPTED_FILE,
        withSource(UNEXEMPTED_FILE, VALUE_PROBE_SOURCE)
      )
    ).toContain("no-restricted-globals");
    expect(
      await ruleIds(
        packageRoot,
        TERMINAL_FILE,
        withSource(TERMINAL_FILE, VALUE_PROBE_SOURCE)
      )
    ).not.toContain("no-restricted-globals");
  }, 60_000);

  it("refuses it through the repository-root config too", async () => {
    // lint-staged runs from the root, where only the root config is read.
    expect(
      await ruleIds(
        repoRoot,
        `packages/nextly/${UNEXEMPTED_FILE}`,
        withSource(UNEXEMPTED_FILE, PROBE_SOURCE)
      )
    ).toContain("no-console");
  }, 60_000);

  it("does not refuse it in a terminal file", async () => {
    // The complement: the exemption is what suppresses the rule.
    expect(
      await ruleIds(
        packageRoot,
        TERMINAL_FILE,
        withSource(TERMINAL_FILE, PROBE_SOURCE)
      )
    ).not.toContain("no-console");
  }, 60_000);

  it("names only paths that exist", () => {
    // A stale entry would exempt whatever later appears at that path.
    const missing = [...TERMINAL.keys()].filter(
      entry => !existsSync(join(packageRoot, entry.replace(/\/\*\*$/, "")))
    );
    expect(missing).toEqual([]);
  });
});
