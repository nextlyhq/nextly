#!/usr/bin/env node

/**
 * Whether a commit, a pull request or a change credits an AI tool or its
 * vendor: as a co-author, reviewer or assistant in a trailer, as the maker of
 * the change, with thanks, or as a commit's author or committer. A mention
 * credits nothing and passes: a change to how an AI tool loads skills names
 * the tool without crediting it.
 *
 * A name alone never decides. Several tools are named for ordinary words or
 * given names, and a person may share one, so a name counts only inside a form
 * that credits it: a trailer, a statement that something was made with or by
 * it, a thank-you, a branch named for it, or an identity that is the tool's
 * own, such as its address or its GitHub account. A tool's API, SDK or key is
 * a component a product uses, not a maker of the change, so a name followed by
 * one of those counts as a mention.
 *
 * A phrase is read across a single line break, since Markdown renders one as
 * a space, but never across a blank line, which starts a new paragraph.
 *
 * As the commit-msg hook (`--commit-msg <file>`) it reads the message and the
 * commit's author and committer, and refuses the commit before it exists. In
 * CI it reads a pull request, or the commits the merge queue would land: the
 * title, description and branch, each commit's message, author and committer,
 * the paths of added and renamed files, and every added line. No file is
 * exempt, this one's tests included, which assemble their examples at run
 * time.
 *
 * Usage: node scripts/ai-credit.mjs [--commit-msg <file>]
 */
import { readFileSync } from "node:fs";

import { comparedRange, diffRange } from "./change-scope.mjs";
import { isCliEntry } from "./cli-entry.mjs";
import { commandText, eventPayload, readGit } from "./workflow-context.mjs";

/** A run of whitespace holding at most one line break: words a phrase joins may wrap, but not across a paragraph. */
const GAP = "(?:[^\\S\\n]*\\n[^\\S\\n]*|[^\\S\\n]+)";
const gapped = pattern => pattern.replaceAll(" ", GAP);

/** Names that stand for an AI tool, a model or its vendor, in any case. */
const TOOLS = [
  "claude code", "claude (?:opus|sonnet|haiku|instant)(?:\\s?[\\d.]+)?", "anthropic", "openai", "chat\\s?gpt", "gpt-?\\d[\\w.-]*",
  "codex", "copilot", "gemini (?:code assist|cli|pro|flash|ultra|\\d[\\w.]*)", "cursor agent", "devin ai", "aider",
  "codeium", "tabnine", "codewhisperer", "amazon q(?: developer)?", "deepseek", "qwen[\\w.-]*", "zhipu", "z\\.ai",
  "glm-?\\d[\\w.-]*", "mixtral", "codestral", "llama\\s?\\d[\\w.]*", "openhands", "roo code", "kilo code", "jetbrains ai",
  "sourcegraph cody", "replit agent", "bolt\\.new",
].map(gapped);

/** Tool names that are also ordinary words or given names: in prose they count only capitalised. */
const PROPER = ["Claude", "Cursor", "Devin", "Jules", "Cody", "Gemini", "Grok", "Mistral", "Windsurf", "Perplexity", "Junie", "Cline", "Lovable", "Kiro", "Amp"];

/** The vendors whose name may stand before a tool's, as they name their own tools. */
const VENDORS = ["Google", "GitHub", "Microsoft", "OpenAI", "Anthropic", "Amazon", "AWS", "Meta", "Mistral", "xAI", "Sourcegraph", "JetBrains", "Replit", "Cognition"];

/** AI in general, naming no tool. */
const GENERIC = ["(?:AI|LLM)s?(?: (?:tool|assistant|agent|model)s?)?", "(?:large )?language models?", "coding (?:agent|assistant)s?"].map(gapped);

/** GitHub App accounts AI tools commit and review as. */
const BOT_ACCOUNTS = [
  "copilot-swe-agent", "claude", "claude-code", "chatgpt-codex-connector", "openai-codex", "devin-ai-integration", "cursor",
  "google-labs-jules", "gemini-code-assist", "coderabbitai", "greptile-apps", "sweep-ai", "openhands-agent", "amazon-q-developer",
];

/** Tools that name the branches they open after themselves, as `<tool>/<topic>`. */
const BRANCH_OWNERS = ["claude", "copilot", "codex", "cursor", "devin", "jules", "gemini", "openhands", "aider", "windsurf", "sweep"];

