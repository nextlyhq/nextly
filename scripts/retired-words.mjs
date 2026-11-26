/**
 * What an author can read in the builder, the Page Builder plugin and the
 * admin, and which of it uses a word the editor has retired.
 *
 * The words themselves, and the rule that finds each one, live in the
 * builder's glossary (`packages/builder/src/glossary/retired-words.ts`); this
 * module only reads source. `retired-words.test.mjs` runs it over the three
 * packages on every pull request.
 *
 * Read from the AST, so comments are never findings, the way the builder's
 * and the plugin's own word tests read their screens. A string is read where
 * an author could see it: string literals, template text, an element's own
 * line (`New {…}` for `New {labels.singular}`) and the attributes that are
 * drawn or spoken (`title`, `placeholder`, `aria-label`…). Skipped, by PLACE
 * and never by word:
 *
 * - code names: module specifiers, literal types, object and type keys, the
 *   attributes only code reads (`className`, `data-*`…), and a lower-case
 *   string with no space outside a shown place;
 * - search keywords: the value of a `keywords`, `aliases`, `synonyms` or
 *   `searchTerms` key, or of a constant so named (`SYNONYMS`), where an
 *   industry word is how an author finds a renamed thing;
 * - log messages: any argument of a `console`, `logger` or `log` call or of
 *   a development warning (`devWarnOnce`), a value under a `remedies` key
 *   (what a development check tells the developer to do), and a line
 *   tagged with its package the way every log line here is
 *   (`"[page-builder] …"`), whichever function it is handed to;
 * - CSS held in a string (`"body { margin: 0; }"`), and SQL in a
 *   migration, which no author reads.
 *
 * A lower-case word with no space is a code name, except where it lands in
 * shown text: under a shown key or attribute, as a branch of a choice inside
 * a shown template or an element's text (`{n === 1 ? "colour" : "colours"}`),
 * or as a lone word anywhere in a words module (`*-words.ts`), which holds
 * nothing but shown words. A string compared or matched in a `case` is code
 * everywhere.
 *
 * Plain JavaScript, so it loads under the scripts suite with no build.
 *
 * @module retired-words
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { parseSource, walk } from "@nextlyhq/module-specifiers/parse-source";

/**
 * The folders whose shipped source is read, by repository-relative path.
 */
export const SCANNED = [
  "packages/builder/src",
  "packages/plugin-page-builder/src",
  "packages/admin/src",
  // The built-in spacing variables' names, drawn in the Design panel.
  "packages/blocks-engine/src/style/site-tokens.ts",
];

/** Test code, stories, declarations and fixtures: never shipped, never shown. */
const NOT_SHIPPED =
  /\.(?:test|spec|test-d|stories|fixture)\.[cm]?[jt]sx?$|\.d\.[cm]?ts$/;
const SOURCE_FILE = /\.[cm]?[jt]sx?$/;
const NOT_SHIPPED_DIR = new Set([
  "__tests__",
  "__fixtures__",
  "__mocks__",
  "test-utils",
  // A migration's SQL, run against the database and read by no author.
  "migrations",
]);

/** Every shipped source file beneath `at`, a file alone when `at` is one. */
export function shippedFiles(at) {
  if (statSync(at).isFile()) return [at];
  return readdirSync(at, { withFileTypes: true }).flatMap(entry => {
    if (NOT_SHIPPED_DIR.has(entry.name)) return [];
    const path = join(at, entry.name);
    if (entry.isDirectory()) return shippedFiles(path);
    return SOURCE_FILE.test(entry.name) && !NOT_SHIPPED.test(entry.name)
      ? [path]
      : [];
  });
}

/** A file's repository-relative path, with "/" whatever the platform. */
export function repoPath(root, file) {
  return relative(root, file).split(sep).join("/");
}

/**
 * A lower-case code name: a slug, an id, a path, a CSS class, a selector
 * (`[data-chip="{…}"]`) or a web address (`https://…/verify?token=…`).
 */
