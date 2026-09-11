#!/usr/bin/env node

/**
 * Documentation and README claims must match what the repository actually ships.
 *
 * The failure this guards against is not carelessness. It is that a fact about the product —
 * "plugins are not ready", "the builder is called X", "this file lives on branch Y" — gets
 * written down in more than one place, and only some of the copies get updated. Every defect
 * this checks for was found in the repository, not imagined: a published package whose README
 * told npm visitors not to use it, nine published packages missing from the root README, four
 * links to a branch that no longer exists, and one product name written three different ways.
 *
 * A SCRIPT rather than a test, matching `check-comment-convention.mjs`: the rule spans docs,
 * package manifests and READMEs, so a test rooted in any one package would read as repository
 * coverage while checking a fraction of it.
 *
 * Usage:
 *   node scripts/check-docs-claims.mjs
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  readFileSync,
  readdirSync,
  existsSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, extname, join, relative, sep } from "node:path";

import { compile } from "@mdx-js/mdx";

import { splitFrontmatter } from "./check-docs-compile.mjs";

/**
 * Files come from git's index, not from a directory walk.
 *
 * A walk reads whatever is on disk, and what is on disk differs per machine: `.internal-docs/`
 * is gitignored and present in some checkouts, so the same commit reported 0 findings in a fresh
 * worktree and 33 in a working clone. Extending an ignore list cannot close that — the next
 * ignored directory reopens it. Tracked-ness is the property that actually distinguishes
 * authored content from whatever a build or a local habit left behind, and it is the same
 * choice `check-comment-convention.mjs` makes for the same reason.
 */
function trackedFiles(repoRoot) {
  try {
    const out = execFileSync("git", ["ls-files", "-z"], {
      cwd: repoRoot,
      encoding: "utf-8",
      maxBuffer: 64 * 1024 * 1024,
    });
    return out.split("\0").filter(Boolean);
  } catch {
    return null;
  }
}

/**
 * Phrases that state a shipped thing is unavailable.
 *
 * A CURATED LIST is the mechanism here, unlike `dead-branch-link` below, which resolves what it
 * checks. There is no way to ask the repository whether a sentence is true, so the list names
 * the specific shapes that have gone stale, and the allowlist carries the ones that are
 * genuinely accurate. That difference is deliberate, not an inconsistency between the checks.
 */
const FORBIDDEN_PHRASES = [
  "coming soon",
  "not ready for use",
  "not yet available",
  "plugins are not ready",
];

/** The whole positioning failure traces to one overloaded word; this is what stops it recurring. */
const BARE_VISUAL_BUILDER = /(?<!schema )(?<!page )\bvisual builder\b/gi;

/**
 * The files that say what Nextly is.
 *
 * The naming rule above stops one word being overloaded. This stops a retired
 * category coming back, which had already happened in three of these six at
 * once, including the prompt this repository's own review agent is given.
 *
 * Every path here is asserted to exist by this script's own tests, so a rename
 * cannot quietly take a surface out of scope while the renamed file goes on
 * stating the category.
 *
 * Named rather than matched by glob, and six files rather than every document.
 * A category is stated in a handful of places and repeated nowhere else, so a
 * wider net would only add ways to be wrong: a tutorial quoting the old name,
 * or a code sample containing the words, are not the project calling itself
 * something. Adding a surface here is a deliberate act, which is the point.
 */
export const CATEGORY_SURFACES = [
  "README.md",
  "AGENTS.md",
  "ARCHITECTURE.md",
  ".github/review-prompt.md",
  "docs/index.mdx",
  "docs/getting-started/index.mdx",
];

/** The file Context7 reads to decide what to index, at the repository root. */
export const CONTEXT7_CONFIG = "context7.json";

/** The package whose description every other statement of the category follows. */
export const CORE_PACKAGE = "nextly";

/** The parsed configuration, or `null` for a file that is absent or not JSON. */
export function readContext7Config(path) {
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return null;
  }
}

const context7Finding = (check, message) => ({
  check,
  file: CONTEXT7_CONFIG,
  line: null,
  message,
});

/**
 * What is wrong with a Context7 configuration, or nothing.
 *
 * The rules are in priority order, and the first that applies is the finding: a file that
 * is not tracked or does not parse says nothing an indexer can use; a description naming
 * the retired category is the claim this whole check exists to stop; a core package with
 * no description leaves nothing to follow; and a description that merely differs from the
 * core package's is the drift that lets the others happen unnoticed. `undefined` is the
 * untracked file, `null` the unreadable one.
 *
 * Last, the exclusions are held to the shapes their readers understand. Context7 matches
 * `excludeFiles` by filename, so an entry that is not one, a path or a pattern, excludes
 * nothing; and the index verifier, `check-context7-index`, reads `excludeFolders` as
 * plain paths, so a pattern there is a rule it could never witness. What is accepted is
 * named rather than what is refused: a list of the metacharacters a pattern may use has
 * no end, and the names in this repository are plain.
 */
const listOf = value =>
  Array.isArray(value) ? value.filter(entry => typeof entry === "string") : [];
/** A filename as Context7 matches one, and as git spells one segment of a path. */
const LITERAL_NAME = /^[A-Za-z0-9._-]+$/;
const isLiteralName = entry =>
  LITERAL_NAME.test(entry) && entry !== "." && entry !== "..";
/** A path as git supplies one: literal names joined by `/`. */
const isLiteralPath = entry => entry.split("/").every(isLiteralName);
const notFilenames = value => listOf(value).filter(entry => !isLiteralName(entry));
const notPaths = value => listOf(value).filter(entry => !isLiteralPath(entry));

const CONTEXT7_RULES = [
  [
    config => config === undefined,
    () =>
      context7Finding(
        "context7-missing",
        "is not tracked; without it an indexer reads the whole repository and guesses what the project is"
      ),
  ],
  [
    config => config === null || typeof config !== "object",
    () => context7Finding("context7-unreadable", "is not a JSON object"),
  ],
  [
    config => typeof config.description !== "string" || config.description.trim() === "",
    () =>
      context7Finding(
        "context7-description",
        "has no description; an indexer falls back to guessing what the project is"
      ),
  ],
  [
    config => RETIRED_CATEGORY.test(config.description),
    () =>
      context7Finding(
        "retired-category",
        `"app framework" — the category is "content platform"; say what this is for`
      ),
  ],
  [
    (_config, core) => typeof core !== "string" || core.trim() === "",
    () =>
      context7Finding(
        "context7-description",
        `packages/${CORE_PACKAGE}/package.json has no description for this to follow; the sentence lives there`
      ),
  ],
  [
    (config, core) => config.description !== core,
    () =>
      context7Finding(
        "context7-description",
        `description differs from packages/${CORE_PACKAGE}/package.json; one sentence says what this is`
      ),
  ],
  [
    config => notFilenames(config.excludeFiles).length > 0,
    config =>
      context7Finding(
        "context7-exclusion",
        `excludeFiles names ${notFilenames(config.excludeFiles).join(", ")}, which is not a filename; Context7 matches the field by filename, so a path or a pattern excludes nothing`
      ),
  ],
  [
    config => notPaths(config.excludeFolders).length > 0,
    config =>
      context7Finding(
        "context7-exclusion",
        `excludeFolders names ${notPaths(config.excludeFolders).join(", ")}, which is not a plain path; check-context7-index reads plain paths, docs/archive, and cannot witness a pattern`
      ),
  ],
];

export function context7Findings(config, coreDescription) {
  const rule = CONTEXT7_RULES.find(([applies]) => applies(config, coreDescription));
  return rule ? rule[1](config) : null;
}

/**
 * The category the project moved away from.
 *
 * A hyphen or whitespace between the words, because the repository has spelled
 * it both ways and a reader sees no difference, and an optional plural, because
 * "one of several app frameworks" is the same claim about the same category.
 */
export const RETIRED_CATEGORY = /\bapp(?:-|\s+)frameworks?\b/i;

/**
 * The same category, as a whole tag rather than a phrase in prose.
 *
 * npm keywords and GitHub topics are both single tokens on a surface people search, and both
 * were left carrying `framework` after the prose was cleared. The word is the one the whole
 * repositioning turned on: it could mean an application framework, a UI framework or a backend
 * framework, which made it the least informative word available.
 *
 * `RETIRED_CATEGORY` cannot serve here — it requires the `app` prefix, so a bare `framework`
 * tag would pass. Anchored rather than substring-matched: `page-builder` and `nextly-plugin`
 * are tags this must never touch.
 */
export const RETIRED_CATEGORY_TAG = /^(?:app-)?frameworks?$/i;

/**
 * The single answer to "does this tag name the retired category", for every tag surface.
 *
 * A tag can carry the category two ways, and one pattern cannot see both: as the whole tag
 * (`framework`), or with the phrase embedded in a longer one (`nextjs-app-framework`). Two
 * checks used to answer this for npm keywords — the prose check matched the phrase, the
 * keyword check matched the whole tag — so a keyword like `app-framework` was reported twice
 * under two names, and their patterns were free to drift apart. This is now the only answer,
 * shared by npm keywords and GitHub topics.
 */
export function namesRetiredCategory(tag) {
  return typeof tag === "string" && (RETIRED_CATEGORY_TAG.test(tag) || RETIRED_CATEGORY.test(tag));
}

/**
 * The keywords npm derives from a manifest, which is not always the keywords it was given.
 *
 * npm accepts a bare string where `keywords` expects an array, and both forms reach the
 * registry. Reading the string form as one value, or spreading it into characters, both
 * answer a different question from the one the npm page shows.
 *
 * The split mirrors `fixKeywordsField` in npm's own `normalize-package-data` (verified
 * against 8.0.0), including its quirk: the separator is a comma followed by whitespace, so
 * `"cms, framework"` is two keywords and `"cms,framework"` stays one. Matching the quirk is
 * the point — the guard has to evaluate what the registry publishes, not a tidier reading of
 * it. Empty and non-string entries are dropped there too.
 */
const NPM_KEYWORD_SEPARATOR = /,\s+/;

export function packageKeywords(manifest) {
  const keywords = manifest?.keywords;
  const list = typeof keywords === "string" ? keywords.split(NPM_KEYWORD_SEPARATOR) : keywords;
  if (!Array.isArray(list)) return [];
  return list.filter(value => typeof value === "string" && value !== "");
}

/**
 * A document reduced to what a reader is shown.
 *
 * `renderedProse` drops fenced examples and commented-out blocks. This drops
 * the rest of what renders as nothing or as the text inside it, so the phrase
 * is judged as it reaches a reader: an MDX import or comment shows nothing, a
 * code span is a name rather than a claim, and a tag, a link or emphasis around
 * one word leaves only its text.
 *
 * The separator entities are decoded, in every spelling of a space and of a
 * hyphen, because the pattern turns on what sits between the two words; an
 * entity anywhere else in a sentence cannot hide the phrase.
 *
 * ESM statements are removed for MDX only, and only unindented, which is where
 * MDX accepts them. Markdown has no imports at all, so there a line beginning
 * "import" is an ordinary sentence, and an indented one under a list item is
 * that item continuing; treating either as a statement blanks real prose.
 *
 * Frontmatter keeps its title and description, which are published as the page's
 * own metadata, and drops the rest. The forms
 * An image's alternative text is read aloud and shown when the image is not,
 * so it comes out of the tag before the tag goes. The forms
 * that carry a line break carry a space with it: a `<br>` and a trailing
 * backslash both separate the words they sit between, so removing them outright
 * would join those words instead. And `<code>` is the HTML spelling of a code
 * span, so it names a literal on the same terms.
 */
