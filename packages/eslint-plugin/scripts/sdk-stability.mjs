/**
 * Writes `src/sdk-stability.json`: which surfaces of `@nextlyhq/plugin-sdk`
 * are `@experimental`, read from the SDK's own stability record.
 *
 * The record is two things the SDK keeps, and this reads both rather than a
 * list kept by hand beside them, which would start drifting the first time a
 * surface graduated and only one copy was edited:
 * - `packages/plugin-sdk/STABILITY.md`, whose stable and experimental tables
 *   name exports in backticks. It says that where it and a doc comment
 *   disagree, the table wins, so a name its stable table lists is never
 *   flagged, and a name its experimental table lists always is.
 * - the TSDoc release tags on each entry point's export statements, for the
 *   names the tables do not mention. A tag covers the whole statement when it
 *   is the doc comment's only release tag; when a comment carries both
 *   `@public` and `@experimental`, a name is experimental only where the
 *   `@experimental` paragraph names it in backticks. A module comment's tag
 *   (`@module`, `@packageDocumentation`) covers the whole entry point.
 *
 * `PluginContext`'s members are recorded too, nested ones as dotted paths
 * (`db`, `services.ownCollections`), from each member's own doc comment.
 *
 * A tag counts only where TSDoc reads one, at the start of a doc-comment line:
 * a tag named in prose, such as "a `@public` or `@experimental` tag", does not.
 *
 * Usage: `node scripts/sdk-stability.mjs` rewrites the file; `--check` exits 1
 * when the committed file is out of date.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseSync } from "oxc-parser";

const here = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(here, "..");
const repoRoot = path.resolve(packageRoot, "../..");

export const MANIFEST_PATH = path.join(packageRoot, "src/sdk-stability.json");
const SDK_ROOT = path.join(repoRoot, "packages/plugin-sdk");
const CONTEXT_SOURCE = path.join(
  repoRoot,
  "packages/nextly/src/plugins/plugin-context.ts"
);
const SDK_NAME = "@nextlyhq/plugin-sdk";

const RELEASE_TAG = /^\s*\*?\s*@(public|experimental)\b/;
const MODULE_TAG = /^\s*\*?\s*@(module|packageDocumentation)\b/m;
const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

/**
 * A doc comment's release-tag paragraphs: each `@public` or `@experimental`
 * line with the lines after it, up to the next tag of any kind.
 */
export function releaseParagraphs(docText) {
  const paragraphs = [];
  let current = null;
  for (const line of docText.split("\n")) {
    const release = RELEASE_TAG.exec(line);
    if (release) {
      current = { tag: release[1], text: line };
      paragraphs.push(current);
    } else if (/^\s*\*?\s*@\w/.test(line)) {
      current = null;
    } else if (current) {
      current.text += `\n${line}`;
    }
  }
  return paragraphs;
}

