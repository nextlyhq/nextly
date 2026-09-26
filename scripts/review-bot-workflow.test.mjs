/**
 * What the review bot's agent may do, and where the bot's identity lives, held
 * on the workflow that grants them.
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
 * action, another flag, another allowlist entry or the reviewed pull request's
 * own settings widen what the agent may do without touching them, so those are
 * pinned as well: a change to any of them is a change to this file too, and
 * gets read as one. And since no allowlist is proof against everything, the
 * bot's identity is kept off the agent's runner altogether: the review is
 * posted from a second job, which the agent never ran in.
 *
 * That job can be re-run after a failure, and it then posts the same payload
 * again. The gateway posts once per run, provided each call says which run is
 * posting, so the post and confirm steps are run here as GitHub runs them, and
 * the calls they make are what is asserted.
 */
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { load } from "js-yaml";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const { jobs } = load(read(".github/workflows/nextly-review-bot.yml"));
/** The job the agent runs in, and the job that posts what it wrote. */
const steps = jobs.review.steps;
const postSteps = jobs.post.steps;
/** Found by the action it runs rather than by its name. */
const agent = steps.find(step => step.uses?.startsWith("anthropics/claude-code-action@"));
const usesOf = (list, action) => list.filter(step => step.uses?.startsWith(`${action}@`));
const named = (list, name) => list.find(step => step.name === name);

/** The one directory the agent writes to, and the two files it hands on from there. */
const PAYLOAD_DIR = ".nextly-review";
const PAYLOAD_FILES = ["review.json", "replies.json"];

/** The action revision whose Claude Code (2.1.222) the rules here were measured against. */
const ACTION = "anthropics/claude-code-action@9db594c7a0e82298c121c18b7f08aa1579ce7341";
/** The action's inputs as reviewed. One that carries permissions, such as `settings`, would sidestep the allowlist. */
const INPUTS = ["anthropic_api_key", "claude_args", "github_token", "prompt", "track_progress"];
/** The agent's flags as reviewed, each set once. A second `--allowedTools`, or a permission mode, widens the grant unseen. */
const FLAGS = ["--allowedTools", "--disallowedTools", "--setting-sources", "--strict-mcp-config", "--max-turns"];
/**
 * The allowlist as reviewed. An entry matches a command prefix, so it has to be
 * safe under any arguments appended to it, and nothing here can judge that; so
 * adding or changing an entry is a deliberate edit of this list. There is no
 * `git` and no `rg`: git's `--output=<file>` writes and ripgrep's `--pre` runs
 * a program, so history is read through the gateway, whose git flags are fixed.
 */
const ALLOWED = [
  "Read",
  "Grep",
  "Glob",
  `Edit(/${PAYLOAD_DIR}/**)`,
  "Bash(${{ runner.temp }}/nextly-review-bot/review-bot-gh.sh:*)",
  "Bash(bash ${{ runner.temp }}/nextly-review-bot/review-bot-gh.sh:*)",
  "Bash(ls:*)",
];
/** The denylist as reviewed. A denial wins over a grant, so an added one can cancel the payload's; a removed one lifts a boundary. */
const DISALLOWED = ["WebSearch", "WebFetch", "Read(//proc/**)", "Read(//sys/**)", "Grep(//proc/**)", "Grep(//sys/**)"];

/** The path rules Claude Code accepts and never consults when it decides a file permission. */
const neverConsulted = rules => rules.filter(rule => /^(Write|MultiEdit|NotebookEdit|Glob)\(/.test(rule));

/** Every flag an argument string sets. Quoted values are blanked first, so a rule's own text is never read as a flag. */
const flagsOf = args => args.replace(/"[^"]*"/g, '""').match(/(?<=^|\s)--?[A-Za-z][\w-]*/g) ?? [];

/**
 * How often a text names a payload file inside a directory, and how often
 * anywhere else. The path counts only as a whole one: `/tmp/.nextly-review/`
 * or `other.nextly-review/` merely contain its spelling, and the Edit rule,
 * anchored at the checkout, grants neither.
 */
function placesOf(text, file, dir = PAYLOAD_DIR) {
  const path = `${dir}/${file}`.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const whole = new RegExp(`(?<![\\w./-])${path}(?![\\w-]|\\.\\w)`, "g");
  return { inside: (text.match(whole) ?? []).length, elsewhere: text.replace(whole, "").split(file).length - 1 };
}

/**
 * The post step as it reads the downloaded payload. Its own validated copy
 * under `$out`, and a warning that names a file without reading it, are set
 * aside.
 */
const postReads = () =>
  named(postSteps, "Post the review as the review bot")
    .run.replaceAll('"$out/review.json"', '"$out/"')
    .replace("::warning::replies.json", "::warning::");

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
});

