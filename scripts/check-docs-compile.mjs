#!/usr/bin/env node

/**
 * Every documentation page compiles as MDX.
 *
 * The pages under `docs/` are not rendered by this repository. nextlyhq.com fetches them
 * at its build and compiles them there, so a page that does not parse is green here and
 * fails the site's next deploy. One closing tag indented under a list item is enough:
 * the parser reads it as part of the item, and the element it should close is never
 * closed.
 *
 * So the pages are compiled here, with the compiler the site's MDX pipeline is built on,
 * and a page the compiler rejects is reported with the file, line and column the compiler
 * names. Frontmatter is taken off first, because the site's loader reads it separately and
 * the compiler would otherwise parse the YAML as Markdown.
 *
 * A page can also compile and still not render. `<Warning>` is JSX to the compiler and
 * needs no import, and the site throws at render time for a component it never
 * registered; frontmatter the site's page schema refuses, a missing title or YAML that
 * does not parse, never reaches the renderer at all. So the frontmatter is split and
 * parsed exactly as the site's loader does it, and every component a page uses is held to
 * `docs/components.json`, the contract kept beside the pages that the site holds itself
 * to from the other side. Read off the syntax tree, expressions included, so a `<T>` inside
 * a code sample is never mistaken for a component and `{cond && <Warning />}` is not missed.
 *
 * Usage:
 *   node scripts/check-docs-compile.mjs
 */

import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

import { compile } from "@mdx-js/mdx";
import { load } from "js-yaml";

/** The contract a page's components are held to, kept beside the pages themselves. */
export const COMPONENTS_CONTRACT = "docs/components.json";

/**
 * The frontmatter block, split exactly as the site's loader splits it.
 *
 * The site takes the block with this expression and parses it with js-yaml, so the same
 * expression and the same parser are used here: a block the site would refuse is refused
 * here, and a block the site would read is read the same way. The line count is kept so a
 * position the compiler reports on the body can be given in the file's own lines.
 */
const FRONTMATTER = /^---\r?\n(.+?)\r?\n---\r?\n?/s;

export function splitFrontmatter(source) {
  const match = FRONTMATTER.exec(source);
  if (!match) return { body: source, skipped: 0, data: {} };
  return {
    body: source.slice(match[0].length),
    skipped: match[0].split("\n").length - 1,
    data: load(match[1]),
  };
}

/** The fields the site's page schema types, and the type each must have when present. */
const PAGE_FIELDS = [
  ["description", "string"],
  ["icon", "string"],
  ["full", "boolean"],
];

function isMapping(data) {
  return data !== null && typeof data === "object" && !Array.isArray(data);
}

function hasTitle(data) {
  return typeof data.title === "string" && data.title.trim() !== "";
}

/** The typed fields present with the wrong type. */
function mistyped(data) {
  return PAGE_FIELDS.filter(
    ([key, type]) => key in data && typeof data[key] !== type
  ).map(([key]) => key);
}

/**
 * Why the frontmatter is not what the site's page schema accepts, or `null`.
 *
 * The site validates a page's frontmatter with a schema that requires a `title` string and
 * accepts `description` and `icon` as strings and `full` as a boolean. A page failing that
 * never renders, whatever its body does, so it is refused here first.
 */
export function frontmatterFinding(data) {
  if (!isMapping(data)) return "frontmatter is not a mapping";
  if (!hasTitle(data))
    return "frontmatter has no title, which the site's page schema requires";
  const wrong = mistyped(data);
  if (wrong.length === 0) return null;
  return `frontmatter ${wrong.join(", ")} is not the type the site's page schema accepts`;
}

/** Whether a syntax-tree node is a JSX element with a name, block or inline. */
function isNamedJsx(node) {
  const jsx =
    node.type === "mdxJsxFlowElement" || node.type === "mdxJsxTextElement";
  return jsx && Boolean(node.name);
}

/** The names of every component a page uses, read off the syntax tree. */
function componentNames(tree) {
  const names = new Set();
  const visit = node => {
    // `<Foo.Bar>` is a member of `Foo`, and `Foo` is what the site registers.
    if (isNamedJsx(node)) names.add(node.name.split(".")[0]);
    visitEstree(node.data?.estree, names);
    (node.children ?? []).forEach(visit);
  };
  visit(tree);
  return names;
}

/** The ESTree nodes directly under one, whichever properties hold them. */
function estreeChildren(node) {
  const isNode = value =>
    value !== null && typeof value === "object" && "type" in value;
  return Object.values(node)
    .flatMap(value => (Array.isArray(value) ? value : [value]))
    .filter(isNode);
}