const CODE_NAME = /^[a-z0-9_\-:./#@*${}…[\]="'?&%+~>(),]*$/;

/**
 * Where a string is always shown, a lone lower-case word included: a value
 * under one of these keys or attributes, or one whose name ends in one of
 * them (`emptyText`, `ariaLabel`, `confirmLabel`).
 */
const SHOWN_PLACE =
  /^(?:header|heading|label|title|placeholder|description|tooltip|hint|note|caption|message|summary|text|alt|aria-label|aria-description|aria-valuetext)$|[a-z](?:Label|Text|Title|Hint|Message|Description|Placeholder|Tooltip|Caption|Summary|Heading|Header|Note)$/;

/**
 * A module that holds only shown words: `*-words.ts`, the glossary's
 * `words.ts`. The retired-words list holds rules, not words.
 */
const WORDS_MODULE = /(?:^|\/)(?!retired-words\.)[\w-]*words\.[cm]?[jt]sx?$/;

/** A lone lower-case word, which a words module may say: "colour". */
const LONE_WORD = /^[a-z]+$/;

/** CSS declarations held in a string: `body { margin: 0; }`. */
const CSS_TEXT = /\{[^{}]*:[^{}]*;[^{}]*\}/;

/** The keys whose values tell a developer how to fix a development check. */
const DEVELOPER_PLACE = /^remedies$/;

/** The keys and constants whose values are search keywords, never drawn. */
const SEARCH_PLACE = /^(?:keywords|aliases|synonyms|searchTerms)$/i;

/** The attributes only code reads; anything else on an element may be shown. */
const CODE_ATTRIBUTE =
  /^(?:className|class|style|id|key|ref|role|type|href|to|src|htmlFor|form|method|target|rel|tabIndex|autoComplete|inputMode|pattern|data-.*|aria-(?:controls|describedby|labelledby|owns|haspopup|live|current|expanded|selected|pressed|hidden|modal|atomic|relevant|orientation|sort))$/;

/** The objects whose calls write a log, read by a developer only. */
const LOG_OBJECT = /^(?:console|logger|log)$/;

/** The functions that write a development warning: `devWarnOnce(…)`. */
const LOG_FUNCTION = /^(?:devWarn\w*|warnOnce)$/;

/** A log line's tag, its package in brackets: `[page-builder] …`. */
const LOG_TAG = /^\[[A-Za-z][\w-]*\] /;

/** The name of a property's key or an element's attribute, when plain. */
function placeName(holder) {
  if (holder.type === "Property") {
    if (holder.key.type === "Identifier") return holder.key.name;
    if (holder.key.type === "Literal") return String(holder.key.value);
    return null;
  }
  if (holder.type === "JSXAttribute" && holder.name.type === "JSXIdentifier") {
    return holder.name.name;
  }
  return null;
}

/** The nodes a value passes through unchanged on its way to its slot. */
function passesThrough(above, below) {
  if (above.type === "ConditionalExpression") return above.test !== below;
  return (
    above.type === "LogicalExpression" ||
    above.type === "ParenthesizedExpression" ||
    above.type === "TSAsExpression" ||
    above.type === "TSSatisfiesExpression"
  );
}

/**
 * Whether a string lands where it is shown however it is spelled, directly
 * or as a branch of a choice: the value of a shown key (`label: "token"`), a
 * shown attribute (`aria-label="token"`, `aria-label={x ?? "token"}`), an
 * expression in an element's text, or an expression in a template whose own
 * text is shown (`` `Remove ${name || "breakpoint"}` ``).
 */
function inShownPlace(node, ancestors) {
  let below = node;
  let at = ancestors.length - 1;
  while (at >= 0 && passesThrough(ancestors[at], below)) {
    below = ancestors[at];
    at -= 1;
  }
  const slot = ancestors[at];
  if (slot === undefined) return false;
  if (slot.type === "TemplateLiteral") {
    const own = tidy(
      slot.quasis.map(quasi => quasi.value.cooked ?? "").join(" ")
    );
    return own !== "" && !CODE_NAME.test(own);
  }
  if (slot.type === "JSXExpressionContainer") {
    const holder = ancestors[at - 1];
    if (holder?.type === "JSXElement" || holder?.type === "JSXFragment") {
      return true;
    }
    return holder !== undefined && SHOWN_PLACE.test(placeName(holder) ?? "");
  }
  if (slot.type === "Property" && slot.value !== below) return false;
  return SHOWN_PLACE.test(placeName(slot) ?? "");
}

/** An attribute only code reads (`className`, `data-*`, `xlink:href`). */
function isCodeAttribute(above) {
  if (above.type !== "JSXAttribute") return false;
  if (above.name.type === "JSXNamespacedName") return true;
  return (
    above.name.type === "JSXIdentifier" && CODE_ATTRIBUTE.test(above.name.name)
  );
}

/** The module an import or export names, which is `node` itself. */
function isModuleSpecifier(above, node) {
  return (
    (above.type === "ImportDeclaration" ||
      above.type === "ExportNamedDeclaration" ||
      above.type === "ExportAllDeclaration" ||
      above.type === "ImportExpression") &&
    above.source === node
  );
}

/**
 * A call that writes a log: `console.warn(…)`, `logger.error(…)`,
 * `devWarnOnce(…)`.
 */
function isLogCall(above) {
  if (above.type !== "CallExpression") return false;
  const callee = above.callee;
  if (callee.type === "Identifier") return LOG_FUNCTION.test(callee.name);
  if (callee.type !== "MemberExpression") return false;
  if (
    callee.property.type === "Identifier" &&
    LOG_FUNCTION.test(callee.property.name)
  ) {
    return true;
  }
  const object = callee.object;
  if (object.type === "Identifier") return LOG_OBJECT.test(object.name);
  // `args.logger.warn(…)`, `this.log.error(…)`.
  return (
    object.type === "MemberExpression" &&
    object.property.type === "Identifier" &&
    LOG_OBJECT.test(object.property.name)
  );
}

/**
 * A value under a search-keyword key or in a search-keyword constant, as a
 * string or in a list of them.
 */
function isSearchKeyword(above, node) {
  if (above.type === "VariableDeclarator") {
    return above.id.type === "Identifier" && SEARCH_PLACE.test(above.id.name);
  }
  return (
    above.type === "Property" &&
    above.key !== node &&
    SEARCH_PLACE.test(placeName(above) ?? "")
  );
}

/** An object's or a type's key, which names a value rather than saying it. */
function isKey(node, parent) {
  return (
    (parent?.type === "Property" || parent?.type === "TSPropertySignature") &&
    parent.key === node
  );
}

/** A value under a `remedies` key: what a development check tells a developer. */
function isDeveloperRemedy(above, node) {
  return (
    above.type === "Property" &&
    above.key !== node &&
    DEVELOPER_PLACE.test(placeName(above) ?? "")
  );
}

/** A string compared with a value, or a `case` label: code, never shown. */
function isCompared(node, parent) {
  return (
    (parent?.type === "BinaryExpression" &&
      /^(?:===|!==|==|!=|in)$/.test(parent.operator)) ||
    (parent?.type === "SwitchCase" && parent.test === node)
  );
}

/** Whether a string at this place in the tree is never shown to an author. */
function notShown(node, ancestors) {
  if (isKey(node, ancestors.at(-1))) return true;
  if (isCompared(node, ancestors.at(-1))) return true;
  return ancestors.some(
    above =>
      above.type === "TSLiteralType" ||
      isCodeAttribute(above) ||
      isModuleSpecifier(above, node) ||
      isLogCall(above) ||
      isSearchKeyword(above, node) ||
      isDeveloperRemedy(above, node)
  );
}

/** One run of an element's children read as a line: text, `{…}` between. */
function elementText(children) {
  return children
    .map(child => {
      if (child.type === "JSXText") return child.value;
      if (child.type === "JSXExpressionContainer") {
        return child.expression.type === "JSXEmptyExpression" ? "" : "{…}";
      }
      return " ";
    })
    .join("");
}

function tidy(text) {
  return text.replace(/\s+/g, " ").trim();
}

/** A string or template's text, `{…}` for each expression; else null. */
function stringText(node) {
  if (node.type === "Literal" && typeof node.value === "string") {
    return node.value;
  }
  if (node.type === "TemplateLiteral") {
    return node.quasis.map(quasi => quasi.value.cooked ?? "").join("{…}");
  }
  return null;
}

/** An element's own line, or null where its children are only expressions. */
function elementLine(node) {
  if (node.type !== "JSXElement" && node.type !== "JSXFragment") return null;
  const line = tidy(elementText(node.children));
  return line.replace(/\{…\}/g, "").trim() === "" ? null : line;
}

/**
 * The texts an author could read in one source file, in source order. A
 * stylesheet's comments inside a string are dropped, since they are never
 * drawn.
 */
export function shownTexts(source, fileName) {
  const texts = [];
  const wordsModule = WORDS_MODULE.test(fileName.split("\\").join("/"));
  walk(parseSource(source, fileName).program, (node, ancestors) => {
    const line = elementLine(node);
    if (line !== null) {
      texts.push(line);
      return;
    }
    const raw = stringText(node);
    if (raw === null) return;
    const text = tidy(raw.replace(/\/\*[\s\S]*?\*\//g, " "));
    if (text === "") return;
    if (
      CODE_NAME.test(text) &&
      !(wordsModule && LONE_WORD.test(text)) &&
      !inShownPlace(node, ancestors)
    ) {
      return;
    }
    if (LOG_TAG.test(text) || CSS_TEXT.test(text)) return;
    if (notShown(node, ancestors)) return;
    texts.push(text);
  });
  return texts;
}

/**
 * Which retired words a text uses, in a file at `path`: the ids of every rule
 * that applies there and matches.
 *
 * @param {string} text
 * @param {string} path repository-relative, with "/"
 * @param {readonly { id: string, where?: readonly string[], test: (text: string, path: string) => boolean }[]} rules
 */
export function retiredIn(text, path, rules) {
  return rules
    .filter(
      rule =>
        (rule.where === undefined ||
          rule.where.some(prefix => path.startsWith(prefix))) &&
        rule.test(text, path)
    )
    .map(rule => rule.id);
}

/**
 * Every shown text that uses a retired word in the scanned folders: one
 * finding per time the text is shown, with every rule it breaks.
 */
export function findRetired(root, rules, folders = SCANNED) {
  const findings = [];
  for (const folder of folders) {
    for (const file of shippedFiles(join(root, folder))) {
      const path = repoPath(root, file);
      for (const text of shownTexts(readFileSync(file, "utf8"), file)) {
        const broken = retiredIn(text, path, rules);
        if (broken.length > 0)
          findings.push({ file: path, text, rules: broken });
      }
    }
  }
  return findings;
}

/**
 * Whether a place in the allowed list covers a file: a folder (ending in
 * "/") covers everything beneath it, a file only itself.
 */
function covers(place, file) {
  return place.endsWith("/") ? file.startsWith(place) : file === place;
}

/** Whether every word a finding breaks is allowed at its place. */
function allowedHere(finding, allowed) {
  return finding.rules.every(rule =>
    allowed.some(a => covers(a.place, finding.file) && a.rules.includes(rule))
  );
}

/** How many times each `file` and `text` pair occurs in a list of them. */
function tally(pairs) {
  const counts = new Map();
  for (const { file, text } of pairs) {
    const key = JSON.stringify([file, text]);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

/** The pending list as pairs, one per listed occurrence. */
function pendingPairs(pending) {
  return Object.entries(pending).flatMap(([file, texts]) =>
    texts.map(text => ({ file, text }))
  );
}

/**
 * The findings neither allowed by their place nor listed as still to rename.
 * The list counts: a text listed once and shown twice in one file leaves the
 * second showing a finding.
 *
 * @param {readonly { file: string, text: string, rules: readonly string[] }[]} findings
 * @param {Readonly<Record<string, readonly string[]>>} pending texts by file, once per showing
 * @param {readonly { place: string, rules: readonly string[] }[]} allowed
 */
export function unlisted(findings, pending, allowed) {
  const left = tally(pendingPairs(pending));
  return findings.filter(finding => {
    if (allowedHere(finding, allowed)) return false;
    const key = JSON.stringify([finding.file, finding.text]);
    const listed = left.get(key) ?? 0;
    if (listed === 0) return true;
    left.set(key, listed - 1);
    return false;
  });
}

/**
 * Listed texts still to rename that are no longer shown there as often, so
 * the list can only shrink: a rename that forgets its entry fails, and so
 * does an entry for a text that was never shown.
 */
export function stalePending(findings, pending) {
  const shown = tally(findings.filter(f => f.rules.length > 0));
  const stale = [];
  for (const [key, listed] of tally(pendingPairs(pending))) {
    const extra = listed - (shown.get(key) ?? 0);
    const [file, text] = JSON.parse(key);
    for (let n = 0; n < extra; n += 1) stale.push(`${file}: ${text}`);
  }
  return stale;
}

/** Allowed places and rules that no longer hold a finding to allow. */
export function staleAllowed(findings, allowed) {
  return allowed.flatMap(a =>
    a.rules
      .filter(
        rule =>
          !findings.some(f => f.rules.includes(rule) && covers(a.place, f.file))
      )
      .map(rule => `${a.place} (${rule})`)
  );
}
