/**
 * What the merge queue needs from the workflows behind its required checks,
 * held on the workflow files themselves.
 *
 * The queue merges a pull request only when every required check passes on
 * the queue's own commit. A workflow that does not run on that event, or that
 * filters itself out by path, creates no check there, and the queue waits for
 * a result that never comes. A job that runs but skips its work on that event
 * reports a pass it did not earn. Neither shows up until the queue is switched
 * on, so the shape is checked here, before it is.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { posix } from "node:path";
import { isBuiltin } from "node:module";

import { load } from "js-yaml";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const read = path => load(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"));
/** js-yaml reads the bare key `on` as the boolean `true`, as YAML 1.1 does. */
const triggersOf = workflow => workflow.on ?? workflow[true];

/** The required checks each workflow carries, by the names the ruleset requires. */
const QUEUE_CHECKS = {
  ".github/workflows/ci.yml": ["CI gate", "Comment convention (describes code, not process)"],
  ".github/workflows/integration.yml": ["Integration (postgres)", "Integration (mysql)", "Integration (sqlite)"],
  ".github/workflows/pr-title.yml": ["Validate PR title follows Conventional Commits"],
  ".github/workflows/independent-review.yml": ["Independent review of the revision being merged"],
  ".github/workflows/secret-scan.yml": ["gitleaks"],
};

describe("every workflow behind a required check, in the merge queue", () => {
  for (const [path, checks] of Object.entries(QUEUE_CHECKS)) {
    const workflow = read(path);
    const triggers = triggersOf(workflow);

    it(`${path} runs on the queue's event`, () => {
      expect(triggers.merge_group).toEqual({ types: ["checks_requested"] });
    });

    it(`${path} never filters itself out by path, on any event`, () => {
      for (const [event, filter] of Object.entries(triggers)) {
        expect(Object.keys(filter ?? {}), event).not.toContain("paths");
        expect(Object.keys(filter ?? {}), event).not.toContain("paths-ignore");
      }
    });

    it(`${path} still names its required checks exactly`, () => {
      const names = Object.values(workflow.jobs).map(job => job.name);
      for (const check of checks) expect(names).toContain(check);
    });
  }
});

describe("the change scope, which decides whether required jobs run", () => {
  for (const [path, job] of [
    [".github/workflows/ci.yml", "changes"],
    [".github/workflows/integration.yml", "changes"],
  ]) {
    it(`${path} takes its range from the event through the one shared script`, () => {
      const steps = read(path).jobs[job].steps;
      const decide = steps.find(step => step.id === "decide");
      expect(decide.run).toBe("node scripts/change-scope.mjs");
      expect(decide.env.INERT_PATHS).toBeTruthy();
      // Both ends of every range have to be in the checkout.
      expect(steps.find(step => String(step.uses).startsWith("actions/checkout@")).with["fetch-depth"]).toBe(0);
    });
  }
});

describe("the changeset check in the queue", () => {
  /*
   * A group's head holds every member's changes. Compared with `HEAD^1` it
   * would read only the last member's changesets, so in the queue it is
   * compared with the queue's base.
   */
  it("compares a queued group with the queue's base", () => {
    const step = read(".github/workflows/ci.yml").jobs.ci.steps.find(candidate => candidate.name === "Changeset covers the lockstep group");
    expect(step.env.QUEUE_BASE).toBe("${{ github.event.merge_group.base_sha }}");
    expect(step.run).toMatch(/git diff --name-only --diff-filter=ACMRT "\$base" HEAD/);
    expect(step.run).toMatch(/base="\$QUEUE_BASE"/);
  });
});

describe("the last commit Integration tested", () => {
  /*
   * The change scope of a push compares with the last commit this workflow
   * tested. A run where one leg judged the commit and another was cancelled
   * did not test it on the second dialect, so every leg is named as the work.
   */
  it("counts a run as tested only when every leg reached a verdict", () => {
    const workflow = read(".github/workflows/integration.yml");
    const legs = Object.values(workflow.jobs).map(job => job.name).filter(name => name.startsWith("Integration ("));
    const ask = workflow.jobs.changes.steps.find(step => step.id === "newer");
    expect(legs.length).toBe(3);
    expect(ask.with["substantive-job"].split("\n").map(name => name.trim()).filter(Boolean).sort()).toEqual(legs.sort());
  });
});

