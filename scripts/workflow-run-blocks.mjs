/**
 * The `run:` script of each step in a workflow file, and each job's ceiling.
 *
 * Its own module rather than a helper inside the test that needs it, for the
 * reason `ci-gate.mjs` and `ci-verdict.mjs` are: a derivation a gate depends on
 * is worth testing directly, and a parser living inside the single test that
 * consumes it can only ever be exercised through that test's subject.
 *
 * Parsed as TEXT rather than through a YAML library on purpose: `yaml` appears
 * in this repository only as a pnpm override, so it is reachable by hoisting
 * rather than by declaration, and a resolution that depends on hoisting is not
 * one to build a gate on.
 *
 * ## What a reader like this gets wrong, and why each is silent
 *
 * A gate built on it then passes over exactly the thing it exists to catch.
 *
 * A step boundary is a LIST ITEM, not a `name:` key. `- name: X` and a bare `-`
 * followed by an indented `run:` are both steps, so tracking ownership by name
 * alone records an anonymous step's script against whichever named step came
 * before it. Steps are therefore returned as a LIST, each with the name it has
 * or `null` — dropping the unnamed ones instead would trade crediting the wrong
 * step for not seeing it at all, which a gate scanning for unwrapped commands
 * cannot afford.
 *
 * Two steps may legitimately carry the SAME name — conditional variants of one
 * job usually do, and every job repeats `Install dependencies`. Returning a map
 * keyed by name kept only the last, so a wrapped step could hide an unwrapped
 * one; a LIST cannot, which is why this returns one. A boundary the parser
 * cannot cross beats a check that looks for crossings.
 *
 * A script may be written INLINE (`run: pnpm test`) as well as as a block
 * scalar, and both are ordinary YAML. Reading only `run: |` makes a step with
 * an inline command invisible.
 *
 * And `timeout-minutes` is legal on a STEP as well as on a job, so a matcher
 * that ignores indentation records a step's value as its job's ceiling — which
 * reads as a bounded job whose own bound was deleted.
 *
 * @module workflow-run-blocks
 */

/** How far a line is indented, in spaces. */
function indentOf(line) {
  return line.length - line.trimStart().length;
}

/**
 * The lines of one block scalar: everything indented FURTHER than its key.
 *
 * Blank lines are skipped rather than ending the block, because YAML allows
 * them inside a block scalar and a reader that stopped at the first one would
 * silently return a prefix of the script.
 */
function blockBody(lines, from, indent) {
  const body = [];

  for (let i = from; i < lines.length; i += 1) {
    if (lines[i].trim() === "") continue;
    if (indentOf(lines[i]) <= indent) break;
    body.push(lines[i]);
  }

  return body.join("\n");
}

/** The step name a list-item line declares, or null when it names none. */
function stepNameOn(line) {
  const named = /^\s*-\s*name:\s*(.+?)\s*$/.exec(line);
  return named === null ? null : named[1];
}

/**
 * True when a line opens a new step.
 *
 * A list item at the step list's own indentation. Items nested DEEPER belong to
 * the step's own values — a `with:` taking a list, say — and treating one as a
 * boundary would end the step early and orphan its script.
 */
function startsStep(line, stepIndent) {
  if (!/^\s*-(\s|$)/.test(line)) return false;
  return stepIndent === null || indentOf(line) <= stepIndent;
}

/** Move ownership to the step this line opens, named or not. */
function applyBoundary(state, line) {
  if (!startsStep(line, state.stepIndent)) return;
  state.stepIndent = indentOf(line);
  state.owner = stepNameOn(line);
  state.opened = true;
}

/**
 * The script a `run:` line carries: the inline command, or the block below it.
 *
 * Returns null when the line opens no script at all. Both YAML forms are read,
 * because a step written `run: pnpm test` is as ordinary as one written
 * `run: |`, and a reader that saw only the second would report a step with an
 * inline command as running nothing.
 */
