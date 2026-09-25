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
const AI_EMAIL = new RegExp(`^(?:noreply@(?:anthropic|openai)\\.com|cursoragent@cursor\\.com|\\d+\\+(?:copilot|${BOT})@users\\.noreply\\.github\\.com)$`, "i");
/** A vendor's own domain: people work there too, so an address there is a tool's only under a tool's name. */
const VENDOR_EMAIL = /@(?:anthropic|openai)\.com$/i;
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
 * Whether `name <email>` is an AI tool's or its vendor's identity: a tool's
 * own address, a vendor's address under a tool's name, one of its GitHub App
 * accounts, an unambiguous tool's name in full, AI in general, or a name a tool
 * marks as its own. A person is not, even one whose name begins with a
 * vendor's or whose address is a vendor's.
 */
export function isAiIdentity(identity) {
  const { name, email } = identityParts(identity);
  return AI_EMAIL.test(email) || isToolName(name) || (VENDOR_EMAIL.test(email) && BARE_NAME.test(name));
}

function isToolName(name) {
  return AI_NAME.test(name) || TOOL_NAME.test(name) || /\(aider\)/i.test(name);
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
  const trailers = unfolded(lines).flatMap(({ text: line, at }) => trailerCredits(line, rules).map(found => ({ ...found, from: at, line: at })));
  const phrases = [...leadCredits(joined, rules), ...adjectiveCredits(joined, rules)].map(({ start, at, ...found }) => ({ ...found, from: lineAt(joined, start), line: lineAt(joined, at) }));
  return [...trailers, ...phrases];
}

