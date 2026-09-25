/**
 * The rule that refuses AI credit, over each form and each place it reads, and
 * the command end to end: over a real repository's pull request and queue
 * range, and as the commit-msg hook. Every crediting example is assembled
 * here at run time, so no line of this file spells one and it passes the
 * check it tests.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { load } from "js-yaml";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { addedOrRenamed, branchCredits, creditsIn, diffBlocks, diffLines, isAiIdentity, main, withTrailerStarts } from "./ai-credit.mjs";
import { readGit } from "./workflow-context.mjs";

/** Joined at run time, so that no line here reads as a credit. */
const spell = (...parts) => parts.join("");
const said = (...words) => words.join(" ");
const lines = (...parts) => parts.join("\n");
const trailer = (key, value) => spell(key, "-by: ", value);

const CODE_TOOL = spell("Clau", "de Code");
const CHAT_TOOL = spell("Chat", "GPT");
const PILOT_TOOL = spell("Co", "pilot");
const MODEL = spell("Clau", "de Opus 5");
const VENDOR_ADDRESS = spell("noreply@", "anthro", "pic.com");
const MADE = spell("Gene", "rated");

const credited = (text, place) => creditsIn(text, place).length > 0;

describe("a message's credit, in each form", () => {
  it("refuses a trailer naming a tool or its vendor, as co-author, reviewer or assistant", () => {
    const trailers = [
      trailer("Co-authored", `${MODEL} <${VENDOR_ADDRESS}>`),
      trailer("Reviewed", CHAT_TOOL),
      trailer("Assisted", `${PILOT_TOOL} (the tests)`),
      trailer("Assisted", "AI"),
      trailer("Co-authored", spell('"Clau', 'de Code" <bot@example.com>')),
      // Folded onto a continuation line, which git unfolds into one value.
      lines(trailer("Co-authored", spell("Git", "Hub")), spell("  Co", "pilot <bot@example.com>")),
      // Its whole value on the next line.
      lines(spell("Co-authored", "-by:"), `  ${MODEL} <${VENDOR_ADDRESS}>`),
      // An ambiguous name alone, whole on its line, and completed by an address folded below it.
      spell("Co-authored-by: Clau", "de"),
      lines(spell("Co-authored-by: Clau", "de"), `  <${VENDOR_ADDRESS}>`),
    ];
    for (const line of trailers) expect(credited(lines("fix: a change", "", line), "message"), line).toBe(true);
  });

  it("refuses a statement that a tool made the change, however it is formatted", () => {
    const statements = [
      said("\u{1f916}", MADE, "with", `[${CODE_TOOL}](https://example.com)`),
      said("Written", "with the help of", CHAT_TOOL),
      said("Refactored", "mostly", "by", `**${PILOT_TOOL}**`),
      said("Implemented", "using", "an", "LLM"),
      said("With", "help from", MODEL),
      said(MADE, "with", `<strong>${CHAT_TOOL}</strong>`),
      said(MADE, "with", spell("Mis", "tral Large")),
      spell(CHAT_TOOL, " generated this change"),
      spell(CODE_TOOL, " wrote this file"),
      said(spell("A", "I"), "wrote", "this", "code"),
      spell("Mis", "tral Large wrote this file"),
      spell(PILOT_TOOL, " Chat generated this change"),
    ];
    for (const line of statements) expect(credited(line, "message"), line).toBe(true);
  });

  it("refuses thanks and credit given to a tool", () => {
    const thanks = [spell("Thanks, ", CODE_TOOL, "!"), said("Tests pass, and", "thanks to", CHAT_TOOL), said("Credit", "goes to", PILOT_TOOL), said("Kudos", "to", MODEL)];
    for (const line of thanks) expect(credited(line, "message"), line).toBe(true);
  });

  it("refuses a tool named in full, with its vendor or its edition", () => {
    const full = [said(MADE, "with", spell("Goo", "gle Gem", "ini")), trailer("Co-authored", spell("Git", "Hub Co", "pilot Agent")), said("Thanks to", spell("Open", "AI's Co", "dex"))];
    for (const line of full) expect(credited(line, "message"), line).toBe(true);
  });

  it("refuses AI in general as a trailer's identity, with an address as without", () => {
    for (const line of [trailer("Co-authored", "AI <ai@example.com>"), trailer("Assisted", "LLM <bot@example.com>")]) expect(credited(line, "message"), line).toBe(true);
  });

  it("reads a phrase wrapped across one line break, as Markdown renders it, but not across a blank line", () => {
    expect(creditsIn(lines(spell(MADE, " with"), CODE_TOOL), "message")[0].line).toBe(2);
    expect(credited(lines("Thanks to", CHAT_TOOL), "message")).toBe(true);
    expect(creditsIn(lines("Thanks", "", "Claude Code reads skills from .claude/skills"), "message")).toEqual([]);
    expect(creditsIn(lines(spell(MADE, " with"), "", "Claude Code reads skills from .claude/skills"), "message")).toEqual([]);
  });

  it("refuses calling the change AI-made", () => {
    for (const line of [spell("test: A", "I-generated fixtures"), spell("docs: ", CHAT_TOOL, "-assisted wording")]) expect(credited(line, "message"), line).toBe(true);
  });

  it("accepts a mention that credits nothing", () => {
    const mentions = [
      "chore(root): keep agent skills in .agents/skills, with a generated copy for Claude Code",
      "ci: have Codex review each push, and ask for a review with a comment",
      "docs: the review bot is Claude Code driven by GLM",
      "fix: a commit that credits an AI tool is refused, and one that thanks nobody passes",
      "fix: refuse a message that thanks an AI tool",
      "feat(plugin-mcp): summaries generated with the OpenAI API",
      "fix: pagination generated with cursor tokens",
      "Thanks to the cursor fix, the list loads",
      "Co-authored-by: Claude Dupont <claude.dupont@example.com>",
      "Reviewed-by: Cody Banks <cody@example.com>",
      "Signed-off-by: Jane Doe <jane@example.com>",
      "Written by Claude Dupont, with thanks to Cody Banks",
      said("Written by", spell("Open", "AI"), "researcher Jane Doe, with thanks to the", spell("Anthro", "pic"), "team"),
      said("Written by", CODE_TOOL, "researcher Jane Doe"),
      said("Thanks to the", spell("Mis", "tral"), "Large team"),
      said("Written by", spell("Mis", "tral"), "Large researcher Jane"),
      said("Built with the", PILOT_TOOL, "Chat SDK"),
      lines(spell("Co-authored-by: Clau", "de"), "  Dupont <claude.dupont@example.com>"),
      "Claude Code reads this file on start",
      "ChatGPT generated suggestions for the form",
    ];
    for (const line of mentions) expect(creditsIn(line, "message"), line).toEqual([]);
  });
});