function runScript(lines, index) {
  const run = /^(\s*)run:(\s*\|)?(.*)$/.exec(lines[index]);
  if (run === null) return null;
  if (run[2] !== undefined) return blockBody(lines, index + 1, run[1].length);
  return run[3].trim() === "" ? null : run[3].trim();
}

/** Record a script against the step that owns it. */
function recordRun(state, script) {
  if (!state.opened) return;
  state.steps.push({ name: state.owner, block: script });
}

/** One line's effect: it may open a step, and it may open that step's script. */
function readStepLine(state, lines, index) {
  applyBoundary(state, lines[index]);
  const script = runScript(lines, index);
  if (script !== null) recordRun(state, script);
}

/**
 * Every step's own script, in file order, plus the names seen more than once.
 *
 * A step's OWN script — never the text running to the next step. A chunk
 * bounded by the following `- name:` would include the comment block that
 * introduces the NEXT step, and workflow comments here quote commands verbatim,
 * so a comment about step N+1 would certify step N. The bound is the block
 * scalar's indentation instead, which ends where `env:` or the next step's
 * comments begin.
 *
 * @param {string} text the workflow file's contents
 * @returns {{name: string|null, block: string}[]} every step's script, in order
 */
export function workflowSteps(text) {
  const lines = text.split("\n");
  const state = { steps: [], owner: null, stepIndent: null, opened: false };

  for (let i = 0; i < lines.length; i += 1) readStepLine(state, lines, i);

  return state.steps;
}

/**
 * The job a line opens, or null.
 *
 * ONE recogniser, used by both readers below. Two of them agreed on the day
 * they were written and would drift the first time either learned about another
 * key shape — and the drift is invisible, because one supplies the population
 * of jobs to check and the other supplies the ceilings, so a job could fall out
 * of exactly one of them.
 */
function jobKeyOn(line) {
  const job = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(line);
  return job === null ? null : job[1];
}

/**
 * A JOB's own ceiling on this line, or null.
 *
 * Four spaces exactly. `timeout-minutes` is legal on a step too, at a deeper
 * indentation, and an indentation-agnostic matcher records that step's value
 * against the job — so a job whose own ceiling was deleted reads as bounded by
 * one of its steps.
 */
function jobTimeoutOn(line) {
  const found = /^ {4}timeout-minutes:\s*(\d+)\s*$/.exec(line);
  return found === null ? null : Number(found[1]);
}

/** Walk `jobs:`, handing each line to a visitor once inside it. */
function walkJobs(text, visit) {
  let job = null;
  let inJobs = false;

  for (const line of text.split("\n")) {
    if (!inJobs) {
      inJobs = line.trimEnd() === "jobs:";
      continue;
    }
    job = jobKeyOn(line) ?? job;
    visit(job, line);
  }
}

/**
 * Every job the workflow declares, in file order.
 *
 * The population a caller needs before judging ceilings. Asking only
 * {@link jobTimeouts} answers about the jobs that HAVE one, so a job whose
 * ceiling was deleted is absent from the answer rather than reported — which
 * reads as nothing to check.
 *
 * @param {string} text the workflow file's contents
 * @returns {string[]} job ids
 */
export function jobIds(text) {
  const ids = [];
  walkJobs(text, (job, line) => {
    if (jobKeyOn(line) !== null) ids.push(job);
  });
  return ids;
}

/**
 * Each job's own `timeout-minutes`, keyed by job id.
 *
 * Per JOB rather than as one list of the numbers in the file. A caller checking
 * that every ceiling clears some floor is satisfied by a list that is merely
 * non-empty, so a job whose ceiling was DELETED passes on its siblings' values
 * while having none of its own — the job then keeps whatever GitHub's six-hour
 * default gives it, which is the unbounded state a ceiling exists to remove.
 *
 * @param {string} text the workflow file's contents
 * @returns {Map<string, number>} job id to its ceiling in minutes
 */
export function jobTimeouts(text) {
  const timeouts = new Map();
  walkJobs(text, (job, line) => {
    const minutes = jobTimeoutOn(line);
    if (minutes !== null && job !== null) timeouts.set(job, minutes);
  });
  return timeouts;
}