/** The lines, with a trailer's folded continuation lines joined to it as git unfolds them; each keeps the line it starts on. */
function unfolded(lines) {
  const logical = [];
  lines.forEach((line, index) => {
    const last = logical.at(-1);
    if (last && /^[ \t]+\S/.test(line) && TRAILER.test(last.text)) last.text = `${last.text} ${line.trim()}`;
    else logical.push({ text: line, at: index + 1 });
  });
  return logical;
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

/** Each crediting phrase followed by a name, with where the phrase starts and where the name it credits does. */
function leadCredits(text, rules) {
  return LEADS.flatMap(({ form, lead }) =>
    [...text.matchAll(lead)].flatMap(match => {
      const after = match.index + match[0].length;
      const name = namedAt(text.slice(after), rules);
      return name === null ? [] : [{ form, excerpt: excerpt(text, match.index), start: match.index, at: after + name }];
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
  return cased.flatMap(pattern => [...text.matchAll(pattern)].map(match => ({ form: "calls it AI-made", excerpt: excerpt(text, match.index), start: match.index, at: match.index })));
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

/**
 * The lines a unified diff shows of the final files: each added line, and the
 * unchanged lines beside it, each with its file, its line number there, and
 * whether the change added it. An unchanged neighbour is read because a credit
 * can be formed by adding a phrase next to a line already there.
 */
export function diffLines(diff) {
  const state = { path: null, next: 0, oldLeft: 0, newLeft: 0 };
  const lines = [];
  for (const line of diff.split("\n")) readDiffLine(line, state, lines);
  return lines;
}

/**
 * A hunk header says how many old and new lines follow it, so inside a hunk
 * every line is content, even one that happens to begin like a header.
 */
function readDiffLine(line, state, lines) {
  if (state.oldLeft + state.newLeft > 0) return readHunkLine(line, state, lines);
  if (line.startsWith("+++ ")) state.path = targetPath(line);
  else if (line.startsWith("@@")) Object.assign(state, hunkHeader(line));
}

/** A removed line counts against the old side, an added one against the new, and an unchanged one against both. */
function readHunkLine(line, state, lines) {
  if (line.startsWith("\\")) return;
  if (!line.startsWith("+")) state.oldLeft -= 1;
  if (line.startsWith("-")) return;
  state.newLeft -= 1;
  keepLine(line, state, lines);
}

function keepLine(line, state, lines) {
  if (state.path) lines.push({ path: state.path, line: state.next, text: line.slice(1), added: line.startsWith("+") });
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
  const [, oldCount = "1", start, newCount = "1"] = match;
  return { next: Number(start), oldLeft: Number(oldCount), newLeft: Number(newCount) };
}

/** Consecutive lines of one file as one block, so a phrase wrapped across them reads whole. */
export function diffBlocks(lines) {
  const blocks = [];
  for (const entry of lines) {
    if (continues(blocks.at(-1), entry)) extend(blocks.at(-1), entry);
    else blocks.push({ path: entry.path, start: entry.line, texts: [entry.text], added: [entry.added] });
  }
  return blocks;
}

function continues(block, entry) {
  return Boolean(block) && block.path === entry.path && block.start + block.texts.length === entry.line;
}

function extend(block, entry) {
  block.texts.push(entry.text);
  block.added.push(entry.added);
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
  // Text, whatever a changed attribute says: a path marked binary would
  // otherwise show no lines at all, and its credit none.
  const diff = git(["-c", "core.quotePath=false", "diff", "--unified=1", "--text", "--no-textconv", "--no-color", "--no-ext-diff", "-M", base, head], { maxBuffer: MAX_OUTPUT });
  if (!commits || !names.ok || !diff.ok) return { problem: `could not read the commits and changes in ${base}..${head}` };
  return { commits, paths: addedOrRenamed(names.out.split("\0")), lines: diffLines(diff.out) };
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
    ...diffBlocks(lines).flatMap(block => blockFindings(block)),
  ];
}

/** A block's credits that an added line takes part in: an unchanged line alone credits nothing new. */
function blockFindings({ path, start, texts, added }) {
  if (!added.includes(true)) return [];
  return creditsIn(texts.join("\n"), "line")
    .filter(found => added.slice(found.from - 1, found.line).includes(true))
    .map(found => {
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

/** The events this reads, each by the event whose payload it carries. */
const EVENTS = new Map([
  ["pull_request", "pull_request"],
  ["pull_request_target", "pull_request"],
  ["merge_group", "merge_group"],
]);

/** Decides for the CI step: a pull request, or what the merge queue would land. */
function checkChange(env, git) {
  const event = EVENTS.get(env.GITHUB_EVENT_NAME);
  if (!event) return refuse(`no range to read for a ${env.GITHUB_EVENT_NAME || "missing"} event; give it one here before triggering this check on it`);
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
  const added = lines.filter(entry => entry.added).length;
  console.log(`ai-credit: no AI credit in ${published}${commits.length} commit(s), ${paths.length} added or renamed path(s) and ${added} added line(s).`);
  return 0;
}

function refuse(problem) {
  console.log(`::error title=AI credit::${commandText(problem)}`);
  return 1;
}

/** Decides for the commit-msg hook: the message about to be committed, and who is committing it. */
function checkCommit(file, git) {
  if (!file) return refuseCommit(["no message file was given"]);
  const { above, below } = committedParts(readFileSync(file, "utf8"));
  const identities = ["author", "committer"].map(role => [role, git(["var", `GIT_${role.toUpperCase()}_IDENT`])]);
  const reasons = [
    ...identities.filter(([, read]) => !read.ok).map(([role]) => `the commit's ${role} could not be read`),
    ...creditsIn(above, "message").map(found => `the message, line ${found.line}, ${found.form}: ${found.excerpt}`),
    ...creditsIn(below, "line").map(found => `the message below its scissors line, line ${found.line}, ${found.form}: ${found.excerpt}`),
    ...identities.filter(([, read]) => read.ok && isAiIdentity(withoutDate(read.out))).map(([role, read]) => `the ${role}, ${withoutDate(read.out)}, is an AI tool's identity`),
  ];
  return reasons.length > 0 ? refuseCommit(reasons) : 0;
}

function withoutDate(ident) {
  return ident.trim().replace(/\s+\d+\s+[-+]\d{4}$/, "");
}

/**
 * A message, split at a scissors line. Comment lines are read, since a message
 * given with `-m` or `-F` keeps them. Git drops what is below a scissors line
 * only when it cleans an edited message, and keeps it otherwise, so that is
 * read too, as the diff an editor usually shows there: its added lines and any
 * plain text, but not the lines it removes or leaves unchanged, since removing
 * an old credit credits nothing.
 */
function committedParts(message) {
  const [above, ...rest] = message.split(/^\S -{8,} >8 -{8,}$/m);
  const below = rest
    .join("\n")
    .split("\n")
    .filter(line => !/^[ -]/.test(line))
    .map(line => line.replace(/^\+/, ""));
  return { above, below: below.join("\n") };
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