/**
 * JSX inside an MDX expression, `{cond && <Warning />}`, is not a child of the expression
 * node: it lives in the expression's ESTree. Walked for opening elements, whose name is an
 * identifier or, for `<Foo.Bar>`, a member expression rooted in one.
 */
function visitEstree(node, names) {
  if (!node) return;
  if (node.type === "JSXOpeningElement") names.add(jsxName(node.name));
  estreeChildren(node).forEach(child => visitEstree(child, names));
}

function jsxName(node) {
  return node.type === "JSXMemberExpression" ? jsxName(node.object) : node.name;
}

/** Whether a tag names a component rather than an HTML element. */
function isComponent(name) {
  return /^[A-Z]/.test(name);
}

/** A remark plugin that hands the finished tree to `receive`. */
function collectTree(receive) {
  return () => tree => {
    receive(tree);
  };
}

/** The page split and parsed, or the finding that stops it being read at all. */
function parsePage(source) {
  try {
    const page = splitFrontmatter(source);
    const finding = frontmatterFinding(page.data);
    return finding ? { finding: { where: ":1", message: finding } } : { page };
  } catch (error) {
    return {
      finding: {
        where: ":1",
        message: `frontmatter is not YAML: ${error.reason ?? error.message}`,
      },
    };
  }
}

/** The tree of a body the compiler accepts, or the finding that names where it stopped. */
async function compileBody(page) {
  let tree;
  try {
    await compile(page.body, {
      format: "mdx",
      remarkPlugins: [collectTree(t => (tree = t))],
    });
    return { tree };
  } catch (error) {
    return { finding: describeFailure(error, page.skipped) };
  }
}

/**
 * Why a page would not render on the site, or `null`.
 *
 * In order: frontmatter the site's schema refuses, a body the compiler refuses (reported
 * with the file's own line and column), and a component the site does not register, which
 * compiles and then throws at render.
 */
export async function compileFinding(source, allowed) {
  const parsed = parsePage(source);
  if (parsed.finding) return parsed.finding;
  const compiled = await compileBody(parsed.page);
  if (compiled.finding) return compiled.finding;
  const unknown = [...componentNames(compiled.tree)].filter(
    name => isComponent(name) && !allowed.has(name)
  );
  if (unknown.length === 0) return null;
  return {
    where: "",
    message: `uses ${unknown.map(name => `<${name}>`).join(", ")}, which ${COMPONENTS_CONTRACT} does not list; the page compiles and fails to render`,
  };
}

/**
 * The compiler's own position and message, the position moved back into the file.
 *
 * A parse failure is a `VFileMessage`, which carries `line`, `column` and `reason`; a
 * failure of any other kind has none of them and is reported by its text alone.
 */
function describeFailure(error, skipped) {
  const { line, column, reason } = error;
  const where = line ? `:${line + skipped}:${column}` : "";
  return { where, message: reason ?? String(error) };
}

/** The components the contract allows, or a refusal when the contract cannot be read. */
export function allowedComponents(repoRoot) {
  const parsed = JSON.parse(
    readFileSync(join(repoRoot, COMPONENTS_CONTRACT), "utf-8")
  );
  if (
    !Array.isArray(parsed.components) ||
    parsed.components.some(name => typeof name !== "string")
  ) {
    throw new Error(
      `${COMPONENTS_CONTRACT}: "components" must be a list of names`
    );
  }
  return new Set(parsed.components);
}

/** The pages git tracks under `docs/`, which is the set the site fetches. */
function trackedPages(repoRoot) {
  const out = execFileSync("git", ["ls-files", "-z", "--", "docs"], {
    cwd: repoRoot,
    encoding: "utf-8",
  });
  return out.split("\0").filter(rel => rel.endsWith(".mdx"));
}

export async function checkDocsCompile(repoRoot) {
  const allowed = allowedComponents(repoRoot);
  const pages = trackedPages(repoRoot);
  const findings = [];
  for (const rel of pages) {
    const finding = await compileFinding(
      readFileSync(join(repoRoot, rel), "utf-8"),
      allowed
    );
    if (finding) findings.push({ file: rel, ...finding });
  }
  return { pages: pages.length, findings };
}

const invokedDirectly =
  process.argv[1] && process.argv[1].endsWith("check-docs-compile.mjs");

if (invokedDirectly) {
  const { pages, findings } = await checkDocsCompile(process.cwd());
  if (pages === 0) {
    console.error(
      "docs compile: git tracks no page under docs/, so nothing was compiled"
    );
    process.exit(1);
  }
  if (findings.length > 0) {
    console.error(
      `docs compile: ${findings.length} of ${pages} page(s) do not compile`
    );
    for (const { file, where, message } of findings) {
      console.error(`  ${file}${where} — ${message}`);
    }
    process.exit(1);
  }
  console.log(`docs compile: ${pages} pages compile.`);
}
