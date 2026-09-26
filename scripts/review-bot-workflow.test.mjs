/**
 * What the review bot's agent may write, held on the workflow that grants it.
 *
 * The agent runs Claude Code under an allowlist, and Claude Code judges every
 * file write, the Write tool's and a shell redirect's alike, against Edit and
 * Read rules alone. A path rule written for Write, MultiEdit, NotebookEdit or
 * Glob is accepted and never consulted, so it reads as a grant and allows
 * nothing: the agent is refused every write, finishes without error, and the
 * post step finds no payload. Only a live, paid review would show that, so the
 * rules are held here. What each rule allows was measured against the Claude
 * Code the pinned action installs (2.1.222); moving the pin is when to measure
 * again.
 */
import { readFileSync } from "node:fs";

import { load } from "js-yaml";
import { describe, expect, it } from "vitest";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const steps = load(read(".github/workflows/nextly-review-bot.yml")).jobs.review.steps;
/** Found by the action it runs rather than by its name. */
const agent = steps.find(step => step.uses?.startsWith("anthropics/claude-code-action@"));
const runOf = name => steps.find(step => step.name === name).run;

/** The one directory the agent writes to, and where the post step reads what it wrote. */
const PAYLOAD_DIR = ".nextly-review";

/** The path rules Claude Code accepts and never consults when it decides a file permission. */
const neverConsulted = rules => rules.filter(rule => /^(Write|MultiEdit|NotebookEdit|Glob)\(/.test(rule));

/** Every rule one `--flag "a,b(c)"` of the agent's arguments lists, each read whole. */
function rulesOf(flag) {
  const found = new RegExp(`--${flag} "([^"]*)"`).exec(agent.with.claude_args);
  expect(found, `--${flag} among the agent's arguments`).not.toBeNull();
  const rules = found[1].split(",");
  // A comma inside a rule's parentheses would split it in two, and each half
  // would then escape the checks below; refuse that rather than misread it.
  for (const rule of rules) expect(rule, "one whole rule").toMatch(/^[A-Za-z]+(\([^()]*\))?$/);
  return rules;
}

describe("the files the review agent may write", () => {
  it.each(["allowedTools", "disallowedTools"])("--%s names no path rule Claude Code never consults", flag => {
    // The control: a Write path rule, the form that grants nothing.
    expect(neverConsulted([`Write(${PAYLOAD_DIR}/**)`])).toHaveLength(1);
    expect(neverConsulted(rulesOf(flag))).toEqual([]);
  });

  it("allows writing in the payload directory and nowhere else", () => {
    const allowed = rulesOf("allowedTools");
    expect(allowed).toContain("Read");
    const writes = allowed.filter(rule => /^(Edit|Write|MultiEdit|NotebookEdit)\b/.test(rule));
    expect(writes).toEqual([`Edit(/${PAYLOAD_DIR}/**)`]);
  });

  it("names one payload directory wherever the payload passes", () => {
    const lines = text => text.split("\n").map(line => line.trim());
    expect(lines(runOf("Materialize the reviewer's tooling outside the tree"))).toContain(`mkdir ${PAYLOAD_DIR}`);
    expect(agent.with.prompt).toContain(`${PAYLOAD_DIR}/review.json`);
    expect(read(".github/review-prompt.md")).toContain(`${PAYLOAD_DIR}/review.json`);
    expect(runOf("Post the review as the review bot")).toContain(`test -s ${PAYLOAD_DIR}/review.json`);
  });
});