describe("a line a change adds", () => {
  it("refuses a credit in a comment, a document or a string", () => {
    for (const line of [spell("// ", MADE, " by ", CHAT_TOOL), spell("<!-- ", trailer("Co-authored", CODE_TOOL), " -->"), spell("const note = '", PILOT_TOOL, "-generated';"), spell("// ", CODE_TOOL, " wrote this file"), spell("// This file is A", "I-generated")]) {
      expect(credited(line, "line"), line).toBe(true);
    }
  });

  it("passes a page, a document or the code a product makes with AI, and refuses the file or the change so described", () => {
    expect(creditsIn(spell("The page is A", "I-generated by our app for each user"), "line")).toEqual([]);
    expect(creditsIn(spell("This document is A", "I-generated from your notes"), "line")).toEqual([]);
    expect(creditsIn(spell("The code is A", "I-generated; review it before you run it"), "line")).toEqual([]);
    expect(credited(spell("// This code is A", "I-generated"), "line")).toBe(true);
    expect(credited(spell("// The file is A", "I-generated"), "line")).toBe(true);
    expect(credited(spell("The change was A", "I-generated"), "line")).toBe(true);
  });

  it("reads AI in general as what a product does, and passes it, while a message would not", () => {
    const productCopy = spell('const label = "A', 'I-generated alt text";');
    expect(creditsIn(productCopy, "line")).toEqual([]);
    expect(credited(productCopy, "message")).toBe(true);
  });

  it("reads each trailer in a comment block as its own, though every line there is indented", () => {
    const credit = trailer("Co-authored", `${MODEL} <${VENDOR_ADDRESS}>`);
    const signed = trailer("Signed-off", "Jane Doe <jane@example.com>");
    expect(creditsIn(lines("/**", ` * ${signed}`, ` * ${credit}`, " */"), "line")).toEqual([expect.objectContaining({ from: 3, line: 3 })]);
    expect(creditsIn(lines(`  # ${signed}`, `  # ${credit}`), "line")).toEqual([expect.objectContaining({ from: 2, line: 2 })]);
    expect(creditsIn(lines("/**", spell(" * Co-authored", "-by:"), ` *   ${MODEL} <${VENDOR_ADDRESS}>`, " */"), "line")).toEqual([expect.objectContaining({ from: 2, line: 3 })]);
    expect(creditsIn(lines("/**", ` * ${signed}`, spell(" * Co-authored", "-by:"), ` *   ${MODEL} <${VENDOR_ADDRESS}>`, " */"), "line")).toEqual([expect.objectContaining({ from: 3, line: 4 })]);
  });

  it("reports the line of a multi-line text that carries the credit", () => {
    expect(creditsIn(lines("first line", "second", spell("  Thanks, ", CHAT_TOOL)), "line")[0].line).toBe(3);
    // A maker's phrase spans from the name to the change, so a line that completes it takes part.
    expect(creditsIn(lines(CODE_TOOL, "wrote this file"), "line")).toEqual([expect.objectContaining({ from: 1, line: 2 })]);
  });
});