describe("conditions that skip the queue's run", () => {
  /*
   * A step that runs on a pull request's own run but not in the queue is
   * skipped there while its job still reports success, and a job like that
   * reports `skipped`, which the gate accepts; either way the queue would merge
   * on a check that did less there than it does for a pull request. So no
   * condition in a job a required check stands on may run for a pull request's
   * event and not for the queue's.
   */
  for (const [path, checks] of Object.entries(QUEUE_CHECKS)) {
    it(`${path} does in the queue whatever it does on a pull request, in every job its required checks stand on`, () => {
      const workflow = read(path);
      expect(skippedInTheQueue(workflow, requiredJobs(workflow, checks))).toEqual([]);
    });
  }

  it("decides a condition by evaluating it for each event, not by its spelling", () => {
    const skips = [
      "github.event_name == 'pull_request'",
      "${{ always() && github.event_name == 'pull_request_target' }}",
      "github.event_name != 'merge_group'",
      "!(github.event_name == 'merge_group')",
      "contains(fromJSON('[\"push\", \"pull_request\"]'), github.event_name)",
      "startsWith(github.event_name, 'pull_request')",
      "GITHUB.EVENT_NAME == 'Pull_Request'",
      // False in the queue whatever the unknown side is.
      "needs.changes.outputs.inert != 'true' && github.event_name == 'pull_request'",
    ];
    const runs = [
      "",
      "github.event_name == 'pull_request' || github.event_name == 'merge_group'",
      "github.event_name == 'merge_group'",
      // Runs on neither, so it does no less in the queue.
      "github.event_name == 'push'",
      // Undecided by the event's name alone.
      "!cancelled()",
      "needs.changes.outputs.inert != 'true'",
      "github.event.pull_request.head.repo.fork == false",
      "needs.changes.outputs.inert != 'true' || github.event_name == 'pull_request'",
    ];
    for (const condition of skips) expect(skipsTheQueue(condition), condition).toBe(true);
    for (const condition of runs) expect(skipsTheQueue(condition), condition).toBe(false);
  });

  it("refuses a condition it cannot read, rather than passing it", () => {
    expect(() => skipsTheQueue("github.event_name == 'pull_request' &&")).toThrow(/cannot read the condition/);
    expect(() => skipsTheQueue("github.event_name == ")).toThrow(/cannot read the condition/);
    expect(() => skipsTheQueue("github.event_name 'pull_request'")).toThrow(/cannot read the condition/);
  });

  it("reads a gate's dependencies as part of it, and leaves a job no required check stands on out", () => {
    const ci = read(".github/workflows/ci.yml");
    expect(requiredJobs(ci, QUEUE_CHECKS[".github/workflows/ci.yml"])).toEqual(expect.arrayContaining(["gate", "ci", "changes", "comments"]));
    const title = read(".github/workflows/pr-title.yml");
    expect(requiredJobs(title, QUEUE_CHECKS[".github/workflows/pr-title.yml"])).toEqual(["lint"]);
  });
});

/**
 * The jobs a workflow's required checks stand on: each check's own job, and
 * every job it `needs`, however deep. A job outside that set, such as one that
 * only comments on a pull request, may be limited to a pull request's events.
 */
function requiredJobs(workflow, checks) {
  const seen = new Set();
  const visit = id => {
    if (seen.has(id)) return;
    seen.add(id);
    [workflow.jobs[id]?.needs ?? []].flat().forEach(visit);
  };
  Object.entries(workflow.jobs).filter(([, job]) => checks.includes(job.name)).forEach(([id]) => visit(id));
  return [...seen];
}

/** The given jobs, and the steps in them, whose condition skips the queue's run. */
function skippedInTheQueue(workflow, ids) {
  return ids.flatMap(id => [...skippingJob(id, workflow.jobs[id]), ...skippingSteps(id, workflow.jobs[id])]);
}

function skippingJob(id, job) {
  return skipsTheQueue(String(job.if ?? "")) ? [id] : [];
}

function skippingSteps(id, job) {
  return (job.steps ?? []).filter(step => skipsTheQueue(String(step.if ?? ""))).map(step => `${id}: ${step.name}`);
}

/**
 * Whether a condition can run for a pull request's event, `pull_request` or
 * `pull_request_target`, and cannot for the queue's. It is evaluated, not
 * matched by its spelling. The event's name is the one value known; any other
 * value is unknown, and a condition the name alone does not decide is left
 * undecided, which is not a skip.
 */