describe("the payload the agent writes is the one the bot posts", () => {
  const upload = usesOf(steps, "actions/upload-artifact")[0];
  const download = usesOf(postSteps, "actions/download-artifact")[0];
  const post = named(postSteps, "Post the review as the review bot");

  it.each(PAYLOAD_FILES)("tells the agent to write %s in the payload directory, and nowhere else", file => {
    for (const [where, text] of [
      ["the agent's prompt", agent.with.prompt],
      ["the review prompt", read(".github/review-prompt.md")],
    ]) {
      const { inside, elsewhere } = placesOf(text, file);
      expect(inside, `${file} in ${where}`).toBeGreaterThan(0);
      expect(elsewhere, `${file} outside ${PAYLOAD_DIR} in ${where}`).toBe(0);
    }
  });

  it("hands on exactly the two payload files, hidden directory included", () => {
    const paths = upload.with.path.split("\n").map(line => line.trim()).filter(Boolean);
    expect(paths).toEqual(PAYLOAD_FILES.map(file => `${PAYLOAD_DIR}/${file}`));
    expect(upload.with["include-hidden-files"]).toBe(true);
    expect(steps.indexOf(upload), "after the agent").toBeGreaterThan(steps.indexOf(agent));
  });

  it.each(PAYLOAD_FILES)("posts %s from where the post job downloaded it, and from nowhere else", file => {
    expect(download.with.name).toBe(upload.with.name);
    expect(download.with.path).toBe(post.env.PAYLOAD);
    const { inside, elsewhere } = placesOf(postReads(), file, '"$PAYLOAD');
    expect(inside, `${file} read from the download`).toBeGreaterThan(0);
    expect(elsewhere, `${file} read from anywhere else`).toBe(0);
  });

  it("rebuilds the review from the payload's body and comments alone", () => {
    // Whatever the payload says, the bot comments on the head it reviewed.
    expect(post.run).toContain('{commit_id: $sha, event: "COMMENT", body, comments: (.comments // [])}');
  });
});