describe("a branch name and a path", () => {
  it("refuses a branch a tool named for itself, or one that spells out a credit", () => {
    for (const branch of [spell("clau", "de/issue-12-login"), spell("feat/generated-by-", "cursor")]) expect(branchCredits(branch).length, branch).toBeGreaterThan(0);
  });

  it("accepts a branch or a path that mentions a tool's files", () => {
    for (const name of ["feat/cursor-pagination", "fix/claude-md-loading", ".claude/skills/testing-evidence/SKILL.md", "packages/nextly/CLAUDE.md"]) {
      expect([...branchCredits(name), ...creditsIn(name, "name")], name).toEqual([]);
    }
  });

  it("refuses a path that spells out a credit", () => {
    expect(credited(spell("docs/written-with-", "chatgpt.md"), "name")).toBe(true);
  });
});

describe("an author or committer", () => {
  it("is an AI tool's identity by its address, its GitHub account or its own name", () => {
    const tools = [
      spell("Clau", "de <", VENDOR_ADDRESS, ">"),
      spell("copilot-swe-agent[bot] <198982749+", "Copilot@users.noreply.github.com>"),
      spell("Devin AI <158243242+devin-ai-", "integration[bot]@users.noreply.github.com>"),
      spell("Cursor Agent <cursoragent@", "cursor.com>"),
      spell("Jane Doe (ai", "der) <jane@example.com>"),
      spell("Clau", "de <claude@", "anthro", "pic.com>"),
    ];
    for (const identity of tools) expect(isAiIdentity(identity), identity).toBe(true);
  });

  it("is never a person, or a bot that is not an AI tool, whatever name they share with one", () => {
    const people = [
      "github-actions[bot] <41898282+github-actions[bot]@users.noreply.github.com>",
      "dependabot[bot] <49699333+dependabot[bot]@users.noreply.github.com>",
      "Claude Dupont <claude.dupont@example.com>",
      "Cody <cody@example.com>",
      "Devin Smith <devin@example.com>",
      "OpenAI Researcher <person@example.com>",
      "Anthropic Team <team@example.org>",
      "Jane Doe <jane@openai.com>",
    ];
    for (const identity of people) expect(isAiIdentity(identity), identity).toBe(false);
  });
});