function skipsTheQueue(condition) {
  const outcome = event => truth(evaluate(condition, { "github.event_name": event }));
  return ["pull_request", "pull_request_target"].some(event => outcome(event) !== false) && outcome("merge_group") === false;
}

const UNKNOWN = Symbol("unknown");
const TOKEN = /\s*(?:('(?:[^']|'')*')|(\d+(?:\.\d+)?)|(==|!=|<=|>=|&&|\|\||[!<>(),])|([A-Za-z_][\w-]*(?:\.[\w*-]+)*))/y;
const LITERALS = { true: true, false: false, null: null };
const RELATIONS = { "<": (a, b) => a < b, "<=": (a, b) => a <= b, ">": (a, b) => a > b, ">=": (a, b) => a >= b };

/** The expression functions a condition can be decided by; any other, such as `success()`, is unknown. */
const FUNCTIONS = {
  always: () => true,
  contains: (within, item) => (Array.isArray(within) ? within.some(entry => looseEqual(entry, item)) : lower(within).includes(lower(item))),
  startswith: (text, prefix) => lower(text).startsWith(lower(prefix)),
  endswith: (text, suffix) => lower(text).endsWith(lower(suffix)),
  fromjson: text => JSON.parse(text),
};

/** A condition's value, with `${{ }}` optional around it, as GitHub accepts it; no condition always runs. */
function evaluate(condition, known) {
  const text = condition.trim().replace(/^\$\{\{([\s\S]*)\}\}$/, "$1").trim();
  if (text === "") return true;
  const parser = { tokens: tokenize(text, condition), at: 0, known, condition };
  const value = parseOr(parser);
  if (parser.at !== parser.tokens.length) unreadable(parser.condition);
  return value;
}

function tokenize(text, condition) {
  const pattern = new RegExp(TOKEN.source, "y");
  const tokens = [];
  while (pattern.lastIndex < text.length) {
    const match = pattern.exec(text) ?? unreadable(condition);
    tokens.push(tokenOf(match));
  }
  return tokens;
}

function tokenOf([, string, number, operator, name]) {
  if (string !== undefined) return { value: string.slice(1, -1).replaceAll("''", "'") };
  if (number !== undefined) return { value: Number(number) };
  return operator ?? { name };
}

function unreadable(condition) {
  throw new Error(`cannot read the condition ${JSON.stringify(condition)}`);
}

function parseOr(parser) {
  let left = parseAnd(parser);
  while (take(parser, "||")) left = or3(left, parseAnd(parser));
  return left;
}

function parseAnd(parser) {
  let left = parseEquality(parser);
  while (take(parser, "&&")) left = and3(left, parseEquality(parser));
  return left;
}

function parseEquality(parser) {
  let left = parseRelation(parser);
  for (let operator = takeAny(parser, ["==", "!="]); operator; operator = takeAny(parser, ["==", "!="])) {
    const equal = operator === "==";
    left = known2(left, parseRelation(parser), (a, b) => looseEqual(a, b) === equal);
  }
  return left;
}

function parseRelation(parser) {
  let left = parseUnary(parser);
  for (let operator = takeAny(parser, Object.keys(RELATIONS)); operator; operator = takeAny(parser, Object.keys(RELATIONS))) {
    const relation = RELATIONS[operator];
    left = known2(left, parseUnary(parser), (a, b) => relation(Number(a), Number(b)));
  }
  return left;
}

function parseUnary(parser) {
  if (!take(parser, "!")) return parsePrimary(parser);
  const operand = parseUnary(parser);
  return operand === UNKNOWN ? UNKNOWN : !operand;
}

function parsePrimary(parser) {
  if (take(parser, "(")) return closed(parser, parseOr(parser));
  const token = nextOperand(parser);
  if ("value" in token) return token.value;
  return take(parser, "(") ? call(token.name, parseArguments(parser)) : lookUp(token.name, parser.known);
}

/** A literal or a name; an operator, or nothing, where one belongs cannot be read. */
function nextOperand(parser) {
  const token = parser.tokens[parser.at];
  if (typeof token !== "object") unreadable(parser.condition);
  parser.at += 1;
  return token;
}

function parseArguments(parser) {
  const values = [];
  if (take(parser, ")")) return values;
  do values.push(parseOr(parser));
  while (take(parser, ","));
  return closed(parser, values);
}

