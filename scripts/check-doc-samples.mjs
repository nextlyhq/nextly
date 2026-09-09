#!/usr/bin/env node
/**
 * Compile every TypeScript sample this site publishes against the `nextly` it
 * actually depends on.
 *
 * Published code is a claim like any other, and it was the least true thing on
 * the site: every sample used `result.docs`, which the Direct API has never
 * had; every one called `getNextly()` with no config, which cannot populate the
 * registry that `find` needs; and the homepage's demo destructured `data` from
 * a result that has neither. Prose that is wrong is embarrassing. A tutorial
 * that is wrong wastes a reader's afternoon and then loses them.
 *
 * Nothing else can catch this. `check-types` compiles the site's own source,
 * and these samples are string literals to it. So they are extracted and
 * compiled as real files, against the installed package rather than a copy of
 * its API written down somewhere.
 *
 * Samples are not expected to run: they reference `./collections/Posts` and
 * other files a reader would have. Module resolution failures for relative
 * imports are therefore ignored, and nothing else is.
 *
 * Only samples that IMPORT something are compiled. The rest are fragments that
 * illustrate a shape rather than a file a reader can paste, and a bare object
 * literal is not a program: it parses as a block with labels, so compiling one
 * reports syntax errors that say nothing about whether the API is real. The
 * count of skipped fragments is printed, so the gap is visible rather than
 * quietly assumed to be zero.
 */

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

/**
 * A fenced block in Markdown, or in a Markdown string inside a template literal.
 *
 * The language token may be followed by metadata on the same line, as in
 * a fence opening with `typescript title="src/db.ts"`. Requiring a newline
 * straight after the token dropped 46 of the 327 TypeScript fences in the
 * documentation without saying so, which is the failure this whole check exists
 * to prevent: a smaller number that still reads like a clean one.
 *
 * Both delimiters are LINE-ORIENTED, and the closer must be at least as long as
 * the opener, which is what Markdown itself requires. An unanchored closer
 * stopped the capture at three backticks appearing inside a string or a comment,
 * so the audit compiled a truncated sample, could report a parse error the page
 * does not have, and silently dropped the rest of the block. It also read a
 * four-backtick fence — the form a page uses when its content contains a fence —
 * as a three-backtick one.
 */
// One pattern per representation, chosen by the surface, so an escaped
// delimiter can never close a raw fence or the other way round. A single
// pattern that accepted either form read `` ```\` `` inside a comment as a
// closer and truncated the block there.
//
// `\r` is tolerated around the closer: a checkout with CRLF endings leaves one
// after the delimiter, and without this every fence but the last in such a file
// is dropped from the gate and the audit without a word.
//
// A CONTAINER PREFIX is allowed before either delimiter and stripped from the
// body. A blockquoted fence is ordinary Markdown, and `plugins/admin-ui.mdx`
// has two; anchoring on whitespace alone dropped both from the gate and the
// audit, which the loose pattern this replaced had at least found.
// Both delimiter families. CommonMark allows `~~~` as well as ```` ``` ````, and
// recognising only backticks meant a `~~~ts` block was invisible: it entered no
// count, so publishing one that does not compile lowered no coverage number and
// passed. The closing run is a backreference, so a fence still has to close with
// what it opened with.
const RAW_FENCE =
  /(?:^|\n)([ \t]*(?:>[ \t]*)*)(```+|~~~+)(\w*)([^\n]*)\n([\s\S]*?)\r?\n[ \t]*(?:>[ \t]*)*\2[`~]*[ \t\r]*(?=\n|$)/g;
const ESCAPED_FENCE =
  /(?:^|\n)([ \t]*(?:>[ \t]*)*)((?:\\`){3,})(\w*)([^\n]*)\n([\s\S]*?)\r?\n[ \t]*(?:>[ \t]*)*\2(?:\\`)*[ \t\r]*(?=\n|$)/g;

/**
 * Take the blockquote markers off a body, and only when it had them.
 *
 * Stripping unconditionally would eat a `>` that opens a line of real code.
 */
const stripContainer = (body, prefix) =>
  prefix.includes(">")
    ? body
        .split("\n")
        .map(line => line.replace(/^[ \t]*>[ \t]?/, ""))
        .join("\n")
    : body;

/** Unescape what a TypeScript template literal escapes. */
const unescapeTemplate = s =>
  s.replaceAll("\\`", "`").replaceAll("\\${", "${").replaceAll("\\\\", "\\");

/** Is this sample TypeScript we can compile, rather than shell or output? */
const isTypeScript = lang =>
  lang === "typescript" || lang === "ts" || lang === "tsx";

/** JSX needs a .tsx extension or the parser reads `<` as a type argument. */
const looksLikeJsx = code => /<\/[A-Za-z]|\/>/.test(code);

/**
 * A TypeScript fence that opens and never closes.
 *
 * `matchAll` yields nothing for one, so the sample is not extracted, not
 * counted and not compiled. On an existing page the coverage ratchet catches
 * the loss; on a NEW page, or one that had no TypeScript before, there is no
 * held count to fall below, so a malformed block changes no protected value and
 * passes while the rest of the page renders as code. Breaking a fence and then
 * rewriting the baseline over the broken tree is how this gate was defeated
 * once already, from the inside.
 *
 * Returns the opening lines, one per unterminated fence, so the report can say
 * where to look.
 */
export function unterminatedFences(text) {
  const opener = /^[ \t]*(?:>[ \t]*)*(```+|~~~+)(\w*)/;
  const open = [];
  for (const line of text.split("\n")) {
    const m = line.match(opener);
    if (!m) continue;
    const last = open[open.length - 1];
    // A closer carries the delimiter and nothing else. Checking only that the
    // language capture was empty accepted ```` ```{.foo} ```` as one, because
    // `\w*` matches nothing before a brace; `extractFrom` rejects that line, so
    // the fence went neither extracted nor reported.
    const closes =
      last &&
      m[1].startsWith(last.delimiter) &&
      /^[ \t]*(?:>[ \t]*)*(?:```+|~~~+)[ \t\r]*$/.test(line);
    if (closes) open.pop();
    else if (!last) open.push({ delimiter: m[1], lang: m[2], line });
  }
  return open.filter(f => isTypeScript(f.lang)).map(f => f.line.trim());
}

export function extractFrom(kind, text, file) {
  const out = [];
  const push = (code, index, lang, meta = "") => {
    const trimmed = code.trim();
    if (trimmed) out.push({ file, index, code: trimmed, lang, meta });
  };
  if (kind === "fenced-in-template-literal" || kind === "markdown-dir") {
    // A Markdown FILE is not a template literal, so its backslashes are already
    // what the reader sees. Unescaping them anyway rewrote the source before
    // compiling it: `/\\\\/` became the unterminated `/\\/`, which reports a
    // syntax error the page does not have and takes the whole sample out of
    // semantic checking behind it.
    const literal = kind === "fenced-in-template-literal";
    for (const m of text.matchAll(literal ? ESCAPED_FENCE : RAW_FENCE)) {
      // 1 is the container prefix, 2 the delimiter, 3 the language token,
      // 4 the rest of the info string, 5 the body.
      if (!isTypeScript(m[3])) continue;
      const body = stripContainer(m[5], m[1]);
      push(literal ? unescapeTemplate(body) : body, out.length, m[3], m[4]);
    }
  } else if (kind === "template-literal-consts") {
    // Exported const NAME = `...`; where the body is TypeScript, not Markdown.
    for (const m of text.matchAll(/export const (\w+) = `([\s\S]*?)`;/g)) {
      const code = unescapeTemplate(m[2]);
      if (/\b(import|export|const|function)\b/.test(code)) push(code, m[1]);
    }
  } else if (kind === "index-code") {
    // indexCode: "..." — a JSON-escaped single-line string.
    for (const m of text.matchAll(/indexCode:\s*("(?:[^"\\]|\\.)*")/g)) {
      try {
        push(JSON.parse(m[1]), out.length);
      } catch {
        push(m[1], out.length);
      }
    }
  }
  return out;
}

/**
 * Which extension a sample has to be compiled under.
 *
 * A fence that SAYS tsx is compiled as tsx, whatever its body looks like. The
 * two parsers disagree on more than tags: `const id = <T>(x: T) => x;` is a
 * generic arrow in a .ts file and an unclosed element in a .tsx one, so a
 * sample advertised as tsx would have been checked under rules a reader
 * pasting it never gets.
 */
export const extensionFor = sample => {
  // A stated filename wins over anything inferred from the body. A fence
  // headed `ts title="nextly.config.ts"` advertises the file a reader is meant
  // to paste it into, and compiling it as TSX because it happens to contain
  // angle brackets checks it under rules that reader never gets. 46 fences in
  // these pages name a file, and the names carry real extensions.
  //
  // Not for a file this harness built, though. A rebuilt sample carries the
  // original fence's metadata, and the concatenation of earlier fences in front
  // of it is not the file that title names: forcing `.ts` on it when the pasted
  // part contains JSX makes it fail to parse for a reason the page does not
  // have. `prependedLines` is only set on a rebuild.
  const stated = sample.prependedLines
    ? undefined
    : sample.meta?.match(/\.(tsx?)\b/)?.[1];
  if (stated) return stated;
  return sample.lang === "tsx" || looksLikeJsx(sample.code) ? "tsx" : "ts";
};

/**
 * A file the sample quotes and the reader writes: ./collections/Posts, or the
 * same reached through the `@/` alias a Next.js app sets up.
 *
 * Named on its own because the gate and the audit want different things from
 * it. The gate drops it: those files are expected to be absent. The audit keeps
 * it long enough to mark the sample UNCHECKED, because TypeScript types the
 * bindings from an unresolved module as `any`, so a wrong call through them
 * produces no diagnostic and the sample reads as clean while never having been
 * read at all — which is what the audit already says about unresolved packages.
 */
export const READER_OWNED_FILE =
  /error TS2307: Cannot find module '(?:\.{1,2}|@)\//;

/**
 * A callback parameter left implicit because the value it maps over is untyped.
 *
 * The GATE ignores it: document fields are `unknown` until `nextly
 * generate:types` has run in the reader's project, so `posts.map((post) => …)`
 * over an untyped result reports this and a reader never sees it.
 *
 * The AUDIT does not, because the same code covers a plain
 * `function parse(value) {}`, which has nothing to do with generated types and
 * does fail for a reader on the strict setup these pages advertise. Nothing in
 * the diagnostic distinguishes the two, so the audit counts them on their own
 * line instead of guessing — the same answer it gives everywhere else it cannot
 * settle a question.
 */
export const IMPLICIT_ANY_PARAMETER =
  /error TS7006: Parameter '.*' implicitly has an 'any' type/;

export const SUPPLIED_BY_THE_READER = [
  READER_OWNED_FILE,
  // Document fields are `unknown` until `nextly generate:types` has run,
  // which happens in the reader's project, not here. Everything below is
  // that one cause wearing different error codes: `unknown` assigned into
  // JSX, `unknown` narrowed to `{}` by a truthiness check, and a callback
  // parameter left implicit because the value it maps over is untyped.
  //
  // None of these can hide a wrong API. A property this package does not
  // have is TS2339 against a NAMED type, an arity mistake is TS2554, and a
  // wrong option shape is TS2322 against a named type; the checker's own
  // test pins that by feeding it `result.docs` and requiring a failure.
  /error TS(?:2322: Type 'unknown' is not assignable|18046: '.*' is of type 'unknown')/,
  /error TS2339: Property '.*' does not exist on type '\{\}'/,
  IMPLICIT_ANY_PARAMETER,
];

/**
 * A whole module a reader could paste, rather than a shape being illustrated.
 *
 * Matches the keyword alone rather than a whole single-line statement: a
 * sample whose import list wraps is still a module, and requiring
 * `import ... from` on one line quietly excused several from compilation.
 *
 * ANY export makes it a module, not only a re-export. A page that splits an
 * example across fences ends with `export default defineConfig({...})` on its
 * own, and ten fences in the current tree do exactly that. Requiring a `from`
 * filed all ten as fragments, so the API mistakes inside them were never read;
 * the missing name they open with is what the continuation pass is for.
 *
 * Asked of the compiler, then widened by the two cases the compiler answers
 * "no" to and this gate still wants compiled. Each is named with the reason it
 * is asked separately, so the next addition has to state one too.
 */
export const isModule = (code, extension = "tsx") => {
  const parsed = parseSample(code, extension);
  // The compiler's own answer, rather than a list of the node kinds that count.
  // `externalModuleIndicator` is what TypeScript itself sets when it decides a
  // file is a module, and it is the answer that governs how this fence would be
  // compiled. Listing the kinds instead left the list one short in both
  // directions: `import.meta.url` alone is a module to TypeScript and was read
  // here as a fragment, and `import A = N.M` is an alias for a namespace rather
  // than a load and was read here as a module. A list has a next omission and
  // this does not.
  if (ts.isExternalModule(parsed)) return true;

  // A call to `require` or to `import`, anywhere in the tree. Both load a
  // package exactly as a declaration does, and a fence opening
  // `const crypto = require("crypto")` is a program a reader runs; requiring
  // ESM syntax filed those as fragments so nothing compiled them. TypeScript
  // does not call a CommonJS file an external module, so this is asked
  // separately rather than left to the indicator.
  //
  // From the tree rather than from the text, because the text cannot tell a
  // call from a mention: `// dynamically import("nextly")` in a comment, or
  // `"import(x)"` in a string, made a fragment look like a module and had the
  // audit compile a block it deliberately excludes. A property access named
  // `require` or `import` is not a load either, and is not an identifier call.
  let loads = false;
  const walk = node => {
    if (loads) return;
    if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) &&
          node.expression.text === "require"))
    ) {
      loads = true;
      return;
    }
    ts.forEachChild(node, walk);
  };
  ts.forEachChild(parsed, walk);
  if (loads) return true;

  // A fence whose only module syntax is `export as namespace X` stays a
  // fragment, deliberately.
  //
  // It reads like a hole: the fence is never compiled, so nothing in it is
  // checked. It is not one. A fence that is not compiled still counts in its
  // page's `samples`, and coverage is ratcheted per page in BOTH directions, so
  // adding one fails the gate with `samples was 1, now 2` until somebody
  // rewrites the baseline. Measured, by adding such a fence to a page and
  // running the gate with this branch absent.
  //
  // Compiling it instead would cost more than it returns. The syntax belongs to
  // a declaration file, and this harness cannot check one: `compileOnce` runs
  // with `skipLibCheck`, under which a `.d.ts` body reports NOTHING — measured,
  // a `.d.ts` declaring a field of a nonexistent type is silent while the same
  // text as `.ts` reports TS2304. It also appends `export {}` to every sample,
  // which makes a namespace-only declaration file valid and erases the one
  // error a reader would meet. So compiling one would raise coverage while
  // checking nothing, which is the defect this gate already has filed against
  // `require()` fences.
  //
  // Doing it properly means a second program for declaration samples, with its
  // own options and no appended export. Worth building when a page has one; no
  // page does.
  return false;
};

/**
 * The documentation this repository owns and publishes.
 *
 * nextly-site fetches these pages and can measure them, but its copy is
 * gitignored and refetched on every build, so a fix made there is overwritten
 * by the next deploy. This is where they can actually be fixed, so this is
 * where they are gated.
 */