describe("reading a diff", () => {
  it("takes each added line, and the unchanged lines beside it, with its file and line number, even one shaped like a header", () => {
    const diff = ["diff --git a/a.md b/a.md", "--- a/a.md", "+++ b/a.md", "@@ -3,0 +4,2 @@", "+++ plain text", "+second", "\\ No newline at end of file", "@@ -9 +10 @@", "-old", "+new", "@@ -20,2 +21,3 @@", " kept", "+inserted", " also kept"].join("\n");
    expect(diffLines(diff)).toEqual([
      { path: "a.md", line: 4, text: "++ plain text", added: true },
      { path: "a.md", line: 5, text: "second", added: true },
      { path: "a.md", line: 10, text: "new", added: true },
      { path: "a.md", line: 21, text: "kept", added: false },
      { path: "a.md", line: 22, text: "inserted", added: true },
      { path: "a.md", line: 23, text: "also kept", added: false },
    ]);
  });

  it("reads consecutive lines of a file as one text, and a gap or another file as a new one", () => {
    const shown = [
      { path: "a.md", line: 3, text: "x", added: false },
      { path: "a.md", line: 4, text: "y", added: true },
      { path: "a.md", line: 9, text: "z", added: true },
      { path: "b.md", line: 10, text: "w", added: true },
    ];
    expect(diffBlocks(shown)).toEqual([
      { path: "a.md", start: 3, texts: ["x", "y"], added: [false, true] },
      { path: "a.md", start: 9, texts: ["z"], added: [true] },
      { path: "b.md", start: 10, texts: ["w"], added: [true] },
    ]);
  });

  /*
   * Most code begins indented, as a folded trailer's continuation does. A
   * block reaches back only to a trailer it continues, read as a line is read,
   * and each file is read once however many of its blocks begin indented.
   */
  it("extends a block back to the trailer it continues, and code to nothing, reading each file once", () => {
    const credit = trailer("Co-authored", "Build Team");
    const text = lines("function one() {", "  const a = 1;", "  const b = 2;", "}", credit, "  and friends", "  more", "", `* ${credit}`, "*   and friends", "*   more");
    const shown = [];
    const git = args => {
      shown.push(args.at(-1));
      return { ok: true, out: text };
    };
    const code = { path: "a.md", start: 3, texts: ["  const b = 2;"], added: [true] };
    const folded = { path: "a.md", start: 7, texts: ["  more"], added: [true] };
    const starred = { path: "a.md", start: 11, texts: ["*   more"], added: [true] };
    expect(withTrailerStarts([code, folded, starred], "HEAD", git)).toEqual([
      code,
      { path: "a.md", start: 5, texts: [credit, "  and friends", "  more"], added: [false, false, true] },
      { path: "a.md", start: 9, texts: [`* ${credit}`, "*   and friends", "*   more"], added: [false, false, true] },
    ]);
    expect(shown).toEqual(["HEAD:a.md"]);
  });

  it("names the paths a change adds, renames or copies, and not the ones it only edits", () => {
    expect(addedOrRenamed(["A", "new.md", "M", "edited.md", "R096", "old.md", "moved.md", "C100", "src.md", "copy.md", "D", "gone.md", ""])).toEqual(["new.md", "moved.md", "copy.md"]);
  });
});

