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
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, posix } from "node:path";

import { load } from "js-yaml";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const workflow = load(read(".github/workflows/nextly-review-bot.yml"));
const { jobs } = workflow;
/** The job the agent runs in, and the job that posts what it wrote. */
const steps = jobs.review.steps;
const postSteps = jobs.post.steps;
/** Found by the action it runs rather than by its name. */
const agent = steps.find(step => step.uses?.startsWith("anthropics/claude-code-action@"));
const usesOf = (list, action) => list.filter(step => step.uses?.startsWith(`${action}@`));
const named = (list, name) => list.find(step => step.name === name);
/** The step that gives the agent its protocol and gateway. */
const MATERIALIZE = "Materialize the reviewer's tooling outside the tree";
/** The step that gives the agent the whole checkout, which the two checkouts before it leave sparse. */
const WHOLE_TREE = "Give the agent the whole pull request";
/** The step that readies what Claude Code needs to scrub the agent's commands. */
const ISOLATION = "Prepare the agent's subprocess isolation";

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

/** The paths the post job checks out, the workflow's own commit's copies. */
const checkedOut = () => usesOf(postSteps, "actions/checkout")[0].with["sparse-checkout"].split("\n").filter(Boolean);

/** Every module a set of modules loads through relative imports, the set included. */
function withImports(paths) {
  const found = new Set();
  const pending = [...paths];
  while (pending.length > 0) {
    const path = pending.pop();
    if (found.has(path)) continue;
    found.add(path);
    for (const [, specifier] of read(path).matchAll(/\b(?:from|import)\s+["'](\.[^"']+)["']/g)) pending.push(posix.normalize(posix.join(posix.dirname(path), specifier)));
  }
  return found;
}

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
    const materialize = steps.findIndex(step => step.name === MATERIALIZE);
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
    // then the agent has run, so the review job refuses them itself. It names
    // the branch by its full ref: a dispatch of a tag called `main` has the
    // ref name `main` too, and the ref `refs/tags/main`.
    expect(jobs.review.if).toContain(
      "(github.event_name == 'workflow_dispatch' && github.ref == format('refs/heads/{0}', github.event.repository.default_branch)) ||",
    );
    expect(jobs.review.if).not.toContain("ref_name");
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
    expect(checkouts[0].with).toMatchObject({ ref: "${{ github.sha }}", "sparse-checkout-cone-mode": false, "persist-credentials": false });
    expect(checkedOut()[0]).toBe(".github/scripts");
    expect(named(postSteps, "Post the review as the review bot").run).toContain("gateway=.github/scripts/review-bot-gh.sh\n");
  });

  it("gives the agent its tooling from the commit the post job checks out", () => {
    // A run can wait in the queue while the default branch moves on. The
    // protocol the agent follows must stay the one the post job's code was
    // written for, or the agent can write a payload that code refuses.
    const revision = usesOf(postSteps, "actions/checkout")[0].with.ref;
    expect(usesOf(steps, "actions/checkout")[0].with.ref, "the command parser's checkout").toBe(revision);
    expect(named(steps, MATERIALIZE).env.REVISION, "the protocol and gateway the agent runs").toBe(revision);
  });

  it("checks out every module the post job runs, and each module that one imports", () => {
    // The job checks out only what it names, so a module missing from the
    // list, or one a listed module imports, fails the post when it runs.
    const started = [...postSteps.map(step => step.run ?? "").join("\n").matchAll(/\bnode (scripts\/[\w./-]+\.mjs)/g)].map(match => match[1]);
    // The control: the post step runs the anchor check.
    expect(started).toContain("scripts/review-anchors.mjs");
    for (const path of withImports(started)) expect(checkedOut().some(entry => path === entry || path.startsWith(`${entry}/`)), path).toBe(true);
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

describe("the tree the agent reads", () => {
  it("is made whole straight after the pull request's checkout, before anything reads it", () => {
    const head = steps.findIndex(step => step.uses?.startsWith("actions/checkout@") && step.with?.ref === "${{ steps.pr.outputs.sha }}");
    const at = steps.findIndex(step => step.name === WHOLE_TREE);
    expect(head).toBeGreaterThan(-1);
    expect(at).toBe(head + 1);
    expect(at).toBeLessThan(steps.indexOf(agent));
    expect(steps[at].if).toBe(agent.if);
    // A tree with holes must stop the job, not reach the agent.
    expect(steps[at]["continue-on-error"]).toBeUndefined();
  });

  it("comes from a checkout that is neither filtered nor sparse", () => {
    // A filtered clone fetches each file when first read, which fails once the
    // checkout has removed its credentials; a sparse one leaves files out.
    const head = steps.find(step => step.uses?.startsWith("actions/checkout@") && step.with?.ref === "${{ steps.pr.outputs.sha }}");
    // The control: the parser's checkout is sparse on purpose, under the key read below.
    expect(usesOf(steps, "actions/checkout")[0].with["sparse-checkout"]).toBe(".github/scripts");
    expect(head.with.filter).toBeUndefined();
    expect(head.with["sparse-checkout"]).toBeUndefined();
  });
});

describe("where a model agent runs", () => {
  const WORKFLOWS = ".github/workflows";
  /** Every job of a workflow that runs the agent action or names the model key, as `file:job`. */
  const agentJobs = (file, text) =>
    Object.entries(load(text).jobs ?? {})
      .filter(([, job]) => (job.steps ?? []).some(step => step.uses?.startsWith("anthropics/claude-code-action@")) || JSON.stringify(job).includes("ZAI_API_KEY"))
      .map(([name]) => `${file}:${name}`);

  it("is the review job alone, so one agent at a time spends the model account", () => {
    // The control: a workflow that answers mentions with the agent and the key is found.
    const mention = "jobs:\n  answer:\n    steps:\n      - uses: anthropics/claude-code-action@x\n        with:\n          anthropic_api_key: ${{ secrets.ZAI_API_KEY }}\n";
    expect(agentJobs("mention.yml", mention)).toEqual(["mention.yml:answer"]);
    const found = readdirSync(new URL(`../${WORKFLOWS}`, import.meta.url))
      .filter(file => /\.ya?ml$/.test(file))
      .flatMap(file => agentJobs(file, read(`${WORKFLOWS}/${file}`)));
    expect(found).toEqual(["nextly-review-bot.yml:review"]);
  });

  it("names the model key nowhere outside the jobs", () => {
    // A workflow-level `env` would hand the key to every job, the agent's included.
    for (const file of readdirSync(new URL(`../${WORKFLOWS}`, import.meta.url)).filter(file => /\.ya?ml$/.test(file))) {
      const { jobs: _jobs, ...rest } = load(read(`${WORKFLOWS}/${file}`));
      expect(JSON.stringify(rest), file).not.toContain("ZAI_API_KEY");
    }
  });
});

describe("what the agent's commands can read", () => {
  it("keeps credentials out of the environment of every command the agent runs", () => {
    // Without it the model key sits in the environment of the gateway and of
    // anything else the agent runs. The action reads it from the step's env.
    expect(agent.env.CLAUDE_CODE_SUBPROCESS_ENV_SCRUB).toBe("1");
  });

  it("has the gateway stop the review if a model key reaches it all the same", () => {
    // What the setting does is up to the action and the Claude Code it
    // installs; the gateway checks the result on every call.
    expect(agent.env.REVIEW_BOT_EXPECT_SCRUB).toBe("1");
  });

  it("prepares what the scrub needs before the agent starts, and fails the review without it", () => {
    const at = steps.findIndex(step => step.name === ISOLATION);
    expect(at).toBeGreaterThan(-1);
    expect(at).toBeLessThan(steps.indexOf(agent));
    expect(steps[at].if).toBe(agent.if);
    // A failure here has to stop the job: carried past it, Claude Code would
    // either refuse to start or refuse every command, mid-review.
    expect(steps[at]["continue-on-error"]).toBeUndefined();
  });
});

describe.runIf(process.platform !== "win32")("the whole-tree step, run as GitHub runs it", () => {
  const TRACKED = [".github/scripts/g.sh", "README.md", "tools/t.mjs"];
  // git here reads no configuration of the developer's, and no GIT_* variable.
  const isolated = {
    ...Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_"))),
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_SYSTEM: "/dev/null",
  };
  let root;
  let repo;
  const git = (...args) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@e", ...args], { cwd: repo, encoding: "utf8", env: isolated }).trim();
  const write = (path, text) => {
    mkdirSync(join(repo, posix.dirname(path)), { recursive: true });
    writeFileSync(join(repo, path), text);
  };
  const read = path => (existsSync(join(repo, path)) ? readFileSync(join(repo, path), "utf8") : null);
  const present = () => TRACKED.filter(path => existsSync(join(repo, path)));
  const links = () => execFileSync("find", [repo, "-path", join(repo, ".git"), "-prune", "-o", "-type", "l", "-print"], { encoding: "utf8" }).trim();
  const runStep = (path = process.env.PATH) =>
    spawnSync("bash", ["--noprofile", "--norc", "-eo", "pipefail", join(root, "step.sh")], { cwd: repo, encoding: "utf8", env: { ...isolated, PATH: path, BASE: "main" } });
  /** A `PATH` whose `name` is the script given, ahead of the real one. */
  const standIn = (name, script) => {
    const bin = join(root, "bin");
    mkdirSync(bin, { recursive: true });
    const real = execFileSync("bash", ["-c", `command -v ${name}`], { encoding: "utf8" }).trim();
    writeFileSync(join(bin, name), `#!/usr/bin/env bash\n${script.replaceAll("REAL", real)}\n`);
    chmodSync(join(bin, name), 0o755);
    return `${bin}:${process.env.PATH}`;
  };

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "review-bot-whole-tree-"));
    repo = join(root, "repo");
    mkdirSync(repo);
    git("init", "-q");
    // The base branch, with instruction files of its own.
    for (const path of TRACKED) write(path, `${path}\n`);
    write("AGENTS.md", "the base branch's rules\n");
    write("CLAUDE.md", "@AGENTS.md\n");
    write("sub/AGENTS.md", "the base branch's rules for sub\n");
    write(".claude/rules/base.md", "the base branch's rule\n");
    git("add", "-A");
    git("commit", "-qm", "base");
    git("update-ref", "refs/remotes/origin/main", "HEAD");
    // The head under review: it rewrites and adds instruction files, and
    // commits links, one to a file outside the tree and one to a directory.
    write("AGENTS.md", "the pull request's rules\n");
    write("sub/AGENTS.md", "the pull request's rules for sub\n");
    write("new/CLAUDE.md", "the pull request's own\n");
    write(".claude/CLAUDE.md", "the pull request's own\n");
    write(".claude/rules/base.md", "the pull request's rule\n");
    write(".claude/rules/override.md", "the pull request's own rule\n");
    write("sub/.claude/rules/nested.md", "the pull request's own rule\n");
    symlinkSync("../outside", join(repo, "leak"));
    symlinkSync("..", join(repo, "tools", "up"));
    git("add", "-A");
    git("commit", "-qm", "head");
    // What actions/checkout does across the job's two checkouts: the parser's
    // sparse one, then the full one, which turns sparse checkout off in the
    // worktree's config and removes the extension that config needs.
    git("config", "core.sparseCheckout", "true");
    writeFileSync(join(repo, ".git", "info", "sparse-checkout"), ".github/scripts\n");
    git("checkout", "-q", "--force", "HEAD");
    git("sparse-checkout", "disable");
    git("config", "--local", "--unset-all", "extensions.worktreeConfig");
    git("checkout", "-q", "--force", "HEAD");
    writeFileSync(join(root, "step.sh"), named(steps, WHOLE_TREE).run);
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("is needed: the checkouts leave the head holding .github/scripts alone", () => {
    expect(present()).toEqual([".github/scripts/g.sh"]);
  });

  it("puts every tracked file back, and they stay through a later checkout", () => {
    const result = runStep();
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(present()).toEqual(TRACKED);
    // Another removal of the extension, as the next checkout would make, no
    // longer brings the sparse setting back.
    git("config", "--local", "--unset-all", "extensions.worktreeConfig");
    git("checkout", "-q", "--force", "HEAD");
    expect(present()).toEqual(TRACKED);
  });

  it("removes every symbolic link the pull request commits", () => {
    git("sparse-checkout", "disable");
    // The control: once the tree is whole, the head's links are in it.
    expect(links()).not.toBe("");
    const result = runStep();
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(links()).toBe("");
  });

  it("gives every instruction file, and everything under `.claude/`, the base branch's text, and removes one the base branch lacks", () => {
    const result = runStep();
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(read("AGENTS.md")).toBe("the base branch's rules\n");
    expect(read("CLAUDE.md")).toBe("@AGENTS.md\n");
    expect(read("sub/AGENTS.md")).toBe("the base branch's rules for sub\n");
    expect(read("new/CLAUDE.md")).toBeNull();
    expect(read(".claude/CLAUDE.md")).toBeNull();
    // Under a `.claude/` directory, at the root or deeper, too.
    expect(read(".claude/rules/base.md")).toBe("the base branch's rule\n");
    expect(read(".claude/rules/override.md")).toBeNull();
    expect(read("sub/.claude/rules/nested.md")).toBeNull();
  });

  it("fails the job when files are still left out", () => {
    // A `git` whose config and sparse-checkout commands change nothing leaves
    // the tree as the checkouts made it.
    const result = runStep(standIn("git", 'case "$1" in config|sparse-checkout) exit 0 ;; esac\nexec REAL "$@"'));
    expect(result.status).toBe(1);
    expect(result.stdout).toMatch(/::error::the checkout still leaves \d+ files of the pull request out/);
  });

  it("fails the job when a link is still in the checkout", () => {
    // A `find` that runs no command for what it finds removes nothing.
    const result = runStep(standIn("find", 'case " $* " in *" -exec "*) exit 0 ;; esac\nexec REAL "$@"'));
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("symbolic links are still in the checkout");
  });
});

