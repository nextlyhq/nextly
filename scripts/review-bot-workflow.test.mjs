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
 *
 * The file rules are not the only road to a grant. Another input of the
 * action, another flag or another allowlist entry widens what the agent may do
 * without touching them, so those are pinned as well: a change to any of them
 * is a change to this file too, and gets read as one.
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

/** The action revision whose Claude Code (2.1.222) the rules here were measured against. */
const ACTION = "anthropics/claude-code-action@9db594c7a0e82298c121c18b7f08aa1579ce7341";
/** The action's inputs as reviewed. One that carries permissions, such as `settings`, would sidestep the allowlist. */
const INPUTS = ["anthropic_api_key", "claude_args", "github_token", "prompt", "track_progress"];
/** The agent's flags as reviewed, each set once. A second `--allowedTools`, or a permission mode, widens the grant unseen. */
const FLAGS = ["--allowedTools", "--disallowedTools", "--max-turns"];
/**
 * The allowlist as reviewed. An entry matches a command prefix, so it has to be
 * safe under any arguments appended to it, and nothing here can judge that; so
 * adding or changing an entry is a deliberate edit of this list.
 */
const ALLOWED = [
  "Read",
  "Grep",
  "Glob",
  `Edit(/${PAYLOAD_DIR}/**)`,
  "Bash(${{ runner.temp }}/nextly-review-bot/review-bot-gh.sh:*)",
  "Bash(bash ${{ runner.temp }}/nextly-review-bot/review-bot-gh.sh:*)",
  "Bash(git show:*)",
  "Bash(git diff:*)",
  "Bash(git log:*)",
  "Bash(git merge-base:*)",
  "Bash(rg:*)",
  "Bash(ls:*)",
];
/** The denylist as reviewed. A denial wins over a grant, so an added one can cancel the payload's; a removed one lifts a boundary. */
const DISALLOWED = ["WebSearch", "WebFetch", "Read(//proc/**)", "Read(//sys/**)", "Grep(//proc/**)", "Grep(//sys/**)"];

/** The path rules Claude Code accepts and never consults when it decides a file permission. */
const neverConsulted = rules => rules.filter(rule => /^(Write|MultiEdit|NotebookEdit|Glob)\(/.test(rule));

/** Every flag an argument string sets. Quoted values are blanked first, so a rule's own text is never read as a flag. */
const flagsOf = args => args.replace(/"[^"]*"/g, '""').match(/(?<=^|\s)--?[A-Za-z][\w-]*/g) ?? [];

/**
 * How often a text names a payload file inside the payload directory, and how
 * often anywhere else. The path counts only as a whole one: `/tmp/.nextly-review/`
 * or `other.nextly-review/` merely contain its spelling, and the Edit rule,
 * anchored at the checkout, grants neither.
 */
function placesOf(text, file) {
  const path = `${PAYLOAD_DIR}/${file}`.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const whole = new RegExp(`(?<![\\w./-])${path}(?![\\w-]|\\.\\w)`, "g");
  return { inside: (text.match(whole) ?? []).length, elsewhere: text.replace(whole, "").split(file).length - 1 };
}

/**
 * The post step as it reads the agent's payload. Its own validated copy under
 * `$out`, and a warning that names a file without reading it, are set aside.
 */
const postReads = () =>
  runOf("Post the review as the review bot").replaceAll('"$out/review.json"', '"$out/"').replace("::warning::replies.json", "::warning::");

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

  it("empties the payload directory before the agent runs", () => {
    // A pull request can commit files there, and a review.json it left would be
    // posted as the bot's own; so the directory is removed, then made afresh.
    const materialize = steps.findIndex(step => step.name === "Materialize the reviewer's tooling outside the tree");
    const lines = steps[materialize].run.split("\n").map(line => line.trim());
    const emptied = lines.indexOf(`rm -rf ${PAYLOAD_DIR}`);
    expect(emptied, "the payload directory removed").toBeGreaterThanOrEqual(0);
    expect(lines.indexOf(`mkdir ${PAYLOAD_DIR}`), "then made afresh").toBe(emptied + 1);
    expect(materialize, "before the agent runs").toBeLessThan(steps.indexOf(agent));
  });

  it.each(["review.json", "replies.json"])("names the payload directory for %s wherever it passes", file => {
    for (const [where, text] of [
      ["the agent's prompt", agent.with.prompt],
      ["the review prompt", read(".github/review-prompt.md")],
      ["the post step", postReads()],
    ]) {
      const { inside, elsewhere } = placesOf(text, file);
      expect(inside, `${file} in ${where}`).toBeGreaterThan(0);
      expect(elsewhere, `${file} outside ${PAYLOAD_DIR} in ${where}`).toBe(0);
    }
  });
});

describe("what else could widen the agent's grant", () => {
  it("runs the action revision the rules were measured against", () => {
    expect(agent.uses).toBe(ACTION);
  });

  it("passes the action only the inputs reviewed", () => {
    expect(Object.keys(agent.with).sort()).toEqual(INPUTS);
  });

  it("sets each flag reviewed exactly once, and no other flag", () => {
    // The control: a repeated flag and a permission mode, both of which the reader has to see.
    expect(flagsOf('--allowedTools "Read" --allowedTools "Edit" --permission-mode acceptEdits')).toEqual([
      "--allowedTools",
      "--allowedTools",
      "--permission-mode",
    ]);
    expect(flagsOf(agent.with.claude_args).sort()).toEqual([...FLAGS].sort());
  });

  it("grants exactly the allowlist reviewed", () => {
    expect(rulesOf("allowedTools")).toEqual(ALLOWED);
  });

  it("denies exactly the denylist reviewed", () => {
    expect(rulesOf("disallowedTools")).toEqual(DISALLOWED);
  });
});