describe("the command in CI", () => {
  let repo;

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), "ai-credit-"));
    run("init", "-q", "-b", "main");
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(repo, { recursive: true, force: true });
  });

  function run(...args) {
    return execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();
  }

  function commit(message, { file = "notes.md", text = "a line\n", author = "Jane Doe <jane@example.com>" } = {}) {
    writeFileSync(join(repo, file), text);
    run("add", "-A");
    run("-c", "user.name=Jane Doe", "-c", "user.email=jane@example.com", "commit", "-q", `--author=${author}`, "-m", message);
    return run("rev-parse", "HEAD");
  }

  /** A pull request of one commit on a branch off `main`, and the event that reports it. */
  function pullRequest({ title = "docs: add notes", body = "Adds notes.", branch = "docs/notes", ...change } = {}) {
    const base = commit("chore: the base", { file: "base.md" });
    run("checkout", "-q", "-b", "topic");
    const head = commit(change.message ?? title, change);
    return eventFor("pull_request", { pull_request: { title, body, head: { ref: branch, sha: head }, base: { sha: base } } });
  }

  function eventFor(name, payload) {
    const event = join(repo, "event.json");
    writeFileSync(event, JSON.stringify(payload));
    return { env: { GITHUB_EVENT_NAME: name, GITHUB_EVENT_PATH: event }, git: (args, options) => readGit(args, { ...options, cwd: repo }) };
  }

  const printed = () => console.log.mock.calls.map(call => call.join(" ")).join("\n");
  const decide = ({ env, git }) => main([], env, git);

  it("passes a pull request with no credit, and says what it read", () => {
    expect(decide(pullRequest())).toBe(0);
    expect(printed()).toMatch(/no AI credit in the title, description and branch, 1 commit\(s\), 1 added or renamed path\(s\) and 1 added line\(s\)/);
  });

  it("refuses a credit in an added line, naming the file and line", () => {
    expect(decide(pullRequest({ text: lines("intro", spell(MADE, " with ", CODE_TOOL), "") }))).toBe(1);
    expect(printed()).toMatch(/::error file=notes\.md,line=2,title=AI credit::notes\.md:2 states that it made the change/);
  });

  it("refuses a credit wrapped across added lines, naming the line of the tool", () => {
    expect(decide(pullRequest({ text: lines("intro", spell(MADE, " with"), CODE_TOOL, "") }))).toBe(1);
    expect(printed()).toMatch(/::error file=notes\.md,line=3,title=AI credit::notes\.md:3 states that it made the change/);
  });

  it("refuses a credit an added line forms with an unchanged one beside it, and never one the change leaves alone", () => {
    const base = commit("chore: the base", { text: lines("intro", "Claude Code reads skills", "", "x", "y", "") });
    run("checkout", "-q", "-b", "topic");
    const head = commit("docs: say where", { text: lines("intro", spell(MADE, " with"), "Claude Code reads skills", "", "x", "y", "") });
    expect(decide(eventFor("pull_request", { pull_request: { title: "docs: say where", body: "", head: { ref: "docs/where", sha: head }, base: { sha: base } } }))).toBe(1);
    expect(printed()).toMatch(/file=notes\.md,line=3,title=AI credit::notes\.md:3 states that it made the change/);
    // The control: a credit already there, right beside an added line, is not the change's.
    run("checkout", "-q", "main");
    const old = commit("chore: an old note", { text: lines(spell(MADE, " with ", CODE_TOOL), "") });
    run("checkout", "-q", "-b", "later");
    const later = commit("docs: add a line", { text: lines(spell(MADE, " with ", CODE_TOOL), "an added line", "") });
    expect(decide(eventFor("pull_request", { pull_request: { title: "docs: add a line", body: "", head: { ref: "docs/later", sha: later }, base: { sha: old } } }))).toBe(0);
  });

  it("refuses a trailer an added continuation line completes, though its first line was already there", () => {
    const base = commit("chore: the base", { text: lines(trailer("Co-authored", spell("Git", "Hub")), "") });
    run("checkout", "-q", "-b", "topic");
    const head = commit("docs: finish the line", { text: lines(trailer("Co-authored", spell("Git", "Hub")), spell("  Co", "pilot Agent"), "") });
    expect(decide(eventFor("pull_request", { pull_request: { title: "docs: finish the line", body: "", head: { ref: "docs/line", sha: head }, base: { sha: base } } }))).toBe(1);
    expect(printed()).toMatch(/file=notes\.md,line=2,title=AI credit::notes\.md:2 names it in a Co-authored-by trailer/);
  });

  it("reads a folded trailer from its start in the final file, however far above the added line it sits", () => {
    // The unchanged lines credit no one; the added line's address makes the whole trailer a tool's.
    const start = lines(trailer("Co-authored", "Build Team"), "  and friends");
    const base = commit("chore: the base", { text: lines(start, "") });
    run("checkout", "-q", "-b", "topic");
    const head = commit("docs: finish it", { text: lines(start, spell("  <198982749+", "Co", "pilot@users.noreply.github.com>"), "") });
    expect(decide(eventFor("pull_request", { pull_request: { title: "docs: finish it", body: "", head: { ref: "docs/finish", sha: head }, base: { sha: base } } }))).toBe(1);
    expect(printed()).toMatch(/file=notes\.md,line=3,title=AI credit::notes\.md:3 names it in a Co-authored-by trailer/);
  });

  it("reads a folded trailer in an indented comment from its start, above the diff", () => {
    const start = lines("/**", ` * ${trailer("Co-authored", "Build Team")}`, " *   and friends");
    const base = commit("chore: the base", { text: lines(start, " */", "") });
    run("checkout", "-q", "-b", "topic");
    const head = commit("docs: finish it", { text: lines(start, spell(" *   <198982749+", "Co", "pilot@users.noreply.github.com>"), " */", "") });
    expect(decide(eventFor("pull_request", { pull_request: { title: "docs: finish it", body: "", head: { ref: "docs/finish", sha: head }, base: { sha: base } } }))).toBe(1);
    expect(printed()).toMatch(/file=notes\.md,line=4,title=AI credit::notes\.md:4 names it in a Co-authored-by trailer/);
  });

  it("does not refuse a harmless continuation added to a credit that was already there", () => {
    const credit = trailer("Co-authored", CODE_TOOL);
    const base = commit("chore: the base", { text: lines(credit, "") });
    run("checkout", "-q", "-b", "topic");
    const head = commit("docs: add a note", { text: lines(credit, "  with a note", "") });
    expect(decide(eventFor("pull_request", { pull_request: { title: "docs: add a note", body: "", head: { ref: "docs/note", sha: head }, base: { sha: base } } }))).toBe(0);
  });

  it("reads a file as text even where a changed attribute calls it binary", () => {
    const base = commit("chore: the base", { file: "base.md" });
    run("checkout", "-q", "-b", "topic");
    commit("chore: call notes binary", { file: ".gitattributes", text: "*.md -diff\n" });
    const head = commit("docs: add notes", { text: spell(MADE, " by ", CHAT_TOOL, "\n") });
    expect(decide(eventFor("pull_request", { pull_request: { title: "docs: add notes", body: "", head: { ref: "docs/notes", sha: head }, base: { sha: base } } }))).toBe(1);
    expect(printed()).toMatch(/file=notes\.md,line=1/);
  });

  it("reads a pull_request_target event as the pull request it carries", () => {
    const { env, git } = pullRequest({ message: "docs: add notes", title: spell("docs: add notes, thanks to ", CHAT_TOOL) });
    expect(decide({ env: { ...env, GITHUB_EVENT_NAME: "pull_request_target" }, git })).toBe(1);
    expect(printed()).toMatch(/the title thanks it/);
  });

  it("reads each commit whole, whatever characters its message holds", () => {
    // A record separator is the character a formatted log would split commits on.
    const message = lines("docs: add notes", "\x1e", trailer("Co-authored", `${MODEL} <${VENDOR_ADDRESS}>`));
    expect(decide(pullRequest({ message }))).toBe(1);
    expect(printed()).toMatch(/names it in a Co-authored-by trailer/);
  });

  it("refuses a credit in a commit's message", () => {
    expect(decide(pullRequest({ message: lines("docs: add notes", "", trailer("Co-authored", `${MODEL} <${VENDOR_ADDRESS}>`)) }))).toBe(1);
    expect(printed()).toMatch(/the message of commit [0-9a-f]{9}, line 3, names it in a Co-authored-by trailer/);
  });

  it("refuses an AI tool as a commit's author", () => {
    expect(decide(pullRequest({ author: spell("Clau", "de <", VENDOR_ADDRESS, ">") }))).toBe(1);
    expect(printed()).toMatch(/the author of commit [0-9a-f]{9}, is an AI tool's identity/);
  });

  it("refuses a credit in the title, the description or the branch, naming which", () => {
    expect(decide(pullRequest({ message: "docs: add notes", title: spell("docs: add notes, thanks to ", CHAT_TOOL), body: lines("Adds notes.", "", spell(MADE, " with ", PILOT_TOOL)), branch: spell("clau", "de/notes") }))).toBe(1);
    expect(printed()).toMatch(/the title thanks it/);
    expect(printed()).toMatch(/the description, line 3, states that it made the change/);
    expect(printed()).toMatch(/the branch \S+ is named for the tool that opened it/);
  });

  it("reads what the merge queue would land, from its base to its head", () => {
    const base = commit("chore: the base", { file: "base.md" });
    commit("docs: add notes (#12)", { text: spell(MADE, " by ", CHAT_TOOL, "\n") });
    const head = commit("docs: more notes (#13)", { file: "more.md" });
    expect(decide(eventFor("merge_group", { merge_group: { base_sha: base, head_sha: head } }))).toBe(1);
    expect(printed()).toMatch(/file=notes\.md,line=1/);
  });

  it("fails, never passes, when it has nothing to read", () => {
    const base = commit("chore: the base", { file: "base.md" });
    expect(decide(eventFor("merge_group", { merge_group: { base_sha: base, head_sha: base } }))).toBe(1);
    expect(printed()).toMatch(/holds no commits, so reading it would examine nothing/);
    expect(decide(eventFor("push", {}))).toBe(1);
    expect(printed()).toMatch(/no range to read for a push event/);
    expect(decide(eventFor("merge_group", { merge_group: { base_sha: "f".repeat(40), head_sha: base } }))).toBe(1);
    expect(printed()).toMatch(/cannot read the range: base f{40} is not present/);
  });
});

