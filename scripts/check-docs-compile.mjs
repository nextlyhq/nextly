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
 * A page can also compile and still not render: `<Warning>` is JSX to the compiler and
 * needs no import, and the site throws at render time for a component it never
 * registered. So every component a page uses is held to the set the site provides, read
 * off the syntax tree so a `<T>` inside a code sample is never mistaken for one.
 *
 * Usage:
 *   node scripts/check-docs-compile.mjs
 */

import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

import { compile } from "@mdx-js/mdx";

/**
 * The components a documentation page may use.
 *
 * The site registers these in `app/docs/[[...slug]]/page.tsx` of nextly-site: Fumadocs'
 * default MDX components, plus the ones the page adds. A lowercase tag is HTML and is not
 * checked. This list is a copy of the site's, kept here because the docs cannot read it;
 * when a component is added there, add it here in the same change.
 */
export const SITE_COMPONENTS = new Set([
  "Callout",
  "CalloutContainer",
  "CalloutTitle",
  "CalloutDescription",
  "Card",
  "Cards",
  "CodeBlockTab",
  "CodeBlockTabs",
  "CodeBlockTabsList",
  "CodeBlockTabsTrigger",
  "Tab",
  "Tabs",
  "Accordion",
  "Accordions",
  "Step",
  "Steps",
  "File",
  "Files",
  "Folder",
]);

/** Whether a syntax-tree node is a JSX element with a name, block or inline. */
function isNamedJsx(node) {
  const jsx =
    node.type === "mdxJsxFlowElement" || node.type === "mdxJsxTextElement";
  return jsx && Boolean(node.name);
}

/** A remark plugin that records the name of every component a page uses. */
function collectComponents(names) {
  const visit = node => {
    if (isNamedJsx(node)) names.add(node.name);
    for (const child of node.children ?? []) visit(child);
  };
  return () => visit;
}

/** Whether a tag names a component rather than an HTML element. */
function isComponent(name) {
  return /^[A-Z]/.test(name);
}

/**
 * The page body without the frontmatter block it opens with, and how many lines that
 * block took, so a position the compiler reports can be given in the file's own lines.
 */
export function withoutFrontmatter(source) {
  const match = /^---\r?\n[\s\S]*?\r?\n---\r?\n/.exec(source);
  if (!match) return { body: source, skipped: 0 };
  return {
    body: source.slice(match[0].length),
    skipped: match[0].split("\n").length - 1,
  };
}

/**
 * Why a page does not compile, or `null`.
 *
 * The compiler's own message, with its position in the FILE, so the finding points at the
 * character the parser stopped on rather than at the page.
 */
export async function compileFinding(source) {
  const { body, skipped } = withoutFrontmatter(source);
  const names = new Set();
  try {
    await compile(body, {
      format: "mdx",
      remarkPlugins: [collectComponents(names)],
    });
  } catch (error) {
    return describeFailure(error, skipped);
  }
  const unknown = [...names].filter(
    name => isComponent(name) && !SITE_COMPONENTS.has(name)
  );
  if (unknown.length === 0) return null;
  return {
    where: "",
    message: `uses ${unknown.map(name => `<${name}>`).join(", ")}, which the site does not register; the page compiles and fails to render`,
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

/** The pages git tracks under `docs/`, which is the set the site fetches. */
function trackedPages(repoRoot) {
  const out = execFileSync("git", ["ls-files", "-z", "--", "docs"], {
    cwd: repoRoot,
    encoding: "utf-8",
  });
  return out.split("\0").filter(rel => rel.endsWith(".mdx"));
}

export async function checkDocsCompile(repoRoot) {
  const pages = trackedPages(repoRoot);
  const findings = [];
  for (const rel of pages) {
    const finding = await compileFinding(
      readFileSync(join(repoRoot, rel), "utf-8")
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