export function collectDocSamples() {
  const root = join(ROOT, "docs");
  if (!existsSync(root)) return null;
  // `fetch-docs.mjs` removes the destination before copying, so an interrupted
  // fetch leaves a partial tree that looks exactly like a complete one. This
  // repository already has the post-condition for that; auditing a partial tree
  // would report plausible totals that are quietly short.
  const walk = dir =>
    readdirSync(dir, { withFileTypes: true }).flatMap(e =>
      e.isDirectory()
        ? walk(join(dir, e.name))
        : e.name.endsWith(".mdx")
          ? [join(dir, e.name)]
          : []
    );
  const pages = walk(root).map(full => ({
    file: relative(ROOT, full),
    text: readFileSync(full, "utf-8"),
  }));
  // A fence that never closes is checked here rather than inferred from a
  // count, because on a page with no held count there is nothing for a count to
  // fall below.
  const broken = pages.flatMap(page =>
    unterminatedFences(page.text).map(line => `${page.file}: ${line}`)
  );
  if (broken.length > 0) {
    const detail = broken.map(line => `  ${line}`).join("\n");
    const err = new Error(
      `these TypeScript fences open and never close, so the samples in them ` +
        `are not extracted and the rest of each page renders as code:\n${detail}`
    );
    // Marked, because the caller treats a failure to read the tree as a reason
    // to stop quietly. This is the opposite: a page IS readable and is wrong,
    // and stopping quietly is how a broken fence gets recorded as normal.
    err.brokenFences = broken;
    throw err;
  }
  return pages.flatMap(page =>
    extractFrom("markdown-dir", page.text, page.file)
  );
}

/**
 * Compile a set of samples and return the diagnostics worth reading.
 *
 * Shared by the gate and the documentation audit so both judge a sample the
 * same way; two compilers with two sets of filters would disagree and the
 * disagreement would be invisible.
 */
/**
 * Compile a set of samples and return the diagnostics worth reading.
 *
 * Uses the TypeScript compiler API rather than parsing `tsc` output, for two
 * reasons that both bit an earlier version. The API separates syntactic from
 * semantic diagnostics itself, where guessing from the error code does not:
 * TS1192, "module has no default export", is semantic despite its TS1xxx code,
 * and reading it as a parse error discarded a whole sample's real findings. And
 * a diagnostic carries the file it came from, so the sample that failed to
 * parse can be set aside on its own rather than taking its whole page with it.
 *
 * Two passes, because TypeScript stops at parse errors: one sample that does
 * not parse suppresses every semantic diagnostic in the program. Measured, not
 * assumed. One malformed block in the documentation was hiding 162 findings
 * behind a report of 7, which would have read as good news.
 *
 * Shared by the gate and the documentation audit so both judge a sample the
 * same way; two compilers with two sets of filters would disagree, and the
 * disagreement would be invisible.
 */
export function compile(samples, label, ignore = SUPPLIED_BY_THE_READER) {
  suppressedByTheReaderRule.length = 0;
  const first = compileOnce(samples, label, ignore);
  if (first.unparsed.length === 0) return first.diagnostics;
  // Only the samples that failed to parse, identified by the file TypeScript
  // named, not by the page they sit on.
  const broken = new Set(first.unparsed.map(d => d.origin));
  const rest = samples.filter(s => !broken.has(`${s.file}#${String(s.index)}`));
  return [
    ...first.unparsed.map(d => d.text),
    ...compileOnce(rest, `${label}-2`, ignore).diagnostics,
  ];
}

/**
 * Give the temporary compile directory the module tree a reader would have.
 *
 * Every entry of the repository's own `node_modules` is linked, so a sample
 * naming a real third-party dependency resolves, and every publishable package
 * in this workspace is linked under the name it publishes as, so `nextly` and
 * `@nextlyhq/*` resolve to the code in this commit.
 *
 * Linked as packages rather than mapped with `paths`, because a path mapping
 * would answer for a subpath the package does not export. The exports map is
 * exactly what a sample can get wrong: three snippets in the authentication
 * guide imported `nextly/lib/env`, which is not in it, and a reader following
 * them got ERR_PACKAGE_PATH_NOT_EXPORTED. A harness that bypassed the map
 * would have called those three fine.
 */
/**
 * Refuse to judge the documentation with the packages half-built.
 *
 * Samples resolve `nextly` through its exports map, which points at `dist`. A
 * tree that is absent, or being rewritten by a concurrent build, resolves the
 * runtime entry and not its types, and TypeScript then reports every import as
 * implicitly `any`: one run mid-build produced 182 of those and called them
 * findings against the pages. The pages were not the problem, and a check that
 * names the wrong cause is worse than one that does not run.
 */
function requireBuiltPackages() {
  // EVERY publishable package, not just `nextly`. A partial build such as
  // `pnpm --filter nextly... build` satisfied a check that looked only at the
  // core: imports from an unbuilt sibling then emitted TS2307, the local
  // manifest showed the subpath as declared, and the diagnostic was filed
  // against the page. The tree was at fault, and the page took the blame.
  const unbuilt = [];
  for (const dirent of readdirSync(join(ROOT, "packages"), {
    withFileTypes: true,
  })) {
    if (!dirent.isDirectory()) continue;
    const dir = join(ROOT, "packages", dirent.name);
    try {
      const manifest = JSON.parse(
        readFileSync(join(dir, "package.json"), "utf-8")
      );
      if (manifest.private || !manifest.name || !manifest.types) continue;
      if (!existsSync(join(dir, manifest.types))) unbuilt.push(manifest.name);
    } catch {
      // Unreadable manifests are not packages a sample can import.
    }
  }
  if (unbuilt.length > 0) {
    console.error(
      `doc samples: ${String(unbuilt.length)} workspace package(s) have no built types, ` +
        "so a sample importing one cannot resolve it and the page would take " +
        "the blame.\n  Build first: pnpm turbo build --filter='./packages/*'\n"
    );
    for (const name of unbuilt) console.error(`  ${name}`);
    process.exit(1);
  }
  const types = join(ROOT, "packages", "nextly", "dist", "index.d.ts");
  if (existsSync(types)) return;
  console.error(
    "doc samples: packages/nextly/dist/index.d.ts is missing, so the samples " +
      "cannot resolve the types they are checked against.\n" +
      "  Build first: pnpm turbo build --filter='./packages/*'\n" +
      "  Nothing was checked, and no finding here would have been about the docs."
  );
  process.exit(1);
}

function linkResolutionTree(dir) {
  const modules = join(dir, "node_modules");
  mkdirSync(modules, { recursive: true });
  for (const entry of readdirSync(join(ROOT, "node_modules"))) {
    if (entry === ".bin") continue;
    const source = join(ROOT, "node_modules", entry);
    // A scope is copied as a directory of links rather than linked whole.
    // Linking the directory made every later write to `@nextlyhq/<pkg>` follow
    // it back into the repository's own install: a run left eighteen links
    // there that pnpm had not declared, and because this check runs before
    // lint and typecheck, those later steps could then resolve packages this
    // workspace does not depend on. A checker must not be able to change the
    // tree it is checking.
    if (entry.startsWith("@")) {
      const scope = join(modules, entry);
      mkdirSync(scope, { recursive: true });
      for (const scoped of readdirSync(source)) {
        symlinkSync(join(source, scoped), join(scope, scoped), "dir");
      }
      continue;
    }
    symlinkSync(source, join(modules, entry), "dir");
  }
  // Everything the workspace packages themselves depend on, which the root
  // does not have: pnpm installs a package's dependencies beside it, so `next`
  // lives at packages/nextly/node_modules/next and `@types/node` beside it,
  // while the workspace root has neither. Without this the checker could not
  // resolve `next`, `next/navigation` or `next/image` and reported them as
  // findings against pages that were right — a reader's project has Next.js,
  // and so does this repository, one directory further down. `types: ["node"]`
  // resolved to nothing for the same reason and blamed the docs for it.
  //
  // First writer wins, so the root's copy of a shared dependency is the one a
  // sample sees, which is the version the workspace resolves for itself.
  const linkInto = (source, target) => {
    if (existsSync(target)) return;
    symlinkSync(source, target, "dir");
  };
  for (const dirent of readdirSync(join(ROOT, "packages"), {
    withFileTypes: true,
  })) {
    const nested = join(ROOT, "packages", dirent.name, "node_modules");
    if (!dirent.isDirectory() || !existsSync(nested)) continue;
    for (const entry of readdirSync(nested)) {
      if (entry === ".bin") continue;
      if (entry.startsWith("@")) {
        const scope = join(modules, entry);
        mkdirSync(scope, { recursive: true });
        for (const scoped of readdirSync(join(nested, entry))) {
          linkInto(join(nested, entry, scoped), join(scope, scoped));
        }
        continue;
      }
      linkInto(join(nested, entry), join(modules, entry));
    }
  }
  for (const dirent of readdirSync(join(ROOT, "packages"), {
    withFileTypes: true,
  })) {
    if (!dirent.isDirectory()) continue;
    const source = join(ROOT, "packages", dirent.name);
    let manifest;
    try {
      manifest = JSON.parse(
        readFileSync(join(source, "package.json"), "utf-8")
      );
    } catch {
      continue;
    }
    // A package nobody can install is not a package a sample may import.
    if (manifest.private || !manifest.name) continue;
    const target = join(modules, manifest.name);
    // Only ever inside the temporary tree: the scope above it is a real
    // directory made here, so removing and relinking cannot reach the
    // repository's install.
    mkdirSync(dirname(target), { recursive: true });
    rmSync(target, { recursive: true, force: true });
    symlinkSync(source, target, "dir");
  }
}

function compileOnce(samples, label, ignore = SUPPLIED_BY_THE_READER) {
  const dir = mkdtempSync(join(tmpdir(), `nextly-${label}-`));
  // Flattened temp names are unreadable in a diagnostic, so keep the way back
  // to the file a person can open.
  const origin = new Map();
  const fileNames = [];
  try {
    // A counter, not the path with its punctuation replaced. That mapping is
    // not injective — `guides/foo-bar.mdx` and `guides/foo/bar.mdx` both become
    // `guides_foo_bar_mdx` — so two samples could land on one filename, the
    // second overwriting the first while both were counted as compiled. The
    // readable part is kept as a prefix, and the number makes it unique.
    let n = 0;
    for (const s of samples) {
      n += 1;
      const readable = s.file.replace(/[^\w]/g, "_");
      const full = join(
        dir,
        `${readable}__${String(s.index)}__${String(n)}.${extensionFor(s)}`
      );
      origin.set(full, `${s.file}#${String(s.index)}`);
      // `export {}` makes every file a module, whatever it contains. A file
      // with no import or export is a SCRIPT, and every script in one Program
      // shares a global scope: a declaration on one page could satisfy a
      // missing name on another, or change its inferred type, and two pages
      // declaring the same name produced clashes this then discarded as
      // harness artefacts. Appended, so no diagnostic's line number moves.
      writeFileSync(full, `${s.code}\n\nexport {};\n`);
      fileNames.push(full);
    }
    linkResolutionTree(dir);

    const program = ts.createProgram(fileNames, {
      noEmit: true,
      strict: true,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      skipLibCheck: true,
      lib: ["lib.es2022.d.ts", "lib.dom.d.ts"],
      // Named explicitly, because `typeRoots` otherwise resolves by walking up
      // from the process's directory rather than from the files being
      // compiled, and this workspace keeps type packages under `.pnpm/` with
      // no `@types` at the root. Without it every run reported "Cannot find
      // type definition file for 'node'" as a finding against the docs.
      typeRoots: [join(dir, "node_modules", "@types")],
      // Node's globals, and nothing else. These samples are Next.js and Node
      // files: they read `process.env.DATABASE_URL`, which every reader's
      // project types and this harness did not, so the audit reported `process`
      // as an error a reader would hit when the reader is the one person who
      // never sees it. Named rather than left open, because `types` with no
      // entry pulls in every @types package this site happens to install and
      // would start excusing globals a reader's project does not have.
      types: ["node"],
    });

    const render = d => {
      const where = origin.get(d.file?.fileName) ?? d.file?.fileName ?? "?";
      const line =
        d.file && d.start !== undefined
          ? d.file.getLineAndCharacterOfPosition(d.start).line + 1
          : 0;
      const message = ts.flattenDiagnosticMessageText(d.messageText, " ");
      return {
        origin: where,
        text: `${where}:${String(line)}  error TS${String(d.code)}: ${message}`,
      };
    };

    // Suppressed diagnostics are counted, not vanished. Each pattern here is
    // keyed on `unknown` or `{}`, which in these pages comes from document
    // fields a reader's `nextly generate:types` would answer and this checkout
    // cannot. Nothing in a diagnostic proves that origin, though, so a genuine
    // mistake that happens to involve `unknown` would be dropped too — and a
    // suppression nobody can see is the one kind this gate must not have. The
    // report says how many were suppressed and by which rule, so the number is
    // available to argue with.
    const keep = d => {
      const rule = ignore.find(re => re.test(d.text));
      if (!rule) return true;
      suppressedByTheReaderRule.push({ rule: String(rule), text: d.text });
      return false;
    };

    // The compiler's own complaints about its setup, which neither of the two
    // collections below carries. A production-only install without @types/node
    // reports TS2688 here and nothing anywhere else, so an otherwise simple
    // sample would compile to an empty diagnostics list and the gate would
    // report success having loaded neither the Node types it asked for nor the
    // standard library.
    const setup = [
      ...program.getOptionsDiagnostics(),
      ...program.getGlobalDiagnostics(),
    ]
      .map(render)
      .filter(keep);

    // The API's own split. Nothing here guesses from the error code.
    const unparsed = program.getSyntacticDiagnostics().map(render).filter(keep);
    // Deprecations, asked of the checker rather than read off the diagnostics,
    // for the reason written on `deprecatedPropertiesIn`. Rendered in the same
    // shape as everything else and put in the same list, so the classifier
    // charges the page and the conservation count downstream sees it without a
    // bucket of its own. TS6385 is TypeScript's own code for this sentence,
    // used rather than an invented one so a reader can look it up.
    const checker = program.getTypeChecker();
    const deprecated = fileNames.flatMap(file => {
      const sourceFile = program.getSourceFile(file);
      if (!sourceFile) return [];
      const where = origin.get(file) ?? file;
      return deprecatedPropertiesIn(sourceFile, checker).map(d => ({
        origin: where,
        text:
          `${where}:${String(sourceFile.getLineAndCharacterOfPosition(d.start).line + 1)}  ` +
          `error TS6385: '${d.name}' is deprecated.` +
          (d.note ? ` ${d.note}` : ""),
      }));
    });
    const diagnostics = [
      ...setup.map(d => d.text),
      ...unparsed.map(d => d.text),
      ...program
        .getSemanticDiagnostics()
        .map(render)
        .filter(keep)
        .map(d => d.text),
      ...deprecated.filter(keep).map(d => d.text),
    ];
    return { unparsed, diagnostics };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Properties a sample writes that the API it is writing them for has deprecated.
 *
 * TypeScript reports a deprecated FUNCTION as a suggestion diagnostic, and this
 * audit reads semantic ones, so adding suggestions was the obvious answer. It
 * was measured and it was wrong twice over: the corpus's suggestions are 24
 * "declared but never read" and a handful of others, all of them expected in a
 * sample that shows a shape rather than a program, and TypeScript does not
 * report this class at all. `{ collections: [...] }` written against a type
 * whose `collections` carries `@deprecated` produces no suggestion, no error and
 * no warning. A documented example taught the deprecated spelling of a plugin's
 * collections for as long as anyone had been reading it, and the gate compiled
 * it clean every time.
 *
 * So it is asked of the checker rather than read off the diagnostics. Every
 * object literal that has a contextual type is one the reader is filling in for
 * a declared API, and the property they wrote either exists on that type
 * carrying a `@deprecated` tag or it does not.
 *
 * The contextual type is what makes this narrow. A bare literal with no
 * declared shape has nothing to be deprecated against and is skipped, and a
 * nested literal is judged against its own property's type, so the `collections`
 * inside `contributes` is a different property from the one beside it.
 */
export function deprecatedPropertiesIn(sourceFile, checker) {
  const found = [];
  const walk = node => {
    if (ts.isObjectLiteralExpression(node)) {
      const contextual = checker.getContextualType(node);
      if (contextual) {
        for (const property of node.properties) {
          const name = writtenPropertyName(property);
          if (name === null) continue;
          const tag = deprecationOf(contextual, name, checker, node);
          if (!tag) continue;
          found.push({
            name,
            start: property.getStart(sourceFile),
            note: (tag.text ?? [])
              .map(part => part.text)
              .join("")
              .trim(),
          });
        }
      }
    }
    ts.forEachChild(node, walk);
  };
  ts.forEachChild(sourceFile, walk);
  return found;
}

/**
 * The property name a literal member writes, when it can be known from the text.
 *
 * `{ collections: [] }` and `{ "collections": [] }` name the same member, and
 * reading only identifiers meant the quoted spelling walked past the check. The
 * test is `.text`, which every static property name carries, rather than a list
 * of the node kinds that have one.
 *
 * Null for a computed name and for a spread, which writes no name here at all:
 * neither can be resolved against a declared property without evaluating
 * something, and a guess is worse than the silence.
 */
function writtenPropertyName(property) {
  const name = property.name;
  if (!name) return null;
  // `{ ["collections"]: [] }` names the same member as the other two
  // spellings, and TypeScript resolves it the same way. Only the expression
  // inside decides: a literal is read, anything that has to be evaluated is
  // not.
  if (ts.isComputedPropertyName(name)) {
    const inner = name.expression;
    return ts.isStringLiteralLike(inner) || ts.isNumericLiteral(inner)
      ? inner.text
      : null;
  }
  return typeof name.text === "string" ? name.text : null;
}

/**
 * The union constituents a literal could still be, after its own discriminants.
 *
 * `{ kind: "legacy", old: "x" }` against `Legacy | Current` is not ambiguous:
 * the literal says which arm it is. Asking every arm and requiring them to
 * agree gave that up, so a key deprecated on the arm actually being written
 * passed whenever the other arm still offered it.
 *
 * A constituent is dropped when the literal writes a literal value for a
 * property that constituent declares as a different literal type. Nothing else
 * narrows: a property whose value is computed, or whose declared type is not a
 * literal, says nothing about which arm this is and is left alone.
 */
function applicableConstituents(constituents, literal, checker) {
  const discriminants = [];
  for (const property of literal.properties) {
    if (!ts.isPropertyAssignment(property)) continue;
    const name = writtenPropertyName(property);
    if (name === null) continue;
    const written = checker.getTypeAtLocation(property.initializer);
    if (
      !written.isLiteral() &&
      !(written.flags & ts.TypeFlags.BooleanLiteral)
    ) {
      continue;
    }
    discriminants.push({ name, written });
  }
  if (discriminants.length === 0) return constituents;

  const applicable = constituents.filter(constituent =>
    discriminants.every(({ name, written }) => {
      const declared = constituent.getProperty(name);
      if (!declared) return true;
      const type = checker.getTypeOfSymbolAtLocation(
        declared,
        declared.valueDeclaration ?? literal
      );
      if (!type.isLiteral() && !(type.flags & ts.TypeFlags.BooleanLiteral)) {
        return true;
      }
      return checker.typeToString(type) === checker.typeToString(written);
    })
  );
  // Every arm ruled out means the discriminants describe none of them, which is
  // the compiler's complaint to make rather than this one's.
  return applicable.length === 0 ? constituents : applicable;
}

/**
 * The `@deprecated` tag on a property, across everything the literal might be.
 *
 * A contextual type is often a union, and `getProperty` on one answers for the
 * union rather than for its parts: a property present on a single constituent
 * comes back `undefined`, so a deprecated option in a union-shaped API passed
 * unread. The constituents are asked one at a time instead.
 *
 * The constituents are narrowed by the literal's own discriminants first, so a
 * literal that says which arm it is gets answered by that arm. Where the
 * discriminants leave more than one arm standing, it reports only when every
 * remaining arm that declares the property deprecates it: charging a page for
 * writing the current spelling of a name that is merely obsolete on some other
 * arm would be claiming to know something this does not.
 */
function deprecationOf(contextual, name, checker, literal) {
  const constituents = applicableConstituents(
    contextual.isUnion() ? contextual.types : [contextual],
    literal,
    checker
  );
  const declared = constituents
    .map(type => type.getProperty(name))
    .filter(symbol => symbol !== undefined);
  if (declared.length === 0) return undefined;
  const tags = declared.map(symbol =>
    symbol.getJsDocTags(checker).find(tag => tag.name === "deprecated")
  );
  return tags.every(tag => tag !== undefined) ? tags[0] : undefined;
}

/**
 * What the reader-supplied rules dropped in the last compile.
 *
 * Module-level rather than returned, so the many callers of `compile` do not
 * all have to thread it through; the audit reads it straight after the compile
 * it belongs to.
 */
export const suppressedByTheReaderRule = [];

/** An import this compilation could not resolve. */
export const UNRESOLVED_IMPORT = /error TS2307: Cannot find module '([^']+)'/;