/** Every backticked identifier in a stretch of text. */
function backticked(text) {
  return [...text.matchAll(/`([^`]+)`/g)]
    .map(match => match[1])
    .filter(name => IDENTIFIER.test(name));
}

/** Whether a doc comment marks `name`, exported by its statement, experimental. */
export function docMarksExperimental(docText, name) {
  const paragraphs = releaseParagraphs(docText);
  const tags = new Set(paragraphs.map(p => p.tag));
  if (!tags.has("experimental")) return false;
  if (!tags.has("public")) return true;
  return paragraphs.some(
    p => p.tag === "experimental" && backticked(p.text).includes(name)
  );
}

/** The doc comment directly before `start`, with only whitespace between. */
function leadingDoc(source, comments, start) {
  const before = comments.filter(
    c => c.type === "Block" && c.value.startsWith("*") && c.end <= start
  );
  const last = before[before.length - 1];
  if (!last || source.slice(last.end, start).trim() !== "") return "";
  return last.value;
}

function parse(file) {
  const source = readFileSync(file, "utf8");
  const result = parseSync(file, source, { sourceType: "module", lang: "ts" });
  if (result.errors.length > 0) {
    throw new Error(`${file}: ${result.errors[0].message}`);
  }
  return { source, ...result };
}

/** The names an export statement makes public. */
function exportedNames(node) {
  if (node.specifiers?.length) {
    return node.specifiers.map(s => s.exported.name ?? s.exported.value);
  }
  const declaration = node.declaration;
  if (!declaration) return [];
  if (declaration.id?.name) return [declaration.id.name];
  return (declaration.declarations ?? []).map(d => d.id.name).filter(Boolean);
}

/** Whether the file's module comment marks the whole entry point experimental. */
function moduleIsExperimental(comments) {
  const moduleDoc = comments.find(
    c =>
      c.type === "Block" && c.value.startsWith("*") && MODULE_TAG.test(c.value)
  );
  if (!moduleDoc) return false;
  const tags = releaseParagraphs(moduleDoc.value).map(p => p.tag);
  return tags.length > 0 && tags.every(tag => tag === "experimental");
}

/** Each name one SDK entry file exports, with whether its tags call it experimental. */
export function taggedExports(file) {
  const { source, comments, program } = parse(file);
  const wholeModule = moduleIsExperimental(comments);
  const names = new Map();
  for (const node of program.body) {
    if (node.type !== "ExportNamedDeclaration") continue;
    const doc = leadingDoc(source, comments, node.start);
    for (const name of exportedNames(node)) {
      names.set(name, wholeModule || docMarksExperimental(doc, name));
    }
  }
  return names;
}

/** One table row's Exports cell: the second `|`-separated column. */
function exportsCell(row) {
  return row.split("|")[2] ?? "";
}

/**
 * The names STABILITY.md's tables settle. `stable`: the stable table's names,
 * less any it marks "(experimental)" in place. `experimental`: those, plus the
 * experimental table's names. The stable table wins where both name one, since
 * an experimental row names a stable type as the carrier of what it adds
 * ("`capabilities` … on `PluginDefinition`") without making that type
 * experimental.
 */
export function readStabilityTables(markdown) {
  const stable = new Set();
  const experimental = new Set();
  let section = "";
  for (const line of markdown.split("\n")) {
    if (line.startsWith("## ")) section = line;
    if (!line.startsWith("| ") || /^\|\s*-/.test(line)) continue;
    const pattern = /`([^`]+)`(\s*\((?:\*\*)?experimental)?/gi;
    for (const match of exportsCell(line).matchAll(pattern)) {
      if (!IDENTIFIER.test(match[1])) continue;
      const inStableTable = section.includes("Stable surface");
      if (inStableTable && !match[2]) stable.add(match[1]);
      else if (inStableTable || section.includes("Experimental surface")) {
        experimental.add(match[1]);
      }
    }
  }
  for (const name of stable) experimental.delete(name);
  return { stable, experimental };
}

/** Each import specifier the SDK publishes, with the source file behind it. */
export function sdkEntryPoints(sdkRoot = SDK_ROOT) {
  const manifest = JSON.parse(
    readFileSync(path.join(sdkRoot, "package.json"), "utf8")
  );
  return Object.entries(manifest.exports)
    .filter(([subpath]) => !subpath.endsWith(".json"))
    .map(([subpath, target]) => {
      const built = typeof target === "string" ? target : target.import;
      const relative = built
        .replace(/^\.\/dist\//, "src/")
        .replace(/\.mjs$/, ".ts");
      return {
        specifier:
          subpath === "." ? SDK_NAME : `${SDK_NAME}/${subpath.slice(2)}`,
        file: path.join(sdkRoot, relative),
      };
    });
}

/** The experimental names one entry point exports, the table winning over tags. */
export function experimentalExports(file, tables) {
  const out = [];
  for (const [name, tagged] of taggedExports(file)) {
    if (tables.stable.has(name)) continue;
    if (tagged || tables.experimental.has(name)) out.push(name);
  }
  return out.sort();
}

function interfaceMembers(program, name) {
  for (const node of program.body) {
    const declaration =
      node.type === "ExportNamedDeclaration" ? node.declaration : node;
    if (
      declaration?.type === "TSInterfaceDeclaration" &&
      declaration.id.name === name
    ) {
      return declaration.body.body;
    }
  }
  throw new Error(`interface ${name} not found`);
}

function collectMembers(members, doc, prefix, out) {
  for (const member of members) {
    if (member.type !== "TSPropertySignature" || !member.key?.name) continue;
    const key = `${prefix}${member.key.name}`;
    const text = leadingDoc(doc.source, doc.comments, member.start);
    if (releaseParagraphs(text).some(p => p.tag === "experimental")) {
      out.push(key);
    }
    const type = member.typeAnnotation?.typeAnnotation;
    if (type?.type === "TSTypeLiteral") {
      collectMembers(type.members, doc, `${key}.`, out);
    }
  }
}

/** `PluginContext`'s experimental members, nested ones as dotted paths. */
export function experimentalContextMembers(file = CONTEXT_SOURCE) {
  const doc = parse(file);
  const out = [];
  collectMembers(interfaceMembers(doc.program, "PluginContext"), doc, "", out);
  return out.sort();
}

/** The manifest as the rule reads it. */
export function buildManifest() {
  const tables = readStabilityTables(
    readFileSync(path.join(SDK_ROOT, "STABILITY.md"), "utf8")
  );
  const imports = {};
  for (const { specifier, file } of sdkEntryPoints()) {
    const names = experimentalExports(file, tables);
    if (names.length > 0) imports[specifier] = names;
  }
  return {
    $comment:
      "Generated by scripts/sdk-stability.mjs from @nextlyhq/plugin-sdk's STABILITY.md and TSDoc tags. Do not edit: run `pnpm --filter @nextlyhq/eslint-plugin generate`.",
    imports,
    context: experimentalContextMembers(),
  };
}

export function renderManifest() {
  return `${JSON.stringify(buildManifest(), null, 2)}\n`;
}

function main() {
  const next = renderManifest();
  if (!process.argv.includes("--check")) {
    writeFileSync(MANIFEST_PATH, next);
    return;
  }
  if (readFileSync(MANIFEST_PATH, "utf8") !== next) {
    console.error(
      "src/sdk-stability.json is out of date: run `pnpm --filter @nextlyhq/eslint-plugin generate`."
    );
    process.exitCode = 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