describe("where the bot's identity lives", () => {
  it("runs the agent in a job that cannot reach the review-bot environment", () => {
    expect(jobs.review.environment).toBeUndefined();
    expect(usesOf(steps, "actions/create-github-app-token")).toEqual([]);
    expect(JSON.stringify(jobs.review)).not.toContain("REVIEW_BOT_PRIVATE_KEY");
  });

  it("runs a dispatch only from the default branch, before the paid agent starts", () => {
    // The environment refuses other branches only once the post job starts; by
    // then the agent has run, so the review job refuses them itself.
    expect(jobs.review.if).toContain(
      "(github.event_name == 'workflow_dispatch' && github.ref_name == github.event.repository.default_branch) ||",
    );
  });

  it("takes the App identity only in a job after the agent's, which never runs the agent", () => {
    expect(jobs.post.environment).toBe("review-bot");
    expect(jobs.post.needs).toBe("review");
    expect(usesOf(postSteps, "actions/create-github-app-token")).toHaveLength(1);
    expect(usesOf(postSteps, "anthropics/claude-code-action")).toEqual([]);
  });

  it("posts with the gateway from the workflow's own commit, never the reviewed branch's", () => {
    const checkouts = usesOf(postSteps, "actions/checkout");
    expect(checkouts).toHaveLength(1);
    expect(checkouts[0].with).toMatchObject({ ref: "${{ github.sha }}", "sparse-checkout": ".github/scripts", "persist-credentials": false });
    expect(named(postSteps, "Post the review as the review bot").run).toContain("gateway=.github/scripts/review-bot-gh.sh\n");
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

  it("loads the runner's settings alone, never the reviewed pull request's", () => {
    // Project settings would let the code under review add hooks, permissions
    // or MCP servers to its own reviewer.
    expect(/--setting-sources (\S+)/.exec(agent.with.claude_args)?.[1]).toBe("user");
  });

  it("grants exactly the allowlist reviewed", () => {
    expect(rulesOf("allowedTools")).toEqual(ALLOWED);
  });

  it("denies exactly the denylist reviewed", () => {
    expect(rulesOf("disallowedTools")).toEqual(DISALLOWED);
  });
});

describe.runIf(process.platform !== "win32")("posting once per run", () => {
  const RUN = "424242";
  const SHA = "a".repeat(40);
  let dir;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "review-bot-post-"));
    // The steps call the gateway by its path in the checkout, so the stand-in
    // sits there. It records each call, and lists the reviews of the run it is
    // asked about from a file named for that run.
    const gateway = join(dir, ".github", "scripts", "review-bot-gh.sh");
    mkdirSync(join(dir, ".github", "scripts"), { recursive: true });
    writeFileSync(
      gateway,
      [
        "#!/usr/bin/env bash",
        'printf "%s\\n" "$*" >> "$FAKE/calls"',
        'case "$1" in',
        '  review-ids-at) cat "$FAKE/ids-$4" 2>/dev/null || true ;;',
        '  head-sha) printf "%s\\n" "$SHA" ;;',
        "esac",
        "",
      ].join("\n"),
    );
    chmodSync(gateway, 0o755);
    mkdirSync(join(dir, "payload"));
    writeFileSync(join(dir, "payload", "review.json"), JSON.stringify({ body: "the review", comments: [] }));
    writeFileSync(
      join(dir, "payload", "replies.json"),
      JSON.stringify([
        { in_reply_to: 101, body: "one" },
        { in_reply_to: 102, body: "two" },
      ]),
    );
    mkdirSync(join(dir, "temp"));
  });

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  /** Runs one post-job step as GitHub's bash does, with `files` written beside the stand-in first. */
  function runStep(name, files = {}) {
    for (const file of readdirSync(dir).filter(file => file === "calls" || file.startsWith("ids-"))) rmSync(join(dir, file));
    for (const [file, text] of Object.entries(files)) writeFileSync(join(dir, file), text);
    writeFileSync(join(dir, "step.sh"), named(postSteps, name).run);
    const env = { PATH: process.env.PATH, HOME: dir, FAKE: dir, RUNNER_TEMP: join(dir, "temp"), GITHUB_RUN_ID: RUN, NUMBER: "7", SHA, PAYLOAD: join(dir, "payload") };
    const result = spawnSync("bash", ["--noprofile", "--norc", "-eo", "pipefail", join(dir, "step.sh")], { cwd: dir, encoding: "utf8", env });
    const calls = existsSync(join(dir, "calls")) ? readFileSync(join(dir, "calls"), "utf8").trim().split("\n") : [];
    return { status: result.status, output: result.stdout + result.stderr, calls };
  }

  it("names this run on every post, and each reply's place in the payload", () => {
    const { status, output, calls } = runStep("Post the review as the review bot");
    expect(status, output).toBe(0);
    const out = join(dir, "temp", "nextly-review-post");
    expect(calls).toEqual([`post-review 7 ${out}/review.json ${SHA} ${RUN}`, `reply 7 101 ${out}/reply-0.md ${RUN} 0`, `reply 7 102 ${out}/reply-1.md ${RUN} 1`]);
  });

  it("confirms with the review this run posted, whichever attempt posted it", () => {
    const { status, output, calls } = runStep("Confirm this run posted a review", { [`ids-${RUN}`]: "555\n" });
    expect(status, output).toBe(0);
    expect(calls[0]).toBe(`review-ids-at 7 ${SHA} ${RUN}`);
  });

  it("refuses to confirm with a review an earlier request posted at this head", () => {
    const { status, output } = runStep("Confirm this run posted a review", { "ids-111": "444\n" });
    expect(status).toBe(1);
    expect(output).toContain("this run posted no review");
  });
});