function stripEsm(markdown) {
  const kept = [];
  let inStatement = false;
  for (const line of markdown.split("\n")) {
    if (!inStatement && /^(?:import|export)\b/.test(line)) inStatement = true;
    if (!inStatement) {
      kept.push(line);
      continue;
    }
    kept.push("");
    // A statement ends at its semicolon or its quoted module path. A blank line
    // ends it too, so an unterminated one cannot swallow the document.
    if (/(?:;|["'])[ \t]*;?[ \t]*$/.test(line) || line.trim() === "") inStatement = false;
  }
  return kept.join("\n");
}

/**
 * The frontmatter fields a reader is shown.
 *
 * A page's title and description are published: the description is served
 * verbatim as the page's meta description. The rest of the block is machinery
 * nobody meets.
 *
 * A value may be a folded or literal scalar, whose text is on the indented
 * lines beneath the marker rather than beside it, so those are collected too.
 */
/** What a double-quoted YAML scalar's escapes stand for. */
function decodeYamlEscapes(value) {
  return value
    .replace(/\\x([0-9a-fA-F]{2})/g, (_, hex) =>
      String.fromCharCode(Number.parseInt(hex, 16))
    )
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) =>
      String.fromCharCode(Number.parseInt(hex, 16))
    )
    .replace(/\\U([0-9a-fA-F]{8})/g, (_, hex) =>
      String.fromCodePoint(Number.parseInt(hex, 16))
    )
    .replace(/\\([nt])/g, " ");
}

function publishedFrontmatter(block) {
  const lines = block.split(/\r?\n/);
  const published = [];
  for (let index = 0; index < lines.length; index++) {
    const field = lines[index].match(/^(?:title|description):[ \t]*(.*)$/);
    if (field === null) continue;
    // A quoted value ends at its closing quote and an unquoted one at a
    // comment. YAML publishes neither the quotes nor anything after them.
    // A single-quoted scalar is literal apart from a doubled quote. A
    // double-quoted one spells characters as escapes, and YAML publishes what
    // those stand for, so only that form is decoded.
    const single = field[1].match(/^'((?:[^']|'')*)'/);
    const double = single === null ? field[1].match(/^"((?:\\.|[^"])*)"/) : null;
    let inline;
    if (single !== null) inline = single[1].replace(/''/g, "'");
    else if (double !== null) inline = decodeYamlEscapes(double[1]);
    else inline = field[1].replace(/(?:^|[ \t])#.*$/, "");
    const value = [inline.replace(/^[>|][-+]?[ \t]*$/, "")];
    // A block scalar runs over the indented lines beneath it, and a blank line
    // inside one is a paragraph break rather than its end, so the scan runs to
    // the last indented line instead of stopping at the first gap.
    let last = index;
    for (let probe = index + 1; probe < lines.length; probe++) {
      if (/^[ \t]+\S/.test(lines[probe])) last = probe;
      else if (lines[probe].trim() !== "") break;
    }
    for (let line = index + 1; line <= last; line++) value.push(lines[line].trim());
    index = last;
    published.push(value.join(" ").trim());
  }
  return published.length === 0 ? "" : `${published.join("\n\n")}\n\n`;
}

/**
 * The strings a component tag puts on the page.
 *
 * A list passed in a braces expression is data the component renders, and an
 * attribute named for a caption holds one. Everything else in a tag is
 * configuration, and reading it would fail on a class or a path that happens to
 * carry the words.
 */
const CAPTION_PROPS =
  /^(?:title|label|labels|caption|captions|heading|headings|summary|placeholder|items|options|tabs)$/;