const VENDOR = `(?:(?:${VENDORS.join("|")})(?:'s)?${GAP})?`;
/** A name ends at a word's end, and is only a component when an API, SDK, key or the like follows it. */
const ENDS = "(?![\\w-])(?!(?:'s)?\\s+(?:api|sdk|client|library|package|embeddings?|endpoint|integration|provider|plugin|key|account|platform|console)s?\\b)";
const TOOL_AT = new RegExp(`^${VENDOR}(?:${TOOLS.join("|")})${ENDS}`, "i");
const PROPER_AT = new RegExp(`^${VENDOR}(?:${PROPER.join("|")})${ENDS}`);
const PROPER_AT_ANY_CASE = new RegExp(PROPER_AT.source, "i");
const GENERIC_AT = new RegExp(`^(?:${GENERIC.join("|")})${ENDS}`, "i");
const BOT = `(?:${BOT_ACCOUNTS.join("|")})\\[bot\\]`;
/** A name that is AI in general, or one of a tool's GitHub App accounts. No person is named either. */
const AI_NAME = new RegExp(`^(?:${GENERIC.join("|")}|${BOT})$`, "i");
/** An unambiguous tool's name in full, as its vendors name it. */
const TOOL_NAME = new RegExp(`^${VENDOR}(?:${TOOLS.join("|")})$`, "i");
/** A name that begins with an unambiguous tool's, such as a product and its edition; read only where no address says who it is. */
const TOOL_NAMED = new RegExp(`^${VENDOR}(?:${TOOLS.join("|")})(?![\\w-])`, "i");
const BARE_NAME = new RegExp(`^(?:${PROPER.join("|")})$`, "i");
const AI_EMAIL = new RegExp(`^(?:[^@\\s]+@(?:anthropic|openai)\\.com|cursoragent@cursor\\.com|\\d+\\+(?:copilot|${BOT})@users\\.noreply\\.github\\.com)$`, "i");
const BRANCH_OWNER = new RegExp(`^(?:${BRANCH_OWNERS.join("|")})/`, "i");

const MADE = "(?:generated|created|written|authored|co-?\\s?authored|co-?\\s?written|produced|drafted|made|built|coded|developed|implemented|refactored|assisted|pair-?\\s?programmed|vibe-?\\s?coded)";
const HOW = gapped("(?:with|by|using|via|through|in collaboration with|with (?:the )?(?:help|assistance) (?:of|from))");
const DEGREE = `(?:(?:partly|partially|mostly|largely|entirely|fully|mainly)${GAP})?`;
const AFTER = "[^\\S\\n]*(?:[,:;!.\\u2013\\u2014-][^\\S\\n]*)*";

/**
 * The phrases that credit whatever is named right after them. Each stops at
 * the end of its line, so the one line break a name may follow is taken once,
 * by what stands between the phrase and the name. Thanks counts as
 * an interjection, where a line, sentence or clause opens with it, never as
 * the verb in a sentence about thanking; credit counts only as credit given to
 * someone.
 */
const LEADS = [
  { form: "states that it made the change", lead: new RegExp(`\\b${MADE}${GAP}${DEGREE}${HOW}[^\\S\\n]*`, "gi") },
  { form: "credits its help", lead: new RegExp(`\\b${gapped("with (?:the )?(?:help|assistance) (?:of|from)")}[^\\S\\n]*`, "gi") },
  { form: "thanks it", lead: new RegExp(`(?:^[^\\S\\n]*|[.!?:;,(\\u2013\\u2014-][^\\S\\n]*|\\b(?:many|big|huge|special|and)${GAP})(?:thanks|${gapped("thank you")}|thx)\\b(?:${GAP}to\\b)?${AFTER}`, "gim") },
  { form: "thanks it", lead: new RegExp(`\\b(?:kudos|props|shout-?outs?|h\\/t|${gapped("hat tip")})\\b(?:${GAP}to\\b)?${AFTER}`, "gi") },
  { form: "gives it credit", lead: new RegExp(`\\bcredits?(?:${GAP}(?:go(?:es)?${GAP})?to\\b|[^\\S\\n]*:)[^\\S\\n]*`, "gi") },
];