/** An undefined name, which may or may not be a defect. */
export const MISSING_NAME = /error TS2304: Cannot find name '([^']+)'/;

/** The package part of a specifier: @nextlyhq/plugin-sdk/testing -> @nextlyhq/plugin-sdk. */
export const packageOf = specifier => {
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
};

/** The subpath part, as an exports-map key: ./testing, or "." for the root. */
export const subpathOf = specifier => {
  const pkg = packageOf(specifier);
  const rest = specifier.slice(pkg.length);
  return rest === "" ? "." : `.${rest}`;
};

/**
 * Does this exact specifier resolve for a reader?
 *
 * Two questions, not one. A docs sample importing @nextlyhq/plugin-sdk names
 * something real that this site has no reason to install, and reporting it as
 * broken would bury the genuine defects. A typo like @nextlyhq/plugin-skd names
 * nothing, and a reader hits that too. And installing a package does not make
 * an unexported subpath resolve, so @nextlyhq/plugin-sdk/typo is a defect even
 * though its package is real: the subpath is checked against the published
 * exports map, which is what Node consults.
 *
 * A registry that cannot be reached returns null, and null is counted as a
 * finding rather than read as "resolves". Silently excusing every unresolved
 * import the moment the network is down is the worse failure.
 */
/**
 * Does a pattern key answer this subpath?
 *
 * Node substitutes the `*`, and it applies the key only when the request
 * matches the text on BOTH sides of it: `./features/*` answers
 * `./features/anything` and nothing else. Reading any key that merely contains
 * a `*` as answering everything excused `pkg/not-a-feature`, which is exactly
 * the unresolvable import a reader would hit.
 */
export const patternAnswers = (key, subpath) => {
  const star = key.indexOf("*");
  if (star === -1) return false;
  const prefix = key.slice(0, star);
  const suffix = key.slice(star + 1);
  return (
    subpath.startsWith(prefix) &&
    subpath.endsWith(suffix) &&
    subpath.length >= prefix.length + suffix.length
  );
};

/**
 * What the published exports map says about one subpath: true, false, or null
 * for "this manifest cannot answer".
 *
 * A `null` TARGET is Node's way of blocking a path that a broader pattern would
 * otherwise expose, so a key matching with a null target is a refusal, not a
 * hit.
 */
/**
 * Does a target reach an ES import, or is it blocked?
 *
 * A target is a string, `null`, or a set of conditions, and the conditions can
 * nest. `{"import": null, "require": "./x.cjs"}` deliberately blocks the ESM
 * import while leaving `require` working, so a sample that writes
 * `import ... from "pkg/feature"` still fails after installing the package.
 * Reading only the outer object as non-null excused exactly that.
 *
 * These samples are ES modules, so `import` wins over `require`, and `default`
 * answers when neither is named.
 */
/**
 * The conditions an ES import in Node actually matches.
 *
 * `node-addons` is one of them under the default loader, which matters in both
 * directions: a target that blocks it first is blocked, and a package exposing
 * only that target resolves. Leaving it out excused the first and condemned the
 * second.
 *
 * `require` is deliberately absent: a target offering only `require` does not
 * answer an `import`. So is `module`, which is a bundler convention Node does
 * not resolve, and treating it as active would excuse a target Node refuses.
 */
const ACTIVE_CONDITIONS = new Set(["node-addons", "node", "import", "default"]);

export function targetReachesAnImport(target) {
  if (target === null || target === undefined) return false;
  if (typeof target === "string") return true;
  // A fallback array: the first entry that works answers.
  if (Array.isArray(target)) return target.some(targetReachesAnImport);
  if (typeof target !== "object") return false;
  // IN MANIFEST ORDER, which is the order Node applies. A fixed priority reads
  // `{ "import": "./esm.js", "node": null }` as blocked, when `import` comes
  // first and answers, so a working package would have been reported as a
  // defect. The first ACTIVE key decides, and an inactive one is skipped rather
  // than ending the search.
  for (const [condition, value] of Object.entries(target)) {
    if (ACTIVE_CONDITIONS.has(condition)) return targetReachesAnImport(value);
  }
  return false;
}

export function exportsMapAnswers(exports, subpath) {
  // `"exports": "./index.js"` is sugar for `{ ".": "./index.js" }`: the root
  // and nothing else.
  if (typeof exports === "string") return subpath === ".";
  // Without an exports map the old resolution rules apply, and those still
  // require the file to be there: `pkg/not-a-real-file` fails after installing
  // `pkg`. Deciding that needs the package's contents, which the manifest does
  // not carry, so this answers unknown rather than yes. Unknown is reported.
  if (!exports || typeof exports !== "object") return null;
  const keys = Object.keys(exports);
  // Conditions-only sugar (`{ "import": ..., "require": ... }`) describes the
  // root, so it answers the root and no subpath — and it answers the root only
  // if the conditions do. `{ "import": null, "require": "./index.cjs" }` blocks
  // an ES import of the package name itself.
  if (!keys.some(k => k.startsWith("."))) {
    return subpath === "." && targetReachesAnImport(exports);
  }
  // The root is a key like any other. A package exporting only subpaths —
  // `{ "./config": "./config.js" }` — throws ERR_PACKAGE_PATH_NOT_EXPORTED on
  // its own name, and answering the root unconditionally moved that import into
  // the excused bucket where nobody would see it.
  if (keys.includes(subpath)) return targetReachesAnImport(exports[subpath]);
  if (subpath === ".") return false;
  // Node's own precedence: the longest base before the `*` wins, and between
  // two keys with the same base the longer key wins. Sorting on the position of
  // the `*` alone leaves `"./foo/*"` and `"./foo/*.js"` in manifest order, so a
  // broad key listed first would answer a path the specific key blocks.
  const matching = keys
    .filter(k => patternAnswers(k, subpath))
    .sort((a, b) => b.indexOf("*") - a.indexOf("*") || b.length - a.length);
  if (matching.length === 0) return false;
  // A blocked pattern is a refusal, and that much the manifest can settle.
  if (!targetReachesAnImport(exports[matching[0]])) return false;
  // Matching a pattern is not proof that the file behind it exists. A key
  // substitutes text — `./*` turns `pkg/not-real` into `./dist/not-real.js` —
  // and Node still fails when nothing is there, so a typo under a wildcard
  // resolves here and throws for the reader. The manifest does not list the
  // tarball's contents, so this answers unknown, which is reported rather than
  // excused. An exact key is different: the package named that subpath itself.
  return null;
}

/**
 * Was this name defined by an earlier block on the same page?
 *
 * Compiling each block on its own is what makes the API claims checkable, and
 * the cost is that a block picking up a variable the page declared above it
 * reports an undefined name. That is a documentation shape rather than a wrong
 * API, but only when the page really did declare it: treating every TS2304 as
 * a continuation would hide a genuine typo or a missing import, which is one of
 * the things this audit exists to find.
 */
/**
 * The block a diagnostic came from, asked whether the name is the reader's.
 *
 * Falls back to the name alone when the block cannot be found, which keeps the
 * finding rather than dropping it.
 */
export function mentionIsReaderOwned(name, file, index, samples) {
  const sample = samples.find(s => s.file === file && s.index === index);
  if (!sample) return readerOwnedName(name);
  return readerOwnedMention(name, sample.code, extensionFor(sample));
}

export function declaredEarlier(name, file, index, samples) {
  return samples.some(
    s =>
      s.file === file &&
      s.index < index &&
      declaresName(s.code, name, extensionFor(s))
  );
}

/**
 * Does this block declare that name?
 *
 * One implementation, used by both the question above and by
 * `inheritedNames()`. They were two regexes with different ideas of what counts,
 * and the difference was a defect: `declaredNamesIn` learned binding patterns
 * while this one still wanted an identifier straight after `const`, so a fence
 * declaring `const { nextly } = ...` was recognised as the source of `nextly`
 * and then not found when the rebuild went looking for it. The continuation was
 * never compiled.
 */
export function declaresName(code, name, extension = "tsx") {
  if (declaredNamesIn(code, extension).includes(name)) return true;
  // An arrow or method bound without a declaration keyword: `handler: (req) =>`
  // in an object literal, or a property assignment. Not something
  // `declaredNamesIn` collects, because it is not a declaration, but a later
  // fence using the name is still continuing the page rather than inventing it.
  // At the top level only. The pattern used to match anywhere, so a handler
  // bound INSIDE a function body — `init(ctx) { const handler = (req) => ... }`
  // — was recorded as though the next fence could see it. The context compile
  // still reported the name missing, but the fence had no first-pass
  // diagnostic to contradict, so it was filed as merely unchecked and an
  // undefined reference escaped the report.
  //
  // Depth is counted rather than parsed: a brace inside a string or a comment
  // would mislead it, and the failure direction of that is to consider a
  // top-level binding nested and report a name the page really does define,
  // which the continuation pass then has to explain. Wrong in the loud
  // direction rather than the quiet one.
  const binding = new RegExp(`\\b${name}\\s*[:=]\\s*(?:async\\s*)?\\(`, "s");
  let depth = 0;
  for (const line of code.split("\n")) {
    if (depth === 0 && binding.test(line)) return true;
    for (const ch of line) {
      if (ch === "{" || ch === "(") depth += 1;
      else if (ch === "}" || ch === ")") depth = Math.max(0, depth - 1);
    }
  }
  return false;
}

/**
 * The names a fence declares, so a later fence can be seen to inherit them.
 *
 * Deliberately shallow: a declaration nested inside a function is not in scope
 * for the next fence, and reading one as if it were is how a missing name gets
 * excused. Anything this misses shows up as a name still missing after the
 * rebuild, which is reported rather than swallowed.
 */
/**
 * The lines of a fence that are at the top level, with deeper ones blanked.
 *
 * The declaration patterns below anchor at a line start, which a declaration
 * nested inside a function also has. The comment on `declaredNamesIn` said it
 * was deliberately shallow and the code never enforced it: `init(ctx) { const
 * handler = ... }` recorded `handler` as though the next fence could see it,
 * and an undefined reference in that fence was then filed as merely unchecked
 * rather than reported.
 *
 * Depth is counted rather than parsed, so a brace inside a string or a comment
 * misleads it. That mistake blanks a line that was really top level, which
 * turns a name the page does define into one it appears not to — loud, and
 * caught by the continuation pass — rather than excusing one it does not.
 */
const OPENS = new Set([
  ts.SyntaxKind.OpenBraceToken,
  ts.SyntaxKind.OpenParenToken,
  ts.SyntaxKind.OpenBracketToken,
]);
const CLOSES = new Set([
  ts.SyntaxKind.CloseBraceToken,
  ts.SyntaxKind.CloseParenToken,
  ts.SyntaxKind.CloseBracketToken,
]);

/**
 * Tokens after which a `/` is division, so everything else means a regex can
 * start there. The scanner returns `SlashToken` either way and only rescans
 * when asked, so without this `const re = /}/` contributes a closing brace and
 * the rest of the enclosing block reads as top level.
 */