function componentCaptions(tag) {
  const captions = [];
  for (const [, name, list] of tag.matchAll(
    /\b([a-zA-Z]+)=\{\s*(\[[^\]]*\])\s*\}/g
  )) {
    if (CAPTION_PROPS.test(name)) captions.push(...(list.match(/"[^"\n]*"|'[^'\n]*'/g) ?? []));
  }
  for (const [, name, text] of tag.matchAll(
    /\b([a-zA-Z]+)=("[^"\n]*"|'[^'\n]*')/g
  )) {
    if (CAPTION_PROPS.test(name)) captions.push(text);
  }
  return captions.map(text => text.slice(1, -1)).join(" ");
}

function readableProse(markdown, { mdx }) {
  // A diagram fence is drawn rather than printed, so its labels are read while
  // the syntax around them is not. Pulled out before `renderedProse` drops the
  // fence with every other one.
  const drawn = markdown.replace(
    /^ {0,3}```mermaid\b[\s\S]*?^ {0,3}```[ \t]*$/gm,
    fence =>
      // A `click` binds a node to an address and may carry a tooltip. The
      // address is not drawn and the tooltip is, and which comes first depends
      // on the form, so the addresses go rather than the first string: the
      // callback form has a tooltip and no address at all.
      (fence
        .replace(/^[ \t]*click\b[^\n]*$/gm, directive =>
          (directive.match(/"[^"\n]*"|'[^'\n]*'/g) ?? [])
            .filter(text => !/^["'](?:[a-z][a-z0-9+.-]*:|[./#])/i.test(text))
            .join(" ")
        )
        .match(/"[^"\n]*"|'[^'\n]*'|\[[^\]\n]*\]|\([^)\n]*\)|\|[^|\n]*\||\{[^}\n]*\}/g) ?? [])
        .map(label => label.slice(1, -1))
        .join("\n\n")
  );
  const prose = renderedProse(drawn).replace(
    /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/,
    (_, block) => publishedFrontmatter(block)
  );
  return (mdx ? stripEsm(prose) : prose)
    .replace(/&(?:nbsp|ensp|emsp|thinsp|#0*32|#0*160|#x0*20|#x0*a0);/gi, " ")
    .replace(/&(?:hyphen|dash|#0*45|#x0*2d);/gi, "-")
    .replace(/<code[^>]*>[\s\S]*?<\/code>/gi, " ")
    .replace(
      /<img\b[^>]*?\balt=(?:"([^"]*)"|'([^']*)')[^>]*>/gi,
      (_, quoted, single) => ` ${quoted ?? single} `
    )
    // A component is given its captions as props, so those strings are drawn
    // even though the tag is not. Only the props that carry text: a list passed
    // as data, and the attributes whose names say they hold a caption. A
    // `className` or an `href` is configuration and naming a stylesheet class
    // after the old category is not the project claiming it.
    .replace(/<[A-Z][A-Za-z0-9]*\b[^>]*>/g, (tag, offset, whole) => {
      // A component opening its own line opens a block, so its captions start a
      // paragraph rather than joining the sentence above them.
      const opensLine = offset === 0 || /\n[ \t]*$/.test(whole.slice(0, offset));
      return `${opensLine ? "\n\n" : " "}${componentCaptions(tag)} `;
    })
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/^ {0,3}\[[^\]\n]+\]:[ \t]*\S[^\n]*$/gm, " ")
    .replace(/\\\n/g, " ")
    .replace(/\\([-!"#$%&'()*+,./:;<=>?@[\]^_`{|}~])/g, "$1")
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, " ")
    .replace(/(`+)[\s\S]*?\1/g, " ")
    .replace(/<[^>]+>/g, (tag, offset, whole) =>
      // Same rule as a component: a tag opening its own line opens a block, so
      // what follows is not a continuation of the sentence above it. An inline
      // tag is only punctuation and leaves the sentence intact.
      offset === 0 || /\n[ \t]*$/.test(whole.slice(0, offset)) ? "\n\n" : ""
    )
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\[[^\]]*\]/g, "$1")
    .replace(/[*_]/g, "");
}

/**
 * Split where a quotation begins.
 *
 * A quotation and the paragraph above it are two blocks even with no blank line
 * between them, and the marker is stripped before the lines are joined, so
 * without this the two would read as one sentence. The other direction is only
 * a boundary when the line beneath opens a block: plain text there continues
 * the quotation, a tag or a table row does not.
 */
function splitOnQuoteBoundary(block) {
  const blocks = [];
  let current = [];
  let quoted = null;
  for (const line of block.split("\n")) {
    const isQuoted = /^\s*>/.test(line);
    // Entering a quotation is a boundary. Leaving one is only a boundary when
    // the line beneath opens a block of its own: ordinary text there is a lazy
    // continuation of the same paragraph, but a tag or a table row is not, and
    // a blank line has already closed the block by the time this runs.
    const opensBlock = /^\s*[<|]/.test(line);
    const entering = quoted === false && isQuoted;
    const leaving = quoted === true && !isQuoted && opensBlock;
    if ((entering || leaving) && current.length > 0) {
      blocks.push(current.join("\n"));
      current = [];
    }
    current.push(line);
    quoted = isQuoted;
  }
  if (current.length > 0) blocks.push(current.join("\n"));
  return blocks;
}

/**
 * The paragraphs a document renders, each on one line.
 *
 * These files are hand-wrapped, so a sentence is regularly split across source
 * lines and a per-line search would miss the phrase whenever a wrap fell inside
 * it. A blank line ends a paragraph, a list item starts its own and a heading is
 * one line by definition, so closing up the wraps cannot run two separate
 * statements together. A quote marker repeats on every line of a quotation, so
 * it comes off before the lines are joined rather than landing between them.
 */
function proseParagraphs(markdown, { mdx }) {
  return readableProse(markdown, { mdx })
    .split(/\n\s*\n/)
    .flatMap(block => block.split(/\n(?=\s*(?:[-*+]|\d+[.)])\s)/))
    .flatMap(block => block.split(/\n(?=\s*#{1,6}\s)/))
    .flatMap(block => {
      const heading = block.match(/^(\s*#{1,6}\s[^\n]*)\n([\s\S]+)$/);
      return heading ? [heading[1], heading[2]] : [block];
    })
    .flatMap(splitOnQuoteBoundary)
    .map(paragraph =>
      paragraph
        .replace(/^[ \t]*>+[ \t]?/gm, "")
        .replace(/\s+/g, " ")
        .trim()
    )
    .filter(Boolean);
}

/**
 * Captures everything after `blob|tree|raw`, because the ref is not one segment. A branch may
 * contain slashes (`feature/docs-refresh`), and git accepts it: `git check-ref-format --branch
 * feature/docs-refresh` exits 0. Splitting on the first slash would read the ref as `feature`
 * and report a live branch as dead, which is the failure mode this whole check exists to avoid.
 */
const REPO_LINK = /github\.com\/nextlyhq\/nextly\/(?:blob|tree|raw)\/([^\s)\]"'`]+)/g;

const HEX_REF = /^[0-9a-f]{7,40}$/i;

/** The syntax-tree nodes that carry a destination: a link, an image, a reference definition. */
const DESTINATION_NODES = new Set(["link", "image", "definition"]);

/**
 * The JSX a page may write a destination into: an `<img>` is an image and an `<a>` a link,
 * each by the attribute that carries it. Only a literal string is read; an expression is a
 * value the page computes, which a scan of the source cannot know.
 */
const JSX_DESTINATIONS = { img: ["src", "image"], a: ["href", "link"] };
const JSX_NODES = new Set(["mdxJsxFlowElement", "mdxJsxTextElement"]);

/** The destination a JSX element carries, as `{ url, type }`, or `null`. */
function jsxDestination(node) {
  if (!JSX_NODES.has(node.type) || !(node.name in JSX_DESTINATIONS)) return null;
  const [attribute, type] = JSX_DESTINATIONS[node.name];
  const found = (node.attributes ?? []).find(
    candidate => candidate.type === "mdxJsxAttribute" && candidate.name === attribute
  );
  return typeof found?.value === "string" ? { url: found.value, type } : null;
}

function hasDestination(node) {
  return DESTINATION_NODES.has(node.type) || jsxDestination(node) !== null;
}

/**
 * What a destination is, for the wording and the rule it is held to.
 *
 * A definition carries no kind of its own: `[pic]: diagram.png` is an image when
 * `![d][pic]` uses it and a link when `[d][pic]` does. Read as an image whenever an
 * image reference uses it, since that is the reading under which a relative
 * destination is broken.
 */
function destinationKind(node, imageIds) {
  if (node.type === "definition" && imageIds.has(node.identifier)) return "image";
  return node.type;
}

/** The identifiers every image reference in a tree uses. */
function imageReferenceIds(nodes) {
  return new Set(
    nodes.filter(node => node.type === "imageReference").map(node => node.identifier)
  );
}

/** Every node under one, itself included, in document order. */
function nodesOf(node) {
  return [node, ...(node.children ?? []).flatMap(nodesOf)];
}

/**
 * Every destination a file holds, read off its syntax tree, with the node that holds it.
 *
 * Read off the tree rather than matched in the text, because the text has no end of
 * spellings: `[x](../y.mdx "title")`, `[x](<../y.mdx>)`, a bare `[x](y.mdx)`, and a
 * reference definition `[x]: ../y.mdx` are four the patterns this replaced had learned one
 * at a time, and a fenced sample, an inline code span and an MDX comment were three places
 * the same patterns had to be taught not to look. A `link` node is a rendered link and a
 * `code` node is not, by construction. An `image` is a destination too: the patterns saw
 * `![d](./x.png)` only because it shares `](` with a link, and the tree names it outright.
 * So is an `<img src>` or an `<a href>` written as JSX, which compiles and renders
 * whatever its attribute says; a literal one is read, an expression is left to the page.
 *
 * Frontmatter is taken off first, the way the site's loader takes it off, or the compiler
 * would read the YAML as Markdown. A block that is not YAML is left in and read as
 * Markdown instead, a rule and a paragraph, so the links after it are still read: the
 * compile check reports a docs page's frontmatter, but a README is not a docs page and
 * this is the only check that reads its links. A page the compiler cannot parse yields no
 * destinations; the compile check reports that one.
 */
async function linkDestinations(text, mdx) {
  const links = [];
  const collect = skipped => () => tree => {
    const nodes = nodesOf(tree);
    const imageIds = imageReferenceIds(nodes);
    for (const node of nodes.filter(hasDestination)) {
      const jsx = jsxDestination(node);
      links.push({
        url: jsx ? jsx.url : node.url,
        type: jsx ? jsx.type : destinationKind(node, imageIds),
        line: (node.position?.start.line ?? 0) + skipped,
      });
    }
  };
  const { body, skipped } = frontmatterOrMarkdown(text);
  try {
    await compile(body, { format: mdx ? "mdx" : "md", remarkPlugins: [collect(skipped)] });
  } catch {
    return [];
  }
  return links;
}

/** The text with its frontmatter taken off, or the whole text when the block is not YAML. */
function frontmatterOrMarkdown(text) {
  try {
    return splitFrontmatter(text);
  } catch {
    return { body: text, skipped: 0 };
  }
}

/**
 * How a finding names a destination, by the node that carries it: what the page does with
 * it, and what the site needs instead. A page is linked by its URL and source by its
 * GitHub URL; an image has nothing served beside the page, so any relative one is a path.
 */
const DESTINATION_WORDING = {
  link: {
    verb: "links to",
    remedy: "a page is linked by its URL, /docs/..., and source by its GitHub URL",
    relativeIsPath: url => /^\.\.?\//.test(url) || /\.mdx?(?:[#?]|$)/i.test(url),
    // A docs URL is right when a page answers there.
    docsUrlFinding: resolves => (resolves ? null : "which is not a docs page"),
    // Nothing under /docs is an image, whatever answers there.
  },
  image: {
    verb: "embeds",
    remedy: "the site serves no file beside a page, so an image is embedded by its URL",
    relativeIsPath: () => true,
    docsUrlFinding: () => "which is where pages are served, not files",
  },
};

/** The wording for a destination's node; a definition reads as the link it defines. */
function wordingFor(type) {
  return DESTINATION_WORDING[type] ?? DESTINATION_WORDING.link;
}

/** A destination written as a path from the file rather than as a URL. */
function isFilePath(url, type) {
  if (/^(?:[a-z][a-z0-9+.-]*:|\/|#)/i.test(url)) return false;
  return wordingFor(type).relativeIsPath(url);
}

/**
 * Split a link's tail into the ref and the path under it.
 *
 * The ref boundary is not derivable from the string, so it is resolved against the refs the
 * remote actually has: the longest leading run of segments that names a real ref wins. A ref
 * shaped like a commit is handed back for object lookup instead.
 */
export function splitRefAndPath(tail, remoteRefs) {
  const segments = tail.split("/").filter(Boolean);
  if (segments.length === 0) return null;

  if (remoteRefs) {
    for (let take = Math.min(segments.length, 8); take >= 1; take--) {
      const candidate = segments.slice(0, take).join("/");
      if (remoteRefs.has(candidate)) {
        return { ref: candidate, resolved: true };
      }
    }
  }
  // Nothing matched. A single segment shaped like a commit is a pinned link, judged separately;
  // otherwise report the longest plausible ref rather than the first segment, so the message
  // names what was actually looked for.
  return { ref: segments[0], resolved: false };
}

/** Files whose prose is a claim about the product. CHANGELOGs are excluded everywhere: they are
 *  Changesets' historical record, and rewriting history to satisfy a lint is worse than the lint. */
function proseFiles(tracked) {
  return tracked.filter(rel => {
    if (basename(rel) === "CHANGELOG.md") return false;
    const ext = extname(rel);
    if (ext === ".md" || ext === ".mdx") return true;
    return (
      (ext === ".ts" || ext === ".tsx" || ext === ".mjs") && rel.split("/")[0] === "packages"
    );
  });
}

/**
 * A manifest that will not parse is reported rather than skipped. Skipping drops the package
 * from every other check here, so a syntax error would quietly buy an exemption from all of
 * them — the check would go green precisely because something was broken.
 */
function publishedPackages(repoRoot, findings) {
  const pkgDir = join(repoRoot, "packages");
  if (!existsSync(pkgDir)) return [];
  const out = [];
  for (const name of readdirSync(pkgDir)) {
    const manifest = join(pkgDir, name, "package.json");
    if (!existsSync(manifest)) continue;
    let json;
    try {
      json = JSON.parse(readFileSync(manifest, "utf-8"));
    } catch (error) {
      findings.push({
        check: "unreadable-manifest",
        file: relative(repoRoot, manifest),
        line: null,
        message: `cannot be parsed, so this package is invisible to every other check: ${error.message}`,
      });
      continue;
    }
    if (json.private) continue;
    out.push({ name: json.name, dir: join(pkgDir, name), json });
  }
  return out;
}

/**
 * Every ref the remote has, read in one call.
 *
 * `git ls-remote` rather than `rev-parse`, because CI clones shallow: a ref that exists is
 * absent from a depth-1 local clone, and a check that goes red on a correct tree teaches people
 * to wave reds through. One call rather than one per link, because the longest-prefix match in
 * `splitRefAndPath` needs the whole set to decide where a ref ends.
 *
 * Returns null — not an empty set — when the remote cannot be reached, so "I could not tell"
 * never masquerades as "it does not exist".
 */
function listRemoteRefs(repoRoot) {
  try {
    const out = execFileSync("git", ["ls-remote", "--heads", "--tags", "origin"], {
      cwd: repoRoot,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const refs = new Set();
    for (const line of out.split("\n")) {
      const name = line.split("\t")[1];
      if (!name) continue;
      refs.add(name.replace(/^refs\/(heads|tags)\//, "").replace(/\^\{\}$/, ""));
    }
    return refs.size > 0 ? refs : null;
  } catch {
    return null;
  }
}

/**
 * Whether a commit-shaped ref names an object this clone holds.
 *
 * A shallow clone genuinely cannot answer this, and `ls-remote` cannot be asked about an
 * arbitrary sha. So a miss is reported as unverifiable rather than dead: the alternative,
 * accepting every hex string, made pinned links a blind spot in the one check meant to cover
 * them.
 */
function makeCommitProbe(repoRoot) {
  const cache = new Map();
  return sha => {
    if (cache.has(sha)) return cache.get(sha);
    let present;
    try {
      execFileSync("git", ["cat-file", "-e", `${sha}^{commit}`], {
        cwd: repoRoot,
        stdio: ["ignore", "ignore", "ignore"],
      });
      present = true;
    } catch {
      present = false;
    }
    cache.set(sha, present);
    return present;
  };
}

/** Matches `digestOffences` in check-comment-convention.mjs so the two allowlists read alike. */
export function digestLine(line) {
  return createHash("sha256")
    .update(line.trim().replace(/\s+/g, " "))
    .digest("hex")
    .slice(0, 16);
}

/** A page is reachable when its own directory's meta.json lists it. A directory with no
 *  meta.json is auto-included by fumadocs, so nothing there can be orphaned. */
function metaReachability(repoRoot, tracked, findings) {
  // Navigation files are consulted only when git tracks them, for the same reason the file list
  // comes from the index: an untracked meta.json sitting in a working tree would satisfy the
  // reachability check locally and be absent from the clone that builds the site.
  const trackedMeta = new Set(
    tracked.filter(rel => basename(rel) === "meta.json").map(rel => join(repoRoot, rel))
  );
  const byDir = new Map();
  for (const rel of tracked) {
    if (extname(rel) !== ".mdx") continue;
    if (rel.split("/")[0] !== "docs") continue;
    const dir = dirname(join(repoRoot, rel));
    if (!byDir.has(dir)) byDir.set(dir, []);
    byDir.get(dir).push(join(repoRoot, rel));
  }
  for (const [dir, files] of byDir) {
    const metaPath = join(dir, "meta.json");
    if (!trackedMeta.has(metaPath)) continue;
    let pages;
    try {
      pages = JSON.parse(readFileSync(metaPath, "utf-8")).pages ?? [];
    } catch (error) {
      // Unreadable navigation metadata is a deploy failure waiting to happen: the docs site
      // parses this file to build its sidebar. Skipping it would report success on a tree that
      // cannot render.
      findings.push({
        check: "unreadable-meta",
        file: relative(repoRoot, metaPath),
        line: null,
        message: `cannot be parsed, so the docs navigation cannot be built: ${error.message}`,
      });
      continue;
    }
    const listed = new Set(pages.map(p => String(p).replace(/^\.\//, "")));
    for (const file of files) {
      const slug = basename(file, ".mdx");
      if (!listed.has(slug)) {
        findings.push({
          check: "meta-reachable",
          file: relative(repoRoot, file),
          line: null,
          message: `not listed in ${relative(repoRoot, metaPath)}; nextly-site's build fails on an unreachable page`,
        });
      }
    }
  }
}

/**
 * Every `/docs/...` link resolves to a page that exists.
 *
 * Cross-links are how a reader moves between capabilities, and a moved or renamed page
 * breaks them silently: the build still succeeds and the sidebar still renders, so nothing
 * reports it until a reader hits a 404. The set of pages is derived from the same tracked
 * list everything else here reads, so a link to a page that exists only locally fails too.
 */
/**
 * Where a plugin route actually answers, checked against the scaffold rather
 * than against a convention someone remembered.
 *
 * 🔴 Four documentation pages named `/api/plugins/<name>` because a comment in
 * `route-path.ts` called that the convention. The base template mounts the
 * dynamic handler under `/admin/api`, and `/api` carries only `health` and
 * `media` with no catch-all, so every one of those URLs answers 404 in a
 * generated project. It is the first thing a plugin author hits.
 *
 * Everything this compares against is DERIVED on each run: the namespace
 * segment from its one declaration, and the mount from BOTH places that decide
 * it, since `create-nextly-app` scaffolds into an empty project from the
 * template and into an existing one from its own generator. Two sources that
 * disagree mean the docs cannot state one answer, so this refuses instead of
 * picking a side.
 *
 * Comments in published source are read too. The wrong claim started in a
 * `@public` JSDoc, so a guard that watched only Markdown would leave the
 * original mistake free to come back and take the pages with it. Code is
 * blanked first: integration tests address the dispatcher directly at an
 * arbitrary prefix, which is theirs to choose and not a claim about anything.
 */
const NAMESPACE_DECLARATION =
  /export const PLUGIN_NAMESPACE_SEGMENT\s*=\s*"([^"]+)"/;
const NAMESPACE_SOURCE = "packages/nextly/src/plugins/routes/route-path.ts";
const TEMPLATE_APP_DIR = "templates/base/src/app/";
const TEMPLATE_CATCH_ALL = "/[[...params]]/route.ts";
const GENERATOR_SOURCE = "packages/create-nextly-app/src/generators/routes.ts";
const GENERATOR_MOUNT =
  /path\.join\(\s*cwd,\s*projectInfo\.appDir,\s*((?:"[^"]*",\s*)+)"\[\[\.\.\.params\]\]"/;
const QUOTED_SEGMENT = /"([^"]*)"/g;

/** The mount the base template hard-codes by where its route file sits. */
function templateMount(repoRoot, tracked, refuse) {
  const candidates = tracked
    .filter(
      rel => rel.startsWith(TEMPLATE_APP_DIR) && rel.endsWith(TEMPLATE_CATCH_ALL)
    )
    .filter(rel => {
      try {
        return /createDynamicHandlers/.test(
          readFileSync(join(repoRoot, rel), "utf-8")
        );
      } catch {
        return false;
      }
    });
  if (candidates.length !== 1) {
    refuse(
      TEMPLATE_APP_DIR,
      `expected exactly one scaffolded createDynamicHandlers route to read the mount from, found ${String(candidates.length)}`
    );
    return null;
  }
  return `/${candidates[0].slice(
    TEMPLATE_APP_DIR.length,
    candidates[0].length - TEMPLATE_CATCH_ALL.length
  )}`;
}

/** The mount the generator builds when scaffolding into an existing project. */
function generatorMount(repoRoot, refuse) {
  let source;
  try {
    source = readFileSync(join(repoRoot, GENERATOR_SOURCE), "utf-8");
  } catch {
    refuse(GENERATOR_SOURCE, "could not be read, so the mount it generates is unknown");
    return null;
  }
  const declared = GENERATOR_MOUNT.exec(source);
  if (declared === null) {
    refuse(
      GENERATOR_SOURCE,
      "no longer builds the catch-all route path in the shape this reads, so the mount it generates is unknown"
    );
    return null;
  }
  const segments = [...declared[1].matchAll(QUOTED_SEGMENT)].map(m => m[1]);
  if (segments.length === 0) {
    refuse(GENERATOR_SOURCE, "builds a catch-all route path with no leading segments");
    return null;
  }
  return `/${segments.join("/")}`;
}

function pluginRouteMount(repoRoot, tracked, findings, isExempt) {
  const refuse = (file, message) => {
    findings.push({
      check: "plugin-route-mount-unreadable",
      file,
      line: null,
      message,
    });
  };

  // Fails closed on every input. Checking the docs against a mount this could
  // not establish would report "no findings" for a question it never asked.
  const fromTemplate = templateMount(repoRoot, tracked, refuse);
  const fromGenerator = generatorMount(repoRoot, refuse);
  if (fromTemplate === null || fromGenerator === null) return;
  if (fromTemplate !== fromGenerator) {
    refuse(
      GENERATOR_SOURCE,
      `generates ${fromGenerator} while the template mounts at ${fromTemplate}; a scaffolded project's plugin routes would answer at two different addresses, so the docs cannot name one`
    );
    return;
  }

  let namespace;
  try {
    const declared = NAMESPACE_DECLARATION.exec(
      readFileSync(join(repoRoot, NAMESPACE_SOURCE), "utf-8")
    );
    if (declared === null) {
      refuse(
        NAMESPACE_SOURCE,
        "PLUGIN_NAMESPACE_SEGMENT is not declared where this check reads it"
      );
      return;
    }
    namespace = declared[1];
  } catch {
    refuse(
      NAMESPACE_SOURCE,
      "could not be read, so the documented plugin route path has nothing to be checked against"
    );
    return;
  }

  const mount = fromTemplate;
  const expected = `${mount}/${namespace}/`;
  // Built from the two derived values, so renaming either reports the pages
  // that now disagree rather than quietly matching nothing.
  const tail = mount.slice(mount.lastIndexOf("/") + 1);
  const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const mountedPath = new RegExp(
    `((?:\\/[A-Za-z0-9_-]+)*\\/${escape(tail)})\\/${escape(namespace)}\\/`,
    "g"
  );

  // Counted, because everything above is a search for a WRONG shape and a
  // search finds nothing in two different situations. Renaming the namespace
  // makes every correct reference stop matching and every stale one invisible,
  // so the run goes green by having asked about nothing at all. At least one
  // reference has to be found saying the right thing.
  let correct = 0;

  const isDoc = rel =>
    (rel.startsWith("docs/") || rel.endsWith("/README.md")) &&
    (rel.endsWith(".mdx") || rel.endsWith(".md")) &&
    basename(rel) !== "CHANGELOG.md";
  const isSource = rel =>
    rel.startsWith("packages/") &&
    /\.(ts|tsx|mjs)$/.test(rel) &&
    !rel.includes("/dist/");

  for (const rel of tracked) {
    const doc = isDoc(rel);
    if (!doc && !isSource(rel)) continue;
    let text;
    try {
      text = readFileSync(join(repoRoot, rel), "utf-8");
    } catch {
      continue;
    }
    // Source is read as its comments alone. A test that calls the dispatcher at
    // some prefix of its own is not claiming anything about where a route
    // answers, and `sourceComments` keeps the line numbers a reader needs.
    const lines = (doc ? text : sourceComments(text)).split("\n");
    for (let i = 0; i < lines.length; i++) {
      mountedPath.lastIndex = 0;
      let match;
      while ((match = mountedPath.exec(lines[i])) !== null) {
        const found = `${match[1]}/${namespace}/`;
        if (found === expected) {
          correct += 1;
          continue;
        }
        // A page teaching that the OLD address 404s has to be able to write it
        // down. That is one line of prose rather than a pattern this can
        // recognise, so it goes through the same per-line allowlist every other
        // deliberate exception here uses.
        if (isExempt(rel, lines[i])) continue;
        findings.push({
          check: "plugin-route-mount",
          file: rel,
          line: i + 1,
          message: `names a plugin route at ${found}, but the handler is mounted at ${mount}, so it answers at ${expected}`,
        });
      }
    }
  }

  if (correct === 0) {
    refuse(
      NAMESPACE_SOURCE,
      `nothing documents a plugin route at ${expected}, so this check compared the docs against a shape none of them use. Either the namespace or the mount moved and every reference is now stale, or the pages that named one are gone`
    );
  }
}

async function internalLinks(repoRoot, tracked, findings) {
  // The published pages are the docs tree, not every `.mdx` git tracks: a
  // package's README.mdx has GitHub as its surface and its own link rules.
  const pages = new Set(tracked.filter(rel => rel.startsWith("docs/") && rel.endsWith(".mdx")));
  const resolves = target => {
    const path = target.split("#")[0].replace(/\/+$/, "");
    if (path === "/docs") return true;
    const rel = `docs${path.slice("/docs".length)}`;
    return pages.has(`${rel}.mdx`) || pages.has(`${rel}/index.mdx`);
  };

  for (const rel of tracked) {
    if (!rel.endsWith(".mdx") && !rel.endsWith(".md")) continue;
    if (basename(rel) === "CHANGELOG.md") continue;
    let text;
    try {
      text = readFileSync(join(repoRoot, rel), "utf-8");
    } catch {
      continue;
    }
    for (const { url, type, line } of await linkDestinations(text, rel.endsWith(".mdx"))) {
      const { verb, remedy, docsUrlFinding } = wordingFor(type);
      const docsUrl = url.startsWith("/docs/") ? docsUrlFinding(resolves(url)) : null;
      if (docsUrl) {
        findings.push({
          check: "internal-docs-link",
          file: rel,
          line,
          message: `${verb} ${url}, ${docsUrl}`,
        });
      }
      // Only a published page: a README linking `./CONTRIBUTING.md` is a link GitHub renders.
      if (pages.has(rel) && isFilePath(url, type)) {
        findings.push({
          check: "internal-docs-link",
          file: rel,
          line,
          message: `${verb} ${url} as a file path; ${remedy}`,
        });
      }
    }
  }
}

/**
 * Every published README carries the same four load-bearing sections.
 *
 * These are long-form by decision, which means the same facts are restated in twenty files —
 * and a restated fact is one that can go stale in nineteen of them. The four checked here are
 * the ones whose absence is visible on npm and whose presence cannot be inferred: what state
 * the package is in, how to install it, what it relates to, and its licence. Depth below them
 * stays a human judgement and is not checked.
 *
 * Headings are matched loosely because the house style is not uniform — `Install`,
 * `Installation`, `Quickstart` and `Usage` all answer the same question, and `See also` is
 * `Related packages` under another name. Enforcing one spelling would be a rename, not a check.
 */
const README_SECTIONS = [
  {
    key: "status",
    label: "an alpha or stability note, or a Status/Stability section",
    // Either a note in prose OR a section carrying one. Matching only the phrase
    // "in alpha" rejected `## Stability` / "Alpha." — a correct statement several
    // packages already used — and would go on to reject an accurate "Beta" or
    // "Stable" note later, which turns the check into a demand for boilerplate.
    // The section alternative requires a NON-EMPTY body: an empty `## Status` answers
    // nothing, and accepting the heading alone would let the check be satisfied by a
    // section that exists rather than by a state that is stated.
    test: /in alpha|@?experimental|^##[ \t]+(status|stability)[ \t]*\r?\n(?:[ \t]*\r?\n)*[ \t]*(?!#)\S/im,
  },
  {
    key: "install",
    label: "an Install, Installation, Quickstart or Usage section",
    test: /^##\s+(install|installation|quick\s*start|usage)/im,
  },
  {
    key: "related",
    label: "a Related packages or See also section",
    test: /^##\s+(related packages|see also)/im,
  },
  { key: "license", label: "a License section", test: /^##\s+licen[sc]e/im },
];

/**
 * Drop what npm will not render as prose before looking for these sections.
 *
 * A fenced example showing a README skeleton, or a commented-out block, contains the
 * very headings this checks for — so testing the raw source would pass a package
 * whose only `## Install` is inside a code sample. The check would then be satisfied
 * by the appearance of the thing rather than the thing.
 */
export function renderedProse(markdown) {
  return (
    markdown
      // Comments first. A fence marker inside a comment is not a fence, and running
      // the fence rules first let `<!--\n```\n-->` swallow the rest of the file —
      // reporting real sections after it as missing, which is a red on a correct
      // README and the worst direction for this check to fail in.
      .replace(/<!--[\s\S]*?-->/g, "")
      // Then paired fences, then an unpaired one. An opening fence with no closing
      // fence renders as code all the way to the end of the file, so stopping at
      // paired blocks would leave that tail in `prose` and let a truncated example
      // satisfy the very sections this is checking for.
      .replace(/^ {0,3}(`{3,}|~{3,})[\s\S]*?^ {0,3}\1[^\n]*$/gm, "")
      .replace(/^ {0,3}(`{3,}|~{3,})[\s\S]*$/m, "")
  );
}

function retiredKeywords(repoRoot, packages, findings) {
  for (const pkg of packages) {
    for (const keyword of packageKeywords(pkg.json)) {
      if (!namesRetiredCategory(keyword)) continue;
      findings.push({
        check: "retired-category-keyword",
        file: relative(repoRoot, join(pkg.dir, "package.json")),
        line: null,
        message: `${pkg.name} publishes the keyword "${keyword}", which names the retired category`,
      });
    }
  }
}

/** Where the API key prefix is declared. One file, so a moved declaration is a refusal. */
const KEY_PREFIX_SOURCE = "packages/nextly/src/domains/auth/services/api-key-service.ts";

/**
 * The declaration itself, anchored so prose cannot stand in for it.
 *
 * `^[ \t]*(?:export )?const` is the load-bearing part. Matching the name anywhere in the file
 * would accept `// const KEY_PREFIX = "nx_live_"` left behind for context after the live
 * constant was renamed, and the check would then hold the docs to a value the service no longer
 * issues while reporting clean.
 */
const KEY_PREFIX_DECLARATION = /^[ \t]*(?:export[ \t]+)?const[ \t]+KEY_PREFIX[ \t]*=[ \t]*"([^"]+)"/gm;

/**
 * A bearer example naming a concrete key rather than a placeholder.
 *
 * `Bearer <key>` and `Bearer <token>` never reach here, since the leading `[A-Za-z]` cannot
 * match `<`. Symbolic placeholders can, and `isPlaceholder` decides those.
 *
 * The separator allows AT MOST ONE line break, so an example wrapped after the scheme is still
 * one example while `Bearer` ending a paragraph is not joined to an underscored word opening
 * the next. Markdown renders a single break as a space and a blank line as a boundary, and this
 * is where that distinction has to be drawn.
 *
 * The SCHEME is matched case-insensitively because RFC 7235 makes it so: `bearer` is a valid
 * HTTP request. The CREDENTIAL is compared case-sensitively, and the two are not the same
 * decision. A key is authenticated by `sha256` of the whole string, so `NX_LIVE_...` hashes to
 * something else and can never match a stored key. Documentation showing it teaches a header
 * that cannot work, which is exactly what this check is for, so it is reported rather than
 * excused.
 */
const BEARER_EXAMPLE =
  /Bearer(?:[ \t]+|[ \t]*\r?\n[ \t]*)([A-Za-z][A-Za-z0-9_-]*)/gi;

/**
 * Whether a bearer token is a credential rather than the word "token".
 *
 * The pattern deliberately matches any word after the scheme, because requiring an underscore
 * missed `Bearer sk-live-EXAMPLE` and `Bearer abc123`: both are concrete headers a reader would
 * copy and neither can authenticate. Deciding here rather than in the pattern keeps the two
 * questions apart, since "what follows Bearer" and "is that a key" have different answers.
 *
 * A separator or a digit is what tells them apart in running prose, which says "send a Bearer
 * token" and "a Bearer header was present", and those words carry neither.
 *
 * A header written out in full needs no such guess. `Authorization: Bearer abcdef` is a line a
 * reader copies, and it cannot authenticate whatever its shape, so the scheme having been
 * spelled with its header name is enough on its own.
 */
const EXPLICIT_HEADER = /Authorization:[ \t]*$/i;

function isCredential(token, explicitHeader) {
  return explicitHeader || /[_-]/.test(token) || /[0-9]/.test(token);
}

/**
 * Whether a token is a placeholder a reader substitutes rather than a key the docs claim to
 * issue.
 *
 * `Bearer YOUR_API_KEY` is an instruction, not a format, and reporting it would have the
 * always-run docs job block a correct page.
 *
 * Recognised by its WORDS rather than by being capitals. Reading every uppercase token as a
 * placeholder excuses any retired prefix spelled in caps: `SK_LIVE_EXAMPLE` would be waved
 * through while the docs taught a header that cannot authenticate. Every segment has to be a
 * word documentation uses to mean "replace me", so `YOUR_API_KEY` qualifies and `SK_LIVE_` does
 * not, because `SK` and `LIVE` name a vendor and an environment.
 *
 * That also keeps `NX_LIVE_...` reported. It is a mis-cased key, and a key is authenticated by
 * `sha256` of the whole string, so that header cannot work; excusing it would make this check
 * tolerate the one defect it exists to catch.
 */
const PLACEHOLDER_WORDS = new Set([
  "YOUR",
  "MY",
  "THE",
  "A",
  "AN",
  "API",
  "KEY",
  "KEYS",
  "TOKEN",
  "SECRET",
  "VALUE",
  "PLACEHOLDER",
  "EXAMPLE",
  "HERE",
  "REPLACE",
  "INSERT",
  "PASTE",
  "XXX",
  "XXXX",
  "ABC",
  "TODO",
]);

function isPlaceholder(token) {
  if (/[a-z]/.test(token)) return false;
  return token.split(/[-_]/).every(word => PLACEHOLDER_WORDS.has(word));
}

/** Tests and fixtures, whose bearer headers are for other services and prove nothing here. */
const TEST_FILE = /(?:^|\/)__tests__\/|\.(?:test|spec)\.[cm]?[jt]sx?$/;

/**
 * A key format documented without the authorization scheme.
 *
 * `nx_live_<base64url-32-bytes>` and `nx_live_...` state what a key looks like as plainly as a
 * bearer header does, and the file that DECLARES the prefix documents it this way three times.
 * Matching only `Bearer` examples would let those advertise a retired prefix indefinitely while
 * one updated bearer example kept the population guard satisfied.
 *
 * Read wherever the surrounding text is talking about a key, since nothing in the shape of a
 * token says it is a credential: run against the tree, this pattern reads
 * `idx_comp_<slug>_parent` in `api/field-groups.ts` as a key prefix, which is an index name.
 * The sentence is what separates them, so `KEY_VOCABULARY` gates every surface.
 *
 * The trailing placeholder is the other half of that narrowness. Requiring `<` or `...` is what
 * keeps this to a STATED FORMAT rather than any snake_case token: measured across the tree,
 * dropping it and matching concrete tokens instead reports `change_column_type`,
 * `actor_user_id`, `single_pricings_pkey` and nineteen more like them, because a doc comment
 * that says "primary key" or "key column" satisfies the vocabulary as readily as one about
 * credentials. `CONCRETE_KEY_EXAMPLE` covers the concrete form where that is safe.
 */
const KEY_FORMAT_EXAMPLE = /\b([a-z][a-z0-9]*(?:_[a-z0-9]+)+_)(?=<|\.\.\.)/g;

/**
 * A key written out in full rather than trailed off, as `"nx_live_abcdefgh"`, or the prefix
 * quoted on its own, as "keys carry the `nx_live_` prefix".
 *
 * The file that declares the prefix does both: the display prefix a masked UI renders, and a
 * bare mention of the prefix in the paragraph explaining what it is for. Neither trails off, so
 * neither is visible to the placeholder form, and both are as able to go stale as any header.
 *
 * Read in that file and nowhere else, and the measurement is the reason: this pattern applied
 * across every key-talking context reports twenty-two database identifiers, `change_column_type`
 * and `single_pricings_pkey` among them, against one real example, because "primary key" and
 * "key column" are sentences about keys too. Inside the declaring file it reports that one
 * example and nothing else, since every comment there is about this credential.
 */
const CONCRETE_KEY_EXAMPLE = /["'`]([a-z][a-z0-9]*(?:_[a-z0-9]+)+_[A-Za-z0-9]*)["'`]/g;

/**
 * The prefix an example claims, which is its leading run of underscore-separated segments.
 *
 * Compared for EQUALITY against the declaration rather than with `startsWith`, which passes
 * anything the declared value is a prefix of. Shortening `nx_live_` to `nx_` would leave every
 * `nx_live_...` example in the tree satisfying `startsWith("nx_")`, so the docs and the source
 * could both keep advertising a format nothing issues while this reported clean.
 *
 * An example writing out a full literal key whose random half contains an underscore reads as a
 * different prefix and is reported. That is the right answer twice over: the documented form is
 * `nx_live_...` or `nx_live_<random>`, and a real key in documentation is something a person
 * should look at.
 */
const DOCUMENTED_PREFIX = /^[A-Za-z][A-Za-z0-9]*(?:_[A-Za-z0-9]+)*_/;

/**
 * Doc comments that are talking about an API key.
 *
 * A bare `something_<placeholder>` says nothing about what it is. Run against the tree, a
 * pattern for that shape reads `idx_comp_<slug>_parent` in `api/field-groups.ts`, which is an
 * index name, so the surrounding sentence has to decide. Every block that documents the key
 * format says so plainly: `api-key-service.ts` heads its with "Key Format", and
 * `direct-api/types/rbac.ts` calls its examples the raw key value. The index-name block does
 * not use the word at all.
 */
const KEY_VOCABULARY = /\bkeys?\b/i;

/** A doc comment, matched against text `sourceComments` has already reduced to those. */
const DOC_COMMENT = /\/\*\*[\s\S]*?\*\//g;

/**
 * A Markdown paragraph, which is the sentence a bare format sits in.
 *
 * A fenced block counts as one, because a key format is usually shown inside one and the
 * heading or sentence that introduces it is not what the fence contains. Splitting on blank
 * lines therefore keeps the fence with nothing, so `KEY_VOCABULARY` has to find the word inside
 * it: `nx_live_<base64url-32-bytes>` sits under a `Key Format` heading, and the fenced examples
 * in this repository all carry the word themselves.
 */
const PARAGRAPH = /[^\n]+(?:\n[^\n]+)*/g;

/** HTML and MDX comments, which a reader never sees and a generator never publishes. */
const NON_RENDERED_COMMENT = /<!--[\s\S]*?-->|\{\s*\/\*[\s\S]*?\*\/\s*\}/g;

/** Fenced blocks, closed or running to end of file, as `renderedProse` also counts them. */
const FENCED_BLOCK = /^ {0,3}(`{3,}|~{3,})[\s\S]*?^ {0,3}\1[^\n]*$|^ {0,3}(?:`{3,}|~{3,})[\s\S]*$/gm;

/**
 * An inline code span, which prints its contents as typed.
 *
 * A span cannot cross a blank line in CommonMark, and holding it to a single line here is the
 * safe direction: reading too far would protect ordinary prose and stop a genuine hidden
 * comment from being blanked.
 *
 * Indented code blocks are deliberately not protected. Four spaces means a code block after a
 * blank line and a continuation inside a list item, and guessing wrong the other way blocks a
 * correct page on a job that always runs. A comment example that matters can be fenced.
 */
const INLINE_CODE = /(`+)(?:(?!\1)[^\n])+\1/g;

/**
 * Blank out comments while keeping every offset and line break where it was.
 *
 * `renderedProse` would be the obvious reuse and is wrong here: it also strips fenced blocks,
 * and the fenced blocks are where the bearer examples live. This removes only what a reader
 * cannot see, and pads rather than deletes so a match's offset still names its real line.
 *
 * Comment SYNTAX inside rendered code is not a comment. A fenced TSX sample, or an inline span
 * showing `{/* Authorization: Bearer sk_live_... *\/}`, is printed to the reader verbatim, so
 * blanking it would hide a wrong prefix from the check while every other example kept the
 * population above zero. Both are located first and anything starting inside one is left
 * exactly as it is.
 */
function blankComments(text) {
  const rendered = [];
  for (const fence of text.matchAll(FENCED_BLOCK)) {
    rendered.push([fence.index, fence.index + fence[0].length]);
  }
  // Spans are collected from the text with fences already accounted for, so a stray backtick
  // inside a fenced block cannot pair with one outside it.
  for (const span of text.matchAll(INLINE_CODE)) {
    const start = span.index;
    if (rendered.some(([open, close]) => start >= open && start < close)) continue;
    rendered.push([start, start + span[0].length]);
  }
  return text.replace(NON_RENDERED_COMMENT, (match, offset) =>
    rendered.some(([open, close]) => offset >= open && offset < close)
      ? match
      : match.replace(/[^\n]/g, " ")
  );
}

/**
 * The documented API key prefix, compared against the one the service issues.
 *
 * A documented prefix belonging to another vendor, or differing between a code sample and the
 * sentence describing it a few lines away, is invisible without this. Nothing catches it at
 * runtime: a key is looked up by hash, so a wrong prefix is an ordinary authentication failure
 * with no hint that the format was the problem. The docs are also the source of
 * `llms-full.txt`, so a wrong format reaches coding agents as readily as readers.
 *
 * The prefix is READ from the declaration rather than restated here. A second copy of "what a
 * key looks like" is the thing that lets the docs and the code drift apart.
 *
 * This lives here rather than in a vitest suite in `packages/nextly` for two reasons, both
 * measured: that package is not in the CI `Test` step's filter list, so the suite ran in no job
 * at all; and `packages/nextly/turbo.json` names a single docs file as an external input, so a
 * change to any other page leaves the task hash unmoved and turbo replays the previous pass.
 * This script runs in the `comments` job, which is deliberately not gated on the inert
 * decision, so it runs on a docs-only commit, which is exactly when this regresses.
 */
/**
 * Split TypeScript into its comments and its code, keeping every offset and line break.
 *
 * Both halves are needed and for opposite reasons.
 *
 * Blanking the COMMENTS is how `KEY_PREFIX_DECLARATION` is read. That pattern is anchored to
 * the start of a line, which stops a `//`-commented copy standing in for the real thing, but a
 * block comment does not indent what it contains, so `/*` on its own line followed by
 * `const KEY_PREFIX = "nx_old_";` matches as readily as the declaration. Where issuance has
 * since moved to a differently named constant, that stale copy is the only match, and the check
 * reads it and holds the docs to a value nothing issues.
 *
 * Keeping only the DOC COMMENTS is how a TypeScript file is read as documentation. What a
 * reader is shown of a `.ts` file is its JSDoc; the code beside it is machinery, and so is a
 * `//` note to whoever maintains it. An email provider that builds
 * `Authorization: "Bearer vendor_key"` at runtime, or explains in a line comment that the
 * vendor wants one, is doing its job rather than documenting a Nextly key, and judging either
 * would block an always-run job over a correct integration.
 *
 * `/**` and not `/*`, so the boundary is the form that gets published. Attachment to an
 * exported declaration would be the stricter rule and is the wrong one: the key format is
 * stated in `api-key-service.ts`'s file-level block, which is attached to nothing, and
 * requiring an export would drop exactly the examples this check exists to hold.
 *
 * String literals are tracked rather than skipped over, because `//` inside one begins no
 * comment and blanking from it would swallow the rest of the line, the declaration included.
 * A regex literal containing a slash pair is read as a comment and over-blanks; that costs a
 * `key-prefix-undeclared` refusal rather than a false pass, which is the direction to be wrong
 * in, and this file has none.
 */
function partitionSource(text, keep) {
  let out = "";
  let index = 0;
  // A short tail of the code emitted so far, enough to see a closing bracket or a keyword.
  let previous = "";
  const blank = character => (character === "\n" ? "\n" : " ");
  // Three kinds, not two. "is this a comment" decides blanking and "is this documentation"
  // decides extraction, and they disagree on a `//` note and a plain `/*` block: both are
  // comments, neither is published. Collapsing them leaves ordinary block comments emitted
  // verbatim while reading the declaration, which is the case the anchor exists to refuse.
  const emit = (character, kind) =>
    (keep === "code" ? kind === "code" : kind === "doc") ? character : blank(character);
  while (index < text.length) {
    const here = text[index];
    const next = text[index + 1];
    if (here === "/" && next === "/") {
      while (index < text.length && text[index] !== "\n") {
        out += emit(text[index], "comment");
        index += 1;
      }
      continue;
    }
    if (here === "/" && next === "*") {
      const close = text.indexOf("*/", index + 2);
      const stop = close === -1 ? text.length : close + 2;
      // `/**` is the published form. `/*` is a note, and `/**/` is an empty one rather than a
      // doc block, so the character after the second star has to be something.
      const kind =
        text[index + 2] === "*" && text[index + 3] !== "/" ? "doc" : "comment";
      for (; index < stop; index += 1) out += emit(text[index], kind);
      continue;
    }
    // A regex literal, which is the other thing that can hold a stray slash-star.
    //
    // `/[/*]/` sitting before a doc comment must not open one at the character-class slash and
    // eat through the JSDoc terminator. Which way that fails depends on what the caller wants:
    // reading the DECLARATION it over-blanks and the check refuses, and reading the file as
    // documentation it drops the doc comment and the check reports clean. The second is a
    // silent pass, so the literal is consumed here rather than left to either.
    //
    // Comments are recognised first, exactly as a JavaScript lexer does, so `/*` and `//` never
    // reach here and only the ambiguity between division and a regex is left. The previous
    // significant character settles it: a value can end with a name, a number or a closing
    // bracket, and a slash after one of those is division.
    if (here === "/" && next !== "/" && next !== "*") {
      if (!/[\w$)\]]$/.test(previous) || /\b(?:return|typeof|case|in|of|new|delete|void|throw)$/.test(previous)) {
        out += emit(here, "code");
        index += 1;
        let inClass = false;
        while (index < text.length && text[index] !== "\n") {
          const character = text[index];
          out += emit(character, "code");
          index += 1;
          if (character === "\\") {
            if (index < text.length) {
              out += emit(text[index], "code");
              index += 1;
            }
            continue;
          }
          if (character === "[") inClass = true;
          else if (character === "]") inClass = false;
          else if (character === "/" && !inClass) break;
        }
        previous = "/";
        continue;
      }
    }
    if (here === '"' || here === "'" || here === "`") {
      // Only a template literal spans lines. A quoted string cannot hold a raw newline, so
      // ending the scan at one is exact, and it is what stops an apostrophe in JSX text from
      // opening a span that never closes: `<p>don't</p>` would otherwise run to the next
      // apostrophe in the file and blank every doc comment in between, which is a bearer
      // example this never judges while other files hold the examined count above zero.
      //
      // A backslash-newline continuation is still a string, and stays one: the escape branch
      // consumes that newline before this test can see it.
      const spansLines = here === "`";
      out += emit(here, "code");
      index += 1;
      while (
        index < text.length &&
        text[index] !== here &&
        (spansLines || text[index] !== "\n")
      ) {
        if (text[index] === "\\") {
          out += emit(text[index], "code");
          index += 1;
          if (index < text.length) {
            out += emit(text[index], "code");
            index += 1;
          }
          continue;
        }
        out += emit(text[index], "code");
        index += 1;
      }
      // Consumes the closing delimiter. An unterminated string stopped at a newline instead,
      // and that newline belongs to the file rather than to the string, so it is left for the
      // outer loop and the line count stays right.
      if (index < text.length && text[index] === here) {
        out += emit(text[index], "code");
        index += 1;
      }
      previous = "x";
      continue;
    }
    out += emit(here, "code");
    if (!/\s/.test(here)) previous = (previous + here).slice(-8);
    index += 1;
  }
  return out;
}

/** The file with its comments padded out, leaving the code a parser would see. */
const blankSourceComments = text => partitionSource(text, "code");

/** The file with its code padded out, leaving what a reader is shown of it. */
const sourceComments = text => partitionSource(text, "comments");

function documentedKeyPrefix(
  repoRoot,
  tracked,
  packages,
  findings,
  isExempt,
  repairs
) {
  if (!tracked.includes(KEY_PREFIX_SOURCE)) {
    findings.push({
      check: "key-prefix-source-missing",
      file: KEY_PREFIX_SOURCE,
      line: null,
      message:
        "the file declaring the API key prefix is not tracked, so the docs cannot be checked against it",
    });
    return;
  }

  let source;
  try {
    source = readFileSync(join(repoRoot, KEY_PREFIX_SOURCE), "utf-8");
  } catch {
    findings.push({
      check: "key-prefix-source-missing",
      file: KEY_PREFIX_SOURCE,
      line: null,
      message:
        "could not be read, so the documented key prefix has nothing to be compared against",
    });
    return;
  }

  // Fails closed. If the declaration is renamed, moved or duplicated, this refuses rather than
  // quietly checking the docs against nothing.
  const declarations = [...blankSourceComments(source).matchAll(KEY_PREFIX_DECLARATION)];
  if (declarations.length !== 1) {
    findings.push({
      check: "key-prefix-undeclared",
      file: KEY_PREFIX_SOURCE,
      line: null,
      message: `expected exactly one KEY_PREFIX declaration to read, found ${String(declarations.length)}`,
    });
    return;
  }
  const prefix = declarations[0][1];

  // Every prose surface, not just `docs/`. ARCHITECTURE.md publishes a bearer example too, and
  // a scope that named one directory would have left it unguarded.
  //
  // TypeScript under `packages/` is in scope for the same reason. `shared/types/config.ts`
  // documents `Authorization: Bearer nx_live_...` in JSDoc that ships in the package's
  // declarations, so it is an example a reader is shown in their editor, and a Markdown-only
  // scope would let it go stale while every published page was updated and the check passed.
  //
  // Tests are dropped. Their bearer headers belong to other services and to fixtures, so
  // judging them against the Nextly prefix would report a defect that is not one.
  //
  // So are private packages. `eslint-config`, `tsconfig` and their neighbours are build
  // machinery that npm never receives, so a comment in one reaches no consumer and documents
  // nothing. `publishedPackages` already decides this for every other check here, and asking
  // it again is what keeps the two answers from drifting apart.
  //
  // Derived as "has a manifest that publishing did not return", not as "was returned by
  // publishing". A directory whose manifest is missing or unreadable stays IN scope, so a
  // package cannot drop out of this check by losing the file that describes it. Unreadable is
  // separately reported.
  const published = new Set(packages.map(pkg => basename(pkg.dir)));
  const withManifest = tracked
    .filter(rel => /^packages\/[^/]+\/package\.json$/.test(rel))
    .map(rel => rel.split("/")[1]);
  const privatePackages = new Set(
    withManifest.filter(name => !published.has(name))
  );
  //
  // Changesets are dropped for the reason the per-line checks drop them: they quote the claim
  // being corrected, so a note saying "replace `Bearer sk_old_EXAMPLE`" describes the fix and
  // is not a page anyone reads.
  const prose = proseFiles(tracked).filter(
    rel =>
      !TEST_FILE.test(rel) &&
      !rel.startsWith(".changeset/") &&
      !privatePackages.has(rel.split("/")[1])
  );

  let examined = 0;

  for (const rel of prose) {
    let text;
    try {
      text = readFileSync(join(repoRoot, rel), "utf-8");
    } catch {
      continue; // unreadable-manifest already reports a file the index names and disk lacks
    }
    // Read each file as what it SHOWS a reader. In Markdown that is everything except the
    // comments a generator never publishes; in TypeScript it is exactly the comments, since
    // the code beside them builds headers rather than documenting Nextly's.
    //
    // Matched over the whole file rather than line by line, so an example wrapped after the
    // scheme is still found. Both readers pad rather than delete, so a match's offset still
    // names its real line.
    const markdown = rel.endsWith(".md") || rel.endsWith(".mdx");
    const scanned = markdown ? blankComments(text) : sourceComments(text);

    // A bearer header and a bare format claim the same thing, so they are judged together.
    // Keyed by where the token starts, because `Bearer nx_live_...` satisfies both patterns
    // and is one example rather than two.
    const candidates = new Map();
    for (const match of scanned.matchAll(BEARER_EXAMPLE)) {
      const explicitHeader = EXPLICIT_HEADER.test(
        scanned.slice(Math.max(0, match.index - 24), match.index)
      );
      candidates.set(match.index + match[0].length - match[1].length, {
        match,
        explicitHeader,
      });
    }
    // Bare formats are read wherever a doc comment is talking about a key. `rbac.ts` publishes
    // three of them with no scheme, in JSDoc that ships in the package's declarations, so
    // scoping this to the declaring file left editor-visible examples free to go stale.
    // The unit of context differs by file type and the test does not: a paragraph in Markdown,
    // a doc comment in source. Without it on both sides, a page explaining that the generated
    // index is `idx_comp_<slug>_parent` is read as documenting an API key prefix.
    const contexts = markdown
      ? [...scanned.matchAll(PARAGRAPH)]
      : [...scanned.matchAll(DOC_COMMENT)];
    for (const [position, context] of contexts.entries()) {
      // The block before counts as part of the context. Markdown introduces a format with a
      // heading or a sentence and then puts the value in its own fence, and a fence holds no
      // blank line so it is a paragraph of its own: judged alone, `## API key format` above it
      // says nothing about what follows.
      const introduced = (contexts[position - 1]?.[0] ?? "") + "\n" + context[0];
      if (!KEY_VOCABULARY.test(introduced)) continue;
      const patterns =
        rel === KEY_PREFIX_SOURCE
          ? [KEY_FORMAT_EXAMPLE, CONCRETE_KEY_EXAMPLE]
          : [KEY_FORMAT_EXAMPLE];
      for (const pattern of patterns) {
        for (const match of context[0].matchAll(pattern)) {
          // The capture, not the whole match: the concrete form takes its quotes with it.
          const start = context.index + match.index + match[0].indexOf(match[1]);
          if (!candidates.has(start)) {
            candidates.set(start, { match, explicitHeader: false });
          }
        }
      }
    }

    for (const [start, { match, explicitHeader }] of [...candidates].sort(
      (a, b) => a[0] - b[0]
    )) {
      const line = scanned.slice(0, start).split("\n").length;
      const token = match[1];
      // The exemption is digested from the whole matched example rather than from the line the
      // match starts on. An allowlisted third-party example that wraps after `Bearer` puts its
      // credential on the next line, so a line digest would cover the scheme and not the thing
      // being excused, and swapping in a wrong Nextly prefix would inherit the exemption while
      // other pages held the examined count above zero. `digestLine` collapses whitespace, so
      // wrapping the same example a different way still matches.
      //
      // Counted AFTER the exemption, so the population is the examples this actually judged: a
      // tree whose only remaining example was exempted must report a refusal, not silence.
      if (isExempt(rel, match[0])) continue;
      // "send a Bearer token" is prose about the scheme, not an example of a credential.
      if (!isCredential(token, explicitHeader)) continue;
      // A placeholder is not an example of the format, so it is neither judged nor counted.
      if (isPlaceholder(token)) continue;
      examined += 1;
      if (DOCUMENTED_PREFIX.exec(token)?.[0] === prefix) continue;
      findings.push({
        check: "documented-key-prefix",
        file: rel,
        line,
        message: `documents \`${match[0].trim()}\`; keys are issued with the prefix "${prefix}"`,
      });
      // The repair is recorded HERE, where the wrong example was found, rather
      // than searched for again by something else. A second pass would be a
      // second answer to "which tokens are key examples", and this one already
      // carries the exemptions, the file scope and the placeholder rules.
      //
      // Only a token that HAS a prefix is repairable: swapping one prefix for
      // another is a rewrite of what the example claims, while `Bearer abc123`
      // states no format and inventing one for it would be writing the
      // documentation rather than correcting it. Those stay findings.
      const documented = DOCUMENTED_PREFIX.exec(token)?.[0];
      if (repairs !== undefined && documented !== undefined) {
        repairs.push({ file: rel, start, from: documented, to: prefix });
      }
    }
  }

  // An absence check with an empty population is satisfied by everything. Reaching here having
  // judged no example means the docs moved, were renamed, or stopped using a syntax this
  // recognises, and every one of those should be looked at rather than reported as clean.
  if (examined === 0) {
    findings.push({
      check: "key-prefix-unexamined",
      file: "docs/",
      line: null,
      message:
        "no API key example was found to check, so this reported clean without examining anything",
    });
  }
}

function readmeSkeleton(repoRoot, packages, findings) {
  for (const pkg of packages) {
    const readme = join(pkg.dir, "README.md");
    if (!existsSync(readme)) continue; // readme-present already reports this
    let text;
    try {
      text = readFileSync(readme, "utf-8");
    } catch {
      continue;
    }
    const prose = renderedProse(text);
    for (const section of README_SECTIONS) {
      if (!section.test.test(prose)) {
        findings.push({
          check: "readme-skeleton",
          file: relative(repoRoot, readme),
          line: null,
          message: `${pkg.name} is published but its README has no ${section.label}`,
        });
      }
    }
  }
}

export async function runChecks({
  repoRoot,
  allowlist = {},
  remoteRefs,
  hasLocalCommit,
  files,
  // Present only when a caller intends to repair. Absent, every check behaves
  // exactly as it did, so reporting is never changed by the ability to fix.
  repairs,
}) {
  const findings = [];
  const unverifiable = [];
  const tracked = files ?? trackedFiles(repoRoot);
  if (tracked === null) {
    throw new Error(
      `cannot list tracked files in ${repoRoot}; this check reads git's index, not the filesystem`
    );
  }
  const refs = remoteRefs === undefined ? listRemoteRefs(repoRoot) : remoteRefs;
  const commitPresent = hasLocalCommit ?? makeCommitProbe(repoRoot);

  /**
   * An exemption covers ONE claim, not one file.
   *
   * Keying only by path would silence every line in an exempt file, so an accurate "coming soon"
   * on one line would also let an inaccurate one elsewhere in the same file through — a
   * file-wide bypass wearing the shape of a single exception. Digests are per-line and match
   * `comment-convention-allowlist.json`.
   */
  /**
   * An exemption is spent, not held. `count` says how many occurrences in a file an entry
   * excuses, and it was carried in the allowlist and read by nobody: one entry excused every
   * duplicate of its line, so a second copy of an allowlisted claim could be added anywhere in
   * the same file and inherit permission granted to the first. The declared number is now the
   * budget, and going over it reports the surplus rather than absorbing it.
   *
   * Absent, it falls back to the number of digests, which is what a one-line-per-digest entry
   * means and what every entry written so far says.
   */
  const exemption = check => {
    const forCheck = allowlist[check] ?? {};
    const byPath = new Map();
    // Both sides in POSIX form. The allowlist is written with "/" and git hands
    // callers the same, but a caller deriving a path with `relative()` gets a
    // backslash on Windows, and a key that does not match reads as "not exempt"
    // rather than as an error.
    const posix = value => value.split(sep).join("/");
    for (const [path, entry] of Object.entries(forCheck)) {
      const digests = entry.digests ?? [];
      byPath.set(posix(path), {
        digests: new Set(digests),
        budget: entry.count ?? digests.length,
        spent: 0,
        reported: false,
      });
    }
    return (relPath, line) => {
      const entry = byPath.get(posix(relPath));
      if (!entry || !entry.digests.has(digestLine(line))) return false;
      entry.spent += 1;
      if (entry.spent <= entry.budget) return true;
      // Said once per file. The surplus occurrences are each reported by the check that found
      // them, and repeating this beside every one of them would bury that.
      if (!entry.reported) {
        entry.reported = true;
        findings.push({
          check: "allowlist-count-exceeded",
          file: posix(relPath),
          line: null,
          message: `the "${check}" entry allows ${String(entry.budget)} occurrence(s) and the file has more; raise the count with a reason, or fix the extra one`,
        });
      }
      return false;
    };
  };

  // --- readme-present + root-readme-lists-package ---
  const packages = publishedPackages(repoRoot, findings);
  const rootReadmePath = join(repoRoot, "README.md");
  const rootReadme = existsSync(rootReadmePath)
    ? readFileSync(rootReadmePath, "utf-8")
    : null;

  if (rootReadme === null && packages.length > 0) {
    // Treating the root README as optional let the whole root-readme check disappear the moment
    // the file did. This job is the guard for exactly that file.
    findings.push({
      check: "root-readme-present",
      file: "README.md",
      line: null,
      message: `absent, but ${packages.length} package(s) are published and must be listed in it`,
    });
  }

  for (const pkg of packages) {
    if (!existsSync(join(pkg.dir, "README.md"))) {
      findings.push({
        check: "readme-present",
        file: relative(repoRoot, join(pkg.dir, "README.md")),
        line: null,
        message: `${pkg.name} is published but has no README, so its npm page is blank`,
      });
    }
    if (rootReadme !== null && !rootReadme.includes(pkg.name)) {
      findings.push({
        check: "root-readme-lists-package",
        file: "README.md",
        line: null,
        message: `${pkg.name} is published but is not named in the root README`,
      });
    }
  }

  // --- the category these files state ---
  //
  // Read through `renderedProse`, the same view the README skeleton check uses,
  // so a fenced example or a commented-out block is not mistaken for the
  // project describing itself. No line number: these are whole documents making
  // a claim, and the file is the useful thing to name, which is how the other
  // document-level checks here report.
  //
  // Four Markdown forms are knowingly not handled, each counted across these
  // six files and found zero times: a fence inside a quotation, code indented
  // by four spaces, a code span closing on a shorter backtick run, and a
  // shortcut reference link resolved against a `[label]:` definition. The first
  // three would be a false report and the allowlist answers those; the last is
  // a missed one. Resolving any of them means reading Markdown properly rather
  // than reading what it renders, which is the depth this check exists without.
  const categoryExempt = exemption("retired-category");
  const trackedSet = new Set(tracked);
  for (const rel of CATEGORY_SURFACES) {
    if (!trackedSet.has(rel)) continue;
    let text;
    try {
      text = readFileSync(join(repoRoot, rel), "utf-8");
    } catch {
      continue;
    }
    for (const paragraph of proseParagraphs(text, { mdx: rel.endsWith(".mdx") })) {
      if (!RETIRED_CATEGORY.test(paragraph) || categoryExempt(rel, paragraph)) continue;
      findings.push({
        check: "retired-category",
        file: rel,
        line: null,
        message: `"app framework" — the category is "content platform"; say what this is for`,
      });
      break;
    }
  }

  // A published description is read on npm rather than here and says the same
  // thing about the same product, so it is a category surface too.
  //
  // Keywords are deliberately not read here. `retired-category-keyword` owns
  // them, and one field answered by two checks reports the same manifest twice
  // under two names while letting the two patterns drift apart.
  //
  // Taken from the list `publishedPackages` already parsed. Enumerating the
  // manifests again here would be a second answer to "which packages ship",
  // free to disagree with the first.
  for (const pkg of packages) {
    const rel = relative(repoRoot, join(pkg.dir, "package.json")).split(sep).join("/");
    const { description } = pkg.json;
    if (typeof description !== "string") continue;
    if (!RETIRED_CATEGORY.test(description) || categoryExempt(rel, description)) continue;
    findings.push({
      check: "retired-category",
      file: rel,
      line: null,
      message: `"app framework" — the category is "content platform"; say what this is for`,
    });
  }

  // `context7.json` tells an indexer what the project is, in one sentence an
  // agent reads before any page. It is a category surface like the npm
  // description, and it is held to the SAME sentence as the core package's
  // rather than checked on its own: two sentences saying what Nextly is, in
  // two files nobody reads together, is how the second one was still calling
  // this an app framework months after the first stopped.
  //
  // Held whether or not the file is there: a configuration that is deleted or
  // never tracked is an indexer left to guess, and a check that skipped it
  // would report that as clean.
  {
    const core = packages.find(pkg => pkg.json.name === CORE_PACKAGE);
    const finding = context7Findings(
      trackedSet.has(CONTEXT7_CONFIG)
        ? readContext7Config(join(repoRoot, CONTEXT7_CONFIG))
        : undefined,
      core?.json.description
    );
    if (finding) findings.push(finding);
  }

  // --- per-line prose checks ---
  const phraseExempt = exemption("forbidden-status-phrase");
  const namingExempt = exemption("naming-rule");
  const linkExempt = exemption("dead-branch-link");

  for (const rel of proseFiles(tracked)) {
    let text;
    try {
      text = readFileSync(join(repoRoot, rel), "utf-8");
    } catch {
      continue;
    }
    const lines = text.split("\n");
    const isProse = rel.endsWith(".md") || rel.endsWith(".mdx");
    const isChangeset = rel.startsWith(".changeset/");

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lower = line.toLowerCase();

      // Prose only, and never a changeset. A "Coming soon" badge in admin UI or an API
      // placeholder string is a fact about the running product, not a claim about what the
      // project ships; and a changeset routinely QUOTES the false claim a change removed,
      // which reads identically to making one. The naming rule still applies to changesets,
      // because they become CHANGELOG entries and the product's name has one spelling.
      if (isProse && !isChangeset && !phraseExempt(rel, line)) {
        for (const phrase of FORBIDDEN_PHRASES) {
          if (lower.includes(phrase)) {
            findings.push({
              check: "forbidden-status-phrase",
              file: rel,
              line: i + 1,
              message: `"${phrase}" — say what ships today, or allowlist this line if it is accurate`,
            });
            break;
          }
        }
      }

      if (!namingExempt(rel, line)) {
        BARE_VISUAL_BUILDER.lastIndex = 0;
        if (BARE_VISUAL_BUILDER.test(line)) {
          findings.push({
            check: "naming-rule",
            file: rel,
            line: i + 1,
            message: `bare "Visual Builder" — write "Visual Schema Builder" or "Visual Page Builder"`,
          });
        }
      }

      if (!linkExempt(rel, line)) {
        REPO_LINK.lastIndex = 0;
        let match;
        while ((match = REPO_LINK.exec(line)) !== null) {
          if (refs === null) {
            unverifiable.push({
              check: "dead-branch-link",
              file: rel,
              line: i + 1,
              ref: match[1],
            });
            continue;
          }
          const split = splitRefAndPath(match[1], refs);
          if (split === null || split.resolved) continue;

          if (HEX_REF.test(split.ref)) {
            // A pinned commit. `ls-remote` cannot be asked about an arbitrary sha, and a shallow
            // clone may not hold the object, so a miss is unverifiable rather than dead.
            if (!commitPresent(split.ref)) {
              unverifiable.push({
                check: "dead-branch-link",
                file: rel,
                line: i + 1,
                ref: split.ref,
              });
            }
            continue;
          }

          findings.push({
            check: "dead-branch-link",
            file: rel,
            line: i + 1,
            message: `links to ref "${split.ref}", which does not resolve on origin`,
          });
        }
      }
    }
  }

  readmeSkeleton(repoRoot, packages, findings);
  retiredKeywords(repoRoot, packages, findings);
  documentedKeyPrefix(
    repoRoot,
    tracked,
    packages,
    findings,
    exemption("documented-key-prefix"),
    repairs
  );
  await internalLinks(repoRoot, tracked, findings);
  pluginRouteMount(repoRoot, tracked, findings, exemption("plugin-route-mount"));
  metaReachability(repoRoot, tracked, findings);

  return { findings, unverifiable };
}

/**
 * Write the repairs a check recorded, and say what was rewritten.
 *
 * Applied back to front within each file, because a repair is addressed by the
 * offset the check read it at and rewriting an earlier one first would move
 * every later offset in that file by the difference in prefix lengths.
 *
 * Each write is checked against the text it claims to replace before it lands.
 * The offsets come from the reading the checks scan, which pads comments rather
 * than deleting them so that a match's offset still names its real position; if
 * that ever stopped holding, this would silently corrupt a page. Refusing on a
 * mismatch turns that into a stop rather than a rewrite of the wrong bytes.
 *
 * @param {string} repoRoot
 * @param {{file: string, start: number, from: string, to: string}[]} repairs
 * @returns {Map<string, number>} how many examples were rewritten per file
 */
export function applyRepairs(repoRoot, repairs) {
  const byFile = new Map();
  for (const repair of repairs) {
    if (!byFile.has(repair.file)) byFile.set(repair.file, []);
    byFile.get(repair.file).push(repair);
  }

  const counts = new Map();
  for (const [rel, edits] of byFile) {
    const absolute = join(repoRoot, rel);
    let text = readFileSync(absolute, "utf-8");
    for (const edit of [...edits].sort((a, b) => b.start - a.start)) {
      const found = text.slice(edit.start, edit.start + edit.from.length);
      if (found !== edit.from) {
        throw new Error(
          `${rel}: expected "${edit.from}" at ${String(edit.start)} and found "${found}"; refusing to rewrite`
        );
      }
      text =
        text.slice(0, edit.start) +
        edit.to +
        text.slice(edit.start + edit.from.length);
    }
    writeFileSync(absolute, text);
    counts.set(rel, edits.length);
  }
  return counts;
}

const invokedDirectly =
  process.argv[1] && process.argv[1].endsWith("check-docs-claims.mjs");

if (invokedDirectly) {
  const repoRoot = process.cwd();
  const allowlistPath = join(repoRoot, "scripts", "docs-claims-allowlist.json");
  const allowlist = existsSync(allowlistPath)
    ? JSON.parse(readFileSync(allowlistPath, "utf-8"))
    : {};

  // Repairs are always COLLECTED and only written when asked for. Collecting
  // costs an array the run already had the answers for, and it is what lets a
  // plain run say how many of its findings a rewrite would settle instead of
  // leaving the reader to guess.
  const fix = process.argv.includes("--fix");
  const repairs = [];
  let { findings, unverifiable } = await runChecks({
    repoRoot,
    allowlist,
    repairs,
  });

  if (fix && repairs.length > 0) {
    const counts = applyRepairs(repoRoot, repairs);
    const total = [...counts.values()].reduce((sum, n) => sum + n, 0);
    console.log(
      `docs claims: rewrote ${String(total)} key example(s) in ${String(counts.size)} file(s).`
    );
    for (const [rel, count] of counts) {
      console.log(`  ${rel} (${String(count)})`);
    }
    // Re-read from disk. What is reported now is the state a reviewer will see,
    // not the state that was found before the rewrite - and anything the repair
    // could not settle is still a finding.
    ({ findings, unverifiable } = await runChecks({ repoRoot, allowlist }));
  }

  if (unverifiable.length > 0) {
    console.warn(
      `${unverifiable.length} link ref(s) could not be resolved against origin (offline?). Not counted as failures.`
    );
  }

  if (findings.length === 0) {
    console.log("docs claims: no findings.");
    process.exit(0);
  }

  const byCheck = new Map();
  for (const f of findings) {
    if (!byCheck.has(f.check)) byCheck.set(f.check, []);
    byCheck.get(f.check).push(f);
  }
  for (const [check, items] of byCheck) {
    console.error(`\n${check} (${items.length}):`);
    for (const item of items) {
      console.error(`  ${item.file}${item.line ? `:${item.line}` : ""} — ${item.message}`);
    }
  }
  console.error(`\n${findings.length} finding(s).`);
  // Said where the failure is read, so it reaches a local run as well as CI.
  // Only the examples whose prefix is merely wrong can be rewritten; the rest
  // state no format and need someone to decide what they should say.
  if (!fix && repairs.length > 0) {
    console.error(
      `${String(repairs.length)} of these name${repairs.length === 1 ? "s" : ""} a prefix that \`pnpm docs:fix\` can rewrite.`
    );
  }
  process.exit(1);
}