function closed(parser, value) {
  if (!take(parser, ")")) unreadable(parser.condition);
  return value;
}

function take(parser, operator) {
  if (parser.tokens[parser.at] !== operator) return false;
  parser.at += 1;
  return true;
}

function takeAny(parser, operators) {
  return operators.find(operator => take(parser, operator));
}

function lookUp(name, known) {
  const key = name.toLowerCase();
  if (Object.hasOwn(LITERALS, key)) return LITERALS[key];
  return Object.hasOwn(known, key) ? known[key] : UNKNOWN;
}

function call(name, values) {
  const key = name.toLowerCase();
  return Object.hasOwn(FUNCTIONS, key) && !values.includes(UNKNOWN) ? FUNCTIONS[key](...values) : UNKNOWN;
}

/** `&&` with an unknown side: false when the other side is, since either way the result is. */
function and3(left, right) {
  if (left === UNKNOWN) return truth(right) === false ? false : UNKNOWN;
  return left ? right : left;
}

/** `||` with an unknown side: true when the other side is, since either way the result is. */
function or3(left, right) {
  if (left === UNKNOWN) return truth(right) === true ? true : UNKNOWN;
  return left || right;
}

function known2(left, right, operation) {
  return left === UNKNOWN || right === UNKNOWN ? UNKNOWN : operation(left, right);
}

/** GitHub's `==`: strings ignore case, and values of different types compare as numbers. */
function looseEqual(a, b) {
  if (typeof a === "string" && typeof b === "string") return lower(a) === lower(b);
  return typeof a === typeof b ? a === b : Number(a) === Number(b);
}

function lower(value) {
  return String(value).toLowerCase();
}

function truth(value) {
  return value === UNKNOWN ? UNKNOWN : Boolean(value);
}

describe("the independent-review gate", () => {
  const workflow = read(".github/workflows/independent-review.yml");
  const job = workflow.jobs.review;

  /*
   * The queue is where the reviews a pull request will get have had time to
   * arrive, and where the gate decides. It judges from the queue's base with
   * read-only access, so no queued change can rewrite what counts as a review
   * of itself.
   */
  it("decides in the queue, from the queue's base, with read access only", () => {
    expect(job.if).toBe("github.event_name == 'merge_group'");
    const checkout = job.steps.find(step => String(step.uses).startsWith("actions/checkout@"));
    expect(checkout.with.ref).toBe("${{ github.event.merge_group.base_sha }}");
    expect(checkout.with["fetch-depth"]).toBe(0);
    expect(workflow.permissions).toEqual({});
    expect(Object.values(job.permissions)).toEqual(["read", "read", "read"]);
    expect(job.steps.at(-1).run).toBe("node scripts/independent-review.mjs");
  });

  // The job installs no packages, so everything the script loads has to be
  // Node's own or a file of this repository's. A package import would pass
  // every test here, where the packages are installed, and fail in the queue.
  it("runs a script that loads nothing the job does not install", () => {
    expect(job.steps.some(step => /\binstall\b/.test(String(step.run)))).toBe(false);
    expect(packageImports(new URL("./independent-review.mjs", import.meta.url))).toEqual([]);
  });
});

const IMPORTED = /^\s*(?:import|export)\s[^;]*?\sfrom\s+["']([^"']+)["']|^\s*import\s+["']([^"']+)["']|\bimport\(\s*["']([^"']+)["']\s*\)/gm;

/** The specifiers a module names in its static and literal dynamic imports. */
function specifiersOf(url) {
  return [...readFileSync(url, "utf8").matchAll(IMPORTED)].map(match => match.slice(1).find(Boolean));
}

/** The package specifiers a module reaches through its relative imports, however deep. */
function packageImports(url, seen = new Set()) {
  if (seen.has(url.href)) return [];
  seen.add(url.href);
  return specifiersOf(url).flatMap(specifier => {
    if (specifier.startsWith(".")) return packageImports(new URL(specifier, url), seen);
    return isBuiltin(specifier) ? [] : [specifier];
  });
}

