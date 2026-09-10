/**
 * The `run:` script of each named step in a workflow file, and each job's
 * ceiling.
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
 * ## Two ways a reader like this credits a step with somebody else's script
 *
 * Both are silent, and both make a gate built on it pass over the thing it
 * exists to catch.
 *
 * A step boundary is a LIST ITEM, not a `name:` key. `- name: X` and a bare `-`
 * followed by an indented `run:` are both steps, so tracking ownership by name
 * alone leaves an anonymous step's script recorded against whichever named step
 * came before it — and a gate then reads a wrapped command on a step that does
 * not run one.
 *
 * And two steps may legitimately carry the SAME name — conditional variants of
 * one job usually do. A map keeps the last, so a wrapped later step hides an
 * unwrapped earlier one. Reported rather than merged, because which of the two
 * a caller wants is the caller's question and silently answering it is how the
 * hiding happens.
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

/** The indentation of a `run: |` key on this line, or null. */
function runIndentOn(line) {
  const run = /^(\s*)run:\s*\|/.exec(line);
  return run === null ? null : run[1].length;
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
}

/** Record a run block against the step that owns it, if any step does. */
function recordRun(state, lines, index, indent) {
  const owner = state.owner;
  if (owner === null) return;
  if (state.blocks.has(owner)) state.duplicated.push(owner);
  state.blocks.set(owner, blockBody(lines, index + 1, indent));
}

/** One line's effect: it may open a step, and it may open that step's script. */
function readStepLine(state, lines, index) {
  applyBoundary(state, lines[index]);
  const indent = runIndentOn(lines[index]);
  if (indent !== null) recordRun(state, lines, index, indent);
}

/**
 * Every step's own run block, keyed by step name, plus the names that appeared
 * more than once.
 *
 * A step's OWN block — never the text running to the next step. A chunk bounded
 * by the following `- name:` would include the comment block that introduces
 * the NEXT step, and workflow comments here quote commands verbatim, so a
 * comment about step N+1 would certify step N. The bound is the block scalar's
 * indentation instead, which ends where `env:` or the next step's comments
 * begin.
 *
 * @param {string} text the workflow file's contents
 * @returns {{ blocks: Map<string, string>, duplicated: string[] }}
 */
export function workflowSteps(text) {
  const lines = text.split("\n");
  const state = {
    blocks: new Map(),
    duplicated: [],
    owner: null,
    stepIndent: null,
  };

  for (let i = 0; i < lines.length; i += 1) readStepLine(state, lines, i);

  return { blocks: state.blocks, duplicated: state.duplicated };
}

/** Collect a job id, once inside `jobs:`. */
function collectJobId(state, line) {
  if (!state.inJobs) {
    state.inJobs = line.trimEnd() === "jobs:";
    return;
  }
  const job = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(line);
  if (job !== null) state.ids.push(job[1]);
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
  const state = { ids: [], inJobs: false };
  for (const line of text.split("\n")) collectJobId(state, line);
  return state.ids;
}

/** Note the job a two-space key opens. */
function noteJob(state, line) {
  const job = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(line);
  if (job !== null) state.job = job[1];
}

/** Note a ceiling against the job currently open. */
function noteTimeout(state, line) {
  const found = /^\s*timeout-minutes:\s*(\d+)\s*$/.exec(line);
  if (found === null || state.job === null) return;
  state.timeouts.set(state.job, Number(found[1]));
}

/** One line's effect while inside `jobs:`. */
function readJobLine(state, line) {
  if (!state.inJobs) {
    state.inJobs = line.trimEnd() === "jobs:";
    return;
  }
  noteJob(state, line);
  noteTimeout(state, line);
}

/**
 * Each job's `timeout-minutes`, keyed by job id.
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
  const state = { timeouts: new Map(), job: null, inJobs: false };
  for (const line of text.split("\n")) readJobLine(state, line);
  return state.timeouts;
}
