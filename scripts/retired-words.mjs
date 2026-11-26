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
 * line (`New {…}` for `New {labels.singular}`, with a string, each branch of
 * a choice, a template's text, a fragment's text and a constant the file
 * binds once read in place) and the attributes that are
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
 * nothing but shown words. A string compared, matched in a `case`, or looked
 * for by a membership check (`names.has("Normal flow")`) is code everywhere.
 *
 * Plain JavaScript, so it loads under the scripts suite with no build.
 *
 * @module retired-words
 */
import { execFileSync } from "node:child_process";
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
 * `words.ts`. The retired-words list holds rules, and `count-words` counts
 * them; neither holds words.
 */
const WORDS_MODULE =
  /(?:^|\/)(?:words|(?!retired-|count-)[\w-]+-words)\.[cm]?[jt]sx?$/;

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

/**
 * The nodes a value passes through on its way to its slot: a choice's
 * branch, a fallback, or a helper's argument (`pluralise(n, "colour")`),
 * whose result says the word.
 */
function passesThrough(above, below) {
  if (above.type === "ConditionalExpression") return above.test !== below;
  if (above.type === "CallExpression") return above.callee !== below;
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
    // Shown when its own text is words ("Remove {…}"), or only the spaces
    // between words ("{…} {…}", "3 colours"); a code template ("/api/{…}",
    // "nx-{…}") or one with no text of its own is not.
    const own = slot.quasis.map(quasi => quasi.value.cooked ?? "").join("");
    if (own.trim() === "") return own !== "";
    return !CODE_NAME.test(tidy(own));
  }
  if (slot.type === "JSXExpressionContainer") {
    const holder = ancestors[at - 1];
    if (holder?.type === "JSXElement" || holder?.type === "JSXFragment") {
      return true;
    }
    return (
      holder !== undefined &&
      (SHOWN_PLACE.test(placeName(holder) ?? "") ||
        isDrawnValue(holder, ancestors[at - 2]))
    );
  }
  if (slot.type === "Property" && slot.value !== below) return false;
  return (
    SHOWN_PLACE.test(placeName(slot) ?? "") ||
    isDrawnValue(slot, ancestors[at - 1])
  );
}

/** The input types whose `value` is never drawn as text in the field. */
const UNDRAWN_INPUT = /^(?:hidden|checkbox|radio|file|color|range|image)$/;

/**
 * A native form control's value, which the field draws: `value` or
 * `defaultValue` on an `<input>` (unless its type draws none, such as a
 * checkbox or a hidden input) or a `<textarea>`. A component's `value` prop
 * is data, not a label, and stays code.
 */
function isDrawnValue(attribute, opening) {
  if (attribute.type !== "JSXAttribute") return false;
  if (!/^(?:value|defaultValue)$/.test(placeName(attribute) ?? "")) {
    return false;
  }
  if (opening?.type !== "JSXOpeningElement") return false;
  if (opening.name.type !== "JSXIdentifier") return false;
  if (opening.name.name === "textarea") return true;
  if (opening.name.name !== "input") return false;
  const type = opening.attributes.find(
    other => other.type === "JSXAttribute" && placeName(other) === "type"
  );
  const kind =
    type?.value?.type === "Literal" ? String(type.value.value) : "text";
  return !UNDRAWN_INPUT.test(kind);
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
    (parent?.type === "SwitchCase" && parent.test === node) ||
    isMembershipArgument(node, parent)
  );
}

/** The methods that ask whether a list, set or string holds a value. */
const MEMBERSHIP_METHOD =
  /^(?:includes|has|indexOf|lastIndexOf|startsWith|endsWith)$/;

/**
 * The value a membership check looks for, which is matched, not drawn:
 * `allowed.includes("Design tokens")`, `names.has("Normal flow")`.
 */