// Unprivileged, so that a directory can be one the job's user may not write,
// as `/home` is on GitHub's runner.
describe.runIf(process.platform !== "win32" && process.getuid?.() !== 0)("the isolation step, run as GitHub runs it", () => {
  let dir;
  let locked;
  let calls;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "review-bot-isolation-"));
    locked = join(dir, "home");
    const workspace = join(locked, "runner", "work", "repo", "repo");
    mkdirSync(workspace, { recursive: true });
    chmodSync(locked, 0o555);
    // The stand-in for `sudo` records what it was asked to run, and runs none of it.
    const bin = join(dir, "bin");
    mkdirSync(bin);
    writeFileSync(join(bin, "sudo"), '#!/usr/bin/env bash\nprintf "%s\\n" "$*" >> "$FAKE/calls"\n');
    chmodSync(join(bin, "sudo"), 0o755);
    writeFileSync(join(dir, "step.sh"), named(steps, ISOLATION).run);
    const result = spawnSync("bash", ["--noprofile", "--norc", "-eo", "pipefail", join(dir, "step.sh")], {
      cwd: workspace,
      encoding: "utf8",
      env: { PATH: `${bin}:${process.env.PATH}`, HOME: join(locked, "runner"), FAKE: dir, GITHUB_WORKSPACE: workspace },
    });
    expect(result.status, result.stdout + result.stderr).toBe(0);
    calls = readFileSync(join(dir, "calls"), "utf8").trim().split("\n");
  });

  afterAll(() => {
    chmodSync(locked, 0o755);
    rmSync(dir, { recursive: true, force: true });
  });

  it("installs bubblewrap and socat", () => {
    expect(calls).toContain("apt-get install -y --no-install-recommends bubblewrap socat");
  });

  it("lifts AppArmor's limit on user namespaces where the kernel has one", () => {
    // Whether the step lifts it depends on this machine's own /proc, which has
    // the setting on GitHub's runner, where this runs in CI, and not
    // everywhere else; so the command is looked for in the step as well.
    expect(named(steps, ISOLATION).run).toContain("sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0");
    const lifted = calls.includes("sysctl -w kernel.apparmor_restrict_unprivileged_userns=0");
    expect(lifted).toBe(existsSync("/proc/sys/kernel/apparmor_restrict_unprivileged_userns"));
  });

  it("creates `.mcp.json` in each directory above the checkout the job's user cannot write, and nowhere else", () => {
    const touched = calls.filter(call => call.startsWith("touch "));
    expect(touched).toEqual([`touch ${locked}/.mcp.json`, "touch /.mcp.json"]);
  });
});

