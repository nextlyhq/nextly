/**
 * The bare-`Error` allowlist may only shrink, and the guard it exempts files from must be live.
 *
 * `eslint-bare-error-allowlist.json` exempts the files that still throw a bare `Error`. An
 * exemption that outlives its reason turns the list into folklore: the next reader cannot tell
 * which entries are load-bearing and which are simply old, so nobody removes any of them. This
 * fails on a stale entry, which makes removal the path of least resistance once a file is cleaned.
 *
 * Violations are counted by ESLINT, not by a regex over the source. The guard is an AST selector
 * and a text search is a second implementation of the same question — it would disagree on a
 * throw split across lines, or on `const e = new Error(); throw e;`, and the disagreement would be
 * silent in whichever direction happened not to be tested. Asking the linter means there is one
 * answer.
 *
 * The selector is READ BACK from the package configuration rather than restated here, and the
 * controls below lint through that configuration unmodified. A suite that installed its own copy
 * of the rule would stay green if the real rule block were deleted or its `files` pattern stopped
 * matching production sources: it would be proving that a test-local rule works.
 */

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { ESLint } from "eslint";
import { beforeAll, describe, expect, it } from "vitest";

const packageRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../.."
);

/**
 * The number of exemptions this list is allowed to hold. It may only be LOWERED. Adding a file to
 * the allowlist silences the guard for it, and nothing else in the repository would show that
 * happening — the lint run stays green by construction. Requiring the same change to edit this
 * number puts the growth in the diff where review can see it.
 *
 * The value is the ledger's live size: it drops by one each time a file's remaining bare throws
 * are converted to NextlyError and its entry is deleted — the reader below rejects zero-valued
 * entries, so a fully cleaned file leaves the ledger entirely rather than sitting at 0.
 */
const EXPECTED_ALLOWLIST_SIZE = 96;

const ALLOWLIST_FILE = "eslint-bare-error-allowlist.json";

/**
 * Read as JSON rather than imported as a module: the list is data, and the ESLint config reads it
 * the same way. One file, two readers, no build step or declaration file between them.
 */
function readAllowlist(): ReadonlyMap<string, number> {
  const parsed: unknown = JSON.parse(
    readFileSync(join(packageRoot, ALLOWLIST_FILE), "utf8")
  );
  // Narrowed rather than asserted. A malformed file would otherwise reach the loops below as an
  // empty or wrong-shaped value, and a file that parsed to nothing would report a perfectly
  // clean allowlist rather than a broken one.
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new TypeError(
      `${ALLOWLIST_FILE} must be an object mapping each exempted path to its throw count`
    );
  }
  const entries = new Map<string, number>();
  for (const [path, count] of Object.entries(parsed)) {
    if (typeof count !== "number" || !Number.isInteger(count) || count < 1) {
      throw new TypeError(
        `${ALLOWLIST_FILE}: ${path} must map to a positive integer, got ${String(count)}`
      );
    }
    entries.set(path, count);
  }
  return entries;
}

const BARE_ERROR_ALLOWLIST = readAllowlist();
const ALLOWLIST_PATHS = [...BARE_ERROR_ALLOWLIST.keys()];

/**
 * A production file the allowlist does not cover, used to read the configured rule back and as
 * the subject of the positive control. If it were ever added to the allowlist the rule would
 * resolve to nothing here and `configuredSelector` would fail rather than silently measure less.
 */
const UNEXEMPTED_FILE = "src/errors/error-codes.ts";

/** A throw the guard must reject, appended to a real file so the TypeScript project can parse it. */
const PROBE_SOURCE = `
export function __bareErrorGuardProbe(): never {
  throw new Error("probe");
}
`;

/** Lints through the package configuration exactly as committed — no rule injected, no ignore override. */
function packageLinter(): ESLint {
  return new ESLint({ cwd: packageRoot });
}

async function bareThrowRuleIds(
  relativePath: string,
  source: string
): Promise<string[]> {
  const results = await packageLinter().lintText(source, {
    filePath: join(packageRoot, relativePath),
  });
  const messages = results[0]?.messages ?? [];
  // A parse failure arrives as a fatal message with a null ruleId and would otherwise read as
  // "the rule did not fire", which is the same answer a working exemption gives.
  const fatal = messages.find(message => message.fatal);
  if (fatal)
    throw new Error(`${relativePath} failed to parse: ${fatal.message}`);
  return messages
    .map(message => message.ruleId)
    .filter((ruleId): ruleId is string => ruleId !== null);
}

/** The selector the package configuration actually installs, so the count below cannot measure a different rule. */
async function configuredSelector(): Promise<string> {
  const config = await packageLinter().calculateConfigForFile(
    join(packageRoot, UNEXEMPTED_FILE)
  );
  const entry: unknown = config.rules?.["no-restricted-syntax"];
  if (!Array.isArray(entry)) {
    throw new TypeError(
      `no-restricted-syntax is not configured for ${UNEXEMPTED_FILE}; the guard is not mounted`
    );
  }
  const option: unknown = entry[1];
  if (
    typeof option !== "object" ||
    option === null ||
    !("selector" in option) ||
    typeof option.selector !== "string"
  ) {
    throw new TypeError(
      "no-restricted-syntax is configured without a string selector"
    );
  }
  return option.selector;
}