describe("the workflow that runs it", () => {
  // A title and a description are published the moment they are written, so
  // an edit to either is read again; the queue reads what it would land.
  it("runs on every change to a pull request, its edits included, and in the merge queue", () => {
    const workflow = load(readFileSync(new URL("../.github/workflows/ai-credit.yml", import.meta.url), "utf8"));
    const triggers = workflow.on ?? workflow[true];
    expect(triggers.pull_request_target).toEqual({ types: ["opened", "edited", "synchronize", "reopened"] });
    expect(triggers.merge_group).toEqual({ types: ["checks_requested"] });
    expect(workflow.jobs.credit.steps.at(-1).run).toBe("node trusted/scripts/ai-credit.mjs");
  });
});

describe("where the workflow's checker comes from", () => {
  // A change could rewrite the checker it is judged by, so the checker comes
  // from main, or the queue's base, and the change is only read.
  it("runs the checker from main or the queue's base, and only reads the change", () => {
    const workflow = load(readFileSync(new URL("../.github/workflows/ai-credit.yml", import.meta.url), "utf8"));
    const steps = workflow.jobs.credit.steps;
    const [change, checker] = steps.filter(step => String(step.uses).startsWith("actions/checkout@"));
    expect(change.with["fetch-depth"]).toBe(0);
    expect(change.with.ref).toBe("${{ github.event_name == 'merge_group' && github.ref || format('refs/pull/{0}/head', github.event.pull_request.number) }}");
    expect(checker.with.ref).toBe("${{ github.event_name == 'merge_group' && github.event.merge_group.base_sha || github.event.repository.default_branch }}");
    expect(workflow.jobs.credit.permissions).toEqual({ contents: "read" });
    expect(checker.with.path).toBe("trusted");
    expect(steps.at(-1).run.startsWith(`node ${checker.with.path}/`)).toBe(true);
  });
});