describe("the model the agent runs", () => {
  it("asks for GLM-5.3 by name, with the Flash model for background calls", () => {
    // `[1m]` gives Claude Code the 1M window and is stripped before the request.
    expect(agent.env.ANTHROPIC_DEFAULT_OPUS_MODEL).toBe("glm-5.3[1m]");
    expect(agent.env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe("glm-5.3[1m]");
    expect(agent.env.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBe("glm-5.3-flash");
  });

  it("sends the deepest effort on every request", () => {
    expect(agent.env.CLAUDE_CODE_EFFORT_LEVEL).toBe("max");
    expect(agent.env.CLAUDE_CODE_ALWAYS_ENABLE_EFFORT).toBe("1");
  });
});

describe("requests that wait", () => {
  it("queues every request for a pull request in order, and cancels none", () => {
    // A group keeps one pending run by default, and a newer one cancels it.
    expect(workflow.concurrency).toEqual({ group: "nextly-review-bot-${{ github.event.issue.number || inputs.pr }}", "cancel-in-progress": false, queue: "max" });
  });

  it("runs one review at a time in the repository, whatever the pull request", () => {
    expect(jobs.review.concurrency).toEqual({ group: "nextly-review-bot-reviews", queue: "max" });
  });

  it("decides whether a request still needs a review before anything else runs", () => {
    const fresh = steps.findIndex(step => step.id === "fresh");
    expect(fresh).toBe(steps.findIndex(step => step.id === "pr") + 1);
    expect(jobs.review.outputs.run).toBe("${{ steps.fresh.outputs.run }}");
    // Every later step of the job runs on that answer, the log step whatever
    // became of the agent.
    for (const step of steps.slice(fresh + 1)) {
      expect(step.if.replace(/^always\(\) && /, ""), step.name ?? step.uses).toBe("steps.fresh.outputs.run == 'true'");
    }
  });
});

describe.runIf(process.platform !== "win32")("the skip step, run as GitHub runs it", () => {
  const SHA = "b".repeat(40);
  const ASKED = "2026-09-29T17:00:00Z";
  let dir;
  const review = (login, commit, at) => ({ user: { login }, commit_id: commit, submitted_at: at, html_url: `https://example.test/${login}/${at}` });

  /** Runs the step against a stand-in `gh` whose pages are the ones given. */
  function decide(pages, asked = ASKED) {
    dir = mkdtempSync(join(tmpdir(), "review-bot-fresh-"));
    const bin = join(dir, "bin");
    mkdirSync(bin);
    writeFileSync(join(dir, "pages"), (pages ?? []).map(page => JSON.stringify(page)).join("\n"));
    // No pages given: GitHub cannot be read.
    writeFileSync(join(bin, "gh"), pages ? '#!/usr/bin/env bash\ncat "$FAKE/pages"\n' : "#!/usr/bin/env bash\necho 'HTTP 502' >&2\nexit 1\n");
    chmodSync(join(bin, "gh"), 0o755);
    writeFileSync(join(dir, "step.sh"), steps.find(step => step.id === "fresh").run);
    const output = join(dir, "output");
    const result = spawnSync("bash", ["--noprofile", "--norc", "-eo", "pipefail", join(dir, "step.sh")], {
      cwd: dir,
      encoding: "utf8",
      env: { PATH: `${bin}:${process.env.PATH}`, HOME: dir, FAKE: dir, GITHUB_OUTPUT: output, REPO: "o/r", NUMBER: "7", SHA, ASKED: asked },
    });
    expect(result.status, result.stdout + result.stderr).toBe(0);
    return { run: readFileSync(output, "utf8").trim(), stdout: result.stdout };
  }

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("skips a request the bot's review of the same head answered after it was made", () => {
    const { run, stdout } = decide([[review("nextly-review-bot[bot]", SHA, "2026-09-29T17:20:00Z")]]);
    expect(run).toBe("run=false");
    expect(stdout).toContain("https://example.test/nextly-review-bot[bot]/2026-09-29T17:20:00Z");
  });

  it("finds that review on a later page", () => {
    expect(decide([[review("someone", SHA, "2026-09-29T16:00:00Z")], [review("nextly-review-bot[bot]", SHA, "2026-09-29T17:20:00Z")]]).run).toBe("run=false");
  });

  it.each([
    ["a review made before the request", review("nextly-review-bot[bot]", SHA, "2026-09-29T16:59:59Z")],
    ["a review of another head", review("nextly-review-bot[bot]", "c".repeat(40), "2026-09-29T17:20:00Z")],
    ["another login's review", review("chatgpt-codex-connector[bot]", SHA, "2026-09-29T17:20:00Z")],
  ])("runs a request that only %s would answer", (_, found) => {
    expect(decide([[found]]).run).toBe("run=true");
  });

  it("runs the request, and says why, when the reviews cannot be read", () => {
    const { run, stdout } = decide(null);
    expect(run).toBe("run=true");
    expect(stdout).toContain("::warning::could not read the pull request's reviews, so the request runs");
  });

  it("runs a dispatch, which has no request time", () => {
    expect(decide([[review("nextly-review-bot[bot]", SHA, "2026-09-29T17:20:00Z")]], "").run).toBe("run=true");
  });
});

describe.runIf(process.platform !== "win32")("the log step, run as GitHub runs it", () => {
  // Every message's text carries this; none of it may reach the log.
  const CONTENT = "the-text-of-a-message";
  let dir;
  const init = { type: "system", subtype: "init", model: "glm-5.3[1m]", claude_code_version: "2.1.222" };
  const said = model => ({ type: "assistant", message: { model, content: [{ type: "text", text: CONTENT }] } });
  const result = extra => ({
    type: "result",
    subtype: "success",
    is_error: false,
    num_turns: 64,
    duration_ms: 803005,
    result: CONTENT,
    modelUsage: { "glm-5.3[1m]": { inputTokens: 1200, outputTokens: 340, cacheReadInputTokens: 90000, cacheCreationInputTokens: 5000 } },
    permission_denials: [
      { tool_name: "Bash", tool_input: { command: CONTENT } },
      { tool_name: "Bash", tool_input: { command: CONTENT } },
      { tool_name: "Read", tool_input: { file_path: CONTENT } },
    ],
    ...extra,
  });

  function log(messages) {
    dir = mkdtempSync(join(tmpdir(), "review-bot-log-"));
    const file = join(dir, "execution.json");
    if (messages) writeFileSync(file, JSON.stringify(messages, null, 2));
    writeFileSync(join(dir, "step.sh"), named(steps, "Log what the run used").run);
    const run = spawnSync("bash", ["--noprofile", "--norc", join(dir, "step.sh")], {
      cwd: dir,
      encoding: "utf8",
      env: { PATH: process.env.PATH, HOME: dir, EXECUTION_FILE: file, RUNNER_TEMP: dir },
    });
    expect(run.status, run.stderr).toBe(0);
    return run.stdout;
  }

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it("reads the execution file the action names, whatever became of the agent", () => {
    const step = named(steps, "Log what the run used");
    expect(step.env.EXECUTION_FILE).toBe("${{ steps.agent.outputs.execution_file }}");
    // A failed run is the one whose log matters most.
    expect(step.if).toBe("always() && steps.fresh.outputs.run == 'true'");
    expect(steps.indexOf(step)).toBe(steps.indexOf(agent) + 1);
  });

  it("prints the models, tokens, turns and refusals, and no message's text", () => {
    const out = log([init, said("glm-5.3"), { type: "user", message: { content: CONTENT } }, said("glm-5.3"), said("glm-5.3-flash"), result()]);
    expect(out).toContain("asked for: glm-5.3[1m], on Claude Code 2.1.222");
    expect(out).toContain("answered by: glm-5.3 x2, glm-5.3-flash x1");
    expect(out).toContain("tokens for glm-5.3[1m]: input 1200, output 340, cache read 90000, cache write 5000");
    expect(out).toContain("turns: 64, ended: success, error: false, 803 s");
    expect(out).toContain("refused tools: Bash x2, Read x1");
    expect(out).not.toContain(CONTENT);
  });

  it("prints why a failed run failed", () => {
    const out = log([init, result({ is_error: true, api_error_status: 429, result: "API Error: 429 rate limited" })]);
    expect(out).toContain("API error status: 429");
    expect(out).toContain("error: API Error: 429 rate limited");
  });

  it("says so, rather than failing, when the agent never started", () => {
    expect(log(null)).toContain("no execution file: the agent did not start");
  });
});

describe.runIf(process.platform !== "win32")("the tooling step, run as GitHub runs it", () => {
  let dir;
  const commits = {};

  // A variable git reads from the environment, such as GIT_DIR inside a hook,
  // would point these commands at another repository, and the developer's own
  // configuration could sign these commits or run hooks on them, and fail
  // them. So git here reads neither, only the settings given below.
  const isolatedEnv = () => ({
    ...Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_"))),
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_SYSTEM: "/dev/null",
  });
  const git = (...args) => execFileSync("git", ["-c", "user.name=test", "-c", "user.email=test@example.com", ...args], { cwd: dir, encoding: "utf8", env: isolatedEnv() }).trim();

  /** Commits a protocol and a gateway that each name the commit they are read from. */
  function commitTooling(name) {
    writeFileSync(join(dir, ".github", "review-prompt.md"), `The protocol at ${name}. Run .github/scripts/review-bot-gh.sh.\n`);
    writeFileSync(join(dir, ".github", "scripts", "review-bot-gh.sh"), `# The gateway at ${name}.\n`);
    git("add", "-A");
    git("commit", "-q", "-m", name);
    return git("rev-parse", "HEAD");
  }

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "review-bot-tooling-"));
    mkdirSync(join(dir, ".github", "scripts"), { recursive: true });
    git("init", "-q", "-b", "main");
    // The commit the event names, the default branch once it has moved on,
    // and the head under review, which the job has checked out by then.
    commits.event = commitTooling("the event's commit");
    git("update-ref", "refs/remotes/origin/main", commitTooling("the default branch's newer commit"));
    commitTooling("the pull request's head");
  });

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("reads the protocol and the gateway from the event's commit, not the default branch or the checkout", () => {
    const step = named(steps, MATERIALIZE);
    // GitHub fills in each expression before the step runs.
    const values = { "github.sha": commits.event, "runner.temp": join(dir, "temp") };
    const resolve = text => text.replace(/\$\{\{ (.+?) \}\}/g, (_, expression) => values[expression]);
    const env = Object.fromEntries(Object.entries(step.env).map(([name, value]) => [name, resolve(value)]));
    writeFileSync(join(dir, "step.sh"), resolve(step.run));
    const result = spawnSync("bash", ["--noprofile", "--norc", "-eo", "pipefail", join(dir, "step.sh")], { cwd: dir, encoding: "utf8", env: { PATH: process.env.PATH, HOME: dir, ...env } });
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(readFileSync(join(env.TOOLING, "review-prompt.md"), "utf8")).toBe(`The protocol at the event's commit. Run ${env.TOOLING}/review-bot-gh.sh.\n`);
    expect(readFileSync(join(env.TOOLING, "review-bot-gh.sh"), "utf8")).toBe("# The gateway at the event's commit.\n");
  });
});