describe("the title check's permissions", () => {
  const workflow = read(".github/workflows/pr-title.yml");
  const writes = job => Object.values(job.permissions ?? {}).includes("write");

  it("grants nothing at the workflow level, so each job holds only what it declares", () => {
    expect(workflow.permissions).toEqual({});
  });

  it("checks the title with a read-only token", () => {
    const lint = Object.values(workflow.jobs).find(job => job.name === "Validate PR title follows Conventional Commits");
    expect(writes(lint)).toBe(false);
  });

  /*
   * `pull_request_target` hands a write-capable token to a run a fork's pull
   * request can start. A job holding one must run nothing a checkout could
   * supply: no checkout, no local action, no shell step.
   */
  it("gives write access only to jobs that run no repository code", () => {
    const writers = Object.entries(workflow.jobs).filter(([, job]) => writes(job));
    expect(writers.length).toBeGreaterThan(0);
    for (const [id, job] of writers) {
      for (const step of job.steps) {
        expect(String(step.uses ?? ""), `${id}: ${step.name}`).not.toMatch(/^(actions\/checkout@|\.\/)/);
        expect(step.run, `${id}: ${step.name}`).toBeUndefined();
      }
    }
  });

  /*
   * In the queue the checked-out tree holds the queued changes, so a queued
   * change to the validator would judge its own title. The checkout is the
   * queue's base instead, with the history the queued commits are read from.
   */
  it("runs the queue's check from the queue's base, with the queued commits in reach", () => {
    const checkout = workflow.jobs.lint.steps.find(step => String(step.uses).startsWith("actions/checkout@"));
    expect(checkout.with.ref).toBe("${{ github.event.merge_group.base_sha }}");
    expect(checkout.with["fetch-depth"]).toBe("${{ github.event_name == 'merge_group' && '0' || '1' }}");
  });

  it("never checks out the pull request's own head", () => {
    for (const job of Object.values(workflow.jobs)) {
      for (const step of job.steps) expect(JSON.stringify(step.with ?? {})).not.toMatch(/pull_request\.head/);
    }
  });

  it("hands the script every rule the workflow sets, through the environment", () => {
    const action = read(".github/actions/pr-title/action.yml");
    const env = action.runs.steps[0].env;
    for (const name of ["TYPES", "SCOPES", "REQUIRE_SCOPE", "SUBJECT_PATTERN", "SUBJECT_PATTERN_ERROR"]) {
      expect(Object.keys(env)).toContain(name);
    }
    const passed = workflow.jobs.lint.steps.find(step => step.id === "lint_pr_title").with;
    for (const [input, spec] of Object.entries(action.inputs)) {
      if (spec.required) expect(Object.keys(passed), input).toContain(input);
    }
  });
});