let selector: string;

beforeAll(async () => {
  selector = await configuredSelector();
});

/**
 * Counts violations in a file the rule EXEMPTS, which requires re-enabling it for that path. The
 * selector comes from the real configuration, so this measures the same question the guard asks.
 * `ignore: false` is needed because some allowlisted paths would otherwise be skipped outright.
 */
async function bareThrowCount(relativePath: string): Promise<number> {
  const eslint = new ESLint({
    cwd: packageRoot,
    // The repository config is KEPT, not replaced: it supplies the TypeScript parser, without
    // which nothing here parses and every count comes back zero.
    overrideConfig: {
      files: ["**/*.ts", "**/*.tsx"],
      rules: { "no-restricted-syntax": ["error", { selector, message: "x" }] },
    },
    ignore: false,
  });

  const results = await eslint.lintText(
    readFileSync(join(packageRoot, relativePath), "utf8"),
    { filePath: join(packageRoot, relativePath) }
  );
  const messages = results[0]?.messages ?? [];
  return messages.filter(m => m.ruleId === "no-restricted-syntax").length;
}

describe("the bare-Error guard", () => {
  it("rejects a bare throw in a file the allowlist does not cover", async () => {
    // The positive control, and it runs through the committed configuration. Every other
    // assertion here is a form of "nothing was reported"; without this, a deleted rule block, a
    // `files` pattern that stopped matching, or a parser failure would all read as clean.
    const ruleIds = await bareThrowRuleIds(
      UNEXEMPTED_FILE,
      readFileSync(join(packageRoot, UNEXEMPTED_FILE), "utf8") + PROBE_SOURCE
    );
    expect(ruleIds).toContain("no-restricted-syntax");
  }, 60_000);

  it("does not reject the same throw in an allowlisted file", async () => {
    // The complement: proves the exemptions are what suppress the rule, rather than the rule
    // being inert everywhere.
    const exempted = ALLOWLIST_PATHS[0];
    // Narrowed rather than asserted: an empty allowlist would otherwise reach `join` as
    // `undefined` and fail on a path error, which reads as a broken test rather than as the
    // control having nothing to run against.
    if (exempted === undefined) {
      throw new TypeError(
        `${ALLOWLIST_FILE} is empty; there is nothing to exempt`
      );
    }
    const ruleIds = await bareThrowRuleIds(
      exempted,
      readFileSync(join(packageRoot, exempted), "utf8") + PROBE_SOURCE
    );
    expect(ruleIds).not.toContain("no-restricted-syntax");
  }, 60_000);
});

describe("the bare-Error allowlist", () => {
  it("holds no more entries than have been accepted", () => {
    expect(
      ALLOWLIST_PATHS.length,
      `${ALLOWLIST_FILE} has ${ALLOWLIST_PATHS.length} entries. If files were cleaned, ` +
        `lower EXPECTED_ALLOWLIST_SIZE to match. If an entry was ADDED, convert the file to ` +
        `NextlyError instead: this number may only go down.`
    ).toBe(EXPECTED_ALLOWLIST_SIZE);
  });

  it("exempts no file that lint already skips", async () => {
    // An entry the base config ignores globally — anything under `__tests__`, for instance — is
    // not an exemption at all: production lint never reaches the file. It would sit here forever,
    // since it does contain a real throw and so never reads as stale.
    const eslint = packageLinter();
    const redundant: string[] = [];
    for (const entry of ALLOWLIST_PATHS) {
      if (await eslint.isPathIgnored(join(packageRoot, entry)))
        redundant.push(entry);
    }

    expect(
      redundant,
      `these paths are already ignored by the base configuration, so exempting them does ` +
        `nothing and they can never go stale — remove them from ${ALLOWLIST_FILE}: ` +
        `${redundant.join(", ")}`
    ).toEqual([]);
  }, 60_000);

  it("exempts each file for exactly the throws it had, no more", async () => {
    // Counted rather than merely non-zero, and that difference is the point. A file-wide
    // exemption checked only for "still has at least one" lets an already-listed file gain new
    // throws forever — and the listed files are the dispatchers and services edited most often,
    // so the guard would be quietest exactly where it is needed most. Comparing the number
    // rejects an ADDED throw and a REMOVED one alike: one fails the count upward, the other
    // downward, and both have to be reflected in the file before the suite goes green.
    const drifted: string[] = [];
    for (const [entry, allowed] of BARE_ERROR_ALLOWLIST) {
      const actual = await bareThrowCount(entry);
      if (actual !== allowed) {
        drifted.push(`${entry}: allowed ${allowed}, found ${actual}`);
      }
    }

    expect(
      drifted,
      `the recorded throw count is wrong for these files. A LOWER count means they were ` +
        `cleaned — lower the number, or remove the entry entirely at zero, so the guard starts ` +
        `protecting them. A HIGHER count means a new bare throw was added: use NextlyError ` +
        `instead of raising the number. In ${ALLOWLIST_FILE}: ${drifted.join("; ")}`
    ).toEqual([]);
  }, 180_000);
});