describe("the command as the commit-msg hook", () => {
  let dir;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "ai-credit-hook-"));
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(dir, { recursive: true, force: true });
  });

  /** Runs the hook's check on a message, with the author and committer git would report. */
  function hook(message, { author = "Jane Doe <jane@example.com>", committer = author, readable = true } = {}) {
    const file = join(dir, "COMMIT_EDITMSG");
    writeFileSync(file, message);
    const idents = { GIT_AUTHOR_IDENT: author, GIT_COMMITTER_IDENT: committer };
    const git = args => (args[0] === "var" && readable ? { ok: true, out: `${idents[args[1]]} 1727222400 +0300\n` } : { ok: false, out: "" });
    return main(["--commit-msg", file], {}, git);
  }

  const complaint = () => console.error.mock.calls.map(call => call.join(" ")).join("\n");

  it("refuses a crediting message before the commit exists", () => {
    expect(hook(lines("fix: a change", "", trailer("Co-authored", `${MODEL} <${VENDOR_ADDRESS}>`)))).toBe(1);
    expect(complaint()).toMatch(/the message, line 3, names it in a Co-authored-by trailer/);
  });

  it("refuses an AI tool as the author or the committer", () => {
    expect(hook("fix: a change", { committer: spell("Clau", "de <", VENDOR_ADDRESS, ">") })).toBe(1);
    expect(complaint()).toMatch(/the committer, .+, is an AI tool's identity/);
  });

  // A message given with `-m` or `-F` keeps its comment lines, and everything
  // below a scissors line, so all of it is read as the message. In the editor
  // git opens, its scissors line is followed by its own comment lines, and it
  // drops what is below; there that part is read as the diff the editor shows:
  // its added lines count, and the lines it removes or keeps do not.
  it("reads comment lines, and below the scissors all a message keeps, but never what an editor's diff removes", () => {
    const credit = trailer("Co-authored", `${MODEL} <${VENDOR_ADDRESS}>`);
    const scissors = "# ------------------------ >8 ------------------------";
    const editor = [scissors, "# Do not modify or remove the line above."];
    expect(hook(lines("fix: a change", spell("# ", credit)))).toBe(1);
    expect(hook(lines("fix: a change", scissors, credit))).toBe(1);
    expect(hook(lines("fix: a change", scissors, spell(" ", credit)))).toBe(1);
    expect(hook(lines("fix: a change", ...editor, spell("+", credit)))).toBe(1);
    expect(hook(lines("fix: a change", ...editor, spell("-", credit)))).toBe(0);
    expect(hook(lines("fix: a change", ...editor, spell(" ", credit)))).toBe(0);
  });

  it("knows the editor's diff by git's own lines, in any comment prefix or language, and reads a message's own text below the scissors as its message", () => {
    const credit = trailer("Co-authored", `${MODEL} <${VENDOR_ADDRESS}>`);
    for (const prefix of [";", "//"]) {
      const editor = [`${prefix} ------------------------ >8 ------------------------`, `${prefix} Ne modifiez pas et ne supprimez pas la ligne ci-dessus.`];
      expect(hook(lines("fix: a change", ...editor, spell(" ", credit))), prefix).toBe(0);
      expect(hook(lines("fix: a change", ...editor, spell("+", credit))), prefix).toBe(1);
    }
    expect(hook(lines("fix: a change", "# ------------------------ >8 ------------------------", spell("Entirely A", "I-generated.")))).toBe(1);
  });

  it("accepts a clean message, and refuses when it cannot read who is committing", () => {
    expect(hook("fix: change how Claude Code loads skills")).toBe(0);
    expect(hook("fix: a change", { readable: false })).toBe(1);
    expect(complaint()).toMatch(/the commit's author could not be read/);
  });
});
