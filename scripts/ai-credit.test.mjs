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

import { addedOrRenamed, branchCredits, creditsIn, diffLines, isAiIdentity, main, paragraphBlocks } from "./ai-credit.mjs";
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
      // An ambiguous name with its edition, as prose and a maker's phrase read it.
      trailer("Co-authored", spell("Mis", "tral Large")),
      // An ambiguous name with the separator before a co-author that was never written.
      trailer("Co-authored", spell("Clau", "de,")),
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
      // The edition wrapped onto the next line is still the name's.
      lines(spell("Mis", "tral"), "Large wrote this file"),
      lines(PILOT_TOOL, "Chat generated this change"),
    ];
    for (const line of statements) expect(credited(line, "message"), line).toBe(true);
  });

  it("refuses thanks and credit given to a tool", () => {
    const thanks = [
      spell("Thanks, ", CODE_TOOL, "!"),
      said("Tests pass, and", "thanks to", CHAT_TOOL),
      said("Credit", "goes to", PILOT_TOOL),
      said("Kudos", "to", MODEL),
      // A role word in the next paragraph is not the name's.
      lines(said("Thanks to", spell("Mis", "tral")), "Large", "", "team notes"),
      lines(said("Thanks to", CHAT_TOOL), "", "team notes"),
    ];
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
      lines(said("Thanks to the", spell("Mis", "tral")), "Large team"),
      // A vendor's name continued onto a person's, with the person's address, is the person.
      lines(trailer("Co-authored", spell("Anthro", "pic")), spell("  Researcher Jane Doe <jane@", "anthro", "pic.com>")),
      lines(trailer("Co-authored", spell("Anthro", "pic")), spell("  Jane Doe <jane@", "anthro", "pic.com>")),
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

  // The line a self-description completes on is the one that makes it a credit.
  it("spans a self-description to the line that completes it", () => {
    expect(creditsIn(lines("This file is", spell("A", "I-generated.")), "line")).toEqual([expect.objectContaining({ from: 1, line: 2 })]);
  });

  /*
   * In a line-comment block a folded trailer's value starts on the next line,
   * behind the same comment prefix, and indented further than the trailer's
   * own text. A line with the prefix and the trailer's indent is a comment of
   * its own, not the trailer's value.
   */
  it("completes a trailer indented in a block with an address level with it", () => {
    expect(creditsIn(lines(spell("  Co-authored", "-by: Alice"), spell("  <noreply@", "open", "ai.com>")), "line")).toEqual([expect.objectContaining({ from: 1, line: 2 })]);
  });

  // At the margin a line is its own, as git reads one: only an indented address continues a trailer.
  it("leaves an address at the margin as a line of its own", () => {
    expect(creditsIn(lines(trailer("Co-authored", "Jane Doe"), spell("<noreply@", "open", "ai.com>")), "line")).toEqual([]);
  });

  // Markdown indents a list item's continuation to its text, without repeating the bullet.
  it("unfolds a trailer written as a list item onto the lines indented under its bullet", () => {
    expect(creditsIn(lines(spell("* Co-authored", "-by:"), `  ${CODE_TOOL}`), "message")).toEqual([expect.objectContaining({ from: 1, line: 2 })]);
    expect(creditsIn(lines(spell("* Co-authored", "-by: Jane Doe"), spell("* ", CHAT_TOOL, " loads skills")), "message")).toEqual([]);
    // Under an item an indented line continues the trailer only as what its
    // value still needs, another co-author or the address that completes one;
    // an explanation of the item is a line of its own.
    expect(creditsIn(lines(spell("* Co-authored", "-by: Jane Doe"), spell("  ", CODE_TOOL, " reads the project files")), "message")).toEqual([]);
    expect(creditsIn(lines(spell("* Co-authored", "-by: Clau", "de"), "  Dupont <claude.dupont@example.com>"), "message")).toEqual([]);
    expect(creditsIn(lines(spell("* Co-authored", "-by: Jane Doe"), spell("  and ", CODE_TOOL)), "message")).toEqual([expect.objectContaining({ from: 2, line: 2 })]);
    // A name alone goes on with the value, as a tool's name or a surname does, and so does a note.
    expect(creditsIn(lines(spell("* Co-authored", "-by: Jane Doe"), `  ${CODE_TOOL}`), "message")).toEqual([expect.objectContaining({ from: 2, line: 2 })]);
    expect(creditsIn(lines(spell("* Co-authored", "-by: Clau", "de"), "  Dupont"), "message")).toEqual([]);
    expect(creditsIn(lines(spell("* Co-authored", "-by: Jane Doe"), "  (context)", `  ${CODE_TOOL}`), "message")).toEqual([expect.objectContaining({ from: 3, line: 3 })]);
    // An explanation credits no one, however it opens, and a co-author after it still belongs to the trailer.
    expect(creditsIn(lines(spell("* Co-authored", "-by: Jane Doe"), spell("  ", CODE_TOOL, ": reads the project files")), "message")).toEqual([]);
    expect(creditsIn(lines(spell("* Co-authored", "-by: Jane Doe"), "  with a note", spell("  and ", CODE_TOOL)), "message")).toEqual([expect.objectContaining({ from: 3, line: 3 })]);
    // An ambiguous name in lower case is a name alone, as the trailer reads it in any case.
    expect(creditsIn(lines(spell("* Co-authored", "-by: Jane Doe"), spell("  clau", "de")), "message")).toEqual([expect.objectContaining({ from: 2, line: 2 })]);
    // A name alone may end with the separator before the next co-author, and is judged without it.
    expect(creditsIn(lines(spell("* Co-authored", "-by: Jane Doe"), spell("  ", CODE_TOOL, ",")), "message")).toEqual([expect.objectContaining({ from: 2, line: 2 })]);
    expect(creditsIn(lines(spell("* Co-authored", "-by: Jane Doe"), spell("  Clau", "de,")), "message")).toEqual([expect.objectContaining({ from: 2, line: 2 })]);
    // A note left open goes on across the lines after it, and once closed, a co-author after it is one of its own.
    expect(creditsIn(lines(spell("* Co-authored", "-by: Jane Doe"), "  (checked against", `  ${CODE_TOOL}`), "message")).toEqual([]);
    expect(creditsIn(lines(spell("* Co-authored", "-by: Jane Doe"), "  (checked against", `  ${CODE_TOOL}`, "  docs)", spell("  and ", CHAT_TOOL)), "message")).toEqual([expect.objectContaining({ from: 5, line: 5 })]);
    // An address goes on with the name before it, which a vendor's address makes a tool's; the name credited on its own line already.
    expect(creditsIn(lines(spell("* Co-authored", "-by: Clau", "de"), spell("  <claude@", "anthro", "pic.com>")), "message")).toEqual([expect.objectContaining({ from: 1, line: 1 })]);
  });

  it("unfolds a trailer across a repeated comment prefix, and not onto the next comment", () => {
    for (const prefix of ["//", "#", ";", "--", " *"]) {
      expect(creditsIn(lines(spell(prefix, " Co-authored", "-by:"), `${prefix}   ${CHAT_TOOL}`), "line"), prefix).toEqual([expect.objectContaining({ from: 1, line: 2 })]);
      expect(creditsIn(lines(`${prefix} ${trailer("Co-authored", "Jane Doe")}`, `${prefix} ${CHAT_TOOL} reads this file`), "line"), prefix).toEqual([]);
    }
  });

  /*
   * A credit already whole on a trailer's first line stays that line's, and a
   * continuation that adds another tool credits it on its own line, so a new
   * credit cannot hide behind an old one. A continuation adding no tool, and a
   * note, add nothing.
   */
  it("credits a continuation that names another tool on its own line, and nothing for one that does not", () => {
    const credit = trailer("Co-authored", CODE_TOOL);
    expect(creditsIn(lines(credit, spell("  and Git", "Hub Co", "pilot")), "line")).toEqual([expect.objectContaining({ from: 1, line: 1 }), expect.objectContaining({ from: 2, line: 2 })]);
    expect(creditsIn(lines(credit, `  ${CHAT_TOOL} <${spell("noreply@", "open", "ai.com")}>`), "line")).toEqual([expect.objectContaining({ from: 1, line: 1 }), expect.objectContaining({ from: 2, line: 2 })]);
    // A tool's full name is a credit once complete: a person's name and address continued after it do not undo it.
    expect(creditsIn(lines(credit, "  and Jane Doe <jane@example.com>"), "line")).toEqual([expect.objectContaining({ from: 1, line: 1 })]);
    expect(creditsIn(lines(credit, "  Jane Doe <jane@example.com>"), "line")).toEqual([expect.objectContaining({ from: 1, line: 1 })]);
    expect(creditsIn(lines(credit, "  with a note"), "line")).toEqual([expect.objectContaining({ from: 1, line: 1 })]);
    expect(creditsIn(lines(trailer("Co-authored", "Jane Doe"), "  and friends"), "line")).toEqual([]);
    // A list item after a trailer is its own line, whatever its bullet or indent.
    for (const item of [spell("* ", CHAT_TOOL, " loads skills differently"), spell("  * ", CHAT_TOOL, " loads skills"), spell("- ", CHAT_TOOL, " loads skills")]) {
      expect(creditsIn(lines(trailer("Co-authored", "Jane Doe"), item), "line"), item).toEqual([]);
    }
    // A note that mentions a tool names no co-author.
    expect(creditsIn(lines(trailer("Co-authored", "Jane Doe"), spell("  (checked against the ", CODE_TOOL, " docs)")), "line")).toEqual([]);
    // A later co-author folded across lines is judged whole, as the first is: a person's surname and address, or a tool's edition.
    expect(creditsIn(lines(trailer("Co-authored", "Jane Doe"), spell("  and Clau", "de"), "  Dupont <claude.dupont@example.com>"), "line")).toEqual([]);
    expect(creditsIn(lines(trailer("Co-authored", "Jane Doe"), spell("  and Clau", "de"), "  Opus 5"), "line")).toEqual([expect.objectContaining({ from: 2, line: 2 })]);
    // A joining word is a word of its own: a surname that starts with one goes on with the co-author before it.
    expect(creditsIn(lines(trailer("Co-authored", "Jane Doe"), spell("  and Clau", "de"), "  Andrews <claude.andrews@example.com>"), "line")).toEqual([]);
    // A closed note completes what it follows, so the line after it is a co-author of its own; a note still open goes on.
    expect(creditsIn(lines(trailer("Co-authored", "Jane Doe"), "  (context)", `  ${CODE_TOOL}`), "line")).toEqual([expect.objectContaining({ from: 3, line: 3 })]);
    expect(creditsIn(lines(trailer("Co-authored", "Jane Doe"), "  (checked against the", spell("  ", CODE_TOOL, " docs)")), "line")).toEqual([]);
    // An address inside a note still open does not end it.
    expect(creditsIn(lines(trailer("Co-authored", "Jane Doe"), "  (reviewed by Alice <alice@example.com>", spell("  ", CODE_TOOL, " docs)")), "line")).toEqual([]);
    // A tool named after a note under a vendor's name is that line's credit, not the vendor's line's.
    expect(creditsIn(lines(trailer("Co-authored", spell("Anthro", "pic")), "  (a note)", spell("  and ", CODE_TOOL)), "line")).toEqual([expect.objectContaining({ line: 3 })]);
    // An identity complete with its address, or closed by a separator, leaves the next line an identity of its own.
    expect(creditsIn(lines(trailer("Co-authored", "Jane Doe"), "  and Alice Smith <alice@example.com>", `  ${MODEL} <${VENDOR_ADDRESS}>`), "line")).toEqual([expect.objectContaining({ from: 3, line: 3 })]);
    expect(creditsIn(lines(trailer("Co-authored", "Jane Doe"), "  and Alice Smith,", `  ${CODE_TOOL}`), "line")).toEqual([expect.objectContaining({ from: 3, line: 3 })]);
    expect(creditsIn(lines(trailer("Co-authored", "Jane Doe"), spell("  and Clau", "de,")), "line")).toEqual([expect.objectContaining({ from: 2, line: 2 })]);
  });

  // An identity is read across a few lines at most, so a long run of folded lines takes time in proportion to its length.
  it("reads a long run of folded lines in time that grows with its length", () => {
    const run = Array.from({ length: 12000 }, (_, n) => `  line ${n}`);
    expect(creditsIn(lines(trailer("Co-authored", CODE_TOOL), ...run), "line")).toEqual([expect.objectContaining({ from: 1, line: 1 })]);
    expect(creditsIn(lines(trailer("Co-authored", "Jane Doe"), ...run), "line")).toEqual([]);
    // Under a list item every line goes on with the trailer, and each is decided without reading the value again.
    expect(creditsIn(lines(spell("* Co-authored", "-by: Jane Doe"), ...Array.from({ length: 30000 }, (_, n) => `  line ${n}`)), "message")).toEqual([]);
  }, 5000);

  it("keeps a trailer's multi-line human name whole under a list item", () => {
    expect(creditsIn(lines(spell("* Co-authored", "-by: Clau", "de"), "  Dupont", "  <claude.dupont@example.com>"), "message")).toEqual([]);
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

  /*
   * Git C-quotes a path that holds a `"`, a `\` or a control character, and
   * ends one that holds a space with a tab. Read as printed, the path names no
   * file, and a final file read by it fails.
   */
  it("reads a path git quotes or ends with a tab as the path it is", () => {
    const header = target => ["diff --git a/x b/x", "--- /dev/null", `+++ ${target}`, "@@ -0,0 +1 @@", "+a line"];
    const pathOf = target => diffLines(header(target).join("\n"))[0].path;
    expect(pathOf('"b/quo\\"te.md"')).toBe('quo"te.md');
    expect(pathOf('"b/back\\\\slash.md"')).toBe("back\\slash.md");
    expect(pathOf('"b/tab\\tname.md"')).toBe("tab\tname.md");
    expect(pathOf('"b/caf\\303\\251.md"')).toBe("café.md");
    expect(pathOf("b/sp ace.md\t")).toBe("sp ace.md");
    expect(pathOf("b/plain.md")).toBe("plain.md");
  });

  /*
   * A phrase wraps but never crosses a blank line, and neither does a folded
   * trailer, so each added line is read in its whole paragraph of the final
   * file, however far above or below the added line the credit starts or
   * ends. Added lines in one paragraph make one block; a blank line parts two.
   */
  it("reads each added line in its paragraph of the final file, once per paragraph and once per file", () => {
    const text = lines("intro", "", "one", "two", "three", "", "four", "");
    const reads = [];
    const git = args => {
      reads.push(args.at(-1));
      return { ok: true, out: text };
    };
    const entry = (line, added = true) => ({ path: "a.md", line, text: text.split("\n")[line - 1], added });
    expect(paragraphBlocks([entry(3), entry(5), entry(7), entry(6)], "HEAD", git)).toEqual({
      blocks: [
        { path: "a.md", start: 3, texts: ["one", "two", "three"], added: [true, false, true] },
        { path: "a.md", start: 7, texts: ["four"], added: [true] },
      ],
    });
    expect(reads).toEqual(["HEAD:a.md"]);
  });

  /*
   * A credit an added line takes part in may start in the file above the
   * change, so a file that cannot be read leaves the range unread rather than
   * judged from the added lines alone.
   */
  it("reports a final file it could not read, rather than judging its added lines alone", () => {
    const unreadable = () => ({ ok: false, out: "" });
    expect(paragraphBlocks([{ path: "big.md", line: 7, text: "more", added: true }], "HEAD", unreadable)).toEqual({ problem: expect.stringContaining("could not read big.md at HEAD") });
    // A file with no added line, or only a blank one, needs no read.
    expect(paragraphBlocks([{ path: "big.md", line: 7, text: "  ", added: true }, { path: "big.md", line: 8, text: "kept", added: false }], "HEAD", unreadable)).toEqual({ blocks: [] });
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

  /** A pull request of one commit that changes `file` from `before` to `after`. */
  function change(before, after, { file = "notes.md" } = {}) {
    const base = commit("chore: the base", { file, text: before });
    run("checkout", "-q", "-b", "topic");
    const head = commit("docs: change it", { file, text: after });
    return eventFor("pull_request", { pull_request: { title: "docs: change it", body: "", head: { ref: "docs/change", sha: head }, base: { sha: base } } });
  }

  it("refuses a self-description an added line completes, though its first line was already there", () => {
    expect(decide(change(lines("This file is", ""), lines("This file is", spell("A", "I-generated."), "")))).toBe(1);
    expect(printed()).toMatch(/file=notes\.md,line=2,title=AI credit::notes\.md:2 calls it AI-made/);
  });

  // The diff shows no context; the paragraph holds the rest of a phrase however many lines it wraps over.
  it("refuses a phrase an added line completes after several wrapped lines already there", () => {
    const before = lines(spell("Mis", "tral"), "Large wrote", "");
    expect(decide(change(before, lines(spell("Mis", "tral"), "Large wrote", "this file", "")))).toBe(1);
    expect(printed()).toMatch(/file=notes\.md,line=3,title=AI credit::notes\.md:3 names it as the change's maker/);
  });

  it("refuses an address added to a trailer folded behind a comment prefix with no space after it", () => {
    const before = lines(spell("//Co-authored", "-by:"), "// Alice", "");
    expect(decide(change(before, lines(spell("//Co-authored", "-by:"), "// Alice", spell("// <noreply@", "open", "ai.com>"), "")))).toBe(1);
    expect(printed()).toMatch(/file=notes\.md,line=3,title=AI credit::notes\.md:3 names it in a Co-authored-by trailer/);
  });

  it("refuses another tool an added continuation names, behind a credit that was already there", () => {
    const credit = trailer("Co-authored", CODE_TOOL);
    expect(decide(change(lines(credit, ""), lines(credit, spell("  and Git", "Hub Co", "pilot"), "")))).toBe(1);
    expect(printed()).toMatch(/file=notes\.md,line=2,title=AI credit::notes\.md:2 names it in a Co-authored-by trailer/);
  });

  // Git quotes this name in its diff; read as printed, the final file the trailer starts in could not be read.
  it.runIf(process.platform !== "win32")("reads a file whose path git quotes as the path it is, to find where a trailer starts", () => {
    const start = lines(trailer("Co-authored", "Build Team"), "  and friends");
    const address = spell("  <198982749+", "Co", "pilot@users.noreply.github.com>");
    expect(decide(change(lines(start, ""), lines(start, address, ""), { file: 'quo"te.md' }))).toBe(1);
    expect(printed()).toMatch(/file=quo"te\.md,line=3,title=AI credit::quo"te\.md:3 names it in a Co-authored-by trailer/);
  });

  // Git ends a path that holds a space with a tab in its diff; kept, it would be part of the name.
  it("names a file whose path holds a space as the path it is", () => {
    expect(decide(change("a line\n", lines("a line", spell(MADE, " with ", CODE_TOOL), ""), { file: "sp ace.md" }))).toBe(1);
    expect(printed()).toMatch(/file=sp ace\.md,line=2,title=AI credit::sp ace\.md:2 states that it made the change/);
  });

  // A line break decoded from a quoted path would end the annotation and start a command of its own.
  it.runIf(process.platform !== "win32")("keeps a path with a line break inside its annotation", () => {
    expect(decide(change("a line\n", lines("a line", spell(MADE, " with ", CODE_TOOL), ""), { file: "line\n::notice title=Injected::oops.md" }))).toBe(1);
    const out = printed();
    expect(out.split("\n").filter(entry => entry.startsWith("::notice"))).toEqual([]);
    expect(out).toContain("file=line%0A%3A%3Anotice title=Injected%3A%3Aoops.md,line=2,");
  });

  it("does not refuse a harmless continuation added to a credit that was already there", () => {
    const credit = trailer("Co-authored", CODE_TOOL);
    const base = commit("chore: the base", { text: lines(credit, "") });
    run("checkout", "-q", "-b", "topic");
    const head = commit("docs: add a note", { text: lines(credit, "  with a note", "") });
    expect(decide(eventFor("pull_request", { pull_request: { title: "docs: add a note", body: "", head: { ref: "docs/note", sha: head }, base: { sha: base } } }))).toBe(0);
  });

  // A vendor's name alone waits for the whole value, which may make a person of it; a note that does not leaves the credit on the vendor's line.
  it("keeps a vendor's credit on its own line when an added note makes no person of it", () => {
    const vendor = trailer("Co-authored", spell("Anthro", "pic"));
    expect(decide(change(lines(vendor, ""), lines(vendor, "  with a note", "")))).toBe(0);
  });

  it("refuses a tool an added line names under a vendor's name that was already there", () => {
    const vendor = trailer("Co-authored", spell("Anthro", "pic"));
    expect(decide(change(lines(vendor, ""), lines(vendor, `  ${MODEL} <${VENDOR_ADDRESS}>`, "")))).toBe(1);
    expect(printed()).toMatch(/file=notes\.md,line=2,title=AI credit::notes\.md:2 names it in a Co-authored-by trailer/);
  });

  // The credit belongs to the tool's line, which was there, not to the note added below it that completes the value.
  it("does not refuse a note added below a vendor, a note and a tool that were already there", () => {
    const before = lines(spell("* Co-authored", "-by: Anthro", "pic"), "  (context)", `  ${CODE_TOOL}`);
    expect(decide(change(lines(before, ""), lines(before, "  (more context)", "")))).toBe(0);
  });

  // The first credit belongs to the tool's line, and the lines after that line are read for another tool of their own.
  it("refuses another tool added after a vendor, a note and a tool that were already there", () => {
    const before = lines(trailer("Co-authored", spell("Anthro", "pic")), "  (context)", `  ${CODE_TOOL}`);
    expect(decide(change(lines(before, ""), lines(before, spell("  and ", CHAT_TOOL), "")))).toBe(1);
    expect(printed()).toMatch(/file=notes\.md,line=4,title=AI credit::notes\.md:4 names it in a Co-authored-by trailer/);
  });

  it("refuses a tool added after a note under a vendor's name that was already there", () => {
    const vendor = trailer("Co-authored", spell("Anthro", "pic"));
    expect(decide(change(lines(vendor, ""), lines(vendor, "  (a note)", spell("  and ", CODE_TOOL), "")))).toBe(1);
    expect(printed()).toMatch(/file=notes\.md,line=3,title=AI credit::notes\.md:3 names it in a Co-authored-by trailer/);
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

  /** The diff `git commit --verbose` puts below its comment lines, as git 2.53 writes it, with one changed line. */
  const verboseDiff = change => ["diff --git a/notes.md b/notes.md", "index 3367afd..df082d3 100644", "--- a/notes.md", "+++ b/notes.md", "@@ -1 +1,2 @@", " old", change];

  // A message given with `-m` or `-F` keeps its comment lines, and everything
  // below a scissors line, so all of it is read as the message. In the editor
  // git opens, its scissors line is followed by its own comment lines and then
  // the diff, and it drops what is below; there that part is read as the diff
  // the editor shows: its added lines count, and the lines it removes or keeps
  // do not.
  it("reads comment lines, and below the scissors all a message keeps, but never what an editor's diff removes", () => {
    const credit = trailer("Co-authored", `${MODEL} <${VENDOR_ADDRESS}>`);
    const scissors = "# ------------------------ >8 ------------------------";
    const editor = [scissors, "# Do not modify or remove the line above.", "# Everything below it will be ignored."];
    expect(hook(lines("fix: a change", spell("# ", credit)))).toBe(1);
    expect(hook(lines("fix: a change", scissors, credit))).toBe(1);
    expect(hook(lines("fix: a change", scissors, spell(" ", credit)))).toBe(1);
    expect(hook(lines("fix: a change", ...editor, ...verboseDiff(spell("+", credit))))).toBe(1);
    expect(hook(lines("fix: a change", ...editor, ...verboseDiff(spell("-", credit))))).toBe(0);
    expect(hook(lines("fix: a change", ...editor, ...verboseDiff(spell(" ", credit))))).toBe(0);
    // Git's own buffer with no diff below its comment lines holds nothing more to read.
    expect(hook(lines("fix: a change", ...editor, ""))).toBe(0);
  });

  it("knows the editor's diff by git's own lines, in any comment prefix or language, and reads a message's own text below the scissors as its message", () => {
    const credit = trailer("Co-authored", `${MODEL} <${VENDOR_ADDRESS}>`);
    for (const prefix of [";", "//"]) {
      const editor = [`${prefix} ------------------------ >8 ------------------------`, `${prefix} Ne modifiez pas et ne supprimez pas la ligne ci-dessus.`];
      expect(hook(lines("fix: a change", ...editor, ...verboseDiff(spell(" ", credit)))), prefix).toBe(0);
      expect(hook(lines("fix: a change", ...editor, ...verboseDiff(spell("+", credit)))), prefix).toBe(1);
    }
    expect(hook(lines("fix: a change", "# ------------------------ >8 ------------------------", spell("Entirely A", "I-generated.")))).toBe(1);
  });

  /*
   * What makes the editor's buffer is its shape, not its first line: git's
   * comment lines, then its diff or nothing. A `-m` message whose own text
   * below a scissors line opens with a comment line of its own is still a
   * message, and a diff straight below the scissors line is still the diff.
   */
  it("reads a message's own text below a scissors line and a comment as its message, and a diff straight below the line as the diff", () => {
    const scissors = "# ------------------------ >8 ------------------------";
    expect(hook(lines("fix: a change", scissors, "# release notes", spell(" Entirely A", "I-generated.")))).toBe(1);
    const made = said(MADE, "with", CODE_TOOL);
    expect(hook(lines("fix: a change", scissors, ...verboseDiff(`-${made}`)))).toBe(0);
    expect(hook(lines("fix: a change", scissors, ...verboseDiff(`+${made}`)))).toBe(1);
  });

  // Git's diff is known by the header git writes after `diff --git`, not by that line alone.
  it("reads a line of a message's own that begins as git's diff does as its message, and knows git's diff by its headers", () => {
    const scissors = "# ------------------------ >8 ------------------------";
    const made = said(MADE, "with", CODE_TOOL);
    expect(hook(lines("fix: a change", scissors, "diff --git behavior notes", ` ${made}`))).toBe(1);
    // A renamed file's diff opens with its similarity, and a line it removes credits nothing.
    const renamed = ["diff --git a/old.md b/new.md", "similarity index 50%", "rename from old.md", "rename to new.md", "index 3367afd..df082d3 100644", "--- a/old.md", "+++ b/new.md", "@@ -1,2 +1,2 @@", " kept", `-${made}`, "+clean"];
    expect(hook(lines("fix: a change", scissors, ...renamed))).toBe(0);
  });

  it("accepts a clean message, and refuses when it cannot read who is committing", () => {
    expect(hook("fix: change how Claude Code loads skills")).toBe(0);
    expect(hook("fix: a change", { readable: false })).toBe(1);
    expect(complaint()).toMatch(/the commit's author could not be read/);
  });
});
