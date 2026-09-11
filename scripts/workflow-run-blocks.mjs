/**
 * The `run:` script of each named step in a workflow file, keyed by step name.
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
 * @module workflow-run-blocks
 */

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
    const here = lines[i].length - lines[i].trimStart().length;
    if (here <= indent) break;
    body.push(lines[i]);
  }

  return body.join("\n");
}

/** The step name a line declares, or null if it declares none. */
function stepNameAt(line) {
  const named = /^\s*- name:\s*(.+?)\s*$/.exec(line);
  return named === null ? null : named[1];
}

/**
 * The indentation of a `run: |` key on this line, or null.
 *
 * Null for an ANONYMOUS step as well as for a line that opens no block, so a
 * run block no named step owns is skipped rather than credited to whichever
 * name came last — which would report a step as running a script it does not.
 */
function runIndentAt(line, owner) {
  const run = owner === null ? null : /^(\s*)run:\s*\|/.exec(line);
  return run === null ? null : run[1].length;
}

/**
 * Each step's OWN run block — never the text running to the next step.
 *
 * A chunk bounded by the following `- name:` would include the comment block
 * that introduces the NEXT step, and workflow comments here quote commands
 * verbatim, so a comment about step N+1 would certify step N. The bound is the
 * block scalar's indentation instead, which ends where `env:` or the next
 * step's comments begin.
 *
 * @param {string} text the workflow file's contents
 * @returns {Map<string, string>} step name to the body of its `run:` block
 */
export function runBlocks(text) {
  const lines = text.split("\n");
  const blocks = new Map();
  let name = null;

  for (let i = 0; i < lines.length; i += 1) {
    name = stepNameAt(lines[i]) ?? name;
    const indent = runIndentAt(lines[i], name);
    if (indent !== null) blocks.set(name, blockBody(lines, i + 1, indent));
  }

  return blocks;
}
