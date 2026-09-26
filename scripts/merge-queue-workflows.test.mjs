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
  ".github/workflows/ai-credit.yml": ["No AI credit"],
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
      // Runs for a pull request whatever the output is, and in the queue only for some of its values.
      "needs.changes.outputs.inert != 'true' || github.event_name == 'pull_request'",
      "!cancelled() || github.event_name == 'pull_request'",
      // An output between two numbers, and two calls of one function that may differ.
      "needs.x.outputs.n > 5 && needs.x.outputs.n < 10 && github.event_name == 'pull_request'",
      "hashFiles('a') != hashFiles('b') && github.event_name == 'pull_request'",
      // A call may return text, and what it returns for the event its arguments read; run on the values tried for an unknown, it skips where one of them does.
      "format('{0}', needs.changes.outputs.flag) == 'ready' && github.event_name == 'pull_request'",
      "format('{0}', github.event_name) == 'pull_request'",
      // An output holding neither text, both at once, or the event's name.
      "contains(needs.changes.outputs.flags, 'e') || github.event_name == 'pull_request'",
      "contains(needs.changes.outputs.flags, 'a') && contains(needs.changes.outputs.flags, 'b') && github.event_name == 'pull_request'",
      "needs.changes.outputs.target == github.event_name",
      // An output read as JSON, where text that is not JSON decides nothing.
      "fromJSON(needs.changes.outputs.run) && github.event_name == 'pull_request'",
      // The queue's payload holds no pull request, so a condition on one can skip it without reading the event's name.
      "github.event.pull_request.head.repo.full_name == github.repository",
      // Any other name under `github` may differ between the runs.
      "github.event.action == 'synchronize'",
      // One output that must pass two text tests at once, of literals or of the event's name.
      "startsWith(needs.x.outputs.value, 'a') && endsWith(needs.x.outputs.value, 'b') && github.event_name == 'pull_request'",
      "startsWith(needs.x.outputs.v, github.event_name) && endsWith(needs.x.outputs.v, 'b') && github.event_name != 'merge_group'",
      // `format` reads `{{` and `}}` as braces.
      "format('{{{0}}}', github.event_name) == '{pull_request}'",
      // A function GitHub runs is run here from its arguments, the event's name among them.
      "toJSON(github.event_name) == '\"pull_request\"'",
    ];
    const runs = [
      "",
      "github.event_name == 'pull_request' || github.event_name == 'merge_group'",
      "github.event_name == 'merge_group'",
      // Runs on neither, so it does no less in the queue.
      "github.event_name == 'push'",
      // Turns on an output alone, which reads the same for both events.
      "!cancelled()",
      "needs.changes.outputs.inert != 'true'",
      // Runs in the queue whenever it runs for a pull request, whatever the output is.
      "needs.changes.outputs.inert != 'true' || github.event_name == 'merge_group'",
      "needs.changes.outputs.inert == 'false' && (github.event_name == 'pull_request' || github.event_name == 'merge_group')",
      // Never reads the event's name, however many outputs it reads: nothing to try.
      Array.from({ length: 12 }, (_, n) => `needs.job${n}.result == 'success'`).join(" && "),
      // A pull request's fields are null in the queue; null equals false, and reads as empty text, not as the word null.
      "github.event.pull_request.head.repo.fork == false",
      "github.event.pull_request.head.repo.fork == false || startsWith(github.event_name, 'pull_request')",
      "!contains(github.event.pull_request.title, 'null')",
      // The queue group's fields are null in a pull request's run, so this runs in the queue alone.
      "github.event.merge_group.base_sha != ''",
      // The repository's own names read alike in both runs.
      "github.repository == 'nextlyhq/nextly'",
      // So do the names the workflow file fixes.
      "github.workflow == 'CI'",
      // `format` runs from its arguments: this runs in the queue alone, and this in both.
      "format('{0}', github.event_name) == 'merge_group'",
      "format('{0}', github.event_name) != ''",
      // `join` and `toJSON` run from their arguments too, so these hold in both runs; an unknown result would not.
      "join(fromJSON('[\"a\", \"b\"]'), '-') == 'a-b' || github.event_name == 'pull_request'",
      "toJSON('a') == '\"a\"' || github.event_name == 'pull_request'",
      // Whatever a function makes of an unknown, this runs in the queue.
      "format('x{0}', needs.x.outputs.v) != 'xa' || github.event_name == 'merge_group'",
    ];
    for (const condition of skips) expect(skipsTheQueue(condition), condition).toBe(true);
    for (const condition of runs) expect(skipsTheQueue(condition), condition).toBe(false);
  });

  it("refuses a condition it cannot read, rather than passing it", () => {
    expect(() => skipsTheQueue("github.event_name == 'pull_request' &&")).toThrow(/cannot read the condition/);
    expect(() => skipsTheQueue("github.event_name == ")).toThrow(/cannot read the condition/);
    expect(() => skipsTheQueue("github.event_name 'pull_request'")).toThrow(/cannot read the condition/);
    // Whatever it reads: one that reads nothing of the event is read too.
    expect(() => skipsTheQueue("needs.changes.outputs.inert ==")).toThrow(/cannot read the condition/);
  });

  // Every assignment of twelve outputs is far too many to try; the condition is refused, not passed.
  it("refuses a condition with too many unknowns to decide, rather than passing it", () => {
    const many = [...Array.from({ length: 12 }, (_, n) => `needs.job${n}.result == 'success'`), "github.event_name == 'pull_request'"].join(" && ");
    expect(() => skipsTheQueue(many)).toThrow(/cannot decide the condition/);
    // A call this evaluator does not run, reading the event, could return anything in each run.
    expect(() => skipsTheQueue("hashFiles(github.event_name) != ''")).toThrow(/cannot decide the condition.*reads the event/);
    // So could a function run on a name that differs between the runs, whose value there is no value tried.
    expect(() => skipsTheQueue("format('x{0}', github.event.action) == 'xopened'")).toThrow(/cannot decide the condition.*reads the event/);
    // Run on an unknown, a function may make the literal it is compared with from a value no value tried is, as these do,
    // or never make it, as the last does; which of the two cannot be told, so both are refused, neither passed nor failed.
    const transformed = [
      "format('x{0}', needs.x.outputs.v) != 'xa' || github.event_name == 'pull_request'",
      "fromJSON(needs.x.outputs.v) != 'xa' || github.event_name == 'pull_request'",
      "toJSON(needs.x.outputs.v) != '\"a\"' || github.event_name == 'pull_request'",
      "join(fromJSON('[\"a\", \"b\"]'), needs.x.outputs.separator) != 'a+b' || github.event_name == 'pull_request'",
      "format('x{0}', needs.x.outputs.v) == 'y' && github.event_name == 'pull_request'",
      // Nor where the call's value is tied to its argument's, which the call read as a value of its own is not:
      // both of these run in the queue whatever the output is, and neither is failed as a skip.
      "format('{0}', needs.x.outputs.v) != 'a' || needs.x.outputs.v != 'b' || github.event_name == 'pull_request'",
      "format('x{0}', needs.x.outputs.v) != 'xa' || needs.x.outputs.v == 'a' || github.event_name == 'pull_request'",
    ];
    for (const condition of transformed) expect(() => skipsTheQueue(condition), condition).toThrow(/cannot decide the condition.*makes a value no value tried/);
    // Three text tests of one value may need a value no two literals make.
    const threeTests = "startsWith(needs.x.outputs.v, 'a') && contains(needs.x.outputs.v, 'b') && endsWith(needs.x.outputs.v, 'c') && github.event_name == 'pull_request'";
    expect(() => skipsTheQueue(threeTests)).toThrow(/cannot decide the condition.*3 text tests/);
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
 * `pull_request_target`, and not for the queue's. It is evaluated, not matched
 * by its spelling. Each name and call it reads but does not know is given, in
 * turn, each value that could change its outcome, and it skips the queue if
 * any one assignment runs it for a pull request and not in the queue. Most
 * names read alike in both runs, so a condition that turns on an output alone
 * is no skip, while one that runs for a pull request whatever the output is,
 * and in the queue only for some of its values, is. The event's own names do
 * not (`readingOf`), and a condition that reads none of them, nor the event's
 * name, reads alike in both runs under any one assignment, so it needs none
 * tried. Every condition is read once first, so one that cannot be read is
 * refused whatever it reads. A function this evaluator runs is run on the
 * values tried for its arguments, so a skip found that way is one; where an
 * argument is unknown, `skipsThroughATransform` decides what that search could
 * not reach.
 */
function skipsTheQueue(condition) {
  const tokens = conditionTokens(condition);
  evaluate(tokens, condition, {});
  if (!tokens.some(readsTheEvent)) return false;
  textTestsDecidable(tokens, condition);
  return skipFound(tokens, condition, readingsIn(tokens, condition, unknownName)) || skipsThroughATransform(tokens, condition);
}

/** Whether any assignment of the given readings runs the condition for a pull request and not in the queue. */
function skipFound(tokens, condition, readings) {
  for (const values of assignments(condition, readings, candidateValues(literalsIn(tokens)))) if (skipsUnder(tokens, condition, readings, values)) return true;
  return false;
}

/**
 * A condition that calls a function that `transforms` on an unknown, when no value
 * tried for the unknown skips the queue. The call may still make a value no
 * value tried makes it make, as `format('x{0}', v)` makes `xa` only from `a`,
 * so it is tried again with each call's result as an unknown of its own, which
 * over-reaches: every value the call can make is among those tried, and so are
 * some it cannot, since `format('x{0}', v)` never makes `y`. No skip then is
 * none; a skip then may need a value the call cannot make, so the condition
 * is refused as undecidable rather than passed or failed on a guess.
 */
function skipsThroughATransform(tokens, condition) {
  const calls = tokens.flatMap((token, at) => (transformsAnUnknown(tokens, at) ? [callKey(token.name, argumentsOf(tokens, at))] : []));
  if (calls.length === 0 || !skipFound(tokens, condition, readingsIn(tokens, condition, readsAnUnknown))) return false;
  throw new Error(`cannot decide the condition ${JSON.stringify(condition)}: it skips the queue only if ${calls.join(" or ")} makes a value no value tried for its arguments makes it make`);
}

const PULL_REQUEST_EVENTS = ["pull_request", "pull_request_target"];
const QUEUE_EVENT = "merge_group";

function skipsUnder(tokens, condition, readings, values) {
  const outcome = (run, event) => truth(evaluate(tokens, condition, { ...knownIn(run, readings, values), "github.event_name": event }));
  return PULL_REQUEST_EVENTS.some(event => outcome("pull request", event) !== false) && outcome("queue", QUEUE_EVENT) === false;
}

/** Whether a function tests text (`FUNCTIONS`), so that one value may have to pass several of its tests at once. */
const testsText = name => Object.hasOwn(FUNCTIONS, name) && FUNCTIONS[name].tests === true;

/**
 * Refuses a condition that holds one unknown to more text tests than its
 * values can pass together. A value is tried joined from two text literals at
 * most, which passes any two tests at once where one value can, so a third
 * test of the same value may need a value that is never tried.
 */
function textTestsDecidable(tokens, condition) {
  const counts = new Map();
  for (const name of textTestOperands(tokens)) counts.set(name, (counts.get(name) ?? 0) + 1);
  const crowded = [...counts].find(([, count]) => count > 2);
  if (crowded) throw new Error(`cannot decide the condition ${JSON.stringify(condition)}: it holds ${crowded[0]} to ${crowded[1]} text tests`);
}

/** Each unknown a text test reads, once for every test that reads it. */
const textTestOperands = tokens => tokens.flatMap((token, at) => (isTextTest(tokens, at) ? [...new Set(argumentsOf(tokens, at).filter(isUnknownName).map(nameOf))] : []));

const isTextTest = (tokens, at) => testsText(nameOf(tokens[at])) && tokens[at + 1] === "(";

/** What one run reads under an assignment: each unknown's value there, fixed or the one its choice was given. */
function knownIn(run, readings, values) {
  return Object.fromEntries(readings.map(({ key, runs }) => [key, "value" in runs[run] ? runs[run].value : values[runs[run].choice]]));
}

/** The names the repository or the workflow file fixes, which read alike in both runs. */
const FIXED_NAMES = new Set([
  "github.repository",
  "github.repository_id",
  "github.repository_owner",
  "github.repository_owner_id",
  "github.workflow",
  "github.job",
  "github.server_url",
  "github.api_url",
  "github.graphql_url",
]);

/** Objects one run's payload lacks, so that every name under one reads as null in that run. */
const ABSENT = [
  ["github.event.pull_request", "queue"],
  ["github.event.merge_group", "pull request"],
];

/**
 * How the two runs read a name. Any name under `github` may differ between
 * them, apart from those the repository or the workflow file fixes, so each
 * run takes a value of its own; the queue's payload holds no pull request and
 * a pull request's holds no queue group, so a name under either is null in the
 * run without it. Every other name, such as an output, reads alike in both.
 */
function readingOf(name) {
  const reading = differsBetweenRuns(name) ? ownInEach(name) : sharedBy(name);
  for (const [object, run] of ABSENT) if (within(name, object)) reading[run] = { value: null };
  return reading;
}

const differsBetweenRuns = name => within(name, "github") && !FIXED_NAMES.has(name);

const within = (name, object) => name === object || name.startsWith(`${object}.`);

const own = (run, key) => ({ choice: `${run}: ${key}` });

const ownInEach = key => ({ "pull request": own("pull request", key), queue: own("queue", key) });

const sharedBy = key => ({ "pull request": { choice: key }, queue: { choice: key } });

/** Whether a token reads the event: its name, or a name the two runs read differently. */
const readsTheEvent = token => nameOf(token) === "github.event_name" || (isUnknownName(token) && differs(readingOf(nameOf(token))));

const differs = reading => reading.queue.choice !== reading["pull request"].choice;

/** A value equal to no literal a condition could compare it with, as a number or as text. */
const NONE_OF_THEM = "none of the condition's values";

/** More assignments than this are not tried: the condition is refused as undecidable, not passed. */
const MOST_ASSIGNMENTS = 20_000;

/**
 * Every assignment of candidate values to the choices the readings make, made
 * one at a time so the first that skips the queue ends the search. A name both
 * runs share is one choice, and a name each run reads for itself is one in
 * each. A call read as an unknown is a choice too, and may return any of the
 * values, text as well as `true` and `false`.
 */
function* assignments(condition, readings, values) {
  const choices = [...new Set(readings.flatMap(({ runs }) => Object.values(runs).flatMap(run => ("choice" in run ? [run.choice] : []))))];
  const count = values.length ** choices.length;
  if (count > MOST_ASSIGNMENTS) throw new Error(`cannot decide the condition ${JSON.stringify(condition)}: ${count} assignments of what it reads but does not know`);
  yield* assigned(choices, values, 0, {});
}

function* assigned(choices, values, index, assignment) {
  if (index === choices.length) return yield assignment;
  for (const value of values) yield* assigned(choices, values, index + 1, { ...assignment, [choices[index]]: value });
}

/**
 * The values each choice is tried with: each literal the condition holds and
 * each event's name, which a name may be compared with too; a number below,
 * between and above its numeric ones; `true`, `false`, empty text, which every
 * text starts with, ends with and contains, and a value equal to none of them;
 * and each ordered pair of its texts run together, its literals and the
 * events' names, so that any two tests of one value that one value can pass
 * together are passed. Between them they give each comparison every outcome it
 * can have.
 */
function candidateValues(literals) {
  const numbers = [...new Set(literals.filter(value => value !== "").map(Number).filter(Number.isFinite))].sort((a, b) => a - b);
  const between = numbers.slice(1).map((number, at) => (numbers[at] + number) / 2);
  const around = numbers.length > 0 ? [numbers[0] - 1, numbers.at(-1) + 1] : [];
  const texts = [...new Set([...literals.filter(value => typeof value === "string"), ...PULL_REQUEST_EVENTS, QUEUE_EVENT])];
  const pairs = texts.flatMap(first => texts.map(second => first + second));
  return [...new Set([...literals, ...PULL_REQUEST_EVENTS, QUEUE_EVENT, ...between, ...around, true, false, "", NONE_OF_THEM, ...pairs])];
}

/** Each name and call a condition reads that `readsAsUnknown` reads as unknown, with how the two runs read it; a call is keyed by its arguments. */
function readingsIn(tokens, condition, readsAsUnknown) {
  const readings = new Map();
  tokens.forEach((token, at) => {
    if (!readsAsUnknown(tokens, at)) return;
    const [key, runs] = tokens[at + 1] === "(" ? callReading(tokens, at, condition) : [nameOf(token), readingOf(nameOf(token))];
    readings.set(key, runs);
  });
  return [...readings].map(([key, runs]) => ({ key, runs }));
}

/** Whether the token at `at` is a name or a call this evaluator does not know. */
const unknownName = (tokens, at) => isUnknownName(tokens[at]);

/** Whether the token at `at` is read as an unknown where a call's result may be any value: an unknown name, or a call that makes something of one. */
const readsAnUnknown = (tokens, at) => unknownName(tokens, at) || transformsAnUnknown(tokens, at);

/** Whether a function this evaluator runs makes text or a value of its arguments: every one of `FUNCTIONS` that does not test them. */
const transforms = name => Object.hasOwn(FUNCTIONS, name) && FUNCTIONS[name].tests !== true;

/**
 * Whether the token at `at` calls a function that `transforms` on an argument that
 * holds an unknown. The values an unknown is tried with give every comparison
 * of that unknown each outcome it can have, but not every comparison of what a
 * function makes of it: `format('x{0}', v) == 'xa'` holds only where `v` is
 * `a`, and no value tried is (`skipsThroughATransform`). On arguments it
 * knows, such as the event's name, the call is only ever run.
 */
const transformsAnUnknown = (tokens, at) => transforms(nameOf(tokens[at])) && tokens[at + 1] === "(" && argumentsOf(tokens, at).some(isUnknownName);

/**
 * A call's key and reading, for a call read as an unknown. Its result is read
 * alike in both runs; one whose arguments read the event could return
 * something different in each, which no value given here would stand for, so
 * the condition is refused rather than decided on an invented result.
 */
function callReading(tokens, at, condition) {
  const argumentTokens = argumentsOf(tokens, at);
  const key = callKey(tokens[at].name, argumentTokens);
  if (argumentTokens.some(readsTheEvent)) throw new Error(`cannot decide the condition ${JSON.stringify(condition)}: ${key} reads the event, and what it returns is not known`);
  return [key, sharedBy(key)];
}

const literalsIn = tokens => tokens.filter(token => typeof token === "object" && "value" in token).map(token => token.value);

function conditionTokens(condition) {
  const text = condition.trim().replace(/^\$\{\{([\s\S]*)\}\}$/, "$1").trim();
  return text === "" ? [] : tokenize(text, condition);
}

const nameOf = token => (typeof token === "object" && "name" in token ? token.name.toLowerCase() : undefined);

const isUnknownName = token => nameOf(token) !== undefined && !isKnown(nameOf(token));

const isKnown = key => key === "github.event_name" || Object.hasOwn(LITERALS, key) || Object.hasOwn(FUNCTIONS, key);

/** A call's key: its name and the tokens of its arguments, so two calls of one function with different arguments are two unknowns. */
const callKey = (name, argumentTokens) => `${name.toLowerCase()}(${argumentTokens.map(tokenText).join(" ")})`;

const tokenText = token => (typeof token === "string" ? token : (nameOf(token) ?? JSON.stringify(token.value)));

/** The tokens between the parentheses of the call whose name is at `at`. */
const argumentsOf = (tokens, at) => tokens.slice(at + 2, closingParen(tokens, at + 1));

/** The index of the parenthesis that closes the one at `open`. */
function closingParen(tokens, open) {
  let depth = 0;
  for (let at = open; at < tokens.length; at += 1) {
    depth += depthStep(tokens[at]);
    if (depth === 0) return at;
  }
  return tokens.length;
}

const depthStep = token => (token === "(" ? 1 : token === ")" ? -1 : 0);

const UNKNOWN = Symbol("unknown");
const TOKEN = /\s*(?:('(?:[^']|'')*')|(\d+(?:\.\d+)?)|(==|!=|<=|>=|&&|\|\||[!<>(),])|([A-Za-z_][\w-]*(?:\.[\w*-]+)*))/y;
const LITERALS = { true: true, false: false, null: null };
const RELATIONS = { "<": (a, b) => a < b, "<=": (a, b) => a <= b, ">": (a, b) => a > b, ">=": (a, b) => a >= b };

/**
 * The expression functions a condition can be decided by, each with how it
 * runs and whether it tests text (`tests`); every other one makes a value of
 * its arguments (`transforms`), which is also what one added without saying
 * is taken to do, the reading that refuses rather than passes. Any function
 * not here, such as `success()`, is unknown, and so is one that transforms an
 * unknown.
 */
const FUNCTIONS = {
  always: { run: () => true },
  contains: { tests: true, run: (within, item) => (Array.isArray(within) ? within.some(entry => looseEqual(entry, item)) : lower(within).includes(lower(item))) },
  startswith: { tests: true, run: (text, prefix) => lower(text).startsWith(lower(prefix)) },
  endswith: { tests: true, run: (text, suffix) => lower(text).endsWith(lower(suffix)) },
  fromjson: { run: text => parsed(textOf(text)) },
  format: { run: (template, ...values) => formatted(textOf(template), values) },
  join: { run: (array, separator = ",") => (Array.isArray(array) ? array.map(textOf).join(textOf(separator)) : textOf(array)) },
  tojson: { run: value => JSON.stringify(value, null, 2) },
};

/**
 * `format`'s text: each `{n}` replaced by the nth value as text, and `{{` and
 * `}}` by a brace. A reference past the values fails GitHub's evaluation,
 * which decides nothing here.
 */
function formatted(template, values) {
  const references = [...template.matchAll(/\{\{|\}\}|\{(\d+)\}/g)].filter(match => match[1] !== undefined);
  if (references.some(match => Number(match[1]) >= values.length)) return UNKNOWN;
  return template.replace(/\{\{|\}\}|\{(\d+)\}/g, (match, index) => (index === undefined ? match[0] : textOf(values[Number(index)])));
}

/** A JSON document's value; text that is not one fails GitHub's evaluation, which decides nothing here. */
function parsed(text) {
  try {
    return JSON.parse(text);
  } catch {
    return UNKNOWN;
  }
}

/** A condition's value from its tokens (`conditionTokens`); no condition always runs. */
function evaluate(tokens, condition, known) {
  if (tokens.length === 0) return true;
  const parser = { tokens, at: 0, known, condition };
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
  if (!take(parser, "(")) return lookUp(token.name, parser.known);
  const from = parser.at;
  const values = parseArguments(parser);
  return call(token.name, values, parser.known, callKey(token.name, parser.tokens.slice(from, parser.at - 1)));
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

/** A call's value: one an assignment gave that call (`readsAnUnknown`), one the evaluator can decide, or unknown. */
function call(name, values, known, key) {
  if (Object.hasOwn(known, key)) return known[key];
  const fn = name.toLowerCase();
  return Object.hasOwn(FUNCTIONS, fn) && !values.includes(UNKNOWN) ? FUNCTIONS[fn].run(...values) : UNKNOWN;
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

/** A value as text, as GitHub reads one: null is empty. */
const textOf = value => (value === null ? "" : String(value));

function lower(value) {
  return textOf(value).toLowerCase();
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

  // The job installs no packages, so the script must run with none; that is
  // proven beside the script, by running it from a copy with none above it.
  it("installs no packages for the script it runs", () => {
    expect(job.steps.some(step => /\binstall\b/.test(String(step.run)))).toBe(false);
  });
});

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