const MADE_ADJECTIVE = "(?:generated|assisted|authored|written|created|made)";
const NAMED_ADJECTIVES = [new RegExp(`\\b(?:${TOOLS.join("|")})-${MADE_ADJECTIVE}\\b`, "gi"), new RegExp(`\\b(?:${PROPER.join("|")})-${MADE_ADJECTIVE}\\b`, "g")];
const GENERIC_ADJECTIVE = new RegExp(`\\b(?:AI|LLM)-${MADE_ADJECTIVE}\\b`, "gi");
/** A trailer, on a line of its own or in a comment: `//`, `#`, `*`, `--`, `;` or an HTML comment. */
const TRAILER = /^\s*(?:(?:\/\/|#|\*|--|;|<!--)\s*)?([A-Za-z][A-Za-z0-9-]*-(?:by|with))\s*:\s*(.+?)\s*(?:-->)?\s*$/i;
/** What may stand between a crediting phrase and the name it credits: quotes, emphasis, a bracket, and one line break at most. */
const LEADING_MARKS = /^(?:[^\S\n]|["'`*_([<@“‘])*(?:\n(?:[^\S\n]|["'`*_([<@“‘])*)?/;
const ARTICLE = new RegExp(`^(?:the|an?)${GAP}`, "i");
const MAX_OUTPUT = 256 * 1024 * 1024;

/**
 * What each place is read for. A message or a description is about the change
 * itself, so calling it AI-made in general credits AI there; in a file the
 * same words usually describe what a product does, so there only a named tool
 * counts. Branch names and paths are read with their separators as spaces, and
 * a proper name counts in any case there, since both are lowercase by
 * convention.
 */
const PLACES = {
  message: { trailers: true, generic: true, anyCase: false, words: text => text },
  line: { trailers: true, generic: false, anyCase: false, words: text => text },
  name: { trailers: false, generic: false, anyCase: true, words: text => text.replace(/[/_.-]+/g, " ") },
};

/**
 * Whether `name <email>` is an AI tool's or its vendor's identity: its own
 * address, one of its GitHub App accounts, an unambiguous tool's name in full,
 * AI in general, or a name a tool marks as its own. A person's name is not,
 * even one that begins with a vendor's, as a researcher's may.
 */
export function isAiIdentity(identity) {
  const { name, email } = identityParts(identity);
  return AI_EMAIL.test(email) || AI_NAME.test(name) || TOOL_NAME.test(name) || /\(aider\)/i.test(name);
}

function identityParts(identity) {
  const text = String(identity ?? "").trim();
  const addressed = /^(.*?)\s*<([^>]*)>/.exec(text);
  return addressed ? { name: addressed[1].trim(), email: addressed[2].trim() } : { name: text, email: "" };
}

/** Every credit a piece of text carries, each with the line it is on. */
export function creditsIn(text, place = "message") {
  const rules = PLACES[place];
  const lines = String(text ?? "")
    .split(/\r?\n/)
    .map(raw => plain(rules.words(raw)));
  const joined = lines.join("\n");
  const trailers = lines.flatMap((line, index) => trailerCredits(line, rules).map(found => ({ ...found, line: index + 1 })));
  const phrases = [...leadCredits(joined, rules), ...adjectiveCredits(joined, rules)].map(({ at, ...found }) => ({ ...found, line: lineAt(joined, at) }));
  return [...trailers, ...phrases];
}

/** Markdown links read as their text, and emphasis marks as nothing, so a formatted credit reads as a plain one. */
function plain(text) {
  return text.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/[*_`]{1,3}/g, "");
}

/** The 1-based line an offset into a text falls on. */
function lineAt(text, offset) {
  return text.slice(0, offset).split("\n").length;
}

function trailerCredits(text, rules) {
  const trailer = rules.trailers ? TRAILER.exec(text) : null;
  return trailer && creditedByTrailer(trailer[2]) ? [{ form: `names it in a ${trailer[1]} trailer`, excerpt: excerpt(text) }] : [];
}

/**
 * A trailer with an address credits an AI when the identity is an AI's. One
 * without an address names whoever it credits outright, before any note, so
 * there a tool's plain name, or one that begins with a tool's, is enough.
 */
function creditedByTrailer(value) {
  if (/<[^>]*>/.test(value)) return isAiIdentity(value);
  const name = value.split(/\s+(?:[(—]|-\s)|:/)[0].trim();
  return isAiIdentity(name) || BARE_NAME.test(name) || TOOL_NAMED.test(name);
}

/** Each crediting phrase followed by a name, reported on the line of the name it credits. */
function leadCredits(text, rules) {
  return LEADS.flatMap(({ form, lead }) =>
    [...text.matchAll(lead)].flatMap(match => {
      const after = match.index + match[0].length;
      const name = namedAt(text.slice(after), rules);
      return name === null ? [] : [{ form, excerpt: excerpt(text, match.index), at: after + name }];
    })
  );
}

/** Where, within the text after a crediting phrase, the AI tool or AI in general it names begins, or null when it names none. */
function namedAt(rest, rules) {
  const marks = LEADING_MARKS.exec(rest)[0].length;
  return names(rest.slice(marks).replace(ARTICLE, ""), rules) ? marks : null;
}

/** Whether a text begins with an AI tool's name, or AI in general. */
function names(text, rules) {
  return TOOL_AT.test(text) || GENERIC_AT.test(text) || (rules.anyCase ? PROPER_AT_ANY_CASE : PROPER_AT).test(text);
}

function adjectiveCredits(text, rules) {
  const patterns = rules.generic ? [...NAMED_ADJECTIVES, GENERIC_ADJECTIVE] : NAMED_ADJECTIVES;
  const cased = rules.anyCase ? patterns.map(pattern => new RegExp(pattern.source, "gi")) : patterns;
  return cased.flatMap(pattern => [...text.matchAll(pattern)].map(match => ({ form: "calls it AI-made", excerpt: excerpt(text, match.index), at: match.index })));
}

function excerpt(text, from = 0) {
  return text.slice(from, from + 100).replace(/\s+/g, " ").trim();
}

/** The credits a branch name carries: a tool's own `<tool>/` prefix, or a credit spelled out in the name. */
export function branchCredits(branch) {
  const name = String(branch ?? "");
  const owned = BRANCH_OWNER.test(name) ? [{ form: "is named for the tool that opened it", excerpt: name, line: 1 }] : [];
  return [...owned, ...creditsIn(name, "name")];
}

/** The lines a unified diff adds, each with its file and its line number there. */
export function linesAdded(diff) {
  const state = { path: null, next: 0, inHunk: 0 };
  const added = [];
  for (const line of diff.split("\n")) readDiffLine(line, state, added);
  return added;
}

/**
 * A hunk header says how many lines follow it, so inside a hunk every line is
 * content, even one that happens to begin like a header.
 */
function readDiffLine(line, state, added) {
  if (state.inHunk > 0) return readHunkLine(line, state, added);
  if (line.startsWith("+++ ")) state.path = targetPath(line);
  else if (line.startsWith("@@")) Object.assign(state, hunkHeader(line));
}

function readHunkLine(line, state, added) {
  if (line.startsWith("\\")) return;
  state.inHunk -= 1;
  if (line.startsWith("+")) addLine(line, state, added);
}

function addLine(line, state, added) {
  if (state.path) added.push({ path: state.path, line: state.next, text: line.slice(1) });
  state.next += 1;
}

function targetPath(line) {
  const target = line.slice(4).replace(/^"|"$/g, "");
  return target === "/dev/null" ? null : target.replace(/^b\//, "");
}

const HUNK = /^@@ -\d+(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

function hunkHeader(line) {
  const match = HUNK.exec(line);
  if (!match) throw new Error(`cannot read the hunk header ${JSON.stringify(line)}`);
  const [, removed = "1", start, addedCount = "1"] = match;
  return { next: Number(start), inHunk: Number(removed) + Number(addedCount) };
}

/** Consecutive added lines of one file as one block, so a phrase wrapped across them reads whole. */
export function addedBlocks(lines) {
  const blocks = [];
  for (const added of lines) {
    if (continues(blocks.at(-1), added)) blocks.at(-1).texts.push(added.text);
    else blocks.push({ path: added.path, start: added.line, texts: [added.text] });
  }
  return blocks;
}

function continues(block, added) {
  return Boolean(block) && block.path === added.path && block.start + block.texts.length === added.line;
}

/** The paths `git diff --name-status -z` reports added, renamed or copied: a rename or copy carries two paths, anything else one. */
export function addedOrRenamed(fields) {
  const entries = [];
  for (let at = 0; at < fields.length - 1; at += entryWidth(fields[at])) entries.push({ status: fields[at], path: fields[at + entryWidth(fields[at]) - 1] });
  return entries.filter(entry => /^[ARC]/.test(entry.status)).map(entry => entry.path);
}

function entryWidth(status) {
  return /^[RC]/.test(status) ? 3 : 2;
}

/** Everything a range carries: its commits, its added or renamed paths, and its added lines, or why they cannot be read. */
function rangeEvidence({ base, head }, git) {
  const commits = commitsIn({ base, head }, git);
  const names = git(["-c", "core.quotePath=false", "diff", "--name-status", "-z", "-M", base, head], { maxBuffer: MAX_OUTPUT });
  const diff = git(["-c", "core.quotePath=false", "diff", "--unified=0", "--no-color", "--no-ext-diff", "-M", base, head], { maxBuffer: MAX_OUTPUT });
  if (!commits || !names.ok || !diff.ok) return { problem: `could not read the commits and changes in ${base}..${head}` };
  return { commits, paths: addedOrRenamed(names.out.split("\0")), lines: linesAdded(diff.out) };
}

/** The commits in a range, each read from its own object, or undefined when any cannot be read. */
function commitsIn({ base, head }, git) {
  const listed = git(["rev-list", `${base}..${head}`], { maxBuffer: MAX_OUTPUT });
  if (!listed.ok) return undefined;
  const commits = listed.out.split("\n").filter(Boolean).map(sha => commitAt(sha, git));
  return commits.every(Boolean) ? commits : undefined;
}

/**
 * One commit, read from its object: its headers up to the first blank line,
 * then its message. Nothing a message holds can split it into another commit,
 * as a separator character in a formatted log could.
 */
function commitAt(sha, git) {
  const read = git(["cat-file", "commit", sha], { maxBuffer: MAX_OUTPUT });
  if (!read.ok) return null;
  const end = read.out.indexOf("\n\n");
  const headers = end === -1 ? read.out : read.out.slice(0, end);
  return { sha, author: identityHeader(headers, "author"), committer: identityHeader(headers, "committer"), message: end === -1 ? "" : read.out.slice(end + 2) };
}

function identityHeader(headers, role) {
  const line = headers.split("\n").find(entry => entry.startsWith(`${role} `)) ?? "";
  return withoutDate(line.slice(role.length + 1));
}

/** The findings for everything a range carries, each naming where it is. */
function rangeFindings({ commits, paths, lines }) {
  return [
    ...commits.flatMap(commit => commitFindings(commit)),
    ...paths.flatMap(path => creditsIn(path, "name").map(found => ({ ...found, where: `the path ${path}` }))),
    ...addedBlocks(lines).flatMap(block => blockFindings(block)),
  ];
}

function blockFindings({ path, start, texts }) {
  return creditsIn(texts.join("\n"), "line").map(found => {
    const line = start + found.line - 1;
    return { ...found, where: `${path}:${line}`, file: path, line };
  });
}

function commitFindings({ sha, author, committer, message }) {
  const commit = `commit ${sha.slice(0, 9)}`;
  return [
    ...creditsIn(message, "message").map(found => ({ ...found, where: `the message of ${commit}, line ${found.line},` })),
    ...identityFindings([`the author of ${commit},`, author], [`the committer of ${commit},`, committer]),
  ];
}

function identityFindings(...roles) {
  return roles.filter(([, identity]) => isAiIdentity(identity)).map(([where, identity]) => ({ where, form: "is an AI tool's identity", excerpt: identity }));
}

/** A pull request's own published text: its title, description and branch. */
function pullRequestFindings(payload) {
  const pr = payload.pull_request ?? {};
  const branch = pr.head?.ref ?? "";
  return [
    ...creditsIn(pr.title, "message").map(found => ({ ...found, where: "the title" })),
    ...creditsIn(pr.body, "message").map(found => ({ ...found, where: `the description, line ${found.line},` })),
    ...branchCredits(branch).map(found => ({ ...found, where: `the branch ${branch}` })),
  ];
}

const EVENTS = new Set(["pull_request", "merge_group"]);

/** Decides for the CI step: a pull request, or what the merge queue would land. */
function checkChange(env, git) {
  const event = env.GITHUB_EVENT_NAME;
  if (!EVENTS.has(event)) return refuse(`no range to read for a ${event || "missing"} event; give it one here before triggering this check on it`);
  const read = readRange(event, eventPayload(env), git);
  return read.problem ? refuse(read.problem) : judge(read, event);
}

/** A range's evidence, or why it cannot be read. A range with no commits is refused: reading it would examine nothing. */
function readRange(event, payload, git) {
  const compared = comparedRange(diffRange({ event, payload }), git);
  if (compared.reason) return { problem: `cannot read the range: ${compared.reason}` };
  const evidence = rangeEvidence(compared, git);
  if (evidence.problem) return evidence;
  return evidence.commits.length > 0 ? { ...evidence, payload } : { problem: `the range ${compared.base}..${compared.head} holds no commits, so reading it would examine nothing` };
}

function judge(read, event) {
  const findings = [...(event === "pull_request" ? pullRequestFindings(read.payload) : []), ...rangeFindings(read)];
  return findings.length > 0 ? reportFindings(findings) : reportClean(read, event);
}

function reportFindings(findings) {
  for (const found of findings) console.log(annotation(found));
  console.error(`${findings.length} AI credit(s) found. Reword each so it names no AI tool as a maker, helper, co-author, reviewer or author. A mention that credits nothing is fine.`);
  return 1;
}

function annotation({ file, line, where, form, excerpt: text }) {
  const at = file ? ` file=${file},line=${line},` : " ";
  return `::error${at}title=AI credit::${commandText(`${where} ${form}: ${text}`)}`;
}

function reportClean({ commits, paths, lines }, event) {
  const published = event === "pull_request" ? "the title, description and branch, " : "";
  console.log(`ai-credit: no AI credit in ${published}${commits.length} commit(s), ${paths.length} added or renamed path(s) and ${lines.length} added line(s).`);
  return 0;
}

function refuse(problem) {
  console.log(`::error title=AI credit::${commandText(problem)}`);
  return 1;
}

/** Decides for the commit-msg hook: the message about to be committed, and who is committing it. */
function checkCommit(file, git) {
  if (!file) return refuseCommit(["no message file was given"]);
  const message = committedText(readFileSync(file, "utf8"));
  const identities = ["author", "committer"].map(role => [role, git(["var", `GIT_${role.toUpperCase()}_IDENT`])]);
  const reasons = [
    ...identities.filter(([, read]) => !read.ok).map(([role]) => `the commit's ${role} could not be read`),
    ...creditsIn(message, "message").map(found => `the message, line ${found.line}, ${found.form}: ${found.excerpt}`),
    ...identities.filter(([, read]) => read.ok && isAiIdentity(withoutDate(read.out))).map(([role, read]) => `the ${role}, ${withoutDate(read.out)}, is an AI tool's identity`),
  ];
  return reasons.length > 0 ? refuseCommit(reasons) : 0;
}

function withoutDate(ident) {
  return ident.trim().replace(/\s+\d+\s+[-+]\d{4}$/, "");
}

/**
 * What git may keep of a message: everything above a scissors line. Comment
 * lines are read too, since a message given with `-m` or `-F` keeps them.
 */
function committedText(message) {
  return message.split(/^\S -{8,} >8 -{8,}$/m)[0];
}

function refuseCommit(reasons) {
  console.error(["This commit credits an AI tool, which this repository refuses:", ...reasons.map(reason => `  - ${reason}`)].join("\n"));
  console.error("Reword it so it names no AI tool as a maker, helper, co-author, reviewer or author, and commit again. A mention that credits nothing is fine.");
  return 1;
}

/** Decides for whichever caller invoked this file, and returns the exit code. */
export function main(argv = process.argv.slice(2), env = process.env, git = readGit) {
  const at = argv.indexOf("--commit-msg");
  return at === -1 ? checkChange(env, git) : checkCommit(argv[at + 1], git);
}

if (isCliEntry(import.meta.url)) process.exit(main());
