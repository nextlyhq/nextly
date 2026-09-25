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
/** Words a vendor puts after a tool's name for an edition or a size, which no surname is taken to be. */
const EDITIONS = ["Large", "Medium", "Small", "Nano", "Mini", "Micro", "Pro", "Flash", "Ultra", "Max", "Plus", "Lite", "Turbo", "Instant", "Code", "Coder", "Agent", "Assistant", "Chat", "Beta", "Preview", "Thinking", "Instruct", "Nemo"];
/** An edition word after a name, on its line or wrapped onto the next, as a phrase's words may be. */
const EDITION = `${GAP}(?:${EDITIONS.join("|")})(?![\\w-])`;
/**
 * Every edition word after a name, so that what follows the name is read after
 * its edition: a role after `Mistral Large` makes people of it as surely as one
 * after `Mistral` does, and the words are not given back to let a shorter name
 * match.
 */
const EDITION_RUN = `(?:${EDITION})*(?!${EDITION})`;
/**
 * A name ends at a word's end. Followed by an API, SDK, key or the like it is a
 * component a product uses, and followed by a person's role it is people, as a
 * vendor's researcher or team is; neither is the tool.
 */
const ENDS = `(?![\\w-])(?!(?:'s)?${GAP}(?:api|sdk|client|library|package|embeddings?|endpoint|integration|provider|plugin|key|account|platform|console|researcher|engineer|employee|team|staff|scientist|intern|founder|developer|designer|manager|lead|colleague|folks|people|member|contractor)s?\\b)`;
const TOOL_AT = new RegExp(`^${VENDOR}(?:${TOOLS.join("|")})${EDITION_RUN}${ENDS}`, "i");
/**
 * In prose, an ambiguous name followed by a capitalised surname is a person,
 * as `Claude Dupont` is; a tool's full name matches first, and an edition
 * word after the name is not a surname, as in `Mistral Large`.
 */
const PROPER_AT = new RegExp(`^${VENDOR}(?:${PROPER.join("|")})${EDITION_RUN}${ENDS}(?![^\\S\\n]+(?!(?:${EDITIONS.join("|")})\\b)[A-Z][a-z])`);
const PROPER_AT_ANY_CASE = new RegExp(`^${VENDOR}(?:${PROPER.join("|")})${EDITION_RUN}${ENDS}`, "i");
const GENERIC_AT = new RegExp(`^(?:${GENERIC.join("|")})${ENDS}`, "i");
const BOT = `(?:${BOT_ACCOUNTS.join("|")})\\[bot\\]`;
/** A name that is AI in general, or one of a tool's GitHub App accounts. No person is named either. */
const AI_NAME = new RegExp(`^(?:${GENERIC.join("|")}|${BOT})$`, "i");
/** An unambiguous tool's name in full, as its vendors name it. */
const TOOL_NAME = new RegExp(`^${VENDOR}(?:${TOOLS.join("|")})$`, "i");
/** A name that begins with an unambiguous tool's, such as a product and its edition; read only where no address says who it is. */
const TOOL_NAMED = new RegExp(`^${VENDOR}(?:${TOOLS.join("|")})(?![\\w-])`, "i");
/** An ambiguous name alone, or with its edition, as `Mistral Large` names a tool in prose and in a trailer alike. */
const BARE_NAME = new RegExp(`^(?:${PROPER.join("|")})${EDITION_RUN}$`, "i");
const AI_EMAIL = new RegExp(`^(?:noreply@(?:anthropic|openai)\\.com|cursoragent@cursor\\.com|\\d+\\+(?:copilot|${BOT})@users\\.noreply\\.github\\.com)$`, "i");
/** A vendor's own domain: people work there too, so an address there is a tool's only under a tool's name. */
const VENDOR_EMAIL = /@(?:anthropic|openai)\.com$/i;
const BRANCH_OWNER = new RegExp(`^(?:${BRANCH_OWNERS.join("|")})/`, "i");
/** A vendor's name and nothing more, which may go on to be part of a person's, as `Anthropic Researcher Jane Doe` does. */
const VENDOR_ALONE = new RegExp(`^(?:${VENDORS.join("|")})$`, "i");

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
/**
 * In a file, AI in general credits only where it describes the file or the
 * change itself. A page, a document or the code a product serves may be
 * AI-made as a feature, so only the change's own artifacts count: any of them
 * as this one, and as the one only the file, the change, the patch or the
 * commit, which product copy has little reason to say.
 */