const DIVISION_FOLLOWS = new Set([
  ts.SyntaxKind.Identifier,
  ts.SyntaxKind.NumericLiteral,
  ts.SyntaxKind.BigIntLiteral,
  ts.SyntaxKind.StringLiteral,
  ts.SyntaxKind.NoSubstitutionTemplateLiteral,
  ts.SyntaxKind.TemplateTail,
  ts.SyntaxKind.RegularExpressionLiteral,
  ts.SyntaxKind.CloseParenToken,
  ts.SyntaxKind.CloseBracketToken,
  ts.SyntaxKind.CloseBraceToken,
  ts.SyntaxKind.ThisKeyword,
  ts.SyntaxKind.SuperKeyword,
  ts.SyntaxKind.TrueKeyword,
  ts.SyntaxKind.FalseKeyword,
  ts.SyntaxKind.NullKeyword,
  ts.SyntaxKind.PlusPlusToken,
  ts.SyntaxKind.MinusMinusToken,
]);

/**
 * Brackets that are really brackets, from the TypeScript scanner rather than
 * from counting characters.
 *
 * Counting characters read a closing brace inside a string or a comment as a
 * real one. The comment here used to argue that the mistake was safe because it
 * fires loudly: over-closing blanks a line that was top level, so a name the
 * page defines looks undefined and becomes a finding. That is only one
 * direction. `function setup() { const marker = "}"; const hidden = {}; }`
 * closes early on the string, which leaves `hidden` looking page-scoped, and a
 * later import-free fence calling `hidden.nonexistent()` is then treated as a
 * continuation and filed as unchecked instead of as a finding. The quiet
 * direction was the one that mattered.
 *
 * Trivia is skipped, so comments contribute nothing. A template literal's text
 * is inside its own token, and `${`/`}` are part of the head/middle/tail
 * tokens, so template expressions balance without special handling. A regex
 * literal still needs `reScanSlashToken` to be recognised and does not get it,
 * so a `}` inside one is read as a brace; that is the same hazard the character
 * count had, narrowed from every string and comment to regex literals alone.
 */
function topLevelOnly(code) {
  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    true,
    ts.LanguageVariant.JSX,
    code
  );
  // UTF-16 units, because that is what the scanner's offsets count. Splitting
  // by code point desynchronises on the first non-ASCII character, and these
  // pages have plenty.
  const chars = code.split("");
  const blank = (from, to) => {
    for (let i = from; i < to && i < chars.length; i += 1) {
      if (chars[i] !== "\n") chars[i] = " ";
    }
  };

  // Per token, not per line. Blanking whole lines cannot see
  // `function setup() { const hidden = {}; }`, where the nesting opens and
  // closes within one line and the line therefore starts at depth 0.
  let depth = 0;
  let prevEnd = 0;
  let previous = ts.SyntaxKind.Unknown;
  for (
    let kind = scanner.scan();
    kind !== ts.SyntaxKind.EndOfFileToken;
    kind = scanner.scan()
  ) {
    // A regex literal is one token or several, depending on whether anybody
    // asks. Unasked, `/}/ ` scans as slash, brace, slash, and the brace closes a
    // block it was never in.
    if (
      (kind === ts.SyntaxKind.SlashToken ||
        kind === ts.SyntaxKind.SlashEqualsToken) &&
      !DIVISION_FOLLOWS.has(previous)
    ) {
      kind = scanner.reScanSlashToken();
    }
    previous = kind;
    const end = scanner.getTokenEnd();
    // A closing bracket belongs to the depth it returns to, and an opening one
    // to the depth it leaves, so both stay visible while their contents do not.
    if (CLOSES.has(kind)) depth = Math.max(0, depth - 1);
    if (depth > 0) blank(prevEnd, end);
    if (OPENS.has(kind)) depth += 1;
    prevEnd = end;
  }
  return chars.join("");
}

/**
 * The import declarations a source actually has.
 *
 * Parsed as TSX, because these samples are, and a parse never throws here: on
 * malformed input TypeScript produces a tree with diagnostics rather than an
 * exception, and a statement list that is short of a broken import is the right
 * answer anyway.
 */