describe.runIf(process.platform !== "win32")("the post step, run as GitHub runs it", () => {
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
        '  files) cat "$FAKE/files.json" ;;',
        '  head-sha) printf "%s\\n" "$SHA" ;;',
        "esac",
        "",
      ].join("\n"),
    );
    chmodSync(gateway, 0o755);
    // The modules the job checks out beside the gateway, copied as the job has them.
    for (const path of checkedOut().filter(entry => entry.startsWith("scripts/"))) {
      mkdirSync(join(dir, posix.dirname(path)), { recursive: true });
      copyFileSync(new URL(`../${path}`, import.meta.url), join(dir, path));
    }
    // One changed file, whose diff shows new lines 1 to 3.
    writeFileSync(join(dir, "files.json"), JSON.stringify([{ filename: "src/a.ts", patch: "@@ -1,2 +1,3 @@\n one\n+two\n three" }]));
    mkdirSync(join(dir, "payload"));
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
  function runStep(name, files = {}, comments = [], body = `the review\n\n<!-- pr-review-agent round:1 head:${SHA} -->`) {
    writeFileSync(join(dir, "payload", "review.json"), JSON.stringify({ body, comments }));
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
    expect(calls).toEqual([`files 7`, `post-review 7 ${out}/inline.json ${SHA} ${RUN}`, `reply 7 101 ${out}/reply-0.md ${RUN} 0`, `reply 7 102 ${out}/reply-1.md ${RUN} 1`]);
  });

  it("posts a comment the diff shows inline, and one it does not as a file-level thread", () => {
    const comments = [
      { path: "src/a.ts", line: 2, side: "RIGHT", body: "shown" },
      { path: "src/a.ts", line: 40, side: "RIGHT", body: "not shown" },
    ];
    const { status, output, calls } = runStep("Post the review as the review bot", {}, comments);
    expect(status, output).toBe(0);
    const out = join(dir, "temp", "nextly-review-post");
    expect(calls.slice(0, 3)).toEqual([`files 7`, `post-review 7 ${out}/inline.json ${SHA} ${RUN}`, `post-file-comment 7 ${SHA} src/a.ts ${out}/file-0.md ${RUN} 0`]);
    expect(JSON.parse(readFileSync(join(out, "inline.json"), "utf8")).comments).toEqual([comments[0]]);
    expect(readFileSync(join(out, "file-0.md"), "utf8")).toContain("not shown");
  });

  it("posts nothing when a comment is on a file the change does not touch", () => {
    const { status, output, calls } = runStep("Post the review as the review bot", {}, [{ path: "src/b.ts", line: 1, body: "elsewhere" }]);
    expect(status).not.toBe(0);
    expect(output).toContain("src/b.ts, which the diff does not change");
    expect(calls).toEqual([`files 7`]);
  });

  // A review whose summary lacks the whole round marker for this head, or any
  // text besides it, is refused before anything is asked of GitHub: posted, it
  // would read as a finished round that said nothing.
  it.each([
    "",
    "  \n ",
    "a summary without the marker",
    "<!-- pr-review-agent round:",
    "a summary <!-- pr-review-agent round:",
    `<!-- pr-review-agent round:1 head:${SHA} -->`,
    ` \n<!-- pr-review-agent round:1 head:${SHA} -->\n<!-- nextly-review-bot run:1 -->\n`,
    "a summary <!-- pr-review-agent round:1 head:0000000 -->",
    `a summary <!-- pr-review-agent round:0 head:${SHA} -->`,
  ])("posts nothing for a review whose summary is %j", body => {
    const { status, output, calls } = runStep("Post the review as the review bot", {}, [], body);
    expect(status).not.toBe(0);
    expect(output).toContain("the payload is not a review");
    expect(calls).toEqual([]);
  });

  it("posts a review whose only text sits between its markers", () => {
    const body = `<!-- pr-review-agent round:2 head:${SHA} -->\n\nNo new findings.\n\n<!-- nextly-review-bot run:1 -->`;
    const { status, output, calls } = runStep("Post the review as the review bot", {}, [], body);
    expect(status, output).toBe(0);
    expect(calls[1]).toMatch(/^post-review 7 /);
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

/*
 * Before it reviews, the agent compares the commit it was asked to review with
 * the branch's head now. Only a request starts a review, so a head that moved
 * gets no newer run, and the agent must say so rather than wait for one.
 */
describe("the head the protocol has the agent compare", () => {
  const protocol = read(".github/review-prompt.md");
  const gateway = read(".github/scripts/review-bot-gh.sh");

  it("names the field the gateway's pull request carries, and writes no payload for a head that moved", () => {
    // `pr` answers with the REST pull request, whose head commit is `head.sha`,
    // and `head-sha` reads that field; `headRefOid` is GraphQL's name for it,
    // which neither answer carries.
    expect(gateway).toMatch(/^ {2}pr\)\n(?: {4}#.*\n)*(?: {4}.*\n)*? {4}exec gh api "repos\/\$REPO\/pulls\/\$1"\n/m);
    expect(gateway).toMatch(/^ {2}head-sha\)\n(?: {4}.*\n)*? {4}exec gh api "repos\/\$REPO\/pulls\/\$1" --jq '\.head\.sha'\n/m);
    expect(protocol).not.toContain("headRefOid");
    expect(protocol).toContain("If the PR's `head.sha` (or the gateway's `head-sha`) no longer matches the SHA you were invoked for");
    expect(protocol).toContain("write no payload");
  });

  it("says a review runs on request, not on a push", () => {
    expect(protocol).toContain("You run when someone asks for a review, once per request");
    expect(protocol).not.toMatch(/per push|newer push/);
  });
});
