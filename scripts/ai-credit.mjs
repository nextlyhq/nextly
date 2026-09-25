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

/** Names that stand for an AI tool, a model or its vendor, in any case. */
const TOOLS = [
  "claude code", "claude (?:opus|sonnet|haiku|instant)(?: ?[\\d.]+)?", "anthropic", "openai", "chat ?gpt", "gpt-?\\d[\\w.-]*",
  "codex", "(?:github )?copilot", "gemini (?:code assist|cli|pro|flash|ultra|\\d[\\w.]*)", "cursor agent", "devin ai", "aider",
  "codeium", "tabnine", "codewhisperer", "amazon q(?: developer)?", "deepseek", "qwen[\\w.-]*", "zhipu", "z\\.ai",
  "glm-?\\d[\\w.-]*", "mixtral", "codestral", "llama ?\\d[\\w.]*", "openhands", "roo code", "kilo code", "jetbrains ai",
  "sourcegraph cody", "replit agent", "bolt\\.new",
];

/** Tool names that are also ordinary words or given names: in prose they count only capitalised. */
const PROPER = ["Claude", "Cursor", "Devin", "Jules", "Cody", "Gemini", "Grok", "Mistral", "Windsurf", "Perplexity", "Junie", "Cline", "Lovable", "Kiro", "Amp"];

/** AI in general, naming no tool. */
const GENERIC = ["(?:AI|LLM)s?(?: (?:tool|assistant|agent|model)s?)?", "(?:large )?language models?", "coding (?:agent|assistant)s?"];

/** GitHub App accounts AI tools commit and review as. */
const BOT_ACCOUNTS = [
  "copilot-swe-agent", "claude", "claude-code", "chatgpt-codex-connector", "openai-codex", "devin-ai-integration", "cursor",
  "google-labs-jules", "gemini-code-assist", "coderabbitai", "greptile-apps", "sweep-ai", "openhands-agent", "amazon-q-developer",
];

/** Tools that name the branches they open after themselves, as `<tool>/<topic>`. */
const BRANCH_OWNERS = ["claude", "copilot", "codex", "cursor", "devin", "jules", "gemini", "openhands", "aider", "windsurf", "sweep"];

/** A name ends at a word's end, and is only a component when an API, SDK, key or the like follows it. */
const ENDS = "(?![\\w-])(?!(?:'s)?\\s+(?:api|sdk|client|library|package|embeddings?|endpoint|integration|provider|plugin|key|account|platform|console)s?\\b)";
const TOOL_AT = new RegExp(`^(?:${TOOLS.join("|")})${ENDS}`, "i");
const PROPER_AT = new RegExp(`^(?:${PROPER.join("|")})${ENDS}`);
const PROPER_AT_ANY_CASE = new RegExp(PROPER_AT.source, "i");
const GENERIC_AT = new RegExp(`^(?:${GENERIC.join("|")})${ENDS}`, "i");
const BOT = `(?:${BOT_ACCOUNTS.join("|")})\\[bot\\]`;
const AI_NAME = new RegExp(`^(?:${TOOLS.join("|")}|${BOT})$`, "i");
const BARE_NAME = new RegExp(`^(?:${[...PROPER, ...GENERIC].join("|")})$`, "i");
const AI_EMAIL = new RegExp(`^(?:[^@\\s]+@(?:anthropic|openai)\\.com|cursoragent@cursor\\.com|\\d+\\+(?:copilot|${BOT})@users\\.noreply\\.github\\.com)$`, "i");
const BRANCH_OWNER = new RegExp(`^(?:${BRANCH_OWNERS.join("|")})/`, "i");

const MADE = "(?:generated|created|written|authored|co[- ]?authored|co[- ]?written|produced|drafted|made|built|coded|developed|implemented|refactored|assisted|pair[- ]programmed|vibe[- ]coded)";
const HOW = "(?:with|by|using|via|through|in collaboration with|with (?:the )?(?:help|assistance) (?:of|from))";
const DEGREE = "(?:(?:partly|partially|mostly|largely|entirely|fully|mainly)\\s+)?";
const AFTER = "[\\s,:;!.\\u2013\\u2014-]*";