const SELF_DESCRIBED = new RegExp(
  `\\b${gapped("(?:this (?:file|change|patch|commit|code|module|script|function|implementation|test|tests)|the (?:file|change|patch|commit)) (?:is|was|has been|are|were)")}${GAP}${DEGREE}(?:AI|LLM)-${MADE_ADJECTIVE}\\b`,
  "gi"
);

/** A tool as the subject of a maker verb whose object is the change itself, as a tool that wrote this file is, whatever its edition. */
const SUBJECT_VERB = "(?:generated|wrote|created|authored|made|built|drafted|produced|implemented|refactored|co-?authored)";
const CHANGE_ITSELF = gapped("(?:this|the|these) (?:change|changes|commit|commits|file|files|code|patch|pull request|pr|implementation|fix|feature|test|tests|docs|documentation|function|module|script|refactor)");
const SUBJECTS = [
  new RegExp(`\\b${VENDOR}(?:${[...TOOLS, ...GENERIC].join("|")})(?:${EDITION})*${GAP}${SUBJECT_VERB}${GAP}${CHANGE_ITSELF}\\b`, "gi"),
  new RegExp(`\\b${VENDOR}(?:${PROPER.join("|")})(?:${EDITION})*${GAP}${SUBJECT_VERB}${GAP}${CHANGE_ITSELF}\\b`, "g"),
];
/** A trailer, on a line of its own or in a comment: `//`, `#`, `*`, `--`, `;` or an HTML comment. */
const TRAILER = /^\s*(?:(?:\/\/|#|\*|--|;|<!--)\s*)?([A-Za-z][A-Za-z0-9-]*-(?:by|with))\s*:\s*(.+?)\s*(?:-->)?\s*$/i;
/** A trailer's first line, whether or not its value starts there, and its key. */
const TRAILER_HEAD = /^\s*(?:(?:\/\/|#|\*|--|;|<!--)\s*)?([A-Za-z][A-Za-z0-9-]*-(?:by|with))\s*:/i;
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
  message: { trailers: true, generic: true, subject: true, anyCase: false, words: text => text },
  line: { trailers: true, generic: false, subject: true, anyCase: false, words: text => text },
  name: { trailers: false, generic: false, subject: false, anyCase: true, words: text => text.replace(/[/_.-]+/g, " ") },
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
  return addressed ? { name: addressed[1].trim().replace(/^"(.*)"$/, "$1"), email: addressed[2].trim() } : { name: text, email: "" };
}

/** Every credit a piece of text carries, each with the line it is on. */
export function creditsIn(text, place = "message") {
  const rules = PLACES[place];
  const read = readLines(text, rules);
  const joined = read.lines.join("\n");
  const trailers = unfolded(read).flatMap(trailer => creditingSpan(trailer, rules));
  const phrases = [...leadCredits(joined, rules), ...adjectiveCredits(joined, rules), ...subjectCredits(joined, rules)].map(({ start, at, ...found }) => ({ ...found, from: lineAt(joined, start), line: lineAt(joined, at) }));
  return [...trailers, ...phrases];
}

/**
 * A text's lines as a place reads them: `raw`, with the marks that give a line
 * its structure (a comment's `*`, a list item's bullet), and `lines`, read
 * plain for the words they say.
 */
function readLines(text, rules) {
  const raw = String(text ?? "")
    .split(/\r?\n/)
    .map(line => rules.words(line));
  return { raw, lines: raw.map(plain) };
}

/**
 * The lines, with a trailer's folded continuation lines gathered onto it: an
 * indented line continues the trailer above it, as git reads one. In a comment
 * block the continuation repeats the trailer's comment prefix first, so it is
 * the text after that prefix that must be indented further than the trailer's
 * own. A line that is a trailer itself always starts its own.
 */
function unfolded({ raw, lines }) {
  const logical = [];
  raw.forEach((line, index) => {
    const last = logical.at(-1);
    const part = continuation(line, lines[index], last);
    if (part === null) logical.push({ parts: [lines[index]], head: line, at: index + 1 });
    else last.parts.push(part);
  });
  return logical;
}

/**
 * What a line adds to the trailer above it, read plain, or null when it starts
 * a line of its own. Its structure is read from the raw line, before `plain`
 * drops a comment's `*` or a list item's bullet: it repeats the trailer's
 * comment prefix, if it has one, and its text after that is indented further
 * than the trailer's own, or is an address level with it. A comment block
 * indents every line, so a line merely level with the trailer is a comment of
 * its own, and a list item is always its own.
 */
function continuation(line, plainLine, last) {
  if (!continuable(plainLine, last)) return null;
  const prefix = commentPrefix(last.head);
  if (line.startsWith(prefix)) return continuingText(line.slice(prefix.length), last.head.slice(prefix.length));
  return indentedUnderItem(line, last.head, prefix) ? listItemPart(line, last) : null;
}

/**
 * Whether a line is indented under a trailer written as a `*` list item:
 * Markdown indents an item's continuation to its text, without repeating the
 * bullet, where a comment block repeats its prefix.
 */
const indentedUnderItem = (line, head, prefix) => /^[ \t]*\*$/.test(prefix) && /\S/.test(line) && !LIST_ITEM.test(line) && indentOf(line) >= prefix.length + indentOf(head.slice(prefix.length));

/**
 * What a line indented under a list item adds to its trailer. Every such line
 * goes on with the item, so a co-author after an explanation still belongs to
 * the trailer; but an explanation credits no one. What goes on with the value
 * (the value itself while it is empty, another co-author after a joining word,
 * an address, or a name alone, a separator after it or not) is read as it is,
 * and anything else, a note among them, as a note: bracketed whole, so that it
 * names no co-author, ends the one before it once closed, and stays open for
 * the lines after it where it opens a bracket it does not close.
 */
function listItemPart(line, last) {
  const text = plain(line).trim();
  return valueEmpty(last) || continuesValue(text) ? text : `(${text})`;
}

/** Whether a trailer's value is still empty: nothing after its key, and no line folded onto it yet. */
const valueEmpty = last => last.parts.length === 1 && last.parts[0].replace(TRAILER_HEAD, "").trim() === "";

/** Whether a line goes on with a trailer's value: another co-author after a joining word, an address, or a name alone. */
const continuesValue = text => JOINER.test(text) || ADDRESS.test(text) || nameAlone(withoutSeparator(beforeNote(text)));

/**
 * A name and nothing more, as a surname or a tool's name folded onto the next
 * line is: capitalised words (`NAME_WORDS`), a tool's name or identity in
 * full, or an ambiguous name in any case. An explanation reads on in lower
 * case, or after a colon.
 */
const nameAlone = text => NAME_WORDS.test(text) || isAiIdentity(text) || BARE_NAME.test(text);

/** A word a name is made of: a capital, in any script that has them, or a number, and what follows it. */
const NAME_WORD = "[\\p{Lu}\\p{Lt}\\p{N}][\\p{L}\\p{M}\\p{N}_.'’-]*";
/** The lowercase particles a surname may carry, as `de`, `van` and `von` do. */
const PARTICLE = "(?:da|das|de|del|della|der|des|di|do|dos|du|la|le|van|von|den|ter|ten|zu|af|al|bin|ibn|ben|y)";
/**
 * Words that make a name: at least one capitalised, and a particle anywhere
 * among them, so `José de` goes on to its surname. A script without case
 * cannot show a name apart from prose, so its words make none, and a line of
 * them ends a co-author as an explanation does, unless a joining word brought
 * them in (`namePending`).
 */
const NAME_WORDS = new RegExp(`^(?:${PARTICLE}\\s+)*${NAME_WORD}(?:\\s+(?:${NAME_WORD}|${PARTICLE}))*$`, "u");

/** A line's text before a note in brackets or after a dash; a colon is kept, since what follows one explains. */
const beforeNote = text => text.split(/\s+(?:[(—]|-\s)/)[0].trim();

/** An address in angle brackets, as a co-author's is written. */
const ADDRESS = /<[^<>\s@]+@[^<>\s]+>/;

/** Whether a line may continue the one above it: that one is a trailer, and this one is not. */
const continuable = (line, last) => Boolean(last) && TRAILER_HEAD.test(last.parts[0]) && !TRAILER_HEAD.test(line);

/** A comment's opening mark, with what indents it — `//`, `#`, `*`, `--` or `;` — or "" for a line that is not one. */
const commentPrefix = line => /^[ \t]*(?:\/\/|#|\*|--|;)/.exec(line)?.[0] ?? "";

/** A line's words, read plain, when its text continues the trailer's; null otherwise. */
const continuingText = (text, trailerText) => (carriesOn(text, trailerText) ? plain(text).trim() : null);

const carriesOn = (text, trailerText) => /\S/.test(text) && !LIST_ITEM.test(text) && (indentOf(text) > indentOf(trailerText) || levelAddress(text, trailerText));

/**
 * An address on a line of its own, level with the trailer it completes, as a
 * trailer indented in a block may have. At the margin a line is its own, as git
 * reads one, so only an indented address continues.
 */
const levelAddress = (text, trailerText) => indentOf(text) > 0 && indentOf(text) === indentOf(trailerText) && /^\s*</.test(text);

/** A Markdown list item: a line of its own, whatever its indent. */
const LIST_ITEM = /^\s*[*+-]\s/;

const indentOf = text => /^[ \t]*/.exec(text)[0].length;

/**
 * A trailer's credits, each spanning its lines up to the one it belongs to. A
 * credit already whole on its first line stays that line's, so an added
 * continuation that says nothing more does not make it new; one an added
 * continuation completes, or names a tool of its own in, counts as that
 * line's. Each later co-author is read the same way from the line it starts
 * on, so a new credit cannot hide behind an old one.
 */
function creditingSpan({ parts, at }, rules) {
  const key = trailerKey(parts[0], rules);
  if (key === undefined) return [];
  const first = growingCredit(parts.slice(0, IDENTITY_LINES), (text, whole) => trailerCredits(text, rules, whole));
  // Later co-authors start after the line the first credit belongs to, not the line that completed it:
  // lines folded after a tool's line may name another tool of their own.
  return [...placed(first, at), ...laterCoAuthorCredits(parts, at, key, first ? first.index + 1 : 1)];
}

const trailerKey = (line, rules) => (rules.trailers ? TRAILER_HEAD.exec(line)?.[1] : undefined);

/** A value's credits, on the lines they belong to, counted from the value's first line at `at`. */
const placed = (found, at) => (found ? found.credits.map(credit => ({ ...credit, from: at, line: at + found.index })) : []);

/**
 * The first credit a value makes as its parts are read in, and the index of
 * the part it belongs to, or null. An ambiguous name, and a vendor's name
 * standing alone, are judged only on the whole value, so a vendor's name
 * continued onto a person's name and address is that person, while a tool's
 * full name is a credit as soon as it is complete.
 */
function growingCredit(parts, creditsOf) {
  for (let count = 1; count <= parts.length; count += 1) {
    const credits = creditsOf(parts.slice(0, count).join(" "), count === parts.length);
    if (credits.length > 0) return { credits, index: creditedPart(parts, creditsOf, count) };
  }
  return null;
}

/**
 * The part a credit completed by the first `count` parts belongs to. A name
 * that credits on its own, judged whole, was waiting only to see whether the
 * lines after it make a person of it. When they do not, the credit is that
 * name's, on its own line, unless they name a tool of their own, whose line it
 * then belongs to: not the line that completed the value, which may be a note
 * added long after.
 */
function creditedPart(parts, creditsOf, count) {
  if (count === 1 || creditsOf(parts[0], true).length === 0) return count - 1;
  const tool = toolLineIn(parts.slice(1, count));
  return tool === null ? 0 : tool + 1;
}

/**
 * The credits a trailer's later co-authors make, from the part at `from` on.
 * Each starts at a joining word, or at `from`, and runs on to the next, so one
 * folded across lines is judged whole, as the first is.
 */
function laterCoAuthorCredits(parts, at, key, from) {
  const creditsOf = (text, whole) => (creditsCoAuthor(text, whole) ? [{ form: `names it in a ${key} trailer`, excerpt: excerpt(text) }] : []);
  return coAuthors(parts, from).flatMap(({ index, group }) => placed(growingCredit(group, creditsOf), at + index));
}

/** A later co-author's lines, judged as a trailer's value is once a joining word is set aside. */
const creditsCoAuthor = (text, whole) => creditedByTrailer(withoutJoiner(text), whole);

/** A trailer's parts from `from` on, as co-authors, each with the index it starts at. */
function coAuthors(parts, from) {
  const groups = [];
  parts.slice(from).forEach((part, offset) => {
    if (startsCoAuthor(part, groups.at(-1))) groups.push({ index: from + offset, group: [part] });
    else groups.at(-1).group.push(part);
  });
  return groups;
}

/**
 * Whether a folded line starts a co-author of its own: the first, one after a
 * joining word, or one after a co-author already complete, with an address, a
 * closing separator or a closed note, or as long as an identity gets. A name
 * in progress goes on onto the next line, as a first name does onto a surname
 * and address, and so does a note still open; plain words that are no name,
 * as an explanation's are, go on no further, so a tool named after them is
 * read on its own.
 */
const startsCoAuthor = (part, last) => !last || JOINER.test(part) || last.group.length >= IDENTITY_LINES || complete(last.group.join(" "));

/** Whether a co-author's lines are complete: no note left open, and an address, a closing separator, a note, or words that are no name. */
const complete = text => balanced(text) && (closed(text) || !namePending(text));

/**
 * Whether a co-author's lines so far are a name that may go on: a name alone,
 * or words in a script without capitals after a joining word. Such a script
 * cannot show a name apart from prose, but a joining word only ever brings in
 * another co-author, so what follows one is read as that co-author's name;
 * without one, the words go on with the value before them, as an explanation.
 */
const namePending = text => nameAlone(withoutJoiner(text)) || (JOINER.test(text) && CASELESS_WORDS.test(withoutJoiner(text)));

/** Words in a script without capitals, as a name in Arabic or Chinese is written. */
const CASELESS_WORDS = /^\p{Lo}[\p{Lo}\p{M}]*(?:\s+\p{Lo}[\p{Lo}\p{M}]*)*$/u;

/** Whether a co-author's lines end as an identity does: with an address, a closing separator or a note. */
const closed = text => ADDRESS.test(text) || /[,;]\s*$/.test(text) || NOTE.test(text);

/**
 * The most lines one identity is read across: a name, a surname, an address,
 * a note and one more. Past it a line starts an identity of its own, so a long
 * run of folded lines is read in time that grows with its length, not with
 * its square.
 */
const IDENTITY_LINES = 5;

/** Where a note opens in a value: a bracket or a dash, at its start or after a space. */
const NOTE = /(?:^|\s)(?:[(—]|-\s)/;

const balanced = text => (text.match(/\(/g) ?? []).length === (text.match(/\)/g) ?? []).length;

/**
 * Where, among lines folded onto a name, the first to name a tool of its own
 * is, as another co-author does, or null: each co-author they hold is judged
 * whole. A note opens with a bracket or a dash, so a name it mentions is not
 * read.
 */
function toolLineIn(parts) {
  for (const { index, group } of coAuthors(parts, 0)) {
    const found = growingCredit(group, (text, whole) => (creditsCoAuthor(text, whole) ? [text] : []));
    if (found) return index + found.index;
  }
  return null;
}

/** A word that joins another co-author onto a trailer's value. */
const JOINER = /^(?:(?:and|plus)\b|&|,)\s*/i;

const withoutJoiner = text => text.replace(JOINER, "");

/**
 * Markdown links read as their text, and emphasis marks and inline HTML tags
 * as nothing, so a formatted credit reads as a plain one. A tag never holds an
 * `@`, so an address in angle brackets stays.
 */
function plain(text) {
  return text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<\/?[a-z][a-z0-9-]*(?:\s[^<>@]*)?>/gi, "")
    .replace(/[*_`]{1,3}/g, "");
}

/** The 1-based line an offset into a text falls on. */
function lineAt(text, offset) {
  return text.slice(0, offset).split("\n").length;
}

function trailerCredits(text, rules, whole) {
  const trailer = rules.trailers ? TRAILER.exec(text) : null;
  return trailer && creditedByTrailer(trailer[2], whole) ? [{ form: `names it in a ${trailer[1]} trailer`, excerpt: excerpt(text) }] : [];
}

/**
 * A trailer with an address credits an AI when the identity is an AI's. One
 * without an address names whoever it credits outright, before any note, so
 * there a tool's plain name, or one that begins with a tool's, is enough. An
 * ambiguous name alone is judged only on the `whole` value: folded onto the
 * next line, `Claude` may go on to be `Claude Dupont`.
 */
function creditedByTrailer(value, whole) {
  if (/<[^>]*>/.test(value)) return isAiIdentity(value);
  return namesToolOutright(namePart(value), whole);
}

/** A value's name, before any note: a bracket, a dash or a colon after it ends the name, and a separator after it is not part of it. */
const namePart = value => withoutSeparator(value.split(/\s+(?:[(—]|-\s)|:/)[0].trim());

/** A name without the comma or semicolon that may part it from the next. */
const withoutSeparator = text => text.replace(/\s*[,;]$/, "");

function namesToolOutright(name, whole) {
  return (whole || !VENDOR_ALONE.test(name)) && namesATool(name, whole);
}

const namesATool = (name, whole) => isAiIdentity(name) || TOOL_NAMED.test(name) || (whole && BARE_NAME.test(name));

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

/**
 * A name or AI in general called the change's maker, from where the phrase
 * starts to where it ends: a self-description may wrap, and a line that
 * completes one takes part in it, as a line completing a maker's phrase does.
 */
function adjectiveCredits(text, rules) {
  const patterns = [...NAMED_ADJECTIVES, rules.generic ? GENERIC_ADJECTIVE : SELF_DESCRIBED];
  const cased = rules.anyCase ? patterns.map(pattern => new RegExp(pattern.source, "gi")) : patterns;
  return cased.flatMap(pattern => [...text.matchAll(pattern)].map(match => ({ form: "calls it AI-made", excerpt: excerpt(text, match.index), start: match.index, at: match.index + match[0].length })));
}

/**
 * A tool named as the change's maker, from its name to the end of the phrase,
 * so that an added line anywhere in the phrase takes part. A full name read as
 * an ambiguous one and its edition matches both patterns, and counts once.
 */
function subjectCredits(text, rules) {
  if (!rules.subject) return [];
  const phrases = new Map();
  for (const match of SUBJECTS.flatMap(pattern => [...text.matchAll(pattern)])) if (!phrases.has(match.index)) phrases.set(match.index, match);
  return [...phrases.values()].map(match => ({ form: "names it as the change's maker", excerpt: excerpt(text, match.index), start: match.index, at: match.index + match[0].length }));
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

/**
 * The path a `+++` line names. Git C-quotes a path that holds a `"`, a `\` or a
 * control character, escapes and all, and ends one that holds a space with a
 * tab, so the path is read back from either form before its file is read.
 */
function targetPath(line) {
  const target = unquoted(line.slice(4).replace(/\t$/, ""));
  return target === "/dev/null" ? null : target.replace(/^b\//, "");
}

/** The C escapes git writes in a quoted path, each with the byte it stands for. */
const ESCAPES = { a: 7, b: 8, t: 9, n: 10, v: 11, f: 12, r: 13, '"': 34, "\\": 92 };

/** A path as git printed it, read back: as it is unless quoted, and then with its escapes, octal bytes among them, decoded. */
function unquoted(text) {
  const quoted = /^"(.*)"$/s.exec(text);
  if (!quoted) return text;
  const bytes = [];
  for (const [, octal, escape, plain] of quoted[1].matchAll(/\\([0-7]{3})|\\(.)|([^\\]+)/gs)) bytes.push(...pathBytes(octal, escape, plain));
  return Buffer.from(bytes).toString("utf8");
}

function pathBytes(octal, escape, plain) {
  if (octal !== undefined) return [parseInt(octal, 8)];
  if (escape !== undefined) return [ESCAPES[escape] ?? escape.charCodeAt(0)];
  return [...Buffer.from(plain, "utf8")];
}

const HUNK = /^@@ -\d+(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

function hunkHeader(line) {
  const match = HUNK.exec(line);
  if (!match) throw new Error(`cannot read the hunk header ${JSON.stringify(line)}`);
  const [, oldCount = "1", start, newCount = "1"] = match;
  return { next: Number(start), oldLeft: Number(oldCount), newLeft: Number(newCount) };
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
function rangeEvidence(range, git) {
  const read = rangeReads(range, git);
  if (read.problem) return read;
  const lines = diffLines(read.diff);
  const paragraphs = paragraphBlocks(lines, range.head, git);
  return paragraphs.problem ? paragraphs : { commits: read.commits, paths: read.paths, lines, blocks: paragraphs.blocks };
}

/** A range's commits, its added or renamed paths and its diff, as git reports them, or why they cannot be read. */
function rangeReads({ base, head }, git) {
  const commits = commitsIn({ base, head }, git);
  const names = git(["-c", "core.quotePath=false", "diff", "--name-status", "-z", "-M", base, head], { maxBuffer: MAX_OUTPUT });
  // Text, whatever a changed attribute says: a path marked binary would
  // otherwise show no lines at all, and its credit none. No context lines:
  // the diff says which lines were added, and each is read in its paragraph
  // of the final file.
  const diff = git(["-c", "core.quotePath=false", "diff", "--unified=0", "--text", "--no-textconv", "--no-color", "--no-ext-diff", "-M", base, head], { maxBuffer: MAX_OUTPUT });
  if (!commits || !names.ok || !diff.ok) return { problem: `could not read the commits and changes in ${base}..${head}` };
  return { commits, paths: addedOrRenamed(names.out.split("\0")), diff: diff.out };
}

/**
 * The final file's paragraphs that hold an added line, a block each, with
 * which of their lines the change added. A phrase may wrap, but never across a
 * blank line, and a folded trailer never holds one either, so a credit an added
 * line takes part in lies whole inside these, however far above or below the
 * added line it starts or ends. Each file is read once. One that cannot be read
 * makes the whole answer a problem: a credit could start in it, and nobody
 * would have read it.
 *
 * @returns {{ blocks: { path: string, start: number, texts: string[], added: boolean[] }[] } | { problem: string }}
 */
export function paragraphBlocks(lines, head, git) {
  const read = [...addedLinesByPath(lines)].map(([path, added]) => ({ path, added, file: git(["show", `${head}:${path}`], { maxBuffer: MAX_OUTPUT }) }));
  const unreadable = read.filter(({ file }) => !file.ok).map(({ path }) => path);
  if (unreadable.length > 0) return { problem: `could not read ${unreadable.join(", ")} at ${head}, whose paragraphs hold the added lines` };
  return { blocks: read.flatMap(({ path, added, file }) => paragraphsOf(path, file.out.split("\n"), added)) };
}

/** Each file's added lines, by the line each has in the final file. A blank one takes part in no phrase. */
function addedLinesByPath(lines) {
  const byPath = new Map();
  for (const entry of lines.filter(line => line.added && !blank(line.text))) {
    if (!byPath.has(entry.path)) byPath.set(entry.path, new Set());
    byPath.get(entry.path).add(entry.line);
  }
  return byPath;
}

/** The paragraphs of a file's final lines that hold an added line, each once, in order. */
function paragraphsOf(path, fileLines, added) {
  const spans = [];
  let covered = 0;
  for (const line of [...added].sort((a, b) => a - b)) {
    if (line <= covered) continue;
    const span = { start: paragraphStart(fileLines, line), end: paragraphEnd(fileLines, line) };
    spans.push(span);
    covered = span.end;
  }
  return spans.map(span => blockOf(path, fileLines, added, span));
}

function blockOf(path, fileLines, added, { start, end }) {
  const texts = fileLines.slice(start - 1, end);
  return { path, start, texts, added: texts.map((_, offset) => added.has(start + offset)) };
}

/** The 1-based first line of the paragraph holding a line: back to, not across, a blank line. */
function paragraphStart(fileLines, line) {
  let start = line;
  while (start > 1 && !blank(fileLines[start - 2])) start -= 1;
  return start;
}

/** The 1-based last line of the paragraph holding a line: on to, not across, a blank line. */
function paragraphEnd(fileLines, line) {
  let end = line;
  while (end < fileLines.length && !blank(fileLines[end])) end += 1;
  return end;
}

const blank = text => /^\s*$/.test(text);

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
function rangeFindings({ commits, paths, blocks }) {
  return [
    ...commits.flatMap(commit => commitFindings(commit)),
    ...paths.flatMap(path => creditsIn(path, "name").map(found => ({ ...found, where: `the path ${path}` }))),
    ...blocks.flatMap(block => blockFindings(block)),
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

/**
 * One finding as a workflow command. A decoded path may hold a line break, a
 * `:` or a `,`, so the file is escaped as a command's property is; the message
 * is escaped as its data.
 */
function annotation({ file, line, where, form, excerpt: text }) {
  const at = file ? ` file=${commandProperty(file)},line=${line},` : " ";
  return `::error${at}title=AI credit::${commandText(`${where} ${form}: ${text}`)}`;
}

const commandProperty = text => commandText(text).replaceAll(":", "%3A").replaceAll(",", "%2C");

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
  const { message, diff } = committedParts(readFileSync(file, "utf8"));
  const identities = ["author", "committer"].map(role => [role, git(["var", `GIT_${role.toUpperCase()}_IDENT`])]);
  const reasons = [
    ...identities.filter(([, read]) => !read.ok).map(([role]) => `the commit's ${role} could not be read`),
    ...creditsIn(message, "message").map(found => `the message, line ${found.line}, ${found.form}: ${found.excerpt}`),
    ...creditsIn(diff, "line").map(found => `the diff below the message's scissors line ${found.form}: ${found.excerpt}`),
    ...identities.filter(([, read]) => read.ok && isAiIdentity(withoutDate(read.out))).map(([role, read]) => `the ${role}, ${withoutDate(read.out)}, is an AI tool's identity`),
  ];
  return reasons.length > 0 ? refuseCommit(reasons) : 0;
}

function withoutDate(ident) {
  return ident.trim().replace(/\s+\d+\s+[-+]\d{4}$/, "");
}

/** A scissors line, in whatever comment prefix git writes it with. */
const SCISSORS = /^(\S+) -{8,} >8 -{8,}\r?$/m;

/**
 * What of a message git records, and the diff its editor shows. Comment lines
 * are read, since a message given with `-m` or `-F` keeps them, and so is what
 * a scissors line there has below it. In the editor it opens, git follows its
 * own scissors line with comment lines in the same prefix, in any language and
 * with any comment character, and then with nothing or with the diff
 * `--verbose` shows, and drops everything from that line on. There the part
 * below is read as that diff: its added lines and any plain text, but not the
 * lines it removes or leaves unchanged, since removing an old credit credits
 * nothing.
 */
function committedParts(message) {
  const cut = SCISSORS.exec(message);
  if (!cut) return { message, diff: "" };
  const below = message.slice(cut.index + cut[0].length + 1).split("\n");
  return isEditorBuffer(below, cut[1]) ? { message: message.slice(0, cut.index), diff: diffAdditions(below).join("\n") } : { message, diff: "" };
}

/**
 * Whether what follows a scissors line is git's own: comment lines in its
 * prefix, then nothing, or a diff. A message's own text below a scissors line
 * goes on otherwise, even after a comment line of its own, or a line of its
 * own that happens to begin as git's diff does.
 */
function isEditorBuffer(below, prefix) {
  const first = below.findIndex(line => !line.startsWith(prefix));
  if (first === -1) return true;
  const rest = below.slice(first);
  return isGitDiff(rest) || rest.every(line => line.trim() === "");
}

/**
 * A header git writes on the line after `diff --git`, before any `---`: the
 * blobs' range, a mode, a similarity, or a rename or copy. Every file's diff
 * has one, since even a change of mode alone is written as a pair of them.
 */
const EXTENDED_HEADER = /^(?:index [0-9a-f]+\.\.[0-9a-f]+|(?:old|new) mode \d|(?:new|deleted) file mode \d|(?:dis)?similarity index \d|(?:rename|copy) (?:from|to) )/;

/** Whether lines are git's diff: `diff --git`, then a header only git writes there. */
const isGitDiff = lines => lines[0].startsWith("diff --git ") && EXTENDED_HEADER.test(lines[1] ?? "");

function diffAdditions(lines) {
  return lines.filter(line => !/^[ -]/.test(line)).map(line => line.replace(/^\+/, ""));
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