describe("who owns what the required checks run", () => {
  /*
   * A pull request runs its own copy of every workflow, action, script and
   * configuration a required check uses, so a change to any of them can change
   * what the check decides. `main`'s ruleset requires a code owner's review,
   * and it applies only to a path CODEOWNERS names, so each of them has to
   * have an owner there.
   */
  const rules = codeOwners(readFileSync(new URL("../.github/CODEOWNERS", import.meta.url), "utf8"));

  // An owner GitHub cannot resolve, or none at all, leaves a path unowned
  // however well the pattern matches, so each entry names an approved owner.
  it("names only approved owners, on every entry", () => {
    for (const rule of rules) expect(rule.owners.length > 0 && rule.owners.every(owner => APPROVED_OWNERS.includes(owner)), `${rule.pattern} ${rule.owners.join(" ")}`).toBe(true);
  });

  it("owns itself, the hooks, the package scripts and the configuration the checks read", () => {
    for (const path of [".github/CODEOWNERS", ".husky/pre-commit", ".husky/commit-msg", ".husky/pre-push", "package.json", ...CHECK_CONFIGURATION]) {
      expect(ownersOf(rules, path), path).not.toEqual([]);
    }
  });

  for (const [path, checks] of Object.entries(QUEUE_CHECKS)) {
    it(`owns ${path}, and every action and script its required jobs run`, () => {
      const workflow = read(path);
      for (const used of [path, ...pathsRunBy(workflow, requiredJobs(workflow, checks))]) expect(ownersOf(rules, used), used).not.toEqual([]);
    });
  }

  // A lane runs the test script a manifest names, with the configuration
  // beside it, over the task graph Turbo reads, so each of those is a check
  // definition too, wherever it sits.
  it("owns every manifest, task graph, and test, compiler, lint and build configuration in the repository", () => {
    const definitions = trackedFiles().filter(path => LANE_DEFINITIONS.test(path));
    // The control: the walk finds the repository's manifests and configurations, not nothing.
    expect(definitions.length).toBeGreaterThan(50);
    for (const path of definitions) expect(ownersOf(rules, path), path).not.toEqual([]);
  });

  // A configuration runs with whatever it extends or imports, so that is a
  // check definition too; each is found from the configurations themselves.
  it("owns every shared configuration a compiler or lint configuration extends or imports", () => {
    const files = trackedFiles();
    const packages = workspacePackages(files);
    const shared = files.filter(path => SHARING_CONFIGURATION.test(path)).flatMap(path => sharedConfigurationOf(path, packages));
    // The control: the walk reaches the shared packages, not nothing.
    expect(shared.some(path => path.startsWith("packages/tsconfig/"))).toBe(true);
    expect(shared.some(path => path.startsWith("packages/eslint-config/"))).toBe(true);
    // And a relative import, as the nextly package's lint configuration makes of its own rule.
    expect(shared.some(path => path.startsWith("packages/nextly/"))).toBe(true);
    for (const path of new Set(shared)) expect(ownersOf(rules, path), path).not.toEqual([]);
  });

  // The control: the walk reaches the scripts a required job runs, named
  // directly and through a package script, so an owned list is not an empty one.
  it("finds the scripts the CI gate's jobs run, directly and through a package script", () => {
    const ci = read(".github/workflows/ci.yml");
    const paths = pathsRunBy(ci, requiredJobs(ci, QUEUE_CHECKS[".github/workflows/ci.yml"]));
    expect(paths).toEqual(expect.arrayContaining(["scripts/change-scope.mjs", "scripts/check-comment-convention.mjs", "package.json"]));
  });

  it("reads only the patterns it understands, and refuses any other rather than guess", () => {
    for (const unread of ["**/x.mjs @a", "docs/x.md @a", "x?.md @a", "[ab].md @a", "!x.md @a"]) expect(() => codeOwners(unread), unread).toThrow(/reads only anchored paths and directories, and file names at any depth/);
    expect(ownersOf(codeOwners("/scripts/ @a\n/scripts/x.mjs @b"), "scripts/x.mjs")).toEqual(["@b"]);
    expect(ownersOf(codeOwners("/scripts/ @a\n/scripts/x.mjs"), "scripts/x.mjs")).toEqual([]);
    // A file name matches at any depth; an anchored path only where it is; a star never crosses a slash.
    expect(ownersOf(codeOwners("package.json @a"), "packages/nextly/package.json")).toEqual(["@a"]);
    expect(ownersOf(codeOwners("/package.json @a"), "packages/nextly/package.json")).toEqual([]);
    expect(ownersOf(codeOwners("vitest*.config.* @a"), "packages/ui/vitest.integration.config.ts")).toEqual(["@a"]);
    expect(ownersOf(codeOwners("/packages/*.json @a"), "packages/nextly/package.json")).toEqual([]);
  });
});

/** Who may approve a change to the checks. Adding an owner is a decision about that, made here and in CODEOWNERS together. */
const APPROVED_OWNERS = ["@mobeenabdullah"];

/** Configuration a required check reads, where a change alters what it decides. */
const CHECK_CONFIGURATION = [
  "pnpm-workspace.yaml",
  "pnpm-lock.yaml",
  ".nvmrc",
  "turbo.jsonc",
  ".changeset/config.json",
  ".commitlintrc.json",
  ".fallowrc.jsonc",
  ".gitleaks.toml",
  "eslint.config.mjs",
  "eslint.scripts.config.mjs",
  "fallow-health-baseline.json",
  "lint-staged.config.mjs",
  "tsconfig.base.json",
  "vitest.config.ts",
];

/**
 * CODEOWNERS rules, in order. Two forms are read: an anchored path or
 * directory, whose segments may hold a `*` that stays within one segment, and
 * a bare file name, which matches at any depth. Any other pattern is refused
 * rather than guessed at, since a guess at what a glob matches is exactly the
 * reading that would pass an unowned path.
 */