/**
 * The phrases that credit whatever is named right after them. Thanks counts as
 * an interjection, where a sentence or clause opens with it, never as the verb
 * in a sentence about thanking; credit counts only as credit given to someone.
 */
const LEADS = [
  { form: "states that it made the change", lead: new RegExp(`\\b${MADE}\\s+${DEGREE}${HOW}\\s+`, "gi") },
  { form: "credits its help", lead: /\bwith (?:the )?(?:help|assistance) (?:of|from)\s+/gi },
  { form: "thanks it", lead: new RegExp(`(?:^\\s*|[.!?:;,(\\u2013\\u2014-]\\s*|\\b(?:many|big|huge|special|and)\\s+)(?:thanks|thank you|thx)\\b(?:\\s+to\\b)?${AFTER}`, "gi") },
  { form: "thanks it", lead: new RegExp(`\\b(?:kudos|props|shout-?outs?|h\\/t|hat tip)\\b(?:\\s+to\\b)?${AFTER}`, "gi") },
  { form: "gives it credit", lead: /\bcredits?(?:\s+(?:go(?:es)?\s+)?to\b|\s*:)\s*/gi },
];

const MADE_ADJECTIVE = "(?:generated|assisted|authored|written|created|made)";
const NAMED_ADJECTIVES = [new RegExp(`\\b(?:${TOOLS.join("|")})-${MADE_ADJECTIVE}\\b`, "gi"), new RegExp(`\\b(?:${PROPER.join("|")})-${MADE_ADJECTIVE}\\b`, "g")];
const GENERIC_ADJECTIVE = new RegExp(`\\b(?:AI|LLM)-${MADE_ADJECTIVE}\\b`, "gi");
/** A trailer, on a line of its own or in a comment: `//`, `#`, `*`, `--`, `;` or an HTML comment. */
const TRAILER = /^\s*(?:(?:\/\/|#|\*|--|;|<!--)\s*)?([A-Za-z][A-Za-z0-9-]*-(?:by|with))\s*:\s*(.+?)\s*(?:-->)?\s*$/i;
const LEADING_MARKS = /^[\s"'`*_([<@“‘]+/;
const ARTICLE = /^(?:the|an?)\s+/i;
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
 * address, an unambiguous tool name, one of its GitHub App accounts, or a name
 * a tool marks as its own. A given name alone, such as a person's, never is.
 */
export function isAiIdentity(identity) {
  const { name, email } = identityParts(identity);
  return AI_EMAIL.test(email) || AI_NAME.test(name) || /\(aider\)/i.test(name);
}

function identityParts(identity) {
  const text = String(identity ?? "").trim();
  const addressed = /^(.*?)\s*<([^>]*)>/.exec(text);
  return addressed ? { name: addressed[1].trim(), email: addressed[2].trim() } : { name: text, email: "" };
}

/** Every credit a piece of text carries, each with the line it is on. */
export function creditsIn(text, place = "message") {
  const rules = PLACES[place];
  return String(text ?? "")
    .split(/\r?\n/)
    .flatMap((raw, index) => creditsOnLine(plain(rules.words(raw)), rules).map(found => ({ ...found, line: index + 1 })));
}

/** Markdown links read as their text, and emphasis marks as nothing, so a formatted credit reads as a plain one. */
function plain(text) {
  return text.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/[*_`]{1,3}/g, "");
}

function creditsOnLine(text, rules) {
  return [...trailerCredits(text, rules), ...leadCredits(text, rules), ...adjectiveCredits(text, rules)];
}

function trailerCredits(text, rules) {
  const trailer = rules.trailers ? TRAILER.exec(text) : null;
  return trailer && creditedByTrailer(trailer[2]) ? [{ form: `names it in a ${trailer[1]} trailer`, excerpt: excerpt(text) }] : [];
}

/**
 * A trailer with an address credits an AI when the identity is an AI's. One
 * without an address names whoever it credits outright, before any note, so
 * there a tool's plain name, or AI in general, is enough.
 */
function creditedByTrailer(value) {
  if (/<[^>]*>/.test(value)) return isAiIdentity(value);
  const name = value.split(/\s+(?:[(—]|-\s)|:/)[0].trim();
  return isAiIdentity(name) || BARE_NAME.test(name);
}

function leadCredits(text, rules) {
  return LEADS.flatMap(({ form, lead }) =>
    [...text.matchAll(lead)].filter(match => namesAt(text.slice(match.index + match[0].length), rules)).map(match => ({ form, excerpt: excerpt(text, match.index) }))
  );
}

/** Whether the text right after a crediting phrase names an AI tool, or AI in general. */
function namesAt(rest, rules) {
  const text = rest.replace(LEADING_MARKS, "").replace(ARTICLE, "");
  return TOOL_AT.test(text) || GENERIC_AT.test(text) || (rules.anyCase ? PROPER_AT_ANY_CASE : PROPER_AT).test(text);
}

function adjectiveCredits(text, rules) {
  const patterns = rules.generic ? [...NAMED_ADJECTIVES, GENERIC_ADJECTIVE] : NAMED_ADJECTIVES;
  const cased = rules.anyCase ? patterns.map(pattern => new RegExp(pattern.source, "gi")) : patterns;
  return cased.flatMap(pattern => [...text.matchAll(pattern)].map(match => ({ form: "calls it AI-made", excerpt: excerpt(text, match.index) })));
}

function excerpt(text, from = 0) {
  return text.slice(from, from + 100).trim();
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
  const log = git(["log", "--format=%H%x00%an <%ae>%x00%cn <%ce>%x00%B%x1e", `${base}..${head}`], { maxBuffer: MAX_OUTPUT });
  const names = git(["-c", "core.quotePath=false", "diff", "--name-status", "-z", "-M", base, head], { maxBuffer: MAX_OUTPUT });
  const diff = git(["-c", "core.quotePath=false", "diff", "--unified=0", "--no-color", "--no-ext-diff", "-M", base, head], { maxBuffer: MAX_OUTPUT });
  if (![log, names, diff].every(read => read.ok)) return { problem: `could not read the commits and changes in ${base}..${head}` };
  return { commits: commitsFrom(log.out), paths: addedOrRenamed(names.out.split("\0")), lines: linesAdded(diff.out) };
}

function commitsFrom(log) {
  return log
    .split("\x1e")
    .map(entry => entry.replace(/^\n/, ""))
    .filter(Boolean)
    .map(entry => {
      const [sha, author, committer, message] = entry.split("\0");
      return { sha, author, committer, message };
    });
}

/** The findings for everything a range carries, each naming where it is. */
function rangeFindings({ commits, paths, lines }) {
  return [
    ...commits.flatMap(commit => commitFindings(commit)),
    ...paths.flatMap(path => creditsIn(path, "name").map(found => ({ ...found, where: `the path ${path}` }))),
    ...lines.flatMap(added => creditsIn(added.text, "line").map(found => ({ ...found, where: `${added.path}:${added.line}`, file: added.path, line: added.line }))),
  ];
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
  const message = committedText(readFileSync(file, "utf8"), commentChar(git));
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

/** What git keeps of a message: nothing below a scissors line, and no comment lines. */
function committedText(message, comment) {
  const kept = message.split(/^[#;] -{8,} >8 -{8,}$/m)[0];
  return kept
    .split("\n")
    .filter(line => !line.startsWith(comment))
    .join("\n");
}

function commentChar(git) {
  const configured = git(["config", "core.commentChar"]);
  const value = configured.ok ? configured.out.trim() : "";
  return value && value !== "auto" ? value : "#";
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