function isMembershipArgument(node, parent) {
  return (
    parent?.type === "CallExpression" &&
    parent.arguments[0] === node &&
    parent.callee.type === "MemberExpression" &&
    !parent.callee.computed &&
    parent.callee.property.type === "Identifier" &&
    MEMBERSHIP_METHOD.test(parent.callee.property.name)
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

/** The inline elements whose text runs on in the line around them. */
const INLINE_ELEMENT =
  /^(?:a|abbr|b|bdi|bdo|cite|code|data|dfn|em|i|kbd|mark|q|s|samp|small|span|strong|sub|sup|time|u|var)$/;

/** Whether a node is an inline element (`<b>`, `<code>`), by its tag. */
function isInline(node) {
  return (
    node.type === "JSXElement" &&
    node.openingElement.name.type === "JSXIdentifier" &&
    INLINE_ELEMENT.test(node.openingElement.name.name)
  );
}

/**
 * The texts an expression in an element's line can draw: a string or a
 * template as written, each branch of a choice or a fallback
 * (`{kind === "data" ? "data" : "content"}`), and `{…}` for anything else.
 * The strings it reads go into `read`, since the line has read them.
 */
function expressionTexts(node, read, bindings, depth = 0) {
  if (node.type === "TemplateLiteral" && node.expressions.length > 0) {
    // Each interpolation's texts joined with the template's own text, so
    // `Normal ${on ? "flow" : "position"}` reads "Normal flow". The strings
    // inside count as read only when the template is read this way.
    const inside = new Set();
    const joined = joinings(
      node.quasis.flatMap((quasi, at) => {
        const own = [quasi.value.cooked ?? ""];
        const expression = node.expressions[at];
        if (expression === undefined) return [own];
        return [
          own,
          [...new Set(expressionTexts(expression, inside, bindings, depth))],
        ];
      })
    );
    if (joined !== null) {
      for (const string of inside) read.add(string);
      read.add(node);
      return joined;
    }
  }
  if (node.type === "Identifier" && depth < MOST_BINDING_STEPS) {
    // A constant the file binds once: `const label = "token"`, drawn as
    // `{label}`, reads "token".
    const bound = bindings.get(node.name);
    if (bound !== undefined) {
      return expressionTexts(bound, read, bindings, depth + 1);
    }
  }
  const raw = stringText(node);
  if (raw !== null) {
    read.add(node);
    return [raw];
  }
  if (node.type === "ConditionalExpression") {
    return [
      ...expressionTexts(node.consequent, read, bindings, depth),
      ...expressionTexts(node.alternate, read, bindings, depth),
    ];
  }
  if (node.type === "LogicalExpression") {
    return [
      ...expressionTexts(node.left, read, bindings, depth),
      ...expressionTexts(node.right, read, bindings, depth),
    ];
  }
  if (
    node.type === "ParenthesizedExpression" ||
    node.type === "TSAsExpression" ||
    node.type === "TSSatisfiesExpression" ||
    node.type === "TSNonNullExpression"
  ) {
    return expressionTexts(node.expression, read, bindings, depth);
  }
  return ["{…}"];
}

/** How many constants deep a name is followed to its value. */
const MOST_BINDING_STEPS = 4;

/** The names a binding pattern declares: `{ a, b: [c] }` declares a and c. */
function patternNames(pattern) {
  if (pattern === null || pattern === undefined) return [];
  if (pattern.type === "Identifier") return [pattern.name];
  if (pattern.type === "ObjectPattern") {
    return pattern.properties.flatMap(property =>
      patternNames(
        property.type === "RestElement" ? property.argument : property.value
      )
    );
  }
  if (pattern.type === "ArrayPattern")
    return pattern.elements.flatMap(patternNames);
  if (pattern.type === "AssignmentPattern") return patternNames(pattern.left);
  if (pattern.type === "RestElement") return patternNames(pattern.argument);
  if (pattern.type === "TSParameterProperty") {
    return patternNames(pattern.parameter);
  }
  return [];
}

const FUNCTION_NODE =
  /^(?:FunctionDeclaration|FunctionExpression|ArrowFunctionExpression|TSDeclareFunction)$/;

/**
 * The names a file binds once, with `const`, to a value, by name. A name the
 * file binds anywhere else as well (a parameter, an import, a function or
 * another declaration) is left out: which binding an element reads is then
 * not known from its name alone.
 */
function constantBindings(program) {
  const values = new Map();
  const counts = new Map();
  const declare = name => counts.set(name, (counts.get(name) ?? 0) + 1);
  walk(program, (node, ancestors) => {
    if (node.type === "VariableDeclarator") {
      for (const name of patternNames(node.id)) declare(name);
      if (
        node.id.type === "Identifier" &&
        node.init &&
        ancestors.at(-1)?.kind === "const"
      ) {
        values.set(node.id.name, node.init);
      }
    } else if (FUNCTION_NODE.test(node.type)) {
      if (node.id) declare(node.id.name);
      for (const param of node.params) {
        for (const name of patternNames(param)) declare(name);
      }
    } else if (node.type === "CatchClause") {
      for (const name of patternNames(node.param)) declare(name);
    } else if (/^Import(?:Default|Namespace)?Specifier$/.test(node.type)) {
      declare(node.local.name);
    } else if (node.type === "ClassDeclaration" && node.id) {
      declare(node.id.name);
    }
  });
  for (const name of values.keys()) {
    if (counts.get(name) !== 1) values.delete(name);
  }
  return values;
}

/**
 * One run of an element's children as parts of a line, each part the texts
 * it can draw: text, an expression's texts, and an inline element's or a
 * fragment's own parts in its place, so "Normal <b>flow</b>",
 * "Normal <>flow</>" and `Normal {"flow"}` all read "Normal flow". Any other
 * element breaks the line.
 */
function elementParts(children, read, bindings) {
  return children.flatMap(child => {
    if (child.type === "JSXText") return [[child.value]];
    if (child.type === "JSXExpressionContainer") {
      if (child.expression.type === "JSXEmptyExpression") return [];
      return [[...new Set(expressionTexts(child.expression, read, bindings))]];
    }
    if (runsOn(child)) return elementParts(child.children, read, bindings);
    return [[" "]];
  });
}

/**
 * Whether a child's text runs on in its parent's line: an inline element,
 * or a fragment, which draws its children where it stands.
 */
function runsOn(node) {
  return isInline(node) || node.type === "JSXFragment";
}

/** The most lines one element's choices are read as, every combination. */
const MOST_COMBINATIONS = 64;

/**
 * Every text a run of parts joins into, one text from each part in turn, or
 * null past `MOST_COMBINATIONS`.
 */
function joinings(parts) {
  const count = parts.reduce((total, part) => total * part.length, 1);
  if (count > MOST_COMBINATIONS) return null;
  return parts.reduce(
    (lines, part) => lines.flatMap(line => part.map(text => `${line}${text}`)),
    [""]
  );
}

/**
 * The lines a run of parts can read: every combination of its parts'
 * texts, so two choices side by side
 * (`{a ? "Normal" : "Default"} {b ? "flow" : "position"}`) read "Normal
 * flow". Past `MOST_COMBINATIONS`, one line per text of each varying part,
 * with every other varying part read as `{…}`, so each branch is still read
 * beside the fixed text around it.
 */
function partLines(parts) {
  const joined = joinings(parts);
  if (joined !== null) return joined.map(tidy);
  const line = (at, text) =>
    tidy(
      parts
        .map((part, i) => {
          if (i === at) return text;
          return part.length > 1 ? "{…}" : part[0];
        })
        .join("")
    );
  const varying = parts.flatMap((part, at) => (part.length > 1 ? [at] : []));
  return varying.flatMap(at => parts[at].map(text => line(at, text)));
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

/**
 * An element's own lines (one, or one per branch of a choice in it), or
 * null where it draws only `{…}`, or where it is an inline element read as
 * part of its parent's line. The strings its lines read go into `read`.
 */
function elementLines(node, ancestors, read, bindings) {
  if (node.type !== "JSXElement" && node.type !== "JSXFragment") return null;
  const parent = ancestors.at(-1);
  if (
    runsOn(node) &&
    (parent?.type === "JSXElement" || parent?.type === "JSXFragment")
  ) {
    return null;
  }
  const own = new Set();
  const lines = [
    ...new Set(
      partLines(elementParts(node.children, own, bindings)).filter(
        line => line.replace(/\{…\}/g, "").trim() !== ""
      )
    ),
  ];
  if (lines.length === 0) return null;
  for (const string of own) read.add(string);
  return lines;
}

/**
 * What an author could read in one source file, in source order, one entry
 * per showing: an element's lines together (one per branch of a choice in
 * it), any other text alone. A stylesheet's comments inside a string are
 * dropped, since they are never drawn.
 */
function shownReadings(source, fileName) {
  // Each reading keeps the string it came from, so a string an element's
  // line read in place (a constant declared above the element, say) is
  // dropped once the walk is done rather than read again alone.
  const readings = [];
  const read = new Set();
  const wordsModule = WORDS_MODULE.test(fileName.split("\\").join("/"));
  const { program } = parseSource(source, fileName);
  const bindings = constantBindings(program);
  walk(program, (node, ancestors) => {
    const lines = elementLines(node, ancestors, read, bindings);
    if (lines !== null) {
      readings.push({ node: null, lines });
      return;
    }
    if (read.has(node)) return;
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
    const shownPlace = inShownPlace(node, ancestors);
    if (!shownPlace && (LOG_TAG.test(text) || CSS_TEXT.test(text))) return;
    if (notShown(node, ancestors)) return;
    readings.push({ node, lines: [text] });
  });
  return readings
    .filter(reading => reading.node === null || !read.has(reading.node))
    .map(reading => reading.lines);
}

/** The texts an author could read in one source file, in source order. */
export function shownTexts(source, fileName) {
  return shownReadings(source, fileName).flat();
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
 * finding per time the text is shown, with every rule it breaks. Of one
 * showing's lines (an element's, one per branch of a choice in it), a later
 * line is a finding only where it breaks a rule the earlier ones did not, so
 * the fixed text around a choice counts once.
 */
export function findRetired(root, rules, folders = SCANNED) {
  const findings = [];
  for (const folder of folders) {
    for (const file of shippedFiles(join(root, folder))) {
      const path = repoPath(root, file);
      for (const lines of shownReadings(readFileSync(file, "utf8"), file)) {
        const found = new Set();
        for (const text of lines) {
          const broken = retiredIn(text, path, rules);
          if (broken.every(rule => found.has(rule))) continue;
          for (const rule of broken) found.add(rule);
          findings.push({ file: path, text, rules: broken });
        }
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

/**
 * Listed texts the list holds more often than its copy at the base did: an
 * entry a change added, which the list's only-shrinks rule refuses. Renaming
 * one text while listing another keeps the list's size, and is still found.
 */
export function addedPending(base, pending) {
  const before = tally(pendingPairs(base));
  const added = [];
  for (const [key, listed] of tally(pendingPairs(pending))) {
    const extra = listed - (before.get(key) ?? 0);
    const [file, text] = JSON.parse(key);
    for (let n = 0; n < extra; n += 1) added.push(`${file}: ${text}`);
  }
  return added;
}

/** Where the list of texts still to rename lives, from the repository root. */
export const PENDING_FILE = "scripts/retired-words-pending.json";

/**
 * The commit the list is held to, which it may only lose entries against:
 * `RETIRED_WORDS_BASE` when set; in GitHub Actions the checkout's first
 * parent, which on a pull request's merge commit is the base branch's tip
 * and on a push the commit before it; otherwise where this branch left
 * `origin/dev`.
 */
export function pendingBase(root, env = process.env) {
  if (env.RETIRED_WORDS_BASE) return env.RETIRED_WORDS_BASE;
  if (env.GITHUB_ACTIONS === "true") return "HEAD^1";
  return git(root, ["merge-base", "HEAD", "origin/dev"]).trim();
}

/**
 * The list as it stood at `ref`, or null where that commit has no list yet
 * (the change that adds it). A commit that cannot be read fails rather
 * than skips, since a skipped comparison would hold the list to nothing.
 */
export function pendingAt(root, ref) {
  git(root, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
  try {
    git(root, ["cat-file", "-e", `${ref}:${PENDING_FILE}`]);
  } catch {
    return null;
  }
  return JSON.parse(git(root, ["show", `${ref}:${PENDING_FILE}`]));
}

function git(root, args) {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/**
 * The files that decide how shown text is read: this reader and the rules.
 * A change to either reads today's text anew, so its pending entries may
 * change with it.
 */
export const READER_FILES = [
  "scripts/retired-words.mjs",
  "packages/builder/src/glossary/retired-words.ts",
];

/**
 * Whether the reader or the rules differ from `ref`, counting changes not
 * yet committed. A change that reads text anew re-reads today's showings
 * (one text becomes another, a newly visible showing joins), and those
 * entries are judged in its review, in the list's own diff, rather than
 * refused as additions.
 */
export function readerChangedSince(root, ref) {
  try {
    git(root, ["diff", "--quiet", ref, "--", ...READER_FILES]);
    return false;
  } catch (error) {
    if (error?.status === 1) return true;
    throw error;
  }
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