function codeOwners(text) {
  return text
    .split("\n")
    .map(line => line.replace(/#.*$/, "").trim())
    .filter(Boolean)
    .map(line => {
      const [pattern, ...owners] = line.split(/\s+/);
      return { pattern, owners, matches: matcherFor(readablePattern(pattern)) };
    });
}

const ANCHORED = /^\/[\w.*-]+(?:\/[\w.*-]+)*\/?$/;
const FILE_NAME = /^[\w.*-]+$/;

function readablePattern(pattern) {
  if (pattern.includes("**") || !(ANCHORED.test(pattern) || FILE_NAME.test(pattern))) {
    throw new Error(`this test reads only anchored paths and directories, and file names at any depth, not ${pattern}`);
  }
  return pattern;
}

function matcherFor(pattern) {
  const glob = part => part.split("*").map(text => text.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join("[^/]*");
  if (FILE_NAME.test(pattern)) return new RegExp(`(?:^|/)${glob(pattern)}$`);
  return new RegExp(`^${glob(pattern.slice(1))}${pattern.endsWith("/") ? "" : "$"}`);
}

/** A path's owners: the last rule that matches it decides, and a rule with no owners leaves it unowned. */
function ownersOf(rules, path) {
  return rules.filter(rule => rule.matches.test(path)).at(-1)?.owners ?? [];
}

/** Manifests, task graphs, and the test, compiler, lint and build configuration the lanes run with. */
const LANE_DEFINITIONS = /(?:^|\/)(?:package\.json|turbo\.jsonc?|tsconfig[^/]*\.json|(?:vitest|playwright|eslint|tsup)[^/]*\.config\.[^/]+)$/;

/** Compiler and lint configuration, which may extend or import shared configuration. */
const SHARING_CONFIGURATION = /(?:^|\/)(?:tsconfig[^/]*\.json|eslint[^/]*\.config\.[^/]+)$/;
const EXTENDS = /"extends"\s*:\s*(\[[^\]]*\]|"[^"]*")/;
const CONFIGURATION_IMPORT = /(?:\bfrom\s+|\brequire\(\s*|\bimport\(\s*)["']([^"']+)["']/g;

function readRepositoryFile(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

/** The workspace's packages by name, so a specifier naming one resolves to its directory. */
function workspacePackages(files) {
  const manifests = files.filter(path => /^packages\/[^/]+\/package\.json$/.test(path));
  return new Map(manifests.map(path => [JSON.parse(readRepositoryFile(path)).name, posix.dirname(path)]));
}

/** The repository files a configuration extends or imports: a relative path, or a workspace package by name. */
function sharedConfigurationOf(path, packages) {
  const text = readRepositoryFile(path);
  const extended = EXTENDS.exec(text)?.[1] ?? "";
  const specifiers = [...extended.matchAll(/"([^"]+)"/g), ...text.matchAll(CONFIGURATION_IMPORT)].map(match => match[1]);
  return specifiers.map(specifier => repositoryPathOf(specifier, path, packages)).filter(Boolean);
}

function repositoryPathOf(specifier, from, packages) {
  if (specifier.startsWith(".")) return posix.normalize(posix.join(posix.dirname(from), specifier));
  const [scope, name, ...rest] = specifier.split("/");
  const directory = packages.get(`${scope}/${name}`);
  return directory ? `${directory}/${rest.join("/") || "package.json"}` : null;
}

function trackedFiles() {
  return execFileSync("git", ["ls-files", "-z"], { cwd: fileURLToPath(new URL("..", import.meta.url)), encoding: "utf8" }).split("\0").filter(Boolean);
}

const PACKAGE_SCRIPTS = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).scripts;
const SCRIPT_PATH = /\bscripts\/[\w./-]+\.(?:mjs|cjs|js|sh)\b/g;

/** The local actions a set of jobs uses, and the scripts their steps name, directly or through a package script. */
function pathsRunBy(workflow, ids) {
  const steps = ids.flatMap(id => workflow.jobs[id].steps ?? []);
  const actions = steps.map(step => String(step.uses ?? "")).filter(uses => uses.startsWith("./")).map(uses => `${uses.slice(2)}/action.yml`);
  const texts = [...steps.map(step => String(step.run ?? "")), ...actions.map(action => readFileSync(new URL(`../${action}`, import.meta.url), "utf8"))];
  return [...new Set([...actions, ...texts.flatMap(scriptsNamedIn)])];
}

function scriptsNamedIn(text) {
  const viaPackage = [...text.matchAll(/\bpnpm (?:run )?([\w:-]+)/g)].map(match => PACKAGE_SCRIPTS[match[1]]).filter(Boolean);
  return [...[text, ...viaPackage].flatMap(source => [...source.matchAll(SCRIPT_PATH)].map(match => match[0])), ...(viaPackage.length > 0 ? ["package.json"] : [])];
}