export function parseSample(source, extension = "tsx") {
  return ts.createSourceFile(
    `sample.${extension}`,
    source,
    ts.ScriptTarget.Latest,
    // Parents, because asking whether a mention sits in a type position means
    // walking up from it. Still the one place a sample is parsed.
    true,
    extension === "tsx" ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
}

/**
 * The import declarations a source actually has, read under the grammar the
 * compiler will use for it.
 *
 * The two grammars disagree before they agree: `const id = <T>(x: T) => x;` is
 * a generic arrow in `.ts` and an unclosed element in `.tsx`, and parsing a
 * `.ts` sample as TSX produces a recovery tree that can drop every import after
 * it. The fence still compiles, because compilation uses the right extension,
 * so the names simply went missing and a later fence using one was reported as
 * undefined rather than rebuilt with its context.
 */
function importsIn(source, extension) {
  return parseSample(source, extension).statements.filter(
    ts.isImportDeclaration
  );
}

export function declaredNamesIn(source, extension = "tsx") {
  const code = topLevelOnly(source);
  const names = new Set();
  const add = n => {
    if (n) names.add(n);
  };
  // Modifiers are a run, in any order and any number: `export default async
  // function Foo`, `export abstract class Bar`, `declare const baz`. Naming only
  // `export` and `declare` lost every one of those, and the lookup this replaced
  // had found them, so unifying the two turned working pages into findings. The
  // separator after the keyword takes an asterisk so `function* gen` and
  // `function *gen` are both read.
  // Anchored at a line start OR after a semicolon, because
  // `const first = 1; const second = 2;` declares both and reading only the
  // first turned a page that was correct into a finding.
  for (const m of code.matchAll(
    /(?:^|;)[ \t]*(?:(?:export|default|declare|abstract|async)[ \t]+)*(?:const|let|var|function|class|interface|type|enum)\b[\s*]+([A-Za-z_$][\w$]*)/gm
  )) {
    add(m[1]);
  }
  // Binding patterns: `const { nextly } = await createClient()` and
  // `const [first] = rows` declare names too. Requiring an identifier straight
  // after the keyword recorded neither, so a later fence using the value looked
  // like it inherited nothing and was never compiled.
  for (const m of code.matchAll(
    /^\s*(?:export\s+)?(?:const|let|var)\s+([[{][^=]*?[\]}])\s*=/gm
  )) {
    const pattern = m[1];
    // `{ a, b: c, d = 1, ...rest }` binds a, c, d and rest; the key in `b: c`
    // is not a binding, so only what follows a colon counts.
    for (const part of pattern.replace(/^[[{]|[\]}]$/g, "").split(",")) {
      const piece = part.trim().replace(/^\.\.\./, "");
      if (!piece) continue;
      const renamed = piece.match(/:\s*([A-Za-z_$][\w$]*)/);
      add(renamed ? renamed[1] : piece.match(/^[A-Za-z_$][\w$]*/)?.[0]);
    }
  }
  // Imports come from the PARSE, not from a pattern over the text. They cannot
  // be read from the top-level view either: an import clause opens a brace, so
  // masking by depth erases the middle of `import {\n  defineConfig,\n} from
  // "nextly"` and a later fence using the name reads as undefined. Reading the
  // raw text instead recorded an `import { ghost } from "pkg"` written inside a
  // block comment or a template literal as a real binding, which then excused a
  // fence that used `ghost` as a continuation of a page that never bound it. A
  // parser has neither problem: a comment produces no statement, and a wrapped
  // clause is one statement however it is laid out.
  for (const statement of importsIn(source, extension)) {
    const clause = statement.importClause;
    if (!clause) continue;
    if (clause.name) add(clause.name.text);
    const bindings = clause.namedBindings;
    if (!bindings) continue;
    if (ts.isNamespaceImport(bindings)) add(bindings.name.text);
    else for (const element of bindings.elements) add(element.name.text);
  }
  return [...names];
}

/**
 * Which of an earlier fence's names does this one use?
 *
 * A fence that continues an example without repeating its imports is not a
 * standalone module, so compilation skipped it entirely — and
 * `api-reference/direct-api.mdx` is full of them, one calling the legacy
 * `result.docs` shape this whole check exists to catch. Compiling it alone
 * would only report the names it inherits; compiled with them, it says what it
 * does with them.
 */
/**
 * The names an earlier fence declared as VALUES, excluding what it imported.
 *
 * The distinction decides whether a fence that only calls something is
 * continuing the page or illustrating a shape. `radio({ ... })` on a field
 * catalogue mentions `option`, which an earlier fence imported, and is not a
 * program a reader pastes. `await nextly.logout()` calls a value an earlier
 * fence built, and is.
 */
export function declaredValuesIn(source, extension = "tsx") {
  const code = topLevelOnly(source);
  const names = new Set();
  for (const m of code.matchAll(
    /(?:^|;)[ \t]*(?:(?:export|default|declare|abstract|async)[ \t]+)*(?:const|let|var|function|class)\b[\s*]+([A-Za-z_$][\w$]*)/gm
  )) {
    names.add(m[1]);
  }
  for (const m of code.matchAll(
    /^\s*(?:export\s+)?(?:const|let|var)\s+([[{][^=]*?[\]}])\s*=/gm
  )) {
    for (const part of m[1].replace(/^[[{]|[\]}]$/g, "").split(",")) {
      const piece = part.trim().replace(/^\.\.\./, "");
      const bound = piece.includes(":") ? piece.split(":").pop() : piece;
      const name = bound?.trim().match(/^[A-Za-z_$][\w$]*/)?.[0];
      if (name) names.add(name);
    }
  }
  return [...names];
}

export function inheritedNames(sample, samples) {
  // A continuation carries the example forward: it declares or assigns
  // something of its own. A bare expression does not, and `radio({ ... })` on a
  // field-catalogue page is a shape being illustrated, not a program a reader
  // pastes — it only looked like a continuation because it happens to mention
  // `option`, which an earlier fence imported. Compiling those reported the
  // page as full of undefined names it never claimed to define.
  const earlier = samples.filter(
    s => s.file === sample.file && s.index < sample.index
  );
  const carriesForward =
    /^\s*(?:const|let|var|function|class)\s|^[^\n=]*\s=\s(?!=)/m.test(
      sample.code
    );
  if (!carriesForward) {
    // A fence that only calls or awaits still continues the page when what it
    // calls is a value an earlier fence built: `await nextly.logout()` and the
    // sorting and populate calls on the Direct API reference are exactly that,
    // and nothing compiled them, so changing one to a method that does not
    // exist produced no diagnostic at all.
    //
    // Only a declared VALUE counts, never an imported name. That is what keeps
    // `radio({ ... })` on the field catalogue out: it mentions `option`, which
    // an earlier fence imported, and is a shape being illustrated rather than a
    // program a reader pastes.
    const values = earlier.flatMap(s =>
      declaredValuesIn(s.code, extensionFor(s))
    );
    const callsOne = values.some(name =>
      new RegExp(
        `\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*[.(]`
      ).test(sample.code)
    );
    if (!callsOne) return [];
  }
  const declared = new Set(
    earlier.flatMap(s => declaredNamesIn(s.code, extensionFor(s)))
  );
  const used = new Set(
    [...sample.code.matchAll(/[A-Za-z_$][\w$]*/g)].map(m => m[0])
  );
  const own = new Set(declaredNamesIn(sample.code, extensionFor(sample)));
  return [...declared].filter(n => used.has(n) && !own.has(n));
}

/**
 * Rebuild a continuation block with the declarations it depends on.
 *
 * Checking that an earlier block declared the name is enough to know the
 * sample is not broken, and not enough to check what it does with it. A later
 * fence calling `adapter.connectTypo()` reports only that `adapter` is
 * undefined; with `adapter` unresolved TypeScript cannot say the member is
 * wrong, so suppressing the missing name suppressed the defect too.
 *
 * So the sample is compiled again with the earlier blocks that declare the
 * names it is missing, in page order. Only those blocks: prepending a whole
 * page would introduce duplicate declarations and report them as defects of
 * their own. The prepended line count is returned so diagnostics can be
 * reported against the reader's line numbers rather than the harness's.
 */
/**
 * Errors only this harness can produce, by joining blocks a reader reads apart.
 *
 * TS2300 is a duplicate identifier, TS2451 is a redeclared block-scoped
 * variable, and TS2528 is a second default export. All three require two blocks
 * in one file, which only happens here: a page that declares `const posts`
 * twice is showing the same example twice, and a reader meets each fence on its
 * own.
 */
export const CONCATENATION_ARTEFACT = /error TS(?:2300|2451|2528):/;

export function withEarlierContext(sample, missingNames, samples) {
  // The nearest declaring block per name, not every block that happens to
  // declare it. Pulling in several copies of the same declaration manufactures
  // duplicate-identifier errors that belong to this harness and to nobody's
  // page.
  const earlier = samples
    .filter(s => s.file === sample.file && s.index < sample.index)
    .sort((a, b) => b.index - a.index);
  // The closure, not just the nearest block per name. Fence A imports a type,
  // B declares a value using it, C uses that value: pasting only B left A's
  // binding missing, B's value became `any`, and everything C did with it went
  // unchecked while C was labelled merely unresolved. Following what each
  // chosen block itself needs closes that.
  //
  // Bounded by what some earlier fence actually declares, so chasing a name
  // cannot wander into keywords, property names or the reader's own
  // identifiers — a fence is pulled in only when the page really does define
  // what it is being pulled in for.
  const declaredEarlierOnThePage = new Set(
    earlier.flatMap(s => declaredNamesIn(s.code, extensionFor(s)))
  );
  const chosen = new Map();
  const wanted = [...missingNames];
  const asked = new Set();
  while (wanted.length > 0) {
    const name = wanted.pop();
    if (asked.has(name)) continue;
    asked.add(name);
    const nearest = earlier.find(s =>
      declaredEarlier(name, s.file, s.index + 1, [s])
    );
    if (!nearest || chosen.has(nearest.index)) continue;
    chosen.set(nearest.index, nearest);
    const own = new Set(declaredNamesIn(nearest.code, extensionFor(nearest)));
    for (const m of nearest.code.matchAll(/[A-Za-z_$][\w$]*/g)) {
      const used = m[0];
      if (!own.has(used) && declaredEarlierOnThePage.has(used)) {
        wanted.push(used);
      }
    }
  }
  const needed = [...chosen.values()].sort((a, b) => a.index - b.index);
  if (needed.length === 0) return null;
  const prefix = needed.map(s => s.code).join("\n\n");
  // Which fence each prepended line came from, as line ranges over the prefix.
  // A diagnostic landing up there is about one of these blocks, and without
  // this the only thing known about it is that it was not the reader's fence,
  // which is not enough to report it against anything.
  //
  // The join puts one blank line between blocks, so each block advances the
  // cursor by its own line count plus that separator.
  const pastedFrom = [];
  let cursor = 1;
  for (const block of needed) {
    const lines = block.code.split("\n").length;
    pastedFrom.push({
      origin: `${block.file}#${String(block.index)}`,
      from: cursor,
      to: cursor + lines - 1,
    });
    cursor += lines + 1;
  }
  return {
    ...sample,
    code: `${prefix}\n\n${sample.code}`,
    prependedLines: prefix.split("\n").length + 1,
    pastedFrom,
  };
}

/**
 * The manifest of a package this workspace publishes, or null for anything else.
 *
 * Read from the checkout, because the point is to answer for the code in this
 * commit. The npm registry describes the last RELEASE, so it cannot see a
 * subpath a pull request has just removed — which is the breakage most worth
 * catching, and the reason nothing here asks it anything.
 */
const workspaceManifests = new Map();
function workspaceManifest(pkg) {
  if (workspaceManifests.size === 0) {
    for (const dirent of readdirSync(join(ROOT, "packages"), {
      withFileTypes: true,
    })) {
      if (!dirent.isDirectory()) continue;
      try {
        const manifest = JSON.parse(
          readFileSync(
            join(ROOT, "packages", dirent.name, "package.json"),
            "utf-8"
          )
        );
        if (manifest.name && !manifest.private) {
          workspaceManifests.set(manifest.name, manifest);
        }
      } catch {
        // A package without a readable manifest is not one a sample can import.
      }
    }
  }
  return workspaceManifests.get(pkg) ?? null;
}

/**
 * Sort diagnostics into what a reader would hit and what this harness caused.
 *
 * Pure and injectable so each rule can be tested on its own. Every branch here
 * was once a pattern match asserting something nobody had checked, and each of
 * those hid real defects.
 */
/**
 * Every name the workspace publishes, read from its SOURCE entries.
 *
 * The question a missing PascalCase name raises is not what it looks like but
 * whether the reader could have imported it. `Posts`, `Users` and `Page` are
 * the reader's own: types `nextly generate:types` writes into their project,
 * and components they author. Nothing here can define them and a page that
 * mentions one is not broken. `Media` and `Skeleton` look exactly the same and
 * are the opposite case: both ARE exported, from `nextly` and `@nextlyhq/ui`,
 * so a sample using one without importing it is a defect a reader meets.
 *
 * Measured rather than assumed, which is the whole point of asking the exports:
 * a rule keyed on the shape alone would have silenced those two.
 *
 * From `src`, never from `dist`, so the answer cannot depend on whether a build
 * has run. CI runs the script suite BEFORE the build step, and reading the built
 * types there returned an empty set: every name read as the reader's, and the
 * unit tests failed on a clean checkout while passing on a laptop.
 *
 * EVERY typed entry a package declares, not only `"."`. A symbol published from
 * a subpath is still published: `@nextlyhq/builder` exports `BuilderShell` from
 * `./shell` and keeps it out of the root barrel, and reading the barrel alone
 * called it the reader's.
 *
 * An entry is found in one of two ways, because neither alone is enough.
 * `dist/shell.d.ts` names `src/shell.ts` and that mirror covers most of them,
 * but not `nextly/document-lock`, which is built from
 * `src/domains/document-lock/contract.ts`. Guessing the source from the output
 * name left six entries unresolved, and with them went `DocumentLockHolder`,
 * `FieldTypeCatalogEntry` and `Hsv`: reader-owned on a clean checkout and ours
 * after a build, which is the build-state dependence this was supposed to end.
 *
 * So the build's own configuration is asked as well, by PARSING it for the
 * source paths it names. Parsed rather than imported, because most of these
 * configs are TypeScript and this gate runs under plain `node`, and because a
 * gate that must not consult the network should not be executing build scripts
 * either. An import chain inside the package is followed, since `@nextlyhq/ui`
 * declares which barrel each subpath is built from in a module beside its
 * config rather than in the config.
 */
const exportedNames = new Set();
/**
 * The subset that can supply a VALUE.
 *
 * TypeScript keeps two namespaces and a name can be in either. `Media` is in
 * only one: `packages/nextly/src/types/media.ts` exports it as a type and
 * `packages/admin/src/types/media.ts` as an interface, and nothing in the
 * workspace exports a value by that name. So `collections: [Posts, Users,
 * Media]` needs a value no import here can supply, which makes that `Media` the
 * reader's own collection exactly as `Posts` is, while `const m: Media` is a
 * defect a reader meets because the type is importable. Flattening the two
 * namespaces into one set answered the first case wrongly.
 */
const exportedValues = new Set();

/** `./dist/shell.d.ts` as its source, since that is what is always present. */
function sourceCandidatesFor(typesPath) {
  const built = typesPath.replace(/^\.\//, "").match(/^dist\/(.+)\.d\.ts$/);
  return built ? [`src/${built[1]}.ts`, `src/${built[1]}.tsx`] : [];
}

/** A relative import specifier, as the files it could mean. */
function localModuleCandidates(base) {
  const withoutJs = base.replace(/\.js$/, "");
  return [
    `${withoutJs}.ts`,
    `${withoutJs}.tsx`,
    base,
    `${withoutJs}.mjs`,
    join(withoutJs, "index.ts"),
  ];
}

/**
 * The source files a package's build configuration names.
 *
 * Read by parsing, so nothing here runs a build script or needs a TypeScript
 * loader to read a `.ts` config. Relative imports are followed within the
 * package, because a config may keep its entry map in a module beside it.
 */
function buildConfigEntries(packageDir) {
  let names;
  try {
    names = readdirSync(packageDir);
  } catch {
    return [];
  }
  const queue = names
    .filter(name => /^tsup(\..+)?\.config\.[cm]?[jt]s$/.test(name))
    .map(name => join(packageDir, name));
  const seen = new Set();
  const found = new Set();
  while (queue.length > 0) {
    const file = queue.pop();
    if (seen.has(file) || !existsSync(file)) continue;
    seen.add(file);
    const source = ts.createSourceFile(
      file,
      readFileSync(file, "utf-8"),
      ts.ScriptTarget.ES2022,
      false,
      ts.ScriptKind.TS
    );
    const visit = node => {
      if (ts.isStringLiteral(node) && /^src\/.+\.tsx?$/.test(node.text)) {
        const full = join(packageDir, node.text);
        if (existsSync(full)) found.add(full);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
    for (const statement of source.statements) {
      if (!ts.isImportDeclaration(statement)) continue;
      const specifier = statement.moduleSpecifier;
      if (!ts.isStringLiteral(specifier)) continue;
      if (!specifier.text.startsWith(".")) continue;
      for (const candidate of localModuleCandidates(
        join(dirname(file), specifier.text)
      )) {
        if (existsSync(candidate)) {
          queue.push(candidate);
          break;
        }
      }
    }
  }
  return [...found];
}

/** Every typed entry a package declares, resolved to a file that exists. *
 * The export set is a parameter with the workspace as its default, so the rule
 * can be stated as a test without a build having run. That mattered: reading it
 * unconditionally made the unit tests depend on build state, and they failed on
 * a clean CI checkout while passing on a laptop.
 */
function typedEntriesOf(packageDir, manifest) {
  const declared = [];
  const map = manifest.exports;
  if (map && typeof map === "object") {
    for (const target of Object.values(map)) {
      if (!target || typeof target !== "object") continue;
      const types =
        target.types ?? target.import?.types ?? target.default?.types;
      if (typeof types === "string") declared.push(types);
    }
  }
  const root = manifest.types ?? manifest.typings;
  if (typeof root === "string") declared.push(root);
  if (declared.length === 0) declared.push("dist/index.d.ts");

  const resolved = new Set(buildConfigEntries(packageDir));
  for (const entry of new Set(declared)) {
    for (const candidate of sourceCandidatesFor(entry)) {
      const full = join(packageDir, candidate.replace(/^\.\//, ""));
      if (existsSync(full)) {
        resolved.add(full);
        break;
      }
    }
  }
  return [...resolved];
}

/**
 * Whether an export is declared type-only, whatever it points at.
 *
 * Both spellings say it: `export type { X }` marks the declaration and
 * `export { type X }` marks the specifier. A symbol exported by several
 * specifiers is type-only only when every one of them is.
 */
function exportedAsTypeOnly(symbol) {
  const specifiers = (symbol.declarations ?? []).filter(ts.isExportSpecifier);
  if (specifiers.length === 0) return false;
  return specifiers.every(
    specifier => specifier.isTypeOnly || specifier.parent.parent.isTypeOnly
  );
}

function workspaceExports() {
  if (exportedNames.size > 0) return exportedNames;
  const entries = [];
  for (const dirent of readdirSync(join(ROOT, "packages"), {
    withFileTypes: true,
  })) {
    if (!dirent.isDirectory()) continue;
    const packageDir = join(ROOT, "packages", dirent.name);
    const manifestPath = join(packageDir, "package.json");
    if (!existsSync(manifestPath)) continue;
    let manifest;
    try {
      manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
    } catch {
      continue;
    }
    if (!manifest.name || manifest.private) continue;
    entries.push(...typedEntriesOf(packageDir, manifest));
  }
  if (entries.length === 0) return exportedNames;
  // One program over every entry, because the same question asked twenty times
  // costs twenty type-checker startups.
  const program = ts.createProgram(entries, {
    noEmit: true,
    skipLibCheck: true,
    target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.ReactJSX,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
  });
  const checker = program.getTypeChecker();
  for (const entry of entries) {
    const sourceFile = program.getSourceFile(entry);
    if (!sourceFile) continue;
    const symbol = checker.getSymbolAtLocation(sourceFile);
    if (!symbol) continue;
    for (const exported of checker.getExportsOfModule(symbol)) {
      exportedNames.add(exported.getName());
      // A re-export is an alias, and an alias carries no namespace of its own:
      // asking the alias whether it is a value answers for the thing bound
      // rather than for the binding. Both questions matter, and in this order.
      //
      // `export type { QueryClient } from "./types/query"` points at TanStack's
      // runtime class, so the target is a value while the export is not: an
      // importer of `@nextlyhq/admin` cannot get that class from it. Reading
      // only the target put `QueryClient` among the values and kept `new
      // QueryClient()` reported as a name the workspace could have supplied.
      if (exportedAsTypeOnly(exported)) continue;
      const target =
        exported.flags & ts.SymbolFlags.Alias
          ? checker.getAliasedSymbol(exported)
          : exported;
      if (target.flags & ts.SymbolFlags.Value) {
        exportedValues.add(exported.getName());
      }
    }
  }
  return exportedNames;
}

export const readerOwnedName = (name, exported = workspaceExports()) =>
  /^[A-Z][A-Za-z0-9]*$/.test(name) && !exported.has(name);

/** The value half of {@link workspaceExports}, built by the same pass. */
export function workspaceValueExports() {
  workspaceExports();
  return exportedValues;
}

/**
 * Whether every mention of `name` in this block needs a value.
 *
 * Asked of the block rather than of the diagnostic's position, because a
 * position has to survive the prelude a continuation fence is recompiled with,
 * and a mention that moved is a wrong answer given confidently. A fence that
 * uses the name in a type position anywhere keeps its finding, which is the
 * loud direction: the alternative silences a reference a reader would meet.
 */
export function usedOnlyAsValue(code, name, extension = "tsx") {
  let mentioned = false;
  let asType = false;
  const visit = node => {
    if (ts.isIdentifier(node) && node.text === name) {
      mentioned = true;
      for (let at = node.parent; at; at = at.parent) {
        if (ts.isTypeNode(at) || ts.isTypeQueryNode(at)) {
          asType = true;
          break;
        }
        if (ts.isExpression(at) || ts.isStatement(at)) break;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(parseSample(code, extension));
  return mentioned && !asType;
}

/** Whether a block ever constructs this name. */
export function constructedInBlock(code, name, extension = "tsx") {
  let constructed = false;
  const visit = node => {
    if (
      ts.isNewExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === name
    ) {
      constructed = true;
    }
    ts.forEachChild(node, visit);
  };
  visit(parseSample(code, extension));
  return constructed;
}

/** Whether two names are the same but for one character. */
function withinOneEdit(a, b) {
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (long.length - short.length > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < short.length && j < long.length) {
    if (short[i] === long[j]) {
      i += 1;
      j += 1;
      continue;
    }
    if (edits === 1) return false;
    edits += 1;
    if (short.length === long.length) i += 1;
    j += 1;
  }
  return true;
}

/**
 * Whether the name is one of ours with a character wrong.
 *
 * `NextlyEror` and `Skelton` are not names a reader declares, they are
 * `NextlyError` and `Skeleton` misspelled, and a rule that only asks whether
 * the workspace exports the name as written waves both through.
 *
 * Compared in lower case so a wrong capital counts as the same word, and a
 * difference of ONLY capitals is then excluded rather than reported: a reader's
 * generated `Users` sits one capital from an internal `users`, and calling that
 * a misspelling would charge the most ordinary reader-owned name there is.
 *
 * A difference at the END is excluded for the same reason, and it is the one
 * that matters most: a generated collection type is the PLURAL of a model this
 * workspace exports, so `Users` is one character from `User` and `Posts` one
 * from `Post`. Those two names are the whole point of the exemption. A
 * misspelling puts its wrong character in the middle, which is what separates
 * `NextlyEror` from `NextlyError` and `Skelton` from `Skeleton`.
 */
export function misspelledExport(name, exported = workspaceExports()) {
  const wanted = name.toLowerCase();
  for (const candidate of exported) {
    const other = candidate.toLowerCase();
    if (other === wanted) continue;
    if (!withinOneEdit(wanted, other)) continue;
    if (differsOnlyAtTheEnd(wanted, other)) continue;
    return true;
  }
  return false;
}

/** Whether one name is the other with a character added at the end. */
function differsOnlyAtTheEnd(a, b) {
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return long.length !== short.length && long.startsWith(short);
}

/**
 * Whether a missing name belongs to the reader, for the way this block used it.
 *
 * The name alone cannot answer it, in both directions.
 *
 * `Media` is exported as a type and never as a value, so it is the reader's in
 * `collections: [Posts, Users, Media]` and ours in `const m: Media`.
 *
 * And a name this workspace does not export is not the reader's just for that.
 * `new S3Client({})` asks for a runtime class, which is not a thing
 * `nextly generate:types` writes into a reader's project or a component they
 * author, so a sample using one has forgotten an import. `NextlyEror` is a name
 * of ours with a letter missing. Both were being set aside, which is the docs
 * gate accepting samples that are simply broken.
 */
export function readerOwnedMention(name, code, extension) {
  if (!/^[A-Z][A-Za-z0-9]*$/.test(name)) return false;
  // Asked before anything else, because it settles the question on its own:
  // whatever the workspace does or does not export, a constructed name has to
  // be a runtime class, and neither a generated type nor an authored component
  // is one.
  if (constructedInBlock(code, name, extension)) return false;
  if (workspaceExports().has(name)) {
    return (
      !workspaceValueExports().has(name) &&
      usedOnlyAsValue(code, name, extension)
    );
  }
  return !misspelledExport(name);
}

export async function classifyDocDiagnostics({ diagnostics, samples }) {
  const uninstalled = [];
  const continued = [];
  const real = [];
  const unchecked = [];
  // Imports of the reader's own files. Not findings, but the sample they sit in
  // was not really checked either.
  const readerFiles = [];
  // Implicit `any` on a parameter: a reader's generated types may or may not
  // answer it, and nothing in the diagnostic says which.
  const implicitAny = [];
  // Names the reader declares in their own project, which nothing here can.
  const readerNames = [];
  // A sample whose import did not resolve was not really checked: TypeScript
  // types the unresolved bindings as `any`, so a wrong call through them
  // produces no diagnostic at all. Counting such a sample as clean overstates
  // the audit, so the whole sample is named as unchecked instead.
  const uncheckedSamples = new Set();
  for (const line of diagnostics) {
    const missing = line.match(UNRESOLVED_IMPORT);
    if (missing) {
      // A file the reader writes. Neither the compiler nor the registry can see
      // it, so it is not a finding, but the rest of that sample was read
      // through bindings TypeScript had to type as `any`.
      if (READER_OWNED_FILE.test(line)) {
        readerFiles.push(line);
        uncheckedSamples.add(line.split("  ")[0].split(":")[0]);
        continue;
      }
      // Decided from this checkout alone. This used to ask the npm registry
      // whether a reader would have the package, and the answer changed the
      // COUNT: `true` and `null` excused a diagnostic, `false` gated it. A
      // network call is not a fact about a commit — the same tree scored 35
      // here and 37 in CI, because `next`'s manifest is large enough to time
      // out locally while CI fetched it. A gate whose verdict depends on the
      // weather is not a gate.
      //
      // So: a package THIS WORKSPACE publishes is judged by its own exports
      // map, which is the case that matters, because a subpath this commit
      // does not publish is a broken example a reader would hit today.
      // Anything else is a dependency a reader's project has and this checkout
      // may not, and the sample is reported unchecked rather than counted.
      //
      // The cost is that a misspelled third-party package name is no longer
      // gated. That is worth a reproducible verdict, and the sample still shows
      // up as unchecked rather than passing silently.
      const origin = line.split("  ")[0].split(":")[0];
      const published = workspaceManifest(packageOf(missing[1]));
      if (published) {
        if (exportsMapAnswers(published.exports, subpathOf(missing[1]))) {
          // Declared here and still unresolved: the tree is not built the way
          // this expects, which is about the checkout and not about the page.
          unchecked.push(line);
          uncheckedSamples.add(origin);
        } else {
          real.push(line);
        }
      } else {
        uninstalled.push(line);
        uncheckedSamples.add(origin);
      }
      continue;
    }
    if (IMPLICIT_ANY_PARAMETER.test(line)) {
      implicitAny.push(line);
      continue;
    }
    const name = line.match(MISSING_NAME);
    if (name) {
      const [file, idx] = line.split("  ")[0].split("#");
      const index = Number.parseInt(idx, 10);
      if (declaredEarlier(name[1], file, index, samples)) continued.push(line);
      else if (mentionIsReaderOwned(name[1], file, index, samples))
        readerNames.push(line);
      else real.push(line);
      continue;
    }
    real.push(line);
  }
  // The summary says unknown answers are counted as findings. They were being
  // put in their own list and printed nowhere, so the code contradicted it.
  real.push(...unchecked);
  return {
    real,
    uninstalled,
    continued,
    unchecked,
    uncheckedSamples,
    readerFiles,
    readerNames,
    implicitAny,
    // Every diagnostic that came in, so a caller can prove it kept them all.
    // The buckets above are a partition, and the audit's job is to record each
    // one somewhere the ratchet can see. Four times a bucket was reported to
    // the console and left out of the baseline, and each fix enumerated the
    // buckets it knew about, which is why a fifth kept being available. A count
    // the caller can check does not depend on anybody remembering.
    total: diagnostics.length,
  };
}

/**
 * Move a context recompile's diagnostics back onto the reader's page.
 *
 * The recompiled file is the sample with earlier declarations pasted above it,
 * so its line numbers are the harness's, not the reader's, and everything above
 * the sample belongs to a block that was already compiled and judged on its
 * own. Reporting those a second time counts one defect twice and points at the
 * wrong fence.
 *
 * A diagnostic the first pass already reported is dropped for the same reason:
 * the recompile exists to surface what could not be seen before, not to repeat
 * what could.
 *
 * One thing in the prepended region is not merely a repeat, and comes back
 * named: an import that did not resolve. The declaration a sample inherited can
 * itself depend on a still-earlier fence — fence 0 imports `createAdapter`,
 * fence 1 declares `const adapter = createAdapter()`, fence 2 calls
 * `adapter.connectTypo()` — and only the nearest declaring fence is pasted in.
 * `adapter` is then typed `any`, the bad member call reports nothing, and the
 * sample reads as checked when nothing in it was read. The origins are returned
 * so the audit can name those samples unchecked, which is what it already says
 * about every other unresolved import.
 */
/** The identifier a duplicate-declaration diagnostic is about. */
export const clashingName = line =>
  line.match(/error TS(?:2300|2451|2528): [^']*'([^']+)'/)?.[1];

export function rebaseContextDiagnostics({
  lines,
  prependedByOrigin,
  pastedFromByOrigin = new Map(),
}) {
  const out = [];
  const unresolvedInContext = new Set();
  // Names that clash because a declaration was PASTED IN. A clash the fence
  // already had with itself is the page's own defect and is reported.
  const clashesFromPasting = new Set();
  // The lines those names came from, kept so the partition below can be counted
  // rather than trusted: two clashes on one name collapse into a single set
  // entry, and a set cannot say how many lines it consumed.
  const artefacts = [];
  // An implicit `any` on a parameter of an INHERITED block. It says nothing
  // about whether the rebuild worked, so it must not make the sample unchecked,
  // and it is still a diagnostic somebody should see.
  const implicitAnyInContext = [];
  // Diagnostics about the pasted region that this construction did not invent.
  // The origin alone used to come back and the line was dropped, which named
  // the sample unchecked in the report and put nothing anywhere the gate reads.
  const contextOnly = [];
  for (const line of lines) {
    const [where, ...rest] = line.split("  ");
    const cut = where.lastIndexOf(":");
    const origin = cut === -1 ? where : where.slice(0, cut);
    const prepended = prependedByOrigin.get(origin);
    if (prepended === undefined) {
      out.push(line);
      continue;
    }
    const lineNo = Number.parseInt(where.slice(cut + 1), 10);
    if (!Number.isFinite(lineNo) || lineNo <= prepended) {
      // An import that did not resolve, and a name that is still missing. Both
      // leave the inherited value typed `any`, which is the state that makes
      // the rebuild worthless; only the first was being caught. The pasted
      // declaration can depend on a still-earlier fence — fence 0 defines
      // `createAdapter`, fence 1 declares `const adapter = createAdapter()` —
      // and only the nearest one is pasted, so the failure is a missing NAME
      // rather than a missing module. The duplicate-identifier errors this
      // construction invents are not a reason to distrust anything.
      // ANYTHING but an artefact this construction invents. An unresolved
      // import and a missing name both leave the inherited value typed `any`;
      // a SYNTAX error in the pasted fence is worse, because `compile()` then
      // drops the whole rebuilt file from its semantic pass and the block's
      // own code is never read at all. Enumerating error codes missed that
      // third one, so the rule is the complement instead.
      if (CONCATENATION_ARTEFACT.test(line)) {
        artefacts.push(line);
        const name = clashingName(line);
        if (name) clashesFromPasting.add(`${origin}\u0000${name}`);
      } else if (IMPLICIT_ANY_PARAMETER.test(line)) {
        implicitAnyInContext.push(line);
      } else {
        unresolvedInContext.add(origin);
        // Reported against the block that produced it, at that block's own line
        // number, which is the same line it would carry had the block been
        // compiled alone. Charging it to the fence that merely inherited the
        // declaration points a reader at code that is not the problem, and
        // leaves the diagnostic with an identity no other pass can match.
        const source = (pastedFromByOrigin.get(origin) ?? []).find(
          range => lineNo >= range.from && lineNo <= range.to
        );
        contextOnly.push(
          source
            ? `${source.origin}:${String(lineNo - source.from + 1)}  ${rest.join("  ")}`
            : line
        );
      }
      continue;
    }
    out.push(`${origin}:${String(lineNo - prepended)}  ${rest.join("  ")}`);
  }
  // Every line in, exactly once out. This partition runs BEFORE the classifier,
  // so the conservation check the classifier's own output is held to cannot see
  // it: a line dropped here was never in the total that check compares. That is
  // how the origin-only branch above hid a real diagnostic behind a sample the
  // report merely called unchecked.
  //
  // EXACT, not "at least", for the same reason as the one downstream: a bucket
  // added later is caught by the equality breaking rather than by anybody
  // remembering to extend a list.
  const partitioned =
    out.length +
    artefacts.length +
    implicitAnyInContext.length +
    contextOnly.length;
  if (partitioned !== lines.length) {
    throw new Error(
      `doc samples: the context recompile produced ${String(lines.length)} ` +
        `diagnostic(s) and ${String(partitioned)} were partitioned. One is ` +
        `going nowhere, and nothing downstream can see a line this pass drops.`
    );
  }
  return {
    lines: out,
    unresolvedInContext,
    clashesFromPasting,
    // The artefact lines themselves, not only the names taken from them, so the
    // four-way partition can be counted from outside as well as inside. An
    // invariant only its own function can check is one nobody else can hold it
    // to when a fifth bucket is added.
    artefacts,
    implicitAnyInContext,
    contextOnly,
  };
}

/**
 * What this audit compared, in one line.
 *
 * The documentation is fetched from the monorepo's `main` while this site pins
 * an exact `nextly`, and the two move independently: an API documented after
 * the pinned release reads here as a defect, and one removed after it can read
 * clean. Pinning the docs to the release would settle that and would also
 * change what a visitor reads on /docs, which is a decision about the site
 * rather than about this checker. So the report states its own basis, and a
 * finding can be weighed against it.
 */
/**
 * The context-only diagnostics a recompile is the first pass to see.
 *
 * Deduped on the DECLARING fence and the message, which is what an identity is,
 * rather than on the message alone. These lines carry the origin of the block
 * that produced them, so a repeat is a repeat about the same fence. Matching on
 * message text across the whole corpus threw away a real diagnostic whenever any
 * other page happened to say `Cannot find name 'Foo'`, which is ratcheting on
 * counts rather than on identities, one level down.
 *
 * Still a dedup rather than nothing: a pasted block that was itself a module was
 * compiled and judged on its own in the first pass, and a block pasted into four
 * continuations arrives here four times.
 */
export function contextOnlyWorthRecording({ contextOnly, firstPass }) {
  // The whole rebased line: page, fence, LINE NUMBER and message.
  //
  // Not the baseline identity, which drops the line number on purpose so a
  // finding that moves down a fence stays the same finding. Used as a dedup key
  // that is wrong in both directions: `docs/a.mdx#1` and `docs/elsewhere.mdx#1`
  // become one diagnostic, and one fence saying `Cannot find name 'Foo'` on two
  // lines becomes one occurrence, while the fingerprint downstream counts
  // occurrences. A second identical error would then move nothing.
  //
  // The line numbers do match across the two passes: a pasted block is its own
  // code verbatim, and these lines have already been rebased onto it, so the
  // location a first-pass compile reported is the location this one reports.
  const reportedAlready = new Set(firstPass);
  const seen = new Set();
  const worth = [];
  for (const line of contextOnly) {
    if (reportedAlready.has(line) || seen.has(line)) continue;
    seen.add(line);
    worth.push(line);
  }
  return worth;
}

export function auditBasis() {
  let pkg = "an unreadable nextly";
  try {
    pkg = `nextly ${String(JSON.parse(readFileSync(join(ROOT, "packages", "nextly", "package.json"), "utf-8")).version)}`;
  } catch {
    // Left as the unreadable wording: naming the version is the point, and
    // guessing one would be worse than admitting it could not be read.
  }
  return `the docs in this commit against ${pkg}`;
}

/** The page and the name a diagnostic is about: `page.mdx#3` and `adapter`. */
export const originOf = line => line.split("  ")[0].split(":")[0];
export const nameIn = line => line.match(MISSING_NAME)?.[1];

/**
 * The page a diagnostic belongs to, for grouping and for the baseline's keys.
 *
 * Through `originOf`, which already answers `?` for a diagnostic the compiler
 * could not attribute to a fence. Splitting the raw line on `#` instead handed
 * back the WHOLE message for that shape, because it contains no `#`: the page
 * key became a diagnostic, and the gate then reported an error message as a
 * page over its allowance, with no baseline entry anyone could write for it.
 */
export const pageOf = line => {
  const at = originOf(line);
  return at.includes("#") ? at.split("#")[0] : at;
};

/**
 * Report on the documentation without gating on it.
 *
 * Never fails the run. These pages come from the monorepo and are overwritten
 * on the next fetch, so a red here would be a red this repository cannot clear,
 * and a check that cannot be cleared teaches people to ignore it.
 */
/**
 * How many diagnostics the classifier produced that nobody kept.
 *
 * Zero is the only acceptable answer: `real` is charged to a page, the other
 * buckets are set aside by identity, and `continued` comes back through this
 * same partition after its recompile. Anything else is a class of diagnostic
 * the gate cannot see, which is the shape of every bucket that has escaped.
 *
 * `unchecked` is deliberately not a term: the classifier appends it to `real`
 * before returning, so counting it again would inflate the sum and let a
 * missing bucket hide behind the surplus. That is the same mistake as comparing
 * against the whole set-aside list, which carries entries added before
 * classification.
 */
export function unaccountedFor({
  total,
  real,
  continued,
  readerFiles,
  readerNames,
  uninstalled,
  implicitAny,
}) {
  return (
    total -
    (real + continued + readerFiles + readerNames + uninstalled + implicitAny)
  );
}

async function auditDocs() {
  let all;
  try {
    all = collectDocSamples();
  } catch (err) {
    // A malformed page is a finding, not a reason to stop looking. Only an
    // unreadable tree is the latter.
    if (err.brokenFences) throw err;
    console.log(
      `docs: the tree is present but incomplete, so nothing was audited.\n  ${String(err.message ?? err)}`
    );
    return;
  }
  if (all === null) {
    console.log(
      "docs: the docs/ directory is not present, so nothing was audited. " +
        "Run `node scripts/fetch-docs.mjs` first."
    );
    return;
  }
  // Only modules are COMPILED, because a bare object literal parses as a block
  // with labels and reports syntax errors that say nothing about the API. But
  // every block is SEARCHED when asking what an earlier fence declared: a page
  // that introduces a value in a fence with no import of its own, and uses it
  // in the next one, is a documentation shape, and reading it as an undefined
  // name would put a finding on the page that a reader never meets.
  const samples = all.filter(s => isModule(s.code, extensionFor(s)));
  // Everything the gate ignores EXCEPT the reader's own files: those are kept
  // so the samples carrying them can be named unchecked rather than counted as
  // compiled clean.
  const AUDIT_IGNORES = SUPPLIED_BY_THE_READER.filter(
    re => re !== READER_OWNED_FILE && re !== IMPLICIT_ANY_PARAMETER
  );
  const firstPass = compile(samples, "docs", AUDIT_IGNORES);
  // Every diagnostic this audit decides not to charge a page for, in one place
  // and marked with the reason it was set aside.
  //
  // Three separate buckets used to escape the ratchet, and each was the same
  // defect: a class of diagnostic reported to the console and left out of the
  // fingerprint, so a NEW instance of it moved nothing the gate reads. Holding
  // them in one list is what stops a fourth joining them: nothing is set aside
  // without being recorded, so an escape has to be added deliberately rather
  // than by forgetting.
  const setAside = [];
  // Read straight after the compile it belongs to, before any later one
  // overwrites it.
  setAside.push(
    ...suppressedByTheReaderRule.map(d => ({
      mark: "suppressed",
      text: d.text,
    }))
  );
  const { continued: continuations } = await classifyDocDiagnostics({
    diagnostics: firstPass,
    samples: all,
  });

  // A continuation is only harmless if the block does nothing wrong with what
  // it inherited, and that cannot be known while the value is unresolved. Each
  // one is compiled again with the declarations it needs.
  const byOrigin = new Map();
  for (const line of continuations) {
    const origin = line.split("  ")[0].split(":")[0];
    const name = line.match(MISSING_NAME)?.[1];
    if (name) byOrigin.set(origin, [...(byOrigin.get(origin) ?? []), name]);
  }
  const rebuilt = [];
  // The names each rebuild was FOR, so a name that is still missing can be told
  // from an unrelated one the block simply gets wrong.
  const inheritedByOrigin = new Map();
  for (const [origin, names] of byOrigin) {
    const [file, idx] = origin.split("#");
    const sample = samples.find(
      s => s.file === file && s.index === Number.parseInt(idx, 10)
    );
    if (!sample) continue;
    const withContext = withEarlierContext(sample, names, all);
    if (withContext) {
      inheritedByOrigin.set(origin, names);
      rebuilt.push(withContext);
    }
  }

  // Fences that continue an example without repeating its imports. They are not
  // standalone modules, so nothing compiled them at all, and
  // `api-reference/direct-api.mdx` is full of them — one calling the legacy
  // `result.docs` shape this whole check exists to catch. Compiled with the
  // declarations they inherit, they say what they do with them.
  //
  // Only fences that actually use an earlier name qualify. A bare object
  // literal illustrating a shape inherits nothing and stays out, which is what
  // keeps this from compiling things that are not programs.
  const continuedWithoutImports = new Set();
  for (const sample of all) {
    if (isModule(sample.code, extensionFor(sample))) continue;
    const names = inheritedNames(sample, all);
    if (names.length === 0) continue;
    const withContext = withEarlierContext(sample, names, all);
    if (!withContext) continue;
    const origin = `${sample.file}#${String(sample.index)}`;
    continuedWithoutImports.add(origin);
    inheritedByOrigin.set(origin, names);
    rebuilt.push(withContext);
  }
  const fromContext = [];
  // A name the rebuild could not resolve. Being declared earlier was only ever
  // a proxy for being available, and the proxy can be wrong: an earlier fence
  // may declare the name inside a function, or a comment may merely mention
  // `const adapter`. When the declaration is present and the name is still
  // missing, the excuse was wrong and the finding is a reader's.
  const stillMissing = [];
  // Samples whose inherited declaration itself failed to resolve something, so
  // the value they were rebuilt around is still `any` and nothing they do with
  // it was really checked.
  const notReallyRebuilt = new Set();
  // Implicit `any` seen only inside a pasted block, which no other pass reads.
  const fromInheritedBlocks = [];
  if (rebuilt.length > 0) {
    // Read straight after this compile and before anything else runs one:
    // `compile` clears the module-level array on entry, so a suppression raised
    // while reconstructing context is only visible here. Taking the first
    // pass's copy alone left this whole pass unratcheted, which is where an
    // import-free continuation could acquire a suppressed diagnostic without
    // moving anything the gate reads.
    const contextDiagnostics = compile(rebuilt, "docs-context", AUDIT_IGNORES);
    setAside.push(
      ...suppressedByTheReaderRule.map(d => ({
        mark: "suppressed",
        text: d.text,
      }))
    );
    const {
      lines: rebased,
      unresolvedInContext,
      clashesFromPasting,
      implicitAnyInContext,
      contextOnly,
    } = rebaseContextDiagnostics({
      lines: contextDiagnostics,
      prependedByOrigin: new Map(
        rebuilt.map(s => [`${s.file}#${String(s.index)}`, s.prependedLines])
      ),
      pastedFromByOrigin: new Map(
        rebuilt.map(s => [`${s.file}#${String(s.index)}`, s.pastedFrom ?? []])
      ),
    });
    for (const origin of unresolvedInContext) notReallyRebuilt.add(origin);
    // Counted, but only the ones no compiled fence reported already: a
    // prepended MODULE was compiled on its own in the first pass, while an
    // import-free one was never compiled at all and this is the only place its
    // diagnostic appears. Matched on the message, since the location differs.
    const messageOf = line => line.split("  ").slice(1).join("  ");
    const seen = new Set(
      firstPass.filter(l => IMPLICIT_ANY_PARAMETER.test(l)).map(messageOf)
    );
    for (const line of implicitAnyInContext) {
      if (!seen.has(messageOf(line))) fromInheritedBlocks.push(line);
    }
    // Everything else the recompile said about a pasted declaration, set aside
    // by identity under the same rule. Only the origin used to come back: the
    // report named the sample unchecked and the line went nowhere, so a new
    // diagnostic in an inherited declaration moved no number the gate compares
    // and a fence could stop being checked while the baseline still passed.
    //
    // Deduped on the DECLARING fence and the message, not on the message alone.
    // These lines now carry the origin of the block that produced them, so a
    // repeat is a repeat about the same fence. Matching on message text across
    // the whole corpus would have thrown away a real diagnostic whenever any
    // other page happened to say `Cannot find name 'Foo'`, which is the same
    // mistake as ratcheting on counts rather than identities.
    //
    // Still a dedup rather than nothing: a pasted block that was itself a
    // module was compiled and judged on its own in the first pass, and a block
    // pasted into four continuations arrives four times here.
    setAside.push(
      ...contextOnlyWorthRecording({ contextOnly, firstPass }).map(text => ({
        mark: "context",
        text,
      }))
    );
    // Deduped against the first pass, because the recompile exists to surface
    // what could not be seen before, not to repeat what could. Except the
    // survivors above: their first-pass copy was filed as a continuation, so
    // dropping the rebuilt one as "already reported" would lose them entirely.
    const alreadyReported = new Set(firstPass);
    // Only the names the first pass EXCUSED. A sample can carry a genuine
    // undefined name beside a real continuation: the genuine one is already in
    // the actionable list, reappears here because the rebuild does not fix it,
    // and would be counted and printed a second time.
    const wasExcused = new Set(
      continuations.map(
        line => `${originOf(line)}\u0000${String(nameIn(line))}`
      )
    );
    for (const line of rebased) {
      if (MISSING_NAME.test(line)) {
        const origin = originOf(line);
        const name = String(nameIn(line));
        const inherited = (inheritedByOrigin.get(origin) ?? []).includes(name);
        if (wasExcused.has(`${origin}\u0000${name}`)) {
          // The first pass claimed an earlier block declares this name. The
          // declaration is now present and the name is still missing, so the
          // claim was wrong and the finding is a reader's.
          stillMissing.push(line);
        } else if (inherited) {
          // A name this block was rebuilt FOR, still missing: the rebuild did
          // not reconstruct the page, so the sample is named unchecked rather
          // than charged with a defect it may not have.
          notReallyRebuilt.add(origin);
        } else {
          // Neither. The block simply uses a name nothing on the page defines,
          // which is a reader's finding wherever it appears. Deduped below,
          // because a module fence would have reported it in the first pass
          // too.
          if (!alreadyReported.has(line)) fromContext.push(line);
        }
        continue;
      }
      // A reader meets each fence on its own and never concatenates them, so a
      // name declared twice ACROSS blocks, or two blocks each carrying a
      // default export, is a property of the harness rather than of the page.
      //
      // A fence that declares the same name twice WITHIN ITSELF is a different
      // thing, and an import-free one has no first pass to have reported it, so
      // discarding every duplicate hid a malformed block entirely. Only the
      // names that also clashed in the pasted region are the harness's.
      if (CONCATENATION_ARTEFACT.test(line)) {
        const name = clashingName(line);
        const pasted =
          name === undefined ||
          clashesFromPasting.has(`${originOf(line)}\u0000${name}`);
        if (pasted) continue;
        if (!alreadyReported.has(line)) fromContext.push(line);
        continue;
      }
      if (!alreadyReported.has(line)) fromContext.push(line);
    }
  }

  // One classification over everything, so a diagnostic the recompile surfaced
  // is sorted by the same rules as the rest. Pushing them straight into the
  // actionable list turned an import of a package that is published but absent
  // here — already excused in the first pass — into a reader-facing finding.
  const {
    real,
    uninstalled,
    continued,
    unchecked,
    uncheckedSamples,
    readerFiles,
    readerNames,
    implicitAny,
    total: classified,
  } = await classifyDocDiagnostics({
    diagnostics: [...firstPass, ...fromContext],
    samples: all,
  });

  // The rest of what this audit sets aside, completed here so the report below
  // and the baseline both read one list. Two lists would drift, and the drift
  // would be a number in the console disagreeing with what the gate protects.
  setAside.push(
    // An implicit `any` on a parameter, from either pass. The strict setup
    // these samples compile under rejects one, so a sample newly adding
    // `function parse(value) {}` is a real regression an aggregate count could
    // not see.
    ...implicitAny.map(text => ({ mark: "implicit-any", text })),
    ...fromInheritedBlocks.map(text => ({ mark: "implicit-any", text })),
    // An import of a package that is published but not installed here. The
    // reader has it and this checkout does not, so the page is not charged.
    // TypeScript types everything reached through that import as `any` all the
    // same, so misspelling a package name removed a fence's checking while
    // moving no number: the fourth bucket to do exactly that.
    ...uninstalled.map(text => ({ mark: "uninstalled", text })),
    // An import of a file only the reader has. It is right not to charge the
    // page, since the file legitimately is not here. But the binding becomes
    // `any`, so everything reached through it stops being checked while the
    // fence still counts as compiled; recording which fences are in that state
    // is what stops one quietly joining them.
    ...readerFiles.map(text => ({ mark: "reader-file", text })),
    // Names the reader declares in their own project. Recorded by identity like
    // every other set-aside bucket, so a page cannot start mentioning a new one
    // unnoticed; what it no longer does is charge the page a finding.
    ...readerNames.map(text => ({ mark: "reader-name", text }))
  );

  // Nothing may be dropped on the floor. `real` is charged to a page, the
  // classifier's other buckets are set aside by identity, and `continued` is
  // recompiled and comes back through this same partition; a diagnostic in
  // none of them is one the gate cannot see, which is the shape of every
  // bucket that has escaped so far.
  //
  // EXACT, not "at least". Comparing against the whole of `setAside` counted
  // entries added before classification, the first pass's suppressions among
  // them, and that surplus could cover for a bucket left out of both sides. An
  // equality over the classifier's own output has nothing to hide behind.
  //
  // `unchecked` is not added: the classifier appends it to `real` before
  // returning, so counting it again would be the same surplus one line down.
  const missing = unaccountedFor({
    total: classified,
    real: real.length,
    continued: continued.length,
    readerFiles: readerFiles.length,
    readerNames: readerNames.length,
    uninstalled: uninstalled.length,
    implicitAny: implicitAny.length,
  });
  if (missing !== 0) {
    throw new Error(
      `doc samples: the classifier produced ${String(classified)} diagnostic(s) ` +
        `and ${String(classified - missing)} were accounted for. A bucket has ` +
        `to be charged to a page or recorded by identity, not just reported: ` +
        `the gate cannot see one that is neither.`
    );
  }

  // The survivors are actionable, and their first-pass copies stop counting as
  // continuations: the same page and the same name, whatever line each landed
  // on.
  const wrongExcuse = new Set(
    stillMissing.map(line => `${originOf(line)}\u0000${String(nameIn(line))}`)
  );
  real.push(...stillMissing);
  const stillContinued = continued.filter(
    line => !wrongExcuse.has(`${originOf(line)}\u0000${String(nameIn(line))}`)
  );
  for (const origin of notReallyRebuilt) uncheckedSamples.add(origin);

  const byFile = new Map();
  for (const line of real) {
    byFile.set(pageOf(line), [...(byFile.get(pageOf(line)) ?? []), line]);
  }
  console.log(
    `\ndocs, ${auditBasis()}: ` +
      `${String(samples.length + continuedWithoutImports.size)} of ` +
      `${String(all.length)} samples compiled ` +
      `(${String(continuedWithoutImports.size)} of them fences that continue an ` +
      `earlier one without repeating its imports).\n` +
      `  ${String(real.length)} diagnostic(s) a reader would hit, across ` +
      `${String(byFile.size)} page(s).\n` +
      (setAside.length > 0
        ? `  ${String(setAside.length)} were set aside and are ratcheted by ` +
          `identity rather than charged to a page: ` +
          `${[...new Set(setAside.map(d => `${d.mark} ${d.text.match(/error TS\d+/)?.[0] ?? "?"}`))].sort().join(", ")}. ` +
          `Nothing in a diagnostic proves it came from an ungenerated document ` +
          `field or a reader's own file, so this number is the size of that ` +
          `assumption.\n`
        : "") +
      `  ${String(uninstalled.length)} import a package that is published but ` +
      `not installed here, which a reader would have.\n` +
      `  ${String(stillContinued.length)} use a name an earlier block on the same ` +
      `page declares, which is a documentation shape rather than a wrong API.` +
      (unchecked.length > 0
        ? `\n  of those findings, ${String(unchecked.length)} could not be ` +
          `checked against the registry and are reported rather than excused.`
        : "") +
      (implicitAny.length + fromInheritedBlocks.length > 0
        ? `\n  ${String(implicitAny.length + fromInheritedBlocks.length)} leave a parameter implicitly ` +
          `\`any\`, which a reader's generated types answer for a document ` +
          `field and do not answer for a plain function.`
        : "") +
      (readerNames.length > 0
        ? `\n  ${String(readerNames.length)} name a type or component the reader ` +
          `declares, such as a generated Posts or their own Page, which no ` +
          `package here exports.`
        : "") +
      (readerFiles.length > 0
        ? `\n  ${String(readerFiles.length)} import a file the reader writes, ` +
          `such as ./collections/Posts, which is expected and is not a finding.`
        : "") +
      (uncheckedSamples.size > 0
        ? `\n  ${String(uncheckedSamples.size)} sample(s) had an import that ` +
          `did not resolve here, so the rest of those samples was not really ` +
          `checked: TypeScript types unresolved bindings as \`any\`.`
        : "")
  );
  // With the location, not just the message. These pages carry many fences
  // each, and several repeat the same mistake, so a bare list of messages
  // cannot be acted on without compiling every block again by hand — which
  // defeats the point of handing this to the monorepo. `#3:12` is the fourth
  // TypeScript fence on the page, line 12 within that fence.
  console.log("  locations read as #<TypeScript fence, from 0>:<line in it>");
  for (const [file, lines] of [...byFile].sort()) {
    console.log(`  ${file}`);
    for (const line of [...lines].sort()) {
      const [where, ...rest] = line.split("  ");
      const at = where.slice(where.indexOf("#"));
      console.log(`    ${at}  ${rest.join("  ")}`);
    }
  }

  // Returned as well as printed: the gate ratchets on exactly the findings this
  // report names, so a page cannot read clean here and fail there.
  return {
    byFile,
    // Everything set aside, by identity, each carrying the reason. None of it
    // charges a page a finding; what it can no longer do is change unnoticed.
    setAside,
    coverage: {
      files: [...new Set(all.map(sample => sample.file))].sort(),
      samples: all.length,
      compiled: samples.length + continuedWithoutImports.size,
      // Per page as well as in total. Totals cancel: a change that loses a
      // fence on one page while adding one on another leaves `samples`
      // unmoved, and the page that went quiet is exactly the one nobody would
      // think to look at. Recorded per page, the loss has nowhere to hide.
      perPage: Object.fromEntries(
        [...new Set(all.map(sample => sample.file))].sort().map(file => [
          file,
          {
            samples: all.filter(sample => sample.file === file).length,
            // Compiled as well as extracted. A fence that stops QUALIFYING
            // for compilation is still extracted, so tracking only the
            // extracted count let a page quietly lose its checking while its
            // sample count stood still.
            compiled:
              samples.filter(sample => sample.file === file).length +
              [...continuedWithoutImports].filter(
                origin => origin.split("#")[0] === file
              ).length,
          },
        ])
      ),
    },
  };
}

/**
 * What each page is still allowed to get wrong.
 *
 * A hard gate would be red on every correct run today, because the pages
 * already carry findings, and a check that fails when nothing is wrong teaches
 * people to re-run reds instead of reading them. So the count ratchets: a page
 * may not get worse, and a page that gets better has to say so here, which is
 * how the number reaches zero and the entry disappears.
 *
 * The same shape as `eslint-bare-error-allowlist.json`, for the same reason.
 */
const BASELINE = join(ROOT, "scripts", "doc-samples-baseline.json");

const readBaseline = () => {
  try {
    return JSON.parse(readFileSync(BASELINE, "utf-8"));
  } catch {
    return {};
  }
};

/**
 * What a finding IS, for the baseline to hold: the fence it landed on and the
 * message, with neither the line number nor any absolute path.
 *
 * The FENCE is kept and the line number dropped. A line moves whenever anything
 * above it on the page is edited, so keying on it makes the baseline churn on
 * every edit and stop being read. The message ALONE is one step short of an
 * identity, though: two fences on one page can carry the same message, so
 * fixing it in one while introducing it in the other leaves that page's count
 * for that message unchanged and the newly broken fence is accepted. A fence
 * ordinal moves only when a TypeScript fence is added, removed or reordered,
 * which is exactly when its diagnostics deserve another look.
 *
 * Absolute paths are stripped because they differ between a laptop and CI.
 */
export function identityOf(line, root = ROOT) {
  const cut = line.indexOf("  ");
  const where = cut === -1 ? "" : line.slice(0, cut);
  const message = (cut === -1 ? line : line.slice(cut + 2))
    .split(root)
    .join("<root>/")
    .replace(/\s+/g, " ")
    .trim();
  // `docs/x.mdx#3:12` becomes `#3`. A diagnostic the compiler could not
  // attribute to a fence carries an absolute path or `?` instead, and gets no
  // prefix rather than an invented one.
  const hash = where.indexOf("#");
  if (hash === -1) return message;
  const colon = where.indexOf(":", hash);
  const fence = colon === -1 ? where.slice(hash) : where.slice(hash, colon);
  return `${fence} ${message}`;
}

/**
 * The one comparison between a held baseline and a fresh audit, in three parts:
 * coverage that may not shrink, diagnostic identities that may not change, and
 * per-page counts.
 *
 * Every caller narrows THIS comparison rather than restating a cheaper one.
 * `--only` used to compare a page's total finding count and return, so the
 * local verification path this tool advertises accepted a page that had swapped
 * one diagnostic for another or lost a compiled fence — a weaker check than the
 * one CI runs, reached by the contributors most likely to trust it.
 *
 * `only` narrows every part to a single page. The repository-wide totals are
 * skipped in that mode because they are not one page's to answer for.
 */
export function compareToBaseline({
  baseline,
  coverage,
  counted,
  fingerprint,
  only = null,
}) {
  const mine = file => only === null || file === only;

  const lost = [];
  const gained = [];
  if (only === null) {
    const seen = {
      pages: coverage.files.length,
      samples: coverage.samples,
      compiled: coverage.compiled,
    };
    for (const [what, was] of Object.entries(baseline.coverage ?? {})) {
      if ((seen[what] ?? 0) < was) {
        lost.push(
          `${what}: was ${String(was)}, now ${String(seen[what] ?? 0)}`
        );
      }
      // A GAIN has to be recorded too, or it is not protected. Accepting one
      // silently meant a fence added today could be deleted tomorrow, returning
      // every count to what the baseline holds, and both changes passed: a
      // ratchet that only resists decreases from a number nobody updates
      // protects the corpus as it was and nothing since.
      if ((seen[what] ?? 0) > was) {
        gained.push(
          `${what}: was ${String(was)}, now ${String(seen[what] ?? 0)}`
        );
      }
    }
  }
  for (const [file, was] of Object.entries(baseline.samplesPerPage ?? {})) {
    if (!mine(file)) continue;
    const now = coverage.perPage[file] ?? { samples: 0, compiled: 0 };
    for (const what of ["samples", "compiled"]) {
      if ((now[what] ?? 0) < (was[what] ?? 0)) {
        lost.push(
          `${file}: ${what} was ${String(was[what])}, now ${String(now[what] ?? 0)}`
        );
      }
      if ((now[what] ?? 0) > (was[what] ?? 0)) {
        gained.push(
          `${file}: ${what} was ${String(was[what])}, now ${String(now[what] ?? 0)}`
        );
      }
    }
  }
  // A page the baseline has never seen is a gain as well.
  for (const file of coverage.files) {
    if (!mine(file)) continue;
    if (!(baseline.samplesPerPage ?? {})[file]) {
      gained.push(`${file}: not in the baseline`);
    }
  }

  const held = baseline.findings ?? {};
  const appeared = [];
  const gone = [];
  for (const [file, counts] of Object.entries(fingerprint)) {
    if (!mine(file)) continue;
    for (const [message, n] of Object.entries(counts)) {
      const was = (held[file] ?? {})[message] ?? 0;
      if (n > was) appeared.push(`${file}: ${message}`);
    }
  }
  for (const [file, counts] of Object.entries(held)) {
    if (!mine(file)) continue;
    for (const [message, was] of Object.entries(counts)) {
      const now = (fingerprint[file] ?? {})[message] ?? 0;
      if (now < was) gone.push(`${file}: ${message}`);
    }
  }

  const allowed = baseline.pages ?? {};
  const worse = [];
  const better = [];
  for (const [file, count] of Object.entries(counted)) {
    if (!mine(file)) continue;
    const cap = allowed[file] ?? 0;
    if (count > cap)
      worse.push(`${file}: allowed ${String(cap)}, found ${String(count)}`);
  }
  for (const [file, cap] of Object.entries(allowed)) {
    if (!mine(file)) continue;
    const count = counted[file] ?? 0;
    if (count < cap)
      better.push(`${file}: allowed ${String(cap)}, found ${String(count)}`);
  }

  return { lost, gained, appeared, gone, worse, better };
}

/**
 * Prints whichever part of a comparison failed, and answers whether any did.
 * Shared by the repository-wide and single-page paths so the two cannot drift
 * into telling a contributor different things about the same state.
 */
function reportComparison(
  { lost, gained, appeared, gone, worse, better },
  findings
) {
  if (lost.length > 0) {
    console.error(
      "\ndoc samples: fewer samples are being checked than the baseline records. " +
        "A page or fence has left the set, which reads the same as a page that " +
        "was fixed. If the loss is intended, rewrite the baseline and say why.\n"
    );
    for (const line of lost) console.error(`  ${line}`);
    return true;
  }

  if ((gained ?? []).length > 0) {
    console.error(
      "\ndoc samples: more samples are being checked than the baseline records, " +
        "which is good news it has not been told. Rewrite it so the gate starts " +
        "protecting them; until then they can be deleted again for free.\n"
    );
    for (const line of gained) console.error(`  ${line}`);
    return true;
  }

  // Identity comparison runs before the counts, because it says WHAT changed
  // where a count only says how much.
  if (appeared.length > 0) {
    console.error(
      "\ndoc samples: these diagnostics are new. A sample a reader copies has " +
        "to run, so fix the finding rather than recording it.\n"
    );
    for (const line of appeared) console.error(`  ${line}`);
    return true;
  }
  if (gone.length > 0) {
    console.error(
      "\ndoc samples: these diagnostics are gone, which is good news the " +
        "baseline has not been told. Rewrite it so the gate starts protecting " +
        "what you fixed.\n"
    );
    for (const line of gone) console.error(`  ${line}`);
    return true;
  }

  if (worse.length > 0) {
    console.error(
      "\ndoc samples: these pages got worse. A sample a reader copies has to " +
        "run, so fix the finding rather than raising the number.\n"
    );
    for (const line of worse) console.error(`  ${line}`);
    for (const line of findings) {
      if (worse.some(w => line.startsWith(w.split(":")[0]))) {
        console.error(`    ${line}`);
      }
    }
    return true;
  }
  if (better.length > 0) {
    console.error(
      "\ndoc samples: these pages are better than the baseline says. Lower the " +
        "number in scripts/doc-samples-baseline.json, or remove the entry at " +
        "zero, so the gate starts protecting them.\n"
    );
    for (const line of better) console.error(`  ${line}`);
    return true;
  }
  return false;
}

async function main() {
  // The audit's own classification, not a second cruder pass: a fence that
  // continues an earlier one, or imports a package a reader would have and this
  // checkout does not, is not something a reader meets, and counting those
  // would fill the baseline with the harness's own artefacts.
  requireBuiltPackages();
  // `auditDocs` returns nothing on the two paths it treats as graceful: a
  // partial tree, and no docs/ at all. Both print why and stop. Destructuring
  // the result unconditionally turned each of those into a TypeError one line
  // after the message explaining that nothing was audited.
  const audit = await auditDocs();
  if (!audit) return;
  const { byFile, coverage } = audit;
  const findings = [...byFile.values()].flat();
  // The build can finish or restart while this runs, so the post-condition is
  // asserted too: a workspace package reported as untyped means the tree moved
  // underneath the compile, not that a page is wrong.
  const untyped = findings.filter(line =>
    /error TS7016: Could not find a declaration file for module '(?:nextly|@nextlyhq\/)/.test(
      line
    )
  );
  if (untyped.length > 0) {
    console.error(
      `doc samples: ${String(untyped.length)} sample(s) report a workspace package as ` +
        "untyped, which means the build moved while this ran. Re-run against a " +
        "settled tree; none of these are findings about the docs."
    );
    process.exit(1);
  }
  const counted = Object.fromEntries(
    [...byFile].map(([file, lines]) => [file, lines.length])
  );

  // What each page is failing ON, not just how many times. A count is a weak
  // invariant: a change that removes one finding and introduces a different one
  // leaves it equal, so neither the worse nor the better branch fires and a
  // newly broken sample is accepted. Identities close that.
  const fingerprint = Object.fromEntries(
    [...byFile].map(([file, lines]) => {
      const counts = {};
      for (const line of lines) {
        const key = identityOf(line);
        counts[key] = (counts[key] ?? 0) + 1;
      }
      return [file, counts];
    })
  );
  // Everything the audit set aside ratchets alongside the findings, each marked
  // with why. They are NOT findings: they do not raise a page's count and no
  // page is charged for them. What they now cannot do is change without anybody
  // noticing, which is what let three separate buckets absorb a newly broken
  // sample while every number the gate reads stood still.
  for (const d of audit.setAside) {
    const file = pageOf(d.text);
    const key = `${d.mark} ${identityOf(d.text)}`;
    fingerprint[file] = fingerprint[file] ?? {};
    fingerprint[file][key] = (fingerprint[file][key] ?? 0) + 1;
  }

  if (process.argv.includes("--write-baseline")) {
    // Refuses to record LESS coverage than the baseline already holds, unless
    // told to. Rewriting the baseline after a change is exactly how the
    // coverage ratchet gets defeated: an unclosed code fence dropped a sample
    // from extraction, the baseline was rewritten with the tree in that state,
    // and the loss became the new normal — the gate then passed while a page
    // rendered as one long code block. The escape hatch has to be harder to
    // reach than the honest path.
    const heldBaseline = readBaseline();
    const held = heldBaseline.coverage ?? {};
    // Per page as well as in aggregate. A loss on one page offset by a gain on
    // another leaves every total standing, so the aggregate guard waved the
    // write through and `samplesPerPage` was replaced with the diminished set —
    // the exact hole per-page tracking exists to close, left open in the one
    // path that overwrites it.
    const shrunkPages = Object.entries(
      heldBaseline.samplesPerPage ?? {}
    ).filter(([file, was]) => {
      const now = coverage.perPage[file] ?? { samples: 0, compiled: 0 };
      return (
        (now.samples ?? 0) < (was.samples ?? 0) ||
        (now.compiled ?? 0) < (was.compiled ?? 0)
      );
    });
    const shrunk = Object.entries(held).filter(
      ([what, was]) =>
        ({
          pages: coverage.files.length,
          samples: coverage.samples,
          compiled: coverage.compiled,
        })[what] < was
    );
    if (
      (shrunk.length > 0 || shrunkPages.length > 0) &&
      !process.argv.includes("--allow-coverage-loss")
    ) {
      console.error(
        "doc samples: this would record LESS coverage than the baseline holds, " +
          "which is what a lost fence looks like. Check that no fence was " +
          "broken or deleted; pass --allow-coverage-loss if the loss is real " +
          "and intended.\n"
      );
      for (const [what, was] of shrunk) {
        console.error(`  ${what}: baseline ${String(was)}`);
      }
      for (const [file, was] of shrunkPages) {
        console.error(
          `  ${file}: baseline ${String(was.samples)} sample(s), ${String(was.compiled)} compiled`
        );
      }
      process.exit(1);
    }

    // ...and refuses to record a diagnostic the baseline does not already hold,
    // for the same reason. The comparison path tells a contributor to fix a new
    // finding rather than record it; this path recorded it silently, so the two
    // disagreed about the same state and the quieter one won. Committing that
    // generated file then made every later run agree, which is a regression
    // blessed permanently by the tool built to catch it.
    const { appeared: newFindings } = compareToBaseline({
      baseline: heldBaseline,
      coverage,
      counted,
      fingerprint,
    });
    if (
      newFindings.length > 0 &&
      !process.argv.includes("--allow-new-findings")
    ) {
      console.error(
        "doc samples: this would record diagnostics the baseline does not hold. " +
          "Fix the sample rather than recording it; pass --allow-new-findings " +
          "if recording it is deliberate.\n"
      );
      for (const line of newFindings) console.error(`  ${line}`);
      process.exit(1);
    }
    // The escape hatch says what it is blessing. A flag that silently widens
    // what the gate accepts is the same hole one argument further away.
    if (newFindings.length > 0) {
      console.warn(
        `doc samples: recording ${String(newFindings.length)} new diagnostic(s) ` +
          "because --allow-new-findings was passed:"
      );
      for (const line of newFindings) console.warn(`  ${line}`);
    }

    writeFileSync(
      BASELINE,
      `${JSON.stringify(
        {
          coverage: {
            pages: coverage.files.length,
            samples: coverage.samples,
            compiled: coverage.compiled,
          },
          samplesPerPage: coverage.perPage,
          pages: counted,
          findings: fingerprint,
        },
        null,
        2
      )}\n`
    );
    console.log(
      `doc samples: baseline written for ${String(Object.keys(counted).length)} page(s), ` +
        `${String(findings.length)} finding(s), ${auditBasis()}.`
    );
    return;
  }

  // One page at a time, for a reader working through a single file: the
  // whole-repository verdict is not useful while other pages are mid-edit, and
  // a person checking their own work should not have to read past everyone
  // else's. The baseline is still the whole repository's; only the comparison
  // narrows.
  const onlyIndex = process.argv.indexOf("--only");
  const only = onlyIndex === -1 ? null : process.argv[onlyIndex + 1];
  if (only) {
    // A selector matching no page is a typo, not a clean page. Defaulting both
    // sides to zero reported "allowed 0, found 0" and exited successfully for
    // `--only docs/does-not-exist.mdx`, which is a check that cannot fail.
    if (!coverage.files.includes(only)) {
      console.error(
        `doc samples: --only ${only} matched no documentation page, so nothing ` +
          "was checked. Check the path against docs/."
      );
      process.exit(1);
    }
    const recordedForPage = readBaseline();
    const found = counted[only] ?? 0;
    const cap = (recordedForPage.pages ?? {})[only] ?? 0;
    const lines = byFile.get(only) ?? [];
    console.log(`\n${only}: allowed ${String(cap)}, found ${String(found)}`);
    for (const line of lines) console.log(`  ${line}`);
    // The same three comparisons CI runs, narrowed to this page rather than
    // reduced to its total. Exits 1 on an improvement too, as the whole-
    // repository path does: printing a suggestion and succeeding let a
    // contributor pass both before and after fixing something, so nothing ever
    // made them lower the ratchet.
    const verdict = compareToBaseline({
      baseline: recordedForPage,
      coverage,
      counted,
      fingerprint,
      only,
    });
    if (reportComparison(verdict, lines)) process.exit(1);
    return;
  }

  // Coverage ratchets too. Findings alone cannot tell a page that was fixed
  // from a page the extractor stopped seeing: both report nothing.
  const recorded = readBaseline();
  const verdict = compareToBaseline({
    baseline: recorded,
    coverage,
    counted,
    fingerprint,
  });
  if (reportComparison(verdict, findings)) process.exit(1);

  if (process.argv.includes("--list")) {
    for (const line of findings) console.log(`  ${line}`);
  }
}

if (process.argv[1]?.endsWith("check-doc-samples.mjs")) await main();
